"""Check, write and create a skill's ``SKILL.md`` for the daemon's skill methods.

Every write goes through :func:`target`, which accepts only a ``SKILL.md`` that sits
directly in a skill folder of a folder the registry lists for the session folder,
and never a bundled one or one reached through a symlink out of its folder.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

import yaml

from golem.skills.model import SKILL_FILE
from golem.skills.parse import MAX_DESCRIPTION, MAX_NAME, NAME, parse_skill
from golem.skills.registry import Origin, SkillRegistry


class SkillEditError(ValueError):
    """The request cannot be done: a bad path, name, or folder."""


class SkillConflictError(SkillEditError):
    """``SKILL.md`` changed on disk since the text being written was read."""


@dataclass(frozen=True, slots=True)
class Issue:
    line: int | None
    message: str


@dataclass(frozen=True, slots=True)
class Checked:
    errors: tuple[Issue, ...]
    warnings: tuple[Issue, ...]


def target(registry: SkillRegistry, root: Path | None, path: str) -> tuple[Path, Origin]:
    """The ``SKILL.md`` ``path`` names, and which source it is in. Raises ``SkillEditError``."""
    file = Path(path)
    if not file.is_absolute() or file.name != SKILL_FILE:
        raise SkillEditError(f"path must be an absolute path to a {SKILL_FILE}")
    if file.is_symlink() or file.parent.is_symlink():
        raise SkillEditError(f"{path} is a symlink: edit the file it points to")
    if not file.is_file():
        raise SkillEditError(f"there is no {SKILL_FILE} at {path}")
    real = file.resolve()
    for source in registry.sources(root):
        if source.path != file.parent.parent and _real(source.path) != real.parent.parent:
            continue
        if source.origin == "bundled":
            raise SkillEditError(f"{path} is a bundled skill: golem's own skills are read-only")
        if real.parent.parent != _real(source.path):
            raise SkillEditError(f"{path} leads outside {source.path}")
        return file, source.origin
    raise SkillEditError(f"{path} is not in a skill folder that golem reads")


def check(folder_name: str, text: str) -> Checked:
    """What ``golem skills check`` says about ``text`` as the ``SKILL.md`` of ``folder_name``."""
    with tempfile.TemporaryDirectory(prefix="golem-skill-") as scratch:
        folder = Path(scratch) / folder_name
        folder.mkdir()
        (folder / SKILL_FILE).write_bytes(text.encode("utf-8"))
        skill = parse_skill(folder)
    return Checked(
        errors=tuple(_issue(text, message) for message in skill.errors),
        warnings=tuple(_issue(text, message) for message in skill.warnings),
    )


def write(file: Path, text: str, base_mtime_ns: int) -> int:
    """Replace ``file`` with ``text`` when it is still as it was read. Returns the new mtime.

    Raises :class:`SkillConflictError` when its ``mtime_ns`` is not ``base_mtime_ns``.
    """
    try:
        current = file.stat().st_mtime_ns
    except FileNotFoundError:
        raise SkillConflictError(f"{SKILL_FILE} was removed; reload") from None
    if current != base_mtime_ns:
        raise SkillConflictError(f"{SKILL_FILE} changed on disk; reload")
    _replace(file, text, mode=file.stat().st_mode & 0o777)
    return file.stat().st_mtime_ns


def create(folder: Path, name: str, description: str, *, model_invocable: bool) -> Path:
    """Make ``folder/<name>/SKILL.md`` with valid frontmatter. Returns its path.

    Raises :class:`SkillEditError` for a bad name or a skill that already exists.
    """
    if len(name) > MAX_NAME or not NAME.fullmatch(name):
        raise SkillEditError(
            f"name {name!r} must be 1-{MAX_NAME} lowercase letters, digits, "
            "and single hyphens, such as `pdf-tools`"
        )
    description = " ".join(description.split())
    if not description:
        raise SkillEditError("description must not be empty")
    if len(description) > MAX_DESCRIPTION:
        raise SkillEditError(f"description is over {MAX_DESCRIPTION} characters")
    fields: dict[str, object] = {"name": name, "description": description}
    if not model_invocable:
        fields["disable-model-invocation"] = True
    front = yaml.safe_dump(
        fields, sort_keys=False, allow_unicode=True, default_flow_style=False, width=1 << 20
    )
    skill = folder / name
    if os.path.lexists(skill):
        raise SkillEditError(f"{skill} already exists")
    folder.mkdir(parents=True, exist_ok=True)
    skill.mkdir()
    file = skill / SKILL_FILE
    _replace(file, f"---\n{front}---\n\n# {name}\n\n", mode=0o644)
    return file


def _replace(file: Path, text: str, *, mode: int) -> None:
    try:
        data = text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise SkillEditError(f"the text is not valid UTF-8: {exc.reason}") from exc
    temp = file.with_name(f".{file.name}.tmp")
    temp.write_bytes(data)
    os.chmod(temp, mode)
    temp.replace(file)


def _issue(text: str, message: str) -> Issue:
    yaml_line = re.match(r"the frontmatter is not valid YAML: line (\d+):", message)
    if yaml_line:
        return Issue(int(yaml_line.group(1)), message)
    key = re.match(r"`([a-z-]+)`", message)
    if key:
        found = re.search(rf"^{re.escape(key.group(1))}\s*:", text.lstrip("﻿"), re.MULTILINE)
        if found:
            return Issue(text.lstrip("﻿").count("\n", 0, found.start()) + 1, message)
    return Issue(None, message)


def _real(path: Path) -> Path:
    try:
        return path.resolve()
    except (OSError, RuntimeError):
        return path
