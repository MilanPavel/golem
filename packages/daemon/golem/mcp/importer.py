"""Servers other apps already know: find their config files, and turn each into ``[mcp.<name>]``.

Nothing here writes to another app's file. The functions are pure except
:func:`discover`, which reads the files in :data:`SOURCES`. A secret value in a
source (an ``env`` token, a ``Bearer`` header) is moved out of the table into
``secrets``, keyed by the reference the table names, so the table is safe to show.
"""

from __future__ import annotations

import json
import re
import secrets as token_source
import time
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Literal, cast

from pydantic import ValidationError

from golem.config import SECRET_KEY, McpServerSettings

Scope = Literal["user", "project"]
JsonObject = dict[str, Any]

SCAN_SECONDS: Final = 600.0
"""How long a scan, and the secret values in it, stay in memory."""

OLD_SSE: Final = "this server uses the old SSE transport, which golem doesn't speak yet"


@dataclass(frozen=True, slots=True)
class Source:
    """One app's config files. Paths are macOS ones, kept here so another OS adds a row."""

    id: str
    label: str
    user: tuple[str, ...] = ()
    """Files under the home folder."""
    project: tuple[str, ...] = ()
    """Files under a project folder."""
    key: str = "mcpServers"
    """The top-level key that holds the servers."""
    projects_in: str | None = None
    """A home file with a ``projects[<folder>].mcpServers`` table, as Claude Code keeps."""


SOURCES: Final[tuple[Source, ...]] = (
    Source(
        "claude-desktop",
        "Claude Desktop",
        user=("Library/Application Support/Claude/claude_desktop_config.json",),
    ),
    Source(
        "claude-code",
        "Claude Code",
        user=(".claude.json",),
        project=(".mcp.json",),
        projects_in=".claude.json",
    ),
    Source("cursor", "Cursor", user=(".cursor/mcp.json",), project=(".cursor/mcp.json",)),
    Source(
        "vscode",
        "VS Code",
        user=("Library/Application Support/Code/User/mcp.json",),
        project=(".vscode/mcp.json",),
        key="servers",
    ),
    Source("windsurf", "Windsurf", user=(".codeium/windsurf/mcp_config.json",)),
)

PASTE: Final = Source("paste", "Pasted text")


class ConvertError(ValueError):
    """A server that cannot become an ``[mcp.<name>]`` table."""


@dataclass(frozen=True, slots=True)
class Raw:
    """One server as another app wrote it. ``body`` may hold secret values."""

    source: str
    label: str
    scope: Scope
    name: str
    body: JsonObject
    inputs: Mapping[str, JsonObject] = field(default_factory=dict[str, JsonObject])


@dataclass(frozen=True, slots=True)
class Found:
    """What one file, or the pasted text, held."""

    source: str
    label: str
    path: Path | None
    raws: list[Raw] = field(default_factory=list[Raw])
    skipped: list[str] = field(default_factory=list[str])
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Converted:
    """A server in golem's terms."""

    table: dict[str, Any]
    settings: McpServerSettings
    secrets: dict[str, str]
    """Secret values the source had, by reference. Never sent to a client."""
    needed: list[str]
    """References whose value the source did not have: the user supplies them."""
    warnings: list[str]


def loads(text: str) -> object:
    """JSON, also with the comments and trailing commas VS Code allows."""
    try:
        return json.loads(text)
    except ValueError:
        parts = re.split(r'("(?:[^"\\]|\\.)*")', text)
        for index in range(0, len(parts), 2):
            plain = re.sub(r"//[^\n]*|/\*.*?\*/", "", parts[index], flags=re.DOTALL)
            parts[index] = re.sub(r",(\s*[}\]])", r"\1", plain)
        return json.loads("".join(parts))


def _object(value: object) -> JsonObject | None:
    return cast(JsonObject, value) if isinstance(value, dict) else None


def _looks_like_server(value: object) -> bool:
    found = _object(value)
    return found is not None and any(
        key in found for key in ("command", "url", "serverUrl", "httpUrl")
    )


def find_servers(doc: object, keys: tuple[str, ...] | None = None) -> dict[str, object] | None:
    """The ``name -> server`` table in ``doc``, or None when it holds no servers at all.

    With ``keys``, only those top-level keys count (a file whose app is known).
    Without, any shape works: ``mcpServers``, VS Code's ``servers``, settings
    with ``mcp.servers``, a table of servers, or one bare server.
    """
    found = _object(doc)
    if found is None:
        return None
    for key in keys or ("mcpServers", "servers"):
        table = _object(found.get(key))
        if table is not None:
            return dict(table)
    if keys is not None:
        return {}
    nested = _object(found.get("mcp"))
    if nested is not None:
        inner = find_servers(nested, ("servers", "mcpServers"))
        if inner:
            return inner
    if _looks_like_server(found):
        return {"server": found}
    if found and all(_looks_like_server(value) for value in found.values()):
        return dict(found)
    return None


