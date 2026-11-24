"""The names in the Ollama library, with their sizes, and which of them fit this Mac.

Ollama has no search API, so the list ships with golem (``data/ollama-library.toml``) and
``just catalog`` keeps its sizes honest. A search reads that list and needs no network. Only a
full name that the list does not know is asked of the registry, so any real name works.
"""

from __future__ import annotations

import tomllib
from collections.abc import Collection
from dataclasses import dataclass
from importlib import resources
from typing import Any, cast

import httpx

from golem.models import hardware, registry
from golem.net_tls import tls_context

DOWN = "The Ollama registry didn't answer. Try again in a moment."


class OllamaLibraryError(Exception):
    """The registry could not answer. The message says what to do."""


@dataclass(frozen=True, slots=True)
class LibrarySize:
    tag: str
    size_gb: float


@dataclass(frozen=True, slots=True)
class LibraryName:
    name: str
    blurb: str
    sizes: tuple[LibrarySize, ...]


def load() -> list[LibraryName]:
    """The shipped names in file order, each with its sizes smallest first."""
    text = resources.files("golem.models").joinpath("data/ollama-library.toml").read_text("utf-8")
    entries: list[LibraryName] = []
    for item in cast(list[dict[str, Any]], tomllib.loads(text).get("model", [])):
        sizes = sorted(
            (
                LibrarySize(tag=str(size["tag"]), size_gb=float(size["size_gb"]))
                for size in item["sizes"]
            ),
            key=lambda size: size.size_gb,
        )
        entries.append(LibraryName(str(item["name"]), str(item["blurb"]), tuple(sizes)))
    return entries


def _rank(name: str, query: str) -> int | None:
    """0 for the name itself, 1 for a name that starts with it, 2 for one that contains it."""
    if name == query:
        return 0
    if name.startswith(query):
        return 1
    return 2 if query in name else None


class OllamaLibrary:
    """``transport`` replaces the network in tests. ``ram_gb`` is this Mac's memory."""

    def __init__(
        self, *, transport: httpx.AsyncBaseTransport | None = None, ram_gb: float | None = None
    ) -> None:
        self._transport = transport
        self.ram_gb = ram_gb
        self._names = load()

    async def search(self, query: str, installed: Collection[str] = ()) -> list[dict[str, Any]]:
        """Names as dicts of ``name``, ``blurb`` and ``sizes``.

        ``installed`` holds the ``name:tag`` strings Ollama has.
        """
        text = query.strip().lower().removeprefix("ollama/")
        needle = text.partition(":")[0]
        if not needle:
            return [self._row(entry, installed) for entry in self._names]
        ranked = [
            (rank, index, entry)
            for index, entry in enumerate(self._names)
            if (rank := _rank(entry.name, needle)) is not None
        ]
        if ranked:
            ranked.sort(key=lambda item: (item[0], item[1]))
            return [self._row(entry, installed) for _, _, entry in ranked]
        return await self._from_registry(text, installed)

    async def _from_registry(self, text: str, installed: Collection[str]) -> list[dict[str, Any]]:
        parsed = registry.parse_name(text)
        if parsed is None:
            return []
        async with httpx.AsyncClient(
            transport=self._transport, verify=tls_context(), trust_env=False
        ) as client:
            exists, size = await registry.manifest_size_gb(client, parsed)
        if exists is False:
            return []
        if exists is None or size is None:
            raise OllamaLibraryError(DOWN)
        found = LibraryName(
            parsed.repository.removeprefix("library/"), "", (LibrarySize(parsed.tag, size),)
        )
        return [self._row(found, installed)]

    def _row(self, entry: LibraryName, installed: Collection[str]) -> dict[str, Any]:
        sizes: list[dict[str, Any]] = []
        for size in entry.sizes:
            fit = hardware.fit(size.size_gb, self.ram_gb) if self.ram_gb else None
            sizes.append(
                {
                    "tag": size.tag,
                    "size_gb": size.size_gb,
                    "fit": fit,
                    "recommended": False,
                    "installed": f"{entry.name}:{size.tag}" in installed,
                }
            )
        fitting = [row for row in sizes if row["fit"] == "fits"]
        if fitting:
            fitting[-1]["recommended"] = True
        return {"name": entry.name, "blurb": entry.blurb, "sizes": sizes}
