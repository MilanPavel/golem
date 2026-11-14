"""Small edits to ``config.toml`` that keep the user's comments and layout.

The file is edited with ``tomlkit``, written to a temporary file next to it,
and moved into place, so a crash never leaves half a config.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any, cast

import tomlkit
from tomlkit.items import AoT, Table
from tomlkit.toml_document import TOMLDocument

from golem.config import McpEnabled, PermissionMode, PolicyRule, RuleAction
from golem.models import options as model_options


class RuleIndexError(ValueError):
    """The file has no ``[[rule]]`` with this number."""


class McpTableError(ValueError):
    """The file has no ``[mcp.<name>]`` table."""


class McpExistsError(ValueError):
    """The file already has an ``[mcp.<name>]`` table."""


class RawConflictError(ValueError):
    """The file changed on disk since the text being written was read."""


def add_mcp_server(config_file: Path, name: str, table: dict[str, Any]) -> None:
    """Add ``[mcp.<name>]`` with the keys of ``table``. Creates the file when it is missing."""
    document = _read(config_file)
    servers = cast(object, document.get("mcp"))  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(servers, Table):
        servers = tomlkit.table(is_super_table=True)
        document["mcp"] = servers
    if name in servers:
        raise McpExistsError(f"{config_file} already has [mcp.{name}]")
    added = _mcp_table(table)
    servers[name] = added
    _write(config_file, document)


def replace_mcp_server(
    config_file: Path, name: str, table: dict[str, Any], new_name: str | None = None
) -> None:
    """Replace the keys of ``[mcp.<name>]`` with ``table``, keeping its place and comments.

    ``new_name`` renames the table, which then goes last in ``[mcp]``.
    """
    document = _read(config_file)
    servers = cast(object, document.get("mcp"))  # pyright: ignore[reportUnknownMemberType]
    existing = cast(object, servers.get(name)) if isinstance(servers, Table) else None  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(servers, Table) or not isinstance(existing, Table):
        raise McpTableError(f"{config_file} has no [mcp.{name}]")
    if new_name is not None and new_name != name:
        if new_name in servers:
            raise McpExistsError(f"{config_file} already has [mcp.{new_name}]")
        del servers[name]
        servers[new_name] = _mcp_table(table)
    else:
        for key in [str(key) for key in existing]:
            del existing[key]
        for key, value in cast(dict[str, Any], _mcp_table(table)).items():
            existing[key] = value
    _write(config_file, document)


def read_raw(config_file: Path) -> tuple[str, int | None]:
    """The file's text and its ``mtime_ns``. A missing file is empty, with no mtime."""
    try:
        text = config_file.read_text("utf-8")
        return text, config_file.stat().st_mtime_ns
    except FileNotFoundError:
        return "", None


def write_raw(config_file: Path, text: str, base_mtime_ns: int | None) -> int:
    """Write ``text`` when the file is still as it was read, and return the new ``mtime_ns``.

    Raises :class:`RawConflictError` when its ``mtime_ns`` is not ``base_mtime_ns``
    (None for a file that did not exist).
    """
    try:
        current = config_file.stat().st_mtime_ns
    except FileNotFoundError:
        current = None
    if current != base_mtime_ns:
        raise RawConflictError("config.toml changed on disk; reload")
    _write(config_file, tomlkit.parse(text))
    return config_file.stat().st_mtime_ns


def _mcp_table(table: dict[str, Any]) -> Table:
    added = tomlkit.table()
    for key, value in table.items():
        if isinstance(value, dict):
            inline = tomlkit.inline_table()
            for inner_key, inner in cast(dict[str, Any], value).items():
                inline[inner_key] = inner
            added[key] = inline
        else:
            added[key] = value
    return added


def has_mcp_server(config_file: Path, name: str) -> bool:
    """True when the file has an ``[mcp.<name>]`` table, valid or not."""
    servers = cast(object, _read(config_file).get("mcp"))  # pyright: ignore[reportUnknownMemberType]
    return isinstance(servers, Table) and name in servers


def remove_mcp_server(config_file: Path, name: str) -> None:
    """Delete ``[mcp.<name>]``, and ``[mcp]`` itself once it holds no other server."""
    document = _read(config_file)
    servers = cast(object, document.get("mcp"))  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(servers, Table) or not isinstance(servers.get(name), Table):  # pyright: ignore[reportUnknownMemberType]
        raise McpTableError(f"{config_file} has no [mcp.{name}]")
    del servers[name]
    if len(servers) == 0:
        del document["mcp"]
        # The blank line that set the table apart goes with it.
        text = tomlkit.dumps(document).rstrip("\n")
        document = tomlkit.parse(text + "\n" if text else "")
    _write(config_file, document)


def set_mcp_enabled(config_file: Path, name: str, enabled: McpEnabled) -> None:
    """Set ``enabled`` in ``[mcp.<name>]``. ``true`` is the default, so it removes the key."""
    document = _read(config_file)
    servers = cast(object, document.get("mcp"))  # pyright: ignore[reportUnknownMemberType]
    table = cast(object, servers.get(name)) if isinstance(servers, Table) else None  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(table, Table):
        raise McpTableError(f"{config_file} has no [mcp.{name}]")
    if enabled is True:
        if "enabled" in table:
            del table["enabled"]
    else:
        table["enabled"] = enabled
    _write(config_file, document)


