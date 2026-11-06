"""The servers golem offers: ``data/catalog.toml``, and how an entry becomes ``[mcp.<name>]``.

An entry has a ``template``, a partial ``[mcp.<name>]`` table whose strings may
hold ``{folder}`` (the session's folder), ``{name}``, ``{input.<id>}`` for a
value the person typed, and ``{secret.<id>}`` for a secret, which becomes
``keychain:mcp/<name>`` so the value never reaches the file. :func:`build`
fills it and validates the result with the same model the daemon loads.
"""

from __future__ import annotations

import re
import tomllib
from collections.abc import Mapping
from importlib import resources
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from golem.config import McpEnabled, McpServerSettings, McpToolFilter

Category = Literal["files", "code", "web", "data", "productivity", "other"]
Runtime = Literal["npx", "uvx", "docker", "url"]
Auth = Literal["none", "token", "oauth"]
InputKind = Literal["path", "text", "secret", "choice"]

PLACEHOLDER = re.compile(r"\{(folder|name|input\.[a-z0-9_-]+|secret\.[a-z0-9_-]+)\}")
SIGN_IN_NOTE = "needs sign-in (coming in 1.12.10)"
"""Why an ``oauth`` entry is not offered yet."""


class CatalogError(ValueError):
    """A typed value is missing or wrong, or an entry's template does not fit its inputs."""


class CatalogInput(BaseModel):
    """One thing to ask for. A ``secret`` is stored in the Keychain, never in the file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")
    kind: InputKind
    label: str = Field(min_length=1)
    hint: str | None = None
    default: str | None = None
    choices: list[str] = Field(default_factory=list[str])
    required: bool = True


class CatalogDefaults(BaseModel):
    """What an added server starts with. Most are ``on_demand``, so they cost no tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    enabled: McpEnabled = "on_demand"
    tools: McpToolFilter = Field(default_factory=McpToolFilter)
    approval: Literal["ask", "allow"] = "ask"


class CatalogEntry(BaseModel):
    """One server the catalog offers."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$")
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    category: Category
    homepage: str = Field(pattern=r"^https://\S+$")
    runtime: Runtime
    auth: Auth
    template: dict[str, Any]
    inputs: list[CatalogInput] = Field(default_factory=list[CatalogInput])
    defaults: CatalogDefaults = Field(default_factory=CatalogDefaults)
    starter: bool = False


def load_catalog() -> list[CatalogEntry]:
    """The entries, in file order. Raises ``ValueError`` when the file is wrong."""
    text = resources.files("golem.mcp").joinpath("data/catalog.toml").read_text("utf-8")
    raw = tomllib.loads(text)
    entries = [CatalogEntry.model_validate(item) for item in raw.get("entry", [])]
    ids = [entry.id for entry in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("catalog.toml has an id twice")
    return entries


def find_entry(catalog_id: str) -> CatalogEntry | None:
    return next((entry for entry in load_catalog() if entry.id == catalog_id), None)


def secret_ref(name: str, input_id: str) -> str:
    """The Keychain item for a server's secret input: ``mcp/<name>``, or ``mcp/<name>-<id>``."""
    return f"mcp/{name}" if input_id == "token" else f"mcp/{name}-{input_id}"


def unavailable(entry: CatalogEntry) -> str | None:
    """Why the entry cannot be added yet, or None."""
    return SIGN_IN_NOTE if entry.auth == "oauth" else None


def build(
    entry: CatalogEntry,
    inputs: Mapping[str, str],
    secrets: Mapping[str, str],
    *,
    name: str | None = None,
    folder: str | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """The ``[mcp.<name>]`` table for ``entry``, and the secrets to store, by reference.

    ``inputs`` are the typed values and ``secrets`` the secret ones, both by input
    id. Raises :class:`CatalogError` for a missing or unknown value.
    """
    server = name or entry.name
    known = {item.id: item for item in entry.inputs}
    for given in [*inputs, *secrets]:
        if given not in known:
            raise CatalogError(f"{entry.title} has no input {given}")
    for given in inputs:
        if known[given].kind == "secret":
            raise CatalogError(f"{known[given].label} is a secret: send it in secrets")
    for given in secrets:
        if known[given].kind != "secret":
            raise CatalogError(f"{known[given].label} is not a secret: send it in inputs")
    values: dict[str, str] = {}
    refs: dict[str, str] = {}
    to_store: dict[str, str] = {}
    for item in entry.inputs:
        if item.kind == "secret":
            refs[item.id] = f"keychain:{secret_ref(server, item.id)}"
            if secrets.get(item.id):
                to_store[secret_ref(server, item.id)] = secrets[item.id]
            elif item.required:
                raise CatalogError(f"{item.label} is required")
            continue
        value = inputs.get(item.id) or _fill(item.default or "", server, folder, {}, {}, item.label)
        if not value and item.required:
            raise CatalogError(f"{item.label} is required")
        if item.kind == "choice" and value and value not in item.choices:
            raise CatalogError(f"{item.label} must be one of {', '.join(item.choices)}")
        values[item.id] = value
    table = cast(dict[str, Any], _walk(entry.template, server, folder, values, refs, entry.title))
    _apply_defaults(table, entry.defaults)
    try:
        McpServerSettings.model_validate(table)
    except ValidationError as exc:
        message = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise CatalogError(f"{entry.title}: {message}") from exc
    return table, to_store


def _apply_defaults(table: dict[str, Any], defaults: CatalogDefaults) -> None:
    if defaults.enabled is not True:
        table["enabled"] = defaults.enabled
    tools = defaults.tools.model_dump(exclude_defaults=True)
    if tools:
        table["tools"] = tools
    if defaults.approval != "ask":
        table["approval"] = defaults.approval


def _walk(
    value: object,
    name: str,
    folder: str | None,
    values: Mapping[str, str],
    refs: Mapping[str, str],
    title: str,
) -> object:
    if isinstance(value, str):
        return _fill(value, name, folder, values, refs, title)
    if isinstance(value, list):
        items = cast(list[object], value)
        return [_walk(item, name, folder, values, refs, title) for item in items]
    if isinstance(value, dict):
        mapping = cast(dict[str, object], value)
        return {
            key: _walk(item, name, folder, values, refs, title) for key, item in mapping.items()
        }
    return value


def _fill(
    text: str,
    name: str,
    folder: str | None,
    values: Mapping[str, str],
    refs: Mapping[str, str],
    title: str,
) -> str:
    stray = re.search(r"\{[A-Za-z][A-Za-z0-9_.-]*\}", PLACEHOLDER.sub("", text))
    if stray is not None:
        raise CatalogError(f"{title} names {stray.group(0)}, which is not a placeholder")

    def replace(found: re.Match[str]) -> str:
        key = found.group(1)
        if key == "name":
            return name
        if key == "folder":
            if folder is None:
                raise CatalogError(f"{title} needs a folder: send a session_id, or type one")
            return folder
        kind, _, ident = key.partition(".")
        table = values if kind == "input" else refs
        if ident not in table:
            raise CatalogError(f"{title} names {{{key}}}, which it does not take")
        return table[ident]

    return PLACEHOLDER.sub(replace, text)


__all__ = [
    "CatalogDefaults",
    "CatalogEntry",
    "CatalogError",
    "CatalogInput",
    "build",
    "find_entry",
    "load_catalog",
    "secret_ref",
    "unavailable",
]
