"""What golem knows about one skill folder, valid or not."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SKILL_FILE = "SKILL.md"


@dataclass(frozen=True, slots=True)
class Skill:
    """One skill folder, parsed from its ``SKILL.md`` frontmatter.

    A skill with errors is still a ``Skill``, so ``/skills`` can say what is
    wrong with it. Only a skill without errors is ever loaded. The body is not
    kept: :func:`golem.skills.parse.read_body` reads it when the skill is used.
    """

    name: str
    description: str
    path: Path
    """The folder, as it was found (it may be a symlink)."""
    real_path: Path
    """The folder with symlinks resolved, so one folder reached twice counts once."""
    hash: str
    """sha256 of ``SKILL.md``, or empty when it could not be read."""
    body_offset: int = 0
    """Byte offset of the body in ``SKILL.md``, after the frontmatter."""
    argument_hint: str | None = None
    user_invocable: bool = True
    model_invocable: bool = True
    """False when the frontmatter says ``disable-model-invocation: true``."""
    allowed_tools: tuple[str, ...] = ()
    model: str | None = None
    extras: Mapping[str, Any] = field(default_factory=dict[str, Any])
    """Frontmatter fields golem does not use, kept as they are."""
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def file(self) -> Path:
        return self.path / SKILL_FILE

    @property
    def valid(self) -> bool:
        return not self.errors


__all__ = ["SKILL_FILE", "Skill"]
