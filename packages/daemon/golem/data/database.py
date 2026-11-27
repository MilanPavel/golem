"""A database source's address: parse it, build it, and turn it into DuckDB's connection string.

Pure: it imports nothing heavy, so the daemon and the worker both use it. A password is never
part of an address here. ``parse_url`` refuses one, and nothing in this file prints one except
``connection_string``, whose result goes straight to DuckDB's ``ATTACH`` inside the worker.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import parse_qs, quote, unquote, urlsplit

from golem.data.types import DataError

DEFAULT_PORTS = {"postgres": 5432, "mysql": 3306}
SSL_MODES = {
    "postgres": ("disable", "allow", "prefer", "require", "verify-ca", "verify-full"),
    "mysql": ("disabled", "preferred", "required", "verify_ca", "verify_identity"),
}
LABELS = {"postgres": "PostgreSQL", "mysql": "MySQL"}
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})
CONNECT_SECONDS = 10
"""How long a connection may take to open, at most."""

EMBEDS_PASSWORD = (
    "That address has a password in it. Remove it: golem keeps the password in the Keychain, "
    "never in a file."
)
WRITE_WARNING = "This login can change data. golem only reads, but a read-only login is safer."
_WRITE_PRIVILEGES = re.compile(
    r"\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|FILE|SUPER)\b",
    re.IGNORECASE,
)
_SERVER_NAME = re.compile(r"^[A-Za-z0-9._:\-\[\]]+$")


def read_only_howto(kind: str, database: str) -> str:
    """A short way to make a login that only reads, for the sentence after the warning."""
    if kind == "mysql":
        return (
            f"To make one: CREATE USER 'golem_ro'@'%' IDENTIFIED BY '...'; "
            f"GRANT SELECT ON {database}.* TO 'golem_ro'@'%';"
        )
    return (
        "To make one: CREATE ROLE golem_ro LOGIN PASSWORD '...'; "
        f"GRANT CONNECT ON DATABASE {database} TO golem_ro; "
        "GRANT USAGE ON SCHEMA public TO golem_ro; "
        "GRANT SELECT ON ALL TABLES IN SCHEMA public TO golem_ro;"
    )


@dataclass(frozen=True, slots=True)
class DatabaseTarget:
    """Where a database is, without its password."""

    kind: str
    host: str
    port: int | None
    database: str
    user: str | None
    ssl_mode: str | None = None

    @property
    def is_local(self) -> bool:
        return self.host.lower() in LOCAL_HOSTS

    @property
    def bare_schemas(self) -> tuple[str, ...]:
        """The schemas whose tables are shown without a prefix, first choice first."""
        return ("public",) if self.kind == "postgres" else (self.database, "main")


def kind_of_url(url: str) -> str | None:
    scheme = urlsplit(url).scheme.lower()
    if scheme in ("postgres", "postgresql"):
        return "postgres"
    return "mysql" if scheme == "mysql" else None


def parse_url(url: str) -> DatabaseTarget:
    """The parts of a ``postgres://`` or ``mysql://`` address. Refuses one with a password."""
    kind = kind_of_url(url)
    if kind is None:
        raise DataError("A database address starts with postgres:// or mysql://.")
    try:
        parts = urlsplit(url)
        password, host, port = parts.password, parts.hostname, parts.port
    except ValueError as exc:
        raise DataError("That is not a database address.") from exc
    if password is not None:
        raise DataError(EMBEDS_PASSWORD)
    if not host:
        raise DataError("The address has no host. Write it as postgres://user@host:5432/database.")
    database = unquote(parts.path.lstrip("/"))
    if not database:
        raise DataError("The address has no database name after the host.")
    query = parse_qs(parts.query)
    wanted = "sslmode" if kind == "postgres" else "ssl_mode"
    ssl = (query.get(wanted) or [None])[0]
    if ssl is not None and ssl not in SSL_MODES[kind]:
        raise DataError(f"{wanted} is one of {', '.join(SSL_MODES[kind])}, not {ssl!r}.")
    user = unquote(parts.username) if parts.username else None
    return DatabaseTarget(kind, host, port, database, user, ssl)


def build_url(target: DatabaseTarget) -> str:
    """The address of ``target``, with no password. ``parse_url`` reads it back."""
    if not _SERVER_NAME.match(target.host):
        raise DataError("The host is a name or an IP address, such as db.example.com.")
    scheme = "postgres" if target.kind == "postgres" else "mysql"
    host = (
        f"[{target.host}]"
        if ":" in target.host and not target.host.startswith("[")
        else target.host
    )
    login = f"{quote(target.user, safe='')}@" if target.user else ""
    port = f":{target.port}" if target.port else ""
    text = f"{scheme}://{login}{host}{port}/{quote(target.database, safe='')}"
    if target.ssl_mode:
        key = "sslmode" if target.kind == "postgres" else "ssl_mode"
        text += f"?{key}={target.ssl_mode}"
    return text


def _quoted(value: str, quote: str = "'") -> str:
    return quote + value.replace("\\", "\\\\").replace(quote, "\\" + quote) + quote


def connection_string(target: DatabaseTarget, password: str | None, timeout_s: float) -> str:
    """What DuckDB's ``ATTACH`` takes. The server is told to read only and to cut a slow query."""
    ms = max(1, int(timeout_s * 1000))
    if target.kind == "postgres":
        options = (
            f"-c default_transaction_read_only=on -c statement_timeout={ms} "
            f"-c idle_in_transaction_session_timeout={ms}"
        )
        pairs = [
            ("host", target.host),
            ("port", str(target.port or DEFAULT_PORTS["postgres"])),
            ("dbname", target.database),
            ("user", target.user),
            ("password", password),
            ("sslmode", target.ssl_mode),
            ("connect_timeout", str(min(CONNECT_SECONDS, max(1, int(timeout_s))))),
            ("application_name", "golem"),
            ("options", options),
        ]
    else:
        pairs = [
            ("host", target.host),
            ("port", str(target.port or DEFAULT_PORTS["mysql"])),
            ("database", target.database),
            ("user", target.user),
            ("password", password),
            ("ssl_mode", target.ssl_mode),
        ]
    # libpq takes single quotes; the MySQL scanner reads a single-quoted value literally
    # (``port='3306'`` fails with "stoi: no conversion"), but double quotes work.
    quote = "'" if target.kind == "postgres" else '"'
    return " ".join(f"{key}={_quoted(value, quote)}" for key, value in pairs if value)


def privileges_can_write(privileges: Sequence[str]) -> bool:
    """Whether a MySQL login's privilege types (global, on the database, or on one of its tables)
    include one that changes data."""
    return any(_WRITE_PRIVILEGES.fullmatch(str(kind).strip()) for kind in privileges)


def version_label(kind: str, raw: str) -> str:
    """A short label: ``PostgreSQL 17.2`` or ``MySQL 8.0.36`` from what ``version()`` says."""
    text = raw.strip()
    if kind == "postgres":
        found = re.match(r"PostgreSQL\s+(\S+)", text)
        return f"PostgreSQL {found.group(1)}" if found else text.split(" on ")[0]
    if "mariadb" in text.lower():
        return f"MariaDB {text.split('-')[0]}"
    return f"MySQL {text.split('-')[0]}"
