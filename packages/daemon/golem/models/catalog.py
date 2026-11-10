"""The bundled list of models golem suggests: local ones to download, hosted ones to offer."""

from __future__ import annotations

import tomllib
from collections.abc import Collection
from dataclasses import dataclass
from importlib import resources
from typing import Any

from golem.config import HOSTED_PROVIDERS
from golem.models.options import LEVELS, ON_OFF

# The fixed set a model can be filed under.
CATEGORIES = ("general", "coding", "reasoning", "vision", "fast", "long-context")

# A model whose context holds at least this many tokens is filed under long-context.
LONG_CONTEXT_TOKENS = 200_000


def in_order(names: tuple[str, ...]) -> tuple[str, ...]:
    """The categories in the fixed order of ``CATEGORIES``."""
    return tuple(name for name in CATEGORIES if name in names)


def categories_of(
    *,
    vision: bool | None,
    reasoning: bool | None,
    ctx: int | None,
) -> tuple[str, ...]:
    """What the facts say about a model the catalog does not list."""
    found = {"general"}
    if vision:
        found.add("vision")
    if reasoning:
        found.add("reasoning")
    if ctx is not None and ctx >= LONG_CONTEXT_TOKENS:
        found.add("long-context")
    return tuple(name for name in CATEGORIES if name in found)


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    ref: str
    label: str
    size_gb: float
    tags: tuple[str, ...]
    min_ram_gb: float | None = None
    categories: tuple[str, ...] = ()
    # The thinking levels the model takes, such as low, medium, high. Empty for on and off.
    think: tuple[str, ...] = ()


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
                categories=tuple(str(name) for name in item.get("categories", [])),
                think=tuple(str(name) for name in item.get("think", [])),
            )
        )
    return entries


def think_values(name: str, capabilities: Collection[str] | None) -> list[str]:
    """What ``think`` takes for the installed Ollama model ``name``. Empty when it cannot think.

    A model without ``thinking`` in its capabilities takes none. One that thinks takes the
    levels its catalog entry lists. Off the catalog, a name that starts with ``gpt-oss`` takes
    the levels and every other model takes ``off`` and ``on``.
    """
    if capabilities is None or "thinking" not in capabilities:
        return []
    for entry in load_local_catalog():
        if entry.ref.removeprefix("ollama/") == name and entry.think:
            return list(entry.think)
    if name.startswith("gpt-oss"):
        return list(LEVELS)
    return list(ON_OFF)


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