def set_default_model(config_file: Path, model: str) -> None:
    """Set the top-level ``default_model``. Creates the file when it is missing."""
    document = _read(config_file)
    document["default_model"] = model
    _write(config_file, document)


def set_permission_mode(config_file: Path, mode: PermissionMode) -> int:
    """Set ``[permissions] mode``, keeping the file's comments, and return the new ``mtime_ns``.

    Creates the file when it is missing. Raises :class:`RawConflictError` when the
    file changed on disk between reading it and writing it.
    """
    text, mtime = read_raw(config_file)
    document = tomlkit.parse(text)
    table = _sub_table(document, "permissions", create=True)
    table["mode"] = mode
    return write_raw(config_file, tomlkit.dumps(document), mtime)


def add_rule(config_file: Path, rule: PolicyRule) -> None:
    """Put ``rule`` first in the file's ``[[rule]]`` list, so it wins over the others."""
    document = _read(config_file)
    table = tomlkit.table()
    table["tool"] = rule.tool
    if rule.match is not None:
        table["match"] = rule.match
    if rule.path is not None:
        table["path"] = rule.path
    table["action"] = rule.action
    rules = cast(object, document.get("rule"))  # pyright: ignore[reportUnknownMemberType]
    if isinstance(rules, AoT):
        table.add(tomlkit.nl())
        rules.insert(0, table)
    else:
        aot = tomlkit.aot()
        aot.append(table)  # pyright: ignore[reportUnknownMemberType]
        document["rule"] = aot
    _write(config_file, document)


def remove_rule(config_file: Path, index: int) -> None:
    """Delete rule number ``index``, counting from 1."""
    document = _read(config_file)
    rules = _rules(document, index)
    del rules[index - 1]
    if len(rules) == 0:
        del document["rule"]
    _write(config_file, document)


def set_rule_action(config_file: Path, index: int, action: RuleAction) -> None:
    """Change the ``action`` of rule number ``index``, counting from 1."""
    document = _read(config_file)
    table = _rules(document, index)[index - 1]
    assert isinstance(table, Table)
    table["action"] = action
    _write(config_file, document)


def set_model_options(
    config_file: Path,
    model: str,
    values: dict[str, float | str | None],
    think_values: Sequence[str] | None = None,
) -> dict[str, float | str]:
    """Save options in ``[ollama.models."<model>"]`` and return what that table now holds.

    A value of None removes the option, so the model's own default applies
    again. A table left empty is removed, and so is ``[ollama.models]`` once it
    is empty. ``think_values`` is what ``think`` takes for this model, or None to accept
    every value. Raises ``ValueError`` for an unknown option or a value out of range,
    before anything is written.
    """
    for name, value in values.items():
        if value is not None:
            model_options.validate(name, value, think_values if name == "think" else None)
    document = _read(config_file)
    ollama = _sub_table(document, "ollama", create=True)
    models = _sub_table(ollama, "models", create=True)
    table = _sub_table(models, model, create=True)
    for name, value in values.items():
        if value is None:
            if name in table:
                del table[name]
        else:
            table[name] = value
    saved = {key: cast(float | str, value) for key, value in table.items()}
    if not table:
        del models[model]
    if not models:
        del ollama["models"]
    if not ollama:
        del document["ollama"]
    _write(config_file, document)
    return saved


def read_model_options(config_file: Path, model: str) -> dict[str, float | str]:
    """The options saved for ``model``. Empty when there are none."""
    ollama = _sub_table(_read(config_file), "ollama", create=False)
    models = _sub_table(ollama, "models", create=False) if ollama is not None else None
    table = _sub_table(models, model, create=False) if models is not None else None
    if table is None:
        return {}
    return {key: cast(float | str, value) for key, value in table.items()}


def _sub_table(parent: Any, key: str, *, create: bool) -> Any:
    child = cast(object, parent.get(key))
    if isinstance(child, Table):
        return child
    if not create:
        return None
    added = tomlkit.table()
    parent[key] = added
    return added


def _rules(document: TOMLDocument, index: int) -> AoT:
    rules = cast(object, document.get("rule"))  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(rules, AoT) or not 1 <= index <= len(rules):
        raise RuleIndexError(f"there is no rule {index}")
    return rules


def _read(config_file: Path) -> TOMLDocument:
    text = config_file.read_text("utf-8") if config_file.is_file() else ""
    return tomlkit.parse(text)


def _write(config_file: Path, document: TOMLDocument) -> None:
    config_file.parent.mkdir(parents=True, exist_ok=True)
    temp = config_file.with_name(f".{config_file.name}.tmp")
    temp.write_text(tomlkit.dumps(document), "utf-8")
    if config_file.exists():
        os.chmod(temp, config_file.stat().st_mode & 0o777)
    temp.replace(config_file)