def _inputs(doc: object) -> dict[str, JsonObject]:
    """VS Code's ``inputs`` by id."""
    found = _object(doc)
    listed = found.get("inputs") if found is not None else None
    if not isinstance(listed, list):
        return {}
    items = [_object(item) for item in cast(list[object], listed)]
    return {
        str(item["id"]): item
        for item in items
        if item is not None and isinstance(item.get("id"), str)
    }


def _raws(
    source: Source, scope: Scope, table: Mapping[str, object], inputs: Mapping[str, JsonObject]
) -> tuple[list[Raw], list[str]]:
    raws: list[Raw] = []
    skipped: list[str] = []
    for name, body in table.items():
        server = _object(body)
        if server is None:
            skipped.append(f"{name}: not a server")
            continue
        raws.append(Raw(source.id, source.label, scope, name, server, inputs))
    return raws, skipped


def from_text(text: str) -> Found:
    """Servers in pasted text."""
    try:
        doc = loads(text)
    except ValueError:
        return Found(PASTE.id, PASTE.label, None, error="that is not JSON")
    table = find_servers(doc)
    if table is None:
        return Found(PASTE.id, PASTE.label, None, error="no MCP servers in that text")
    raws, skipped = _raws(PASTE, "user", table, _inputs(doc))
    return Found(PASTE.id, PASTE.label, None, raws, skipped)


def _read(path: Path) -> object:
    return loads(path.read_text(encoding="utf-8"))


def discover(home: Path, folder: Path | None) -> list[Found]:
    """The servers in each app's files that exist. ``folder`` adds that project's files."""
    found: list[Found] = []
    for source in SOURCES:
        files: list[tuple[Path, Scope]] = [(home / rel, "user") for rel in source.user]
        if folder is not None:
            files.extend((folder / rel, "project") for rel in source.project)
        for path, scope in files:
            if not path.is_file():
                continue
            try:
                doc = _read(path)
            except (OSError, ValueError) as exc:
                found.append(
                    Found(source.id, source.label, path, error=f"could not read it: {exc}")
                )
                continue
            table = find_servers(doc, (source.key,))
            raws, skipped = _raws(source, scope, table or {}, _inputs(doc))
            found.append(Found(source.id, source.label, path, raws, skipped))
            if source.projects_in is not None and path == home / source.projects_in:
                found.extend(_claude_projects(source, path, doc, folder))
    return found


def _claude_projects(source: Source, path: Path, doc: object, folder: Path | None) -> list[Found]:
    """The servers Claude Code keeps for a project inside its home file."""
    if folder is None:
        return []
    top = _object(doc)
    projects = _object(top.get("projects")) if top else None
    entry = _object(projects.get(str(folder))) if projects else None
    table = _object(entry.get("mcpServers")) if entry else None
    if not table:
        return []
    raws, skipped = _raws(source, "project", table, {})
    return [Found(source.id, source.label, path, raws, skipped)]


PLACEHOLDER: Final = re.compile(r"\$\{(?:input:|env:)?([A-Za-z_][\w.-]*)(?::-[^}]*)?\}")
"""``${input:x}``, ``${env:X}``, ``${X}``, and ``${X:-default}``."""

_BEARER: Final = re.compile(r"(Bearer\s+)(.+)", re.IGNORECASE | re.DOTALL)
_HTTP_TYPES: Final = {"http", "streamable-http", "streamablehttp", "sse"}
_NOT_IMPORTED: Final = ("envFile", "oauth")


def _strings(value: object) -> list[str]:
    return [str(item) for item in cast(list[object], value)] if isinstance(value, list) else []


def _table(value: object) -> dict[str, str]:
    found = _object(value)
    return {} if found is None else {str(key): str(item) for key, item in found.items()}


def _secret_key(key: str) -> bool:
    return SECRET_KEY.search(key.replace("-", "_")) is not None


