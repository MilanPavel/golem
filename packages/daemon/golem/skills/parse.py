"""Read one skill folder and say exactly what is wrong with it.

The rules are the Agent Skills spec (agentskills.io) plus the fields Claude
Code adds. Where the two differ, golem does what Claude Code does, so an
existing Claude Code skill works unchanged: ``name`` may be left out (the
folder names the skill), and a missing ``description`` falls back to the first
paragraph of the body.

Only the frontmatter is read here. The body is read by :func:`read_body` when
the skill is used.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, cast

import yaml

from golem.skills.model import SKILL_FILE, Skill

MAX_NAME = 64
MAX_DESCRIPTION = 1024
MAX_FILE_BYTES = 1 << 20
"""A bigger ``SKILL.md`` is an error: its body would fill the model's context."""
MAX_FRONTMATTER_BYTES = 64 << 10

NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
"""Lowercase letters, digits, and single hyphens between them."""

KNOWN = frozenset(
    {
        "name",
        "description",
        "argument-hint",
        "disable-model-invocation",
        "user-invocable",
        "allowed-tools",
        "model",
    }
)
UNSUPPORTED = ("context", "agent", "hooks")
"""Claude Code fields golem parses but does not act on yet."""

_BOM = b"\xef\xbb\xbf"


def parse_skill(folder: Path) -> Skill:
    """Parse ``folder/SKILL.md``. Never raises for a bad skill: the problems are in ``errors``."""
    real = _real(folder)
    try:
        with (folder / SKILL_FILE).open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
            size = file.tell()
            file.seek(0)
            head = file.read(MAX_FRONTMATTER_BYTES)
    except OSError as error:
        return _broken(folder, real, f"cannot read {SKILL_FILE}: {error.strerror or error}")

    errors: list[str] = []
    warnings: list[str] = []
    if size > MAX_FILE_BYTES:
        errors.append(f"{SKILL_FILE} is {_kb(size)}, over the {_kb(MAX_FILE_BYTES)} limit")

    split = _split(head, complete=size <= len(head))
    if isinstance(split, str):
        return _broken(folder, real, split, digest)
    raw, body_offset = split
    data = _fields(raw, errors)

    name = _name(data, folder, errors)
    argument_hint = _argument_hint(data, errors)
    user_invocable = _flag(data, "user-invocable", True, errors)
    model_invocable = not _flag(data, "disable-model-invocation", False, errors)
    allowed_tools = _allowed_tools(data, errors)
    model = _text(data, "model", errors)
    description = _text(data, "description", errors)
    if not description and "description" not in data:
        description = _first_paragraph(folder, body_offset) if size <= MAX_FILE_BYTES else ""
        if description:
            warnings.append("no `description`, so the first paragraph of the body is used")
    if not description:
        errors.append("`description` is missing: the model needs it to know when to use the skill")
    elif len(description) > MAX_DESCRIPTION:
        errors.append(f"`description` is {len(description)} characters, over {MAX_DESCRIPTION}")

    warnings += [
        f"`{key}` is not supported yet, so it is ignored" for key in UNSUPPORTED if key in data
    ]
    extras = {key: value for key, value in data.items() if key not in KNOWN}
    return Skill(
        name=name,
        description=description or "",
        path=folder,
        real_path=real,
        hash=digest,
        body_offset=body_offset,
        argument_hint=argument_hint,
        user_invocable=user_invocable,
        model_invocable=model_invocable,
        allowed_tools=allowed_tools,
        model=model,
        extras=extras,
        errors=tuple(errors),
        warnings=tuple(warnings),
    )


def read_body(skill: Skill) -> str:
    """The body of ``SKILL.md``, after the frontmatter. Raises ``OSError`` if it cannot be read."""
    return _read_from(skill.file, skill.body_offset)


def _read_from(path: Path, offset: int) -> str:
    with path.open("rb") as file:
        file.seek(offset)
        data = file.read(MAX_FILE_BYTES)
    return data.decode("utf-8", errors="replace").lstrip("\r\n")


def _split(head: bytes, *, complete: bool) -> tuple[str, int] | str:
    """The frontmatter text and where the body starts, or an error.

    ``complete`` says whether ``head`` is the whole file. A file without a
    leading ``---`` has no frontmatter, which Claude Code allows.
    """
    start = len(_BOM) if head.startswith(_BOM) else 0
    lines = head[start:].splitlines(keepends=True)
    if not lines or lines[0].rstrip() != b"---":
        return "", start
    offset = start + len(lines[0])
    for line in lines[1:]:
        if line.rstrip() == b"---":
            raw = head[start + len(lines[0]) : offset]
            try:
                return raw.decode("utf-8"), offset + len(line)
            except UnicodeDecodeError:
                return "the frontmatter is not UTF-8"
        offset += len(line)
    if complete:
        return "the frontmatter has no closing `---` line"
    return f"the frontmatter is not closed within the first {_kb(MAX_FRONTMATTER_BYTES)}"


