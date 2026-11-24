"""``just catalog``: keep ``catalog.toml`` honest.

Checks every entry against the Ollama registry and rewrites ``size_gb`` when
the download changed size. Then it tries the next version numbers of each
family (``qwen3.9`` and ``qwen4`` for ``qwen3.8``) and prints the tags that
exist, so a newer release is noticed. Which models the catalog lists stays a
human choice.

The same run refreshes the sizes in ``ollama-library.toml`` and reports its tags that are
gone from the registry. It never adds a name.
"""

from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path
from typing import Any, cast

import httpx
import tomlkit

from golem.models import registry
from golem.net_tls import tls_context

CATALOG = Path(__file__).resolve().parent / "data" / "catalog.toml"
LIBRARY = Path(__file__).resolve().parent / "data" / "ollama-library.toml"
_FAMILY = re.compile(r"^(?P<prefix>[a-z]+?)(?P<major>\d+)(?:\.(?P<minor>\d+))?(?P<suffix>.*)$")


def next_versions(family: str) -> list[str]:
    """``qwen3.8`` gives ``qwen3.9`` and ``qwen4``; ``gemma4`` gives ``gemma4.1`` and ``gemma5``."""
    match = _FAMILY.match(family)
    if match is None:
        return []
    prefix, suffix = match["prefix"], match["suffix"]
    major = int(match["major"])
    minor = match["minor"]
    following = f"{major}.{int(minor) + 1}" if minor is not None else f"{major}.1"
    return [f"{prefix}{following}{suffix}", f"{prefix}{major + 1}{suffix}"]


async def check(path: Path = CATALOG) -> int:
    document = tomlkit.parse(path.read_text("utf-8"))
    table = cast(dict[str, Any], document)
    entries = cast(list[dict[str, Any]], table.get("local", []))
    changed = 0
    missing: list[str] = []
    families: dict[str, set[str]] = {}
    async with httpx.AsyncClient(verify=tls_context()) as client:
        for entry in entries:
            ref = str(entry["ref"])
            parsed = registry.parse_name(ref)
            if parsed is None:
                missing.append(f"{ref}: not a library name")
                continue
            short = parsed.repository.removeprefix("library/")
            families.setdefault(short, set()).add(parsed.tag)
            exists, size = await registry.manifest_size_gb(client, parsed)
            if exists is False:
                missing.append(f"{ref}: gone from the registry")
            elif size is None:
                missing.append(f"{ref}: the registry did not answer")
            elif float(entry["size_gb"]) != size:
                print(f"{ref}: size {entry['size_gb']} GB -> {size} GB")
                entry["size_gb"] = size
                changed += 1
        found: list[str] = []
        for family, tags in sorted(families.items()):
            for candidate in next_versions(family):
                if candidate in families:
                    continue
                for tag in sorted({"latest", *tags}):
                    name = registry.OllamaName(repository=f"library/{candidate}", tag=tag)
                    exists, size = await registry.manifest_size_gb(client, name)
                    if exists:
                        found.append(f"{candidate}:{tag}  {size} GB  (catalog has {family})")
    if changed:
        path.write_text(tomlkit.dumps(document), "utf-8")
        print(f"rewrote {changed} size(s) in {path}")
    for line in missing:
        print(f"check: {line}")
    if found:
        print("newer releases in the registry:")
        for line in found:
            print(f"  {line}")
    if not changed and not missing and not found:
        print("the catalog is current")
    return 1 if missing else 0


async def check_library(
    path: Path = LIBRARY, *, transport: httpx.AsyncBaseTransport | None = None
) -> int:
    """Refresh each listed tag's size from the registry. Report tags that are gone."""
    document = tomlkit.parse(path.read_text("utf-8"))
    table = cast(dict[str, Any], document)
    changed = 0
    missing: list[str] = []
    async with httpx.AsyncClient(transport=transport, verify=tls_context()) as client:
        for model in cast(list[dict[str, Any]], table.get("model", [])):
            for size in cast(list[dict[str, Any]], model["sizes"]):
                ref = f"{model['name']}:{size['tag']}"
                parsed = registry.OllamaName(
                    repository=f"library/{model['name']}", tag=str(size["tag"])
                )
                exists, found = await registry.manifest_size_gb(client, parsed)
                if exists is False:
                    missing.append(f"{ref}: gone from the registry")
                elif found is None:
                    missing.append(f"{ref}: the registry did not answer")
                elif float(size["size_gb"]) != found:
                    print(f"{ref}: size {size['size_gb']} GB -> {found} GB")
                    size["size_gb"] = found
                    changed += 1
    if changed:
        path.write_text(tomlkit.dumps(document), "utf-8")
        print(f"rewrote {changed} size(s) in {path}")
    for line in missing:
        print(f"check: {line}")
    if not changed and not missing:
        print("the Ollama library list is current")
    return 1 if missing else 0


async def main() -> int:
    catalog = await check()
    library = await check_library()
    return 1 if catalog or library else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
