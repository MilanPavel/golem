"""What the daemon and the worker both know. Pure: it imports nothing heavy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

SourceKind = Literal["files", "sqlite", "duckdb"]
SOURCE_KINDS: tuple[SourceKind, ...] = ("files", "sqlite", "duckdb")

EXTENSION_FILES = {
    "sqlite": "sqlite_scanner",
    "excel": "excel",
    "postgres": "postgres_scanner",
    "mysql": "mysql_scanner",
}
"""The extensions golem installs once, by the name it uses and the file DuckDB writes."""


class DataError(Exception):
    """A plain sentence the model or the user can act on."""


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
