"""What the daemon and the worker both know. Pure: it imports nothing heavy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

SourceKind = Literal["files", "sqlite", "duckdb", "builtin"]
SOURCE_KINDS: tuple[SourceKind, ...] = ("files", "sqlite", "duckdb", "builtin")
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
    """One source: ``kind`` says how to read ``location``, a path or a glob."""

    name: str
    kind: SourceKind
    location: str

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name, "kind": self.kind, "location": self.location}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> SourceSpec:
        kind = data.get("kind")
        if kind not in SOURCE_KINDS:
            raise DataError(f"A source is one of {', '.join(SOURCE_KINDS)}, not {kind!r}.")
        name, location = data.get("name"), data.get("location")
        if not isinstance(name, str) or not name or not isinstance(location, str) or not location:
            raise DataError("A source needs a name and a location.")
        return cls(name=name, kind=kind, location=location)
