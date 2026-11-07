"""The bundled list of models golem suggests: local ones to download, hosted ones to offer."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from importlib import resources
from typing import Any

from golem.config import HOSTED_PROVIDERS

# The fixed set a model can be filed under.
CATEGORIES = ("general", "coding", "reasoning", "vision", "fast", "long-context")


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    ref: str
    label: str
    size_gb: float
    tags: tuple[str, ...]
    min_ram_gb: float | None = None


@dataclass(frozen=True, slots=True)
class HostedEntry:
    ref: str
    label: str
    blurb: str
    categories: tuple[str, ...]

    @property
    def provider(self) -> str:
        return self.ref.split("/", 1)[0]


def _raw() -> dict[str, Any]:
    text = resources.files("golem.models").joinpath("data/catalog.toml").read_text("utf-8")
    return tomllib.loads(text)


def load_local_catalog() -> list[CatalogEntry]:
    """Entries in file order, smallest first."""
    entries: list[CatalogEntry] = []
    for item in _raw().get("local", []):
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


def load_hosted_catalog() -> list[HostedEntry]:
    """The current hosted models, grouped by provider in file order."""
    return [
        HostedEntry(
            ref=str(item["ref"]),
            label=str(item["label"]),
            blurb=str(item["blurb"]),
            categories=tuple(str(name) for name in item["categories"]),
        )
        for item in _raw().get("hosted", [])
    ]


def hosted_problems(entries: list[HostedEntry]) -> list[str]:
    """Why the hosted entries break the schema. An empty list means they are fine."""
    problems: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        provider, _, model = entry.ref.partition("/")
        if provider not in HOSTED_PROVIDERS or not model:
            problems.append(f"{entry.ref}: the ref must be <provider>/<model> of a hosted provider")
        if entry.ref in seen:
            problems.append(f"{entry.ref}: listed twice")
        seen.add(entry.ref)
        if not entry.label.strip():
            problems.append(f"{entry.ref}: no label")
        if not entry.blurb.strip() or "\n" in entry.blurb:
            problems.append(f"{entry.ref}: the blurb must be one line")
        if not entry.categories:
            problems.append(f"{entry.ref}: no categories")
        for name in entry.categories:
            if name not in CATEGORIES:
                problems.append(f"{entry.ref}: unknown category {name!r}")
    for provider in HOSTED_PROVIDERS:
        if not any(entry.provider == provider for entry in entries):
            problems.append(f"{provider}: no entries")
    return problems