def convert(name: str, body: Mapping[str, Any], inputs: Mapping[str, JsonObject]) -> Converted:
    """``body``, a server of another app, as the table for ``[mcp.<name>]``.

    Raises :class:`ConvertError` when it has neither a command nor a url, or the
    table would not pass golem's own checks.
    """
    warnings: list[str] = []
    command = body.get("command")
    url = next((body[key] for key in ("url", "serverUrl", "httpUrl") if body.get(key)), None)
    kind = str(body.get("type", "")).lower()
    table: dict[str, Any] = {}
    if isinstance(command, str) and command and not (url and kind in _HTTP_TYPES):
        table["command"] = command
        if args := _strings(body.get("args")):
            table["args"] = args
        if cwd := body.get("cwd"):
            table["cwd"] = str(cwd)
        carried = _table(body.get("env"))
        field_name = "env"
    elif isinstance(url, str):
        table["url"] = url
        if kind == "sse":
            warnings.append(OLD_SSE)
        carried = _table(body.get("headers"))
        field_name = "headers"
    else:
        raise ConvertError("it has neither a command nor a url")
    if body.get("disabled") is True:
        table["enabled"] = False
    for key in _NOT_IMPORTED:
        if key in body:
            warnings.append(f"{key} is not imported")
    texts = [*(_strings(body.get("args"))), str(body.get("cwd") or ""), str(url or "")]
    if any(PLACEHOLDER.search(text) for text in texts):
        warnings.append("a ${…} value in the command or url is not filled in by golem: edit it")

    values: dict[str, str] = {}
    secrets: dict[str, str] = {}
    needed: list[str] = []
    for key, value in carried.items():
        replaced = _secret(key, value, name, len(secrets) + len(needed), inputs)
        if replaced is None:
            if PLACEHOLDER.search(value):
                warnings.append(f"{key} has a ${{…}} value, which golem does not fill in: edit it")
            values[key] = value
            continue
        text, ref, secret = replaced
        values[key] = text
        if secret is None:
            needed.append(ref)
            warnings.append(
                f"{key} is {value.strip()}: golem asks for its value, or set {ref} later"
            )
        else:
            secrets[ref] = secret
    if values:
        table[field_name] = values
    try:
        settings = McpServerSettings.model_validate(table)
    except ValidationError as exc:
        message = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise ConvertError(message) from exc
    return Converted(table, settings, secrets, needed, warnings)


def _secret(
    key: str, value: str, name: str, taken: int, inputs: Mapping[str, JsonObject]
) -> tuple[str, str, str | None] | None:
    """``(table value, ref, secret or None)`` when ``value`` is a secret, else None.

    The secret is None when the source only names it (``${input:token}``).
    """
    bearer = _BEARER.fullmatch(value)
    password = any(
        _object(inputs.get(found)) is not None and inputs[found].get("password") is True
        for found in PLACEHOLDER.findall(value)
    )
    if bearer is None and not _secret_key(key) and not password:
        return None
    prefix, secret = (bearer.group(1), bearer.group(2)) if bearer else ("", value)
    ref = f"mcp/{name}" if taken == 0 else f"mcp/{name}-{key.lower()}"
    ref = re.sub(r"[^A-Za-z0-9._/-]", "-", ref)
    text = f"{prefix}keychain:{ref}"
    secret = secret.strip()
    if not secret or PLACEHOLDER.search(secret):
        return text, ref, None
    return text, ref, secret


def fit_name(original: str, taken: Collection[str]) -> tuple[str, bool]:
    """A server name that fits ``MCP_SERVER_NAME`` and is not in ``taken``, and whether it moved."""
    base = re.sub(r"-+", "-", re.sub(r"[^A-Za-z0-9-]", "-", original)).strip("-")[:32].rstrip("-")
    base = base or "server"
    if base not in taken:
        return base, False
    number = 2
    while True:
        suffix = f"-{number}"
        candidate = f"{base[: 32 - len(suffix)].rstrip('-')}{suffix}"
        if candidate not in taken:
            return candidate, True
        number += 1


class ScanStore:
    """The scans a client has not applied yet, held in memory for ten minutes."""

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        ttl: float = SCAN_SECONDS,
        limit: int = 8,
    ) -> None:
        self.clock = clock
        self._ttl = ttl
        self._limit = limit
        self._scans: dict[str, tuple[float, dict[str, Raw]]] = {}

    def put(self, raws: dict[str, Raw]) -> str:
        self._sweep()
        while len(self._scans) >= self._limit:
            del self._scans[next(iter(self._scans))]
        scan_id = token_source.token_urlsafe(16)
        self._scans[scan_id] = (self.clock() + self._ttl, raws)
        return scan_id

    def take(self, scan_id: str) -> dict[str, Raw] | None:
        """The scan, once. None when it expired or was taken."""
        self._sweep()
        found = self._scans.pop(scan_id, None)
        return None if found is None else found[1]

    def _sweep(self) -> None:
        now = self.clock()
        for scan_id in [key for key, (expires, _) in self._scans.items() if expires <= now]:
            del self._scans[scan_id]