def _fields(raw: str, errors: list[str]) -> dict[str, Any]:
    try:
        loaded: object = yaml.safe_load(raw)
    except yaml.YAMLError as error:
        errors.append(f"the frontmatter is not valid YAML: {_yaml_problem(error)}")
        return {}
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        errors.append("the frontmatter is not a list of `key: value` fields")
        return {}
    return {str(key): value for key, value in cast(dict[object, Any], loaded).items()}


def _yaml_problem(error: yaml.YAMLError) -> str:
    if isinstance(error, yaml.MarkedYAMLError) and error.problem_mark is not None:
        # +2: marks count from 0, and the opening `---` is line 1 of the file.
        return f"line {error.problem_mark.line + 2}: {error.problem}"
    return str(error)


def _name(data: dict[str, Any], folder: Path, errors: list[str]) -> str:
    given = _text(data, "name", errors)
    name = given or folder.name
    if len(name) > MAX_NAME or not NAME.fullmatch(name):
        what = "`name`" if given else "the folder name"
        errors.append(
            f"{what} {name!r} must be 1-{MAX_NAME} lowercase letters, digits, "
            "and single hyphens, such as `pdf-tools`"
        )
    elif given and given != folder.name:
        errors.append(f"`name` is {given!r} but the folder is {folder.name!r}: they must match")
    return name


def _text(data: dict[str, Any], key: str, errors: list[str]) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        errors.append(f"`{key}` must be text")
        return None
    return value.strip() or None


def _flag(data: dict[str, Any], key: str, default: bool, errors: list[str]) -> bool:
    value = data.get(key)
    if value is None:
        return default
    if not isinstance(value, bool):
        errors.append(f"`{key}` must be true or false")
        return default
    return value


def _argument_hint(data: dict[str, Any], errors: list[str]) -> str | None:
    value = data.get("argument-hint")
    # Claude Code's own examples write `argument-hint: [issue-number]`, which YAML reads as a list.
    if isinstance(value, list):
        items = cast(list[object], value)
        return " ".join(f"[{item}]" for item in items) or None
    return _text(data, "argument-hint", errors)


def _allowed_tools(data: dict[str, Any], errors: list[str]) -> tuple[str, ...]:
    """``Read, Grep`` or ``Read Grep`` or a YAML list. ``Bash(git diff:*)`` stays one entry."""
    value = data.get("allowed-tools")
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(_split_tools(value))
    if isinstance(value, list) and all(isinstance(item, str) for item in cast(list[object], value)):
        return tuple(item.strip() for item in cast(list[str], value) if item.strip())
    errors.append("`allowed-tools` must be text or a list of tool names")
    return ()


def _split_tools(text: str) -> list[str]:
    tools: list[str] = []
    current = ""
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if depth == 0 and (char == "," or char.isspace()):
            if current:
                tools.append(current)
            current = ""
        else:
            current += char
    if current:
        tools.append(current)
    return tools


def _first_paragraph(folder: Path, body_offset: int) -> str:
    """The first paragraph of the body that is not a heading, on one line."""
    try:
        body = _read_from(folder / SKILL_FILE, body_offset)
    except OSError:
        return ""
    for block in re.split(r"\n\s*\n", body):
        lines = [line.strip() for line in block.splitlines() if not line.lstrip().startswith("#")]
        text = " ".join(line for line in lines if line)
        if text:
            return text
    return ""


def _real(folder: Path) -> Path:
    try:
        return folder.resolve()
    except (OSError, RuntimeError):  # a symlink loop
        return folder


def _broken(folder: Path, real: Path, error: str, digest: str = "") -> Skill:
    return Skill(
        name=folder.name, description="", path=folder, real_path=real, hash=digest, errors=(error,)
    )


def _kb(size: int) -> str:
    return f"{size / 1024:.0f} KB" if size < 1 << 20 else f"{size / (1 << 20):.1f} MB"


__all__ = ["MAX_DESCRIPTION", "MAX_FILE_BYTES", "MAX_NAME", "parse_skill", "read_body"]
