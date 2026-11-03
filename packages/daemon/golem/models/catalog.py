"""The bundled list of local models golem suggests downloading."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from importlib import resources


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    ref: str
    label: str
    size_gb: float
    tags: tuple[str, ...]
    min_ram_gb: float | None = None


def load_local_catalog() -> list[CatalogEntry]:
    """Entries in file order, smallest first."""
    text = resources.files("golem.models").joinpath("data/local-catalog.toml").read_text("utf-8")
    raw = tomllib.loads(text)
    entries: list[CatalogEntry] = []
    for item in raw.get("model", []):
        entries.append(
            CatalogEntry(
                ref=str(item["ref"]),
                label=str(item["label"]),
                size_gb=float(item["size_gb"]),
                tags=tuple(str(tag) for tag in item.get("tags", [])),
                min_ram_gb=float(item["min_ram_gb"]) if "min_ram_gb" in item else None,
            )
        )
    return entries
