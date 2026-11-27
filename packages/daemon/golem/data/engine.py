"""One source, read-only, in DuckDB. Runs inside the worker process.

A source is an in-memory DuckDB database of its own. It is filled first (views over
files, or an attached database) and then closed in three steps, in this order:
``allowed_paths`` names only the source's own files (not the folder: DuckDB writes a
file's replacement next to it, and that is refused), ``enable_external_access`` turns off
everything else, and ``lock_configuration`` stops a query from turning either back on or
raising its own memory limit. Views and attached databases made before the lock keep
working. ``guard.refusal`` runs first on every query and gives the model a sentence
instead of a permission error.
"""

from __future__ import annotations

import datetime as dt
import decimal
import glob as globlib
import math
import re
import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import duckdb

from golem.data import guard
from golem.data.database import (
    DatabaseTarget,
    connection_string,
    parse_url,
    privileges_can_write,
    version_label,
)
from golem.data.types import (
    DATABASE_KINDS,
    EXTENSION_FILES,
    DataError,
    NeedsExtension,
    SourceSpec,
)

_FILE_KINDS = {
    ".csv": "csv",
    ".tsv": "csv",
    ".parquet": "parquet",
    ".json": "json",
    ".jsonl": "json",
    ".ndjson": "json",
    ".xlsx": "excel",
}
_DATABASE_SUFFIXES = {
    ".sqlite": "sqlite",
    ".sqlite3": "sqlite",
    ".db": "sqlite",
    ".duckdb": "duckdb",
    ".ddb": "duckdb",
}
_READERS = {
    "csv": "read_csv({files}, filename=true)",
    "parquet": "read_parquet({files}, filename=true)",
    "json": "read_json({files}, filename=true)",
}
_WILDCARDS = re.compile(r"[*?\[]")
_TABLE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_COLUMN_TYPES = frozenset({"VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"})
_PASSWORD_PAIR = re.compile(r"(pass(?:wor)?d\s*=\s*)('(?:[^'\\]|\\.)*'|\S+)", re.IGNORECASE)
_SIZE = re.compile(r"^\d+(\.\d+)?\s?(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Limits:
    """What one source's connection may use."""

    memory: str = "2GB"
    threads: int = 4
    extension_dir: Path | None = None
    temp_dir: Path | None = None


_passwords: set[str] = set()


def redact(text: str) -> str:
    """``text`` with every password this worker knows, and any ``password=...``, hidden."""
    for secret in sorted(_passwords, key=len, reverse=True):
        text = text.replace(secret, "***")
    return _PASSWORD_PAIR.sub(r"\1***", text)


def extension_installed(directory: Path, name: str) -> bool:
    """Whether DuckDB's extension ``name`` is in golem's extension folder."""
    file = EXTENSION_FILES.get(name)
    if file is None or not directory.is_dir():
        return False
    return any(directory.glob(f"**/{file}.duckdb_extension"))


def install_extension(directory: Path, name: str) -> None:
    """Download extension ``name`` into ``directory``. The only place that uses the network."""
    if name not in EXTENSION_FILES:
        raise DataError(f"golem has no data extension called {name}.")
    directory.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect()
    try:
        connection.execute("set extension_directory = ?", [str(directory)])
        connection.execute(f"install {_ident(name)}")
    except duckdb.Error as exc:
        raise DataError(
            f"DuckDB's {name} extension needs a one-time download. "
            f"golem could not reach extensions.duckdb.org: {_message(exc)}"
        ) from exc
    finally:
        connection.close()


PG_ESTIMATES = (
    "select n.nspname, c.relname, c.reltuples::bigint from pg_class c "
    "join pg_namespace n on n.oid = c.relnamespace "
    "where c.relkind in ('r', 'p', 'm', 'f') "
    "and n.nspname not in ('pg_catalog', 'information_schema')"
)
PG_CAN_WRITE = (
    "select coalesce(bool_or(has_table_privilege(c.oid, 'INSERT') "
    "or has_table_privilege(c.oid, 'UPDATE') or has_table_privilege(c.oid, 'DELETE')), false) "
    "or (select rolsuper from pg_roles where rolname = current_user) "
    "from pg_class c join pg_namespace n on n.oid = c.relnamespace "
    "where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')"
)
# ``SHOW GRANTS`` cannot run through ``mysql_query`` (it has no result types), so the login's
# privileges come from information_schema: global ones, then the database's, then its tables'.
_MYSQL_GRANTEE = (
    "concat(char(39), substring_index(current_user(), char(64), 1), char(39), char(64), "
    "char(39), substring_index(current_user(), char(64), -1), char(39))"
)
MYSQL_PRIVILEGES = (
    "select privilege_type from information_schema.user_privileges "
    f"where grantee = {_MYSQL_GRANTEE} "
    "union all select privilege_type from information_schema.schema_privileges "
    f"where grantee = {_MYSQL_GRANTEE} and table_schema = database() "
    "union all select privilege_type from information_schema.table_privileges "
    f"where grantee = {_MYSQL_GRANTEE} and table_schema = database()"
)
MYSQL_ESTIMATES = (
    "select table_schema, table_name, table_rows from information_schema.tables "
    "where table_schema not in ('mysql', 'sys', 'information_schema', 'performance_schema')"
)


def attach_server(connection: Any, spec: SourceSpec, target: DatabaseTarget) -> None:
    """``ATTACH`` the server as ``src``, read-only. The one place a password meets SQL text."""
    text = connection_string(target, spec.password, spec.timeout_s)
    try:
        connection.execute(f"attach {_literal(text)} as src (type {spec.kind}, read_only)")
    except duckdb.Error as exc:
        raise DataError(
            f"Cannot connect to the {spec.kind} database at {target.host}: {_message(exc)}"
        ) from exc


class Source:
    """An attached source: its connection, its tables, and its queries."""

    def __init__(self, spec: SourceSpec, limits: Limits) -> None:
        self.spec = spec
        self._attached = False
        self._remote: dict[str, tuple[str, str]] = {}
        self._remote_kinds: dict[str, str] = {}
        """A database's tables: the name shown, then its schema and its name there."""
        self._estimates: dict[tuple[str, str], int] = {}
        self._schema: str | None = None
        self.info: dict[str, Any] = {}
        """What the server told on connect: ``version``, and ``can_write`` when known."""
        if spec.password:
            _passwords.add(spec.password)
            _passwords.add(spec.password.replace("\\", "\\\\").replace("'", "\\'"))
        if not _SIZE.match(limits.memory.strip()):
            raise DataError(f"worker_memory is a size such as 2GB, not {limits.memory!r}.")
        self._connection = duckdb.connect(":memory:")
        try:
            self._open(limits)
        except BaseException:
            self._connection.close()
            raise

    def close(self) -> None:
        self._connection.close()

    def cursor(self) -> Any:
        """A cursor of its own, which ``interrupt()`` stops without touching the others."""
        cursor = self._connection.cursor()
        if self._attached:
            cursor.execute(f"use src.{_ident(self._schema)}" if self._schema else "use src")
        return cursor

    def tables(self) -> list[dict[str, Any]]:
        if self.spec.kind in DATABASE_KINDS:
            return [
                {
                    "name": name,
                    "type": kind,
                    "rows": self._estimates.get(self._remote[name]),
                }
                for name, kind in self._remote_kinds.items()
            ]
        rows = self._connection.execute(
            "select table_name, table_type from information_schema.tables "
            "where table_catalog = current_database() and table_schema = current_schema() "
            "order by table_name"
        ).fetchall()
        return [
            {"name": str(name), "type": "view" if "VIEW" in str(kind) else "table"}
            for name, kind in rows
        ]

    def describe(self, table: str) -> dict[str, Any]:
        if table not in {t["name"] for t in self.tables()}:
            known = ", ".join(t["name"] for t in self.tables()) or "none"
            raise DataError(f"There is no table called {table}. The tables are: {known}.")
        if self.spec.kind in DATABASE_KINDS:
            return self._describe_remote(table)
        cursor = self.cursor()
        try:
            rows = cursor.execute(f"summarize {_ident(table)}").fetchall()
            count = cursor.execute(f"select count(*) from {_ident(table)}").fetchone()
        finally:
            cursor.close()
        columns = [
            {
                "name": str(row[0]),
                "type": str(row[1]),
                "min": _json(row[2]),
                "max": _json(row[3]),
                "distinct": _json(row[4]),
                "null_percent": _json(row[-1]),
            }
            for row in rows
        ]
        return {"table": table, "rows": int(count[0]) if count else 0, "columns": columns}

    def _describe_remote(self, table: str) -> dict[str, Any]:
        """The columns of a database table from the catalog. It reads no rows of the table."""
        schema, name = self._remote[table]
        rows = self._connection.execute(
            "select column_name, data_type from duckdb_columns() "
            "where database_name = 'src' and schema_name = ? and table_name = ? "
            "order by column_index",
            [schema, name],
        ).fetchall()
        columns = [
            {
                "name": str(column),
                "type": str(kind),
                "min": None,
                "max": None,
                "distinct": None,
                "null_percent": None,
            }
            for column, kind in rows
        ]
        return {
            "table": table,
            "rows": self._estimates.get((schema, name)),
            "columns": columns,
        }

    def load_table(
        self, table: str, columns: list[dict[str, str]], rows: list[list[Any]], replace: bool
    ) -> int:
        """Put ``rows`` in an in-memory table of a ``builtin`` source. Only the daemon calls this.

        ``replace`` drops the table first, so a reload starts clean and a later batch of the same
        load (``replace`` false) adds to it. Returns the number of rows in the table.
        """
        if self.spec.kind != "builtin":
            raise DataError("Only the built-in source takes rows from the daemon.")
        if not _TABLE_NAME.match(table):
            raise DataError(f"{table!r} is not a table name.")
        if not columns:
            raise DataError("A table needs at least one column.")
        definitions: list[str] = []
        for column in columns:
            name, kind = str(column.get("name", "")), str(column.get("type", "")).upper()
            if not _TABLE_NAME.match(name) or kind not in _COLUMN_TYPES:
                raise DataError(f"{name!r} {kind} is not a column golem can load.")
            definitions.append(f"{_ident(name)} {kind}")
        con = self._connection
        marks = ", ".join("?" for _ in columns)
        try:
            if replace:
                con.execute(f"create or replace table {_ident(table)} ({', '.join(definitions)})")
            if rows:
                con.executemany(f"insert into {_ident(table)} values ({marks})", rows)
            count = con.execute(f"select count(*) from {_ident(table)}").fetchone()
        except duckdb.Error as exc:
            raise DataError(f"Cannot load {table}: {_message(exc)}") from exc
        return int(count[0]) if count else 0

    def query(
        self,
        sql: str,
        limit: int,
        cursor: Any | None = None,
        keep: Callable[[list[str], list[str], list[Any]], None] | None = None,
    ) -> dict[str, Any]:
        """Run ``sql``. ``keep`` gets the column names, their types and the raw rows to store.

        A ``keep`` that raises :class:`DataError` leaves the answer as it is, with ``stored``
        false: a result that cannot be kept is still a result.
        """
        reason = guard.refusal(sql)
        if reason is not None:
            raise DataError(reason)
        if limit < 1:
            raise DataError("The row limit is at least 1.")
        own = cursor is None
        run: Any = cursor if cursor is not None else self.cursor()
        started = time.monotonic()
        try:
            run.execute(sql)
            description: list[Any] = run.description or []
            rows: list[Any] = run.fetchmany(limit + 1)
        except duckdb.InterruptException as exc:
            raise DataError("The query was cancelled.") from exc
        except duckdb.Error as exc:
            raise DataError(_message(exc)) from exc
        finally:
            if own:
                run.close()
        truncated = len(rows) > limit
        kept = rows[:limit]
        names = unique_names([str(d[0]) for d in description])
        stored = False
        if keep is not None and names:
            try:
                keep(names, [str(d[1]) for d in description], kept)
                stored = True
            except DataError:
                stored = False
        return {
            "columns": [
                {"name": n, "type": str(d[1])} for n, d in zip(names, description, strict=True)
            ],
            "rows": [[_json(value) for value in row] for row in kept],
            "truncated": truncated,
            "stored": stored,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }

    # -- opening ---------------------------------------------------------------------------

    def _open(self, limits: Limits) -> None:
        con = self._connection
        con.execute("set memory_limit = ?", [limits.memory.strip()])
        con.execute("set threads = ?", [limits.threads])
        con.execute("set autoinstall_known_extensions = false")
        con.execute("set autoload_known_extensions = true")
        if limits.extension_dir is not None:
            con.execute("set extension_directory = ?", [str(limits.extension_dir)])
        if limits.temp_dir is not None:
            limits.temp_dir.mkdir(parents=True, exist_ok=True)
            con.execute("set temp_directory = ?", [str(limits.temp_dir)])
        spec = self.spec
        if spec.kind == "files":
            allowed = self._files(spec, limits)
        elif spec.kind == "builtin":
            allowed = []
        elif spec.kind in DATABASE_KINDS:
            allowed = self._server(spec, limits)
        else:
            allowed = self._database(spec, limits)
        con.execute("set allowed_paths = ?", [allowed])
        con.execute("set enable_external_access = false")
        con.execute("set lock_configuration = true")

    def _database(self, spec: SourceSpec, limits: Limits) -> list[str]:
        path = Path(spec.location).expanduser()
        if not path.is_file():
            raise DataError(f"There is no file at {path}.")
        real = path.resolve()
        if spec.kind == "sqlite":
            self._load("sqlite", "sqlite_scanner", limits)
            kind = "(type sqlite, read_only)"
        else:
            kind = "(read_only)"
        try:
            self._connection.execute(f"attach {_literal(str(real))} as src {kind}")
            self._connection.execute("use src")
            self._attached = True
        except duckdb.Error as exc:
            raise DataError(
                f"Cannot open {path} as a {spec.kind} database: {_message(exc)}"
            ) from exc
        return [str(real)]

    def _server(self, spec: SourceSpec, limits: Limits) -> list[str]:
        """Attach a Postgres or MySQL database read-only. Nothing of it is a file."""
        target = parse_url(spec.location)
        if target.kind != spec.kind:
            raise DataError(f"The address is a {target.kind} address, not a {spec.kind} one.")
        self._load(spec.kind, EXTENSION_FILES[spec.kind], limits)
        attach_server(self._connection, spec, target)
        self._attached = True
        self._list_server(target)
        self._probe_server(target)
        return []

    def _list_server(self, target: DatabaseTarget) -> None:
        con = self._connection
        rows = con.execute(
            "select schema_name, table_name, kind from ("
            "select schema_name, table_name, 'table' as kind from duckdb_tables() "
            "where database_name = 'src' and not internal "
            "union all select schema_name, view_name, 'view' from duckdb_views() "
            "where database_name = 'src' and not internal) "
            "order by schema_name, table_name"
        ).fetchall()
        schemas = {str(schema) for schema, _, _ in rows}
        bare = next((s for s in target.bare_schemas if s in schemas), None)
        self._schema = bare
        for schema, name, kind in rows:
            shown = str(name) if str(schema) == bare else f"{schema}.{name}"
            self._remote[shown] = (str(schema), str(name))
            self._remote_kinds[shown] = str(kind)

    def _probe_server(self, target: DatabaseTarget) -> None:
        """Ask the server its version, its row estimates and what this login may change.

        Every question is optional: one that fails leaves its answer unknown, and the source
        still opens.
        """
        func = "postgres_query" if target.kind == "postgres" else "mysql_query"

        def ask(sql: str) -> list[tuple[Any, ...]] | None:
            try:
                return self._connection.execute(
                    f"select * from {func}('src', {_literal(sql)})"
                ).fetchall()
            except duckdb.Error:
                return None

        version = ask("select version()")
        if version:
            self.info["version"] = version_label(target.kind, str(version[0][0]))
        if target.kind == "postgres":
            counts = ask(PG_ESTIMATES)
            writes = ask(PG_CAN_WRITE)
            if writes:
                self.info["can_write"] = _truthy(writes[0][0])
        else:
            counts = ask(MYSQL_ESTIMATES)
            privileges = ask(MYSQL_PRIVILEGES)
            if privileges is not None:
                self.info["can_write"] = privileges_can_write([str(row[0]) for row in privileges])
            # The source is attached read-only, so DuckDB refuses ``mysql_execute`` and the
            # server cannot be asked for a read-only session or a time limit. DuckDB's read-only
            # attach and the guard keep writes out; golem's own query timeout cuts a slow query.
        for schema, name, rows in counts or []:
            if rows is not None and int(rows) >= 0:
                self._estimates[(str(schema), str(name))] = int(rows)

    def _load(self, extension: str, file: str, limits: Limits) -> None:
        """Load an extension from golem's folder. It is never downloaded here."""
        if limits.extension_dir is None or not extension_installed(limits.extension_dir, extension):
            raise NeedsExtension(extension)
        try:
            self._connection.execute(f"load {file}")
        except duckdb.Error as exc:
            raise NeedsExtension(extension) from exc

    def _files(self, spec: SourceSpec, limits: Limits) -> list[str]:
        found = matched_files(spec.location)
        if not found:
            raise DataError(
                f"No CSV, TSV, Parquet, JSON or Excel files match {spec.location}. "
                "A source reads .csv, .tsv, .parquet, .json, .jsonl, .ndjson and .xlsx."
            )
        if any(kind == "excel" for _, kind in found):
            self._load("excel", "excel", limits)
        groups: dict[tuple[str, tuple[str, ...]], list[Path]] = defaultdict(list)
        for path, kind in found:
            groups[(kind, self._columns(kind, path))].append(path)
        base, pattern = _split(spec.location)
        glob_name = _glob_name(pattern, base.resolve())
        taken: set[str] = set()
        for (kind, _), paths in groups.items():
            stem = glob_name if len(paths) > 1 else paths[0].stem
            name = _unique(_table_name(stem), taken)
            if kind == "excel":
                body = " union all by name ".join(
                    f"select {_literal(str(p))} as file, * from read_xlsx({_literal(str(p))})"
                    for p in paths
                )
            else:
                files = "[" + ", ".join(_literal(str(p)) for p in paths) + "]"
                reader = _READERS[kind].format(files=files)
                body = f"select filename as file, * exclude (filename) from {reader}"
            self._connection.execute(f"create view {_ident(name)} as {body}")
        return [str(path.resolve()) for path, _ in found]

    def _columns(self, kind: str, path: Path) -> tuple[str, ...]:
        if kind == "excel":
            reader = f"read_xlsx({_literal(str(path))})"
        else:
            reader = _READERS[kind].format(files=_literal(str(path)))
        try:
            cursor = self._connection.execute(f"select * from {reader} limit 0")
        except duckdb.Error as exc:
            raise DataError(f"Cannot read {path.name}: {_message(exc)}") from exc
        return tuple(str(d[0]) for d in cursor.description)


# -- what a location holds ---------------------------------------------------------------


def sniff_kind(path: Path) -> str | None:
    """What a file with no known suffix is, from its first bytes: a file kind or a database."""
    try:
        with path.open("rb") as handle:
            head = handle.read(4096)
    except OSError:
        return None
    if head.startswith(b"SQLite format 3\x00"):
        return "sqlite"
    if head[8:12] == b"DUCK":
        return "duckdb"
    if head.startswith(b"PAR1"):
        return "parquet"
    if head.startswith(b"PK\x03\x04"):
        return "excel"
    if not head:
        return None
    try:
        text = head.decode("utf-8").lstrip()
    except UnicodeDecodeError:
        return None
    if text[:1] in ("{", "["):
        return "json"
    first = text.splitlines()[0] if text else ""
    return "csv" if "," in first or "\t" in first else None


def location_kind(location: str) -> str:
    """The source kind of ``location``: a database file by its suffix or first bytes, else files."""
    path = Path(location).expanduser()
    suffix = path.suffix.lower()
    if suffix in _DATABASE_SUFFIXES:
        return _DATABASE_SUFFIXES[suffix]
    if suffix in _FILE_KINDS or _WILDCARDS.search(location) or not path.is_file():
        return "files"
    sniffed = sniff_kind(path)
    return sniffed if sniffed in ("sqlite", "duckdb") else "files"


def matched_files(location: str) -> list[tuple[Path, str]]:
    """The files a ``files`` source reads, with the reader of each, sorted by path.

    A link that leaves the folder is left out. A single file with no known suffix is read as
    what its first bytes say it is.
    """
    base, pattern = _split(location)
    if not base.is_dir():
        raise DataError(f"There is no folder at {base}.")
    real_base = base.resolve()
    found: list[tuple[Path, str]] = []
    for name in sorted(globlib.glob(str(real_base / pattern), recursive=True)):
        path = Path(name)
        if not path.is_file() or not _inside(path.resolve(), real_base):
            continue  # a link that leaves the folder is not part of the source
        kind = _FILE_KINDS.get(path.suffix.lower())
        if kind is None and not _WILDCARDS.search(location) and not path.suffix:
            sniffed = sniff_kind(path)
            kind = sniffed if sniffed in _READERS or sniffed == "excel" else None
        if kind is not None:
            found.append((path, kind))
    return found


def stamp(spec: SourceSpec) -> tuple[tuple[str, int, int], ...]:
    """The path, modified time and size of each file a source reads. Empty when it has none."""
    if spec.kind in DATABASE_KINDS:
        return ()  # a server's data is read live, not kept
    try:
        if spec.kind == "files":
            paths = [path for path, _ in matched_files(spec.location)]
        else:
            paths = [Path(spec.location).expanduser()]
        out: list[tuple[str, int, int]] = []
        for path in paths:
            info = path.stat()
            out.append((str(path), info.st_mtime_ns, info.st_size))
        return tuple(out)
    except (OSError, DataError):
        return ()


def needed_extension(spec: SourceSpec) -> str | None:
    """The extension a source needs, from its files alone. It does not open the source."""
    try:
        if spec.kind in ("sqlite", "postgres", "mysql"):
            return spec.kind
        if spec.kind == "files" and any(
            kind == "excel" for _, kind in matched_files(spec.location)
        ):
            return "excel"
    except DataError:
        return None
    return None


# -- names and values --------------------------------------------------------------------


def _split(location: str) -> tuple[Path, str]:
    """The folder a location starts in, and the rest of it as a glob."""
    path = Path(location).expanduser()
    if not _WILDCARDS.search(location):
        if path.is_dir():
            return path, "*"
        return path.parent, path.name
    parts = path.parts
    index = next(i for i, part in enumerate(parts) if _WILDCARDS.search(part))
    return Path(*parts[:index]), str(Path(*parts[index:]))


def _glob_name(pattern: str, base: Path) -> str:
    """A table's name for a glob: the file pattern's fixed start, else the folder's name."""
    stem = Path(pattern).name.split(".")[0]
    fixed = _WILDCARDS.split(stem)[0].strip("_-. ")
    return fixed or base.name or "data"


def _table_name(text: str) -> str:
    name = re.sub(r"[^0-9a-z_]+", "_", text.lower()).strip("_") or "data"
    return f"t_{name}" if name[0].isdigit() else name


def _unique(name: str, taken: set[str]) -> str:
    candidate, count = name, 1
    while candidate in taken:
        count += 1
        candidate = f"{name}_{count}"
    taken.add(candidate)
    return candidate


def _inside(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _truthy(value: object) -> bool:
    """A yes from a server: ``True``, ``1``, ``t`` or ``true``."""
    return value is True or str(value).strip().lower() in ("1", "t", "true")


def _message(exc: Exception) -> str:
    text = redact(str(exc).strip())
    return text.splitlines()[0] if text else type(exc).__name__


def _json(value: Any) -> Any:
    """A value DuckDB returned, as something JSON can carry."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, decimal.Decimal):
        if not value.is_finite():
            return str(value)
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dt.datetime | dt.date | dt.time):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(cast("bytes | bytearray | memoryview[int]", value)).hex()
    if isinstance(value, list | tuple):
        return [_json(item) for item in cast("list[Any]", value)]
    if isinstance(value, dict):
        return {str(key): _json(item) for key, item in cast("dict[Any, Any]", value).items()}
    return str(value)


def unique_names(names: Sequence[str]) -> list[str]:
    """``names`` with a repeat renamed ``name_2``, ``name_3``: a table has one column per name."""
    seen: set[str] = set()
    out: list[str] = []
    for index, name in enumerate(names):
        base = name or f"column{index + 1}"
        candidate, number = base, 1
        while candidate in seen:
            number += 1
            candidate = f"{base}_{number}"
        seen.add(candidate)
        out.append(candidate)
    return out


json_value = _json
"""A value DuckDB returned, as something JSON can carry (for the result files)."""
