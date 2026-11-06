"""``just catalog``: keep ``data/catalog.toml`` honest.

Offline, every entry must fill and validate with sample inputs, so a typo in a
template fails here and not on a user's machine. Online, every ``npx`` and
``uvx`` package must still be published and not deprecated, and every ``url``
entry must answer. Which servers the catalog lists stays a human choice.
"""

from __future__ import annotations

import asyncio
import re
import sys
from typing import Any, cast
from urllib.parse import quote

import httpx

from golem.mcp.catalog import CatalogEntry, CatalogError, build, load_catalog

SAMPLE_FOLDER = "/tmp/project"
NPM = "https://registry.npmjs.org/{package}/latest"
PYPI = "https://pypi.org/pypi/{package}/json"


def validate(entries: list[CatalogEntry]) -> list[str]:
    """What is wrong with the entries after substitution with sample inputs. Empty when fine."""
    problems: list[str] = []
    for entry in entries:
        inputs = {item.id: SAMPLE_FOLDER for item in entry.inputs if item.kind != "secret"}
        for item in entry.inputs:
            if item.kind == "choice":
                inputs[item.id] = item.choices[0]
        secrets = {item.id: "sample-secret" for item in entry.inputs if item.kind == "secret"}
        try:
            table, stored = build(entry, inputs, secrets, folder=SAMPLE_FOLDER)
        except CatalogError as exc:
            problems.append(f"{entry.id}: {exc}")
            continue
        if entry.runtime != "url" and str(table.get("command", "")) != entry.runtime:
            problems.append(f"{entry.id}: runtime {entry.runtime} but the command is different")
        if entry.runtime == "url" and "url" not in table:
            problems.append(f"{entry.id}: runtime url but the template has no url")
        if (entry.auth == "token") != any(item.kind == "secret" for item in entry.inputs):
            problems.append(f"{entry.id}: auth {entry.auth} does not match its secret inputs")
        if entry.auth == "token" and not stored:
            problems.append(f"{entry.id}: a token entry stores no secret")
    return problems


def package_of(entry: CatalogEntry) -> str | None:
    """The npm or PyPI package an ``npx`` or ``uvx`` entry runs."""
    args = [str(arg) for arg in cast(list[object], entry.template.get("args", []))]
    package = next((arg for arg in args if not arg.startswith("-")), None)
    if package is None:
        return None
    return re.sub(r"(?<=.)@[^@/]*$", "", package)


async def check_online(entries: list[CatalogEntry]) -> list[str]:
    problems: list[str] = []
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        for entry in entries:
            if entry.runtime == "url":
                url = str(entry.template["url"])
                try:
                    # Any answer means the host is there. A server may want a POST or a sign-in.
                    await client.get(url)
                except httpx.HTTPError as exc:
                    problems.append(f"{entry.id}: {url} does not answer: {exc}")
                continue
            package = package_of(entry)
            if package is None:
                continue
            if entry.runtime == "npx":
                problems.extend(await _npm(client, entry.id, package))
            elif entry.runtime == "uvx":
                problems.extend(await _pypi(client, entry.id, package))
    return problems


async def _npm(client: httpx.AsyncClient, ident: str, package: str) -> list[str]:
    try:
        response = await client.get(NPM.format(package=quote(package, safe="@")))
    except httpx.HTTPError as exc:
        return [f"{ident}: npm did not answer: {exc}"]
    if response.status_code != 200:
        return [f"{ident}: {package} is not on npm ({response.status_code})"]
    body = cast(dict[str, Any], response.json())
    if body.get("deprecated"):
        return [f"{ident}: {package} is deprecated: {body['deprecated']}"]
    return []


async def _pypi(client: httpx.AsyncClient, ident: str, package: str) -> list[str]:
    try:
        response = await client.get(PYPI.format(package=package))
    except httpx.HTTPError as exc:
        return [f"{ident}: PyPI did not answer: {exc}"]
    if response.status_code != 200:
        return [f"{ident}: {package} is not on PyPI ({response.status_code})"]
    status = cast(dict[str, Any], response.json()).get("info", {}).get("yanked")
    return [f"{ident}: {package}'s latest release is yanked"] if status else []


async def check(online: bool = True) -> int:
    entries = load_catalog()
    problems = validate(entries)
    if online:
        problems.extend(await check_online(entries))
    for line in problems:
        print(f"mcp catalog: {line}")
    if not problems:
        print(f"the MCP catalog is current ({len(entries)} entries)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(check(online="--offline" not in sys.argv)))
