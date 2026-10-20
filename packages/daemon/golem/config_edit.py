"""Small edits to ``config.toml`` that keep the user's comments and layout.

The file is edited with ``tomlkit``, written to a temporary file next to it,
and moved into place, so a crash never leaves half a config.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import cast

import tomlkit
from tomlkit.items import AoT, Table
from tomlkit.toml_document import TOMLDocument

from golem.config import PolicyRule, RuleAction


class RuleIndexError(ValueError):
    """The file has no ``[[rule]]`` with this number."""


def set_default_model(config_file: Path, model: str) -> None:
    """Set the top-level ``default_model``. Creates the file when it is missing."""
    document = _read(config_file)
    document["default_model"] = model
    _write(config_file, document)


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
