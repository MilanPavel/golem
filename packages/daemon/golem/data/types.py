"""What the daemon and the worker both know. Pure: it imports nothing heavy."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

SourceKind = Literal["files", "sqlite", "duckdb", "postgres", "mysql", "builtin"]
SOURCE_KINDS: tuple[SourceKind, ...] = (
    "files", "sqlite", "duckdb", "postgres", "mysql", "builtin"
)  # fmt: skip
DATABASE_KINDS = ("postgres", "mysql")
"""The kinds that are a server golem connects to, with a password the daemon resolves."""
"""``builtin`` is an empty in-memory database the daemon fills with ``load_table``."""

EXTENSION_FILES = {
    "sqlite": "sqlite_scanner",
    "excel": "excel",
    "postgres": "postgres_scanner",
    "mysql": "mysql_scanner",
}
"""The extensions golem installs once, by the name it uses and the file DuckDB writes."""


EXTENSION_NEEDS = {
    "excel": ("Excel", "2 MB"),
    "sqlite": ("SQLite files", "3 MB"),
    "postgres": ("PostgreSQL databases", "30 MB"),
    "mysql": ("MySQL databases", "30 MB"),
}
"""What a person is told about an extension a source needs: what it reads, and how big it is."""


class DataError(Exception):
    """A plain sentence the model or the user can act on."""


class NeedsExtension(DataError):
    """A source cannot be read until a DuckDB extension is downloaded once."""

    def __init__(self, extension: str) -> None:
        reading, size = EXTENSION_NEEDS.get(extension, (extension, "a few MB"))
        super().__init__(
            f"Reading {reading} needs a one-time download ({size}) from extensions.duckdb.org. "
            "Get it?"
        )
        self.extension = extension


@dataclass(frozen=True, slots=True)
class SourceSpec:
    """One source: ``kind`` says how to read ``location``, a path, a glob or a database URL.

    ``password`` is for a database only. It is resolved by the daemon, goes to the worker over
    its pipe, and is left out of ``repr``. ``location`` never holds it.
    """

    name: str
    kind: SourceKind
    location: str
    password: str | None = field(default=None, repr=False)
    timeout_s: float = 15.0

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "kind": self.kind, "location": self.location}
        if self.kind in DATABASE_KINDS:
            out["timeout_s"] = self.timeout_s
            if self.password is not None:
                out["password"] = self.password
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> SourceSpec:
        kind = data.get("kind")
        if kind not in SOURCE_KINDS:
            raise DataError(f"A source is one of {', '.join(SOURCE_KINDS)}, not {kind!r}.")
        name, location = data.get("name"), data.get("location")
        if not isinstance(name, str) or not name or not isinstance(location, str) or not location:
            raise DataError("A source needs a name and a location.")
        password, timeout = data.get("password"), data.get("timeout_s", 15.0)
        return cls(
            name=name,
            kind=kind,
            location=location,
            password=password if isinstance(password, str) else None,
            timeout_s=float(timeout) if isinstance(timeout, int | float) else 15.0,
        )
