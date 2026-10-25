"""Which skills a session sees: the folders golem reads, in order, and who wins a name.

The daemon is one process for every session, and a project's skills depend on
the session's folder. So the registry holds no single list: :meth:`view` builds
the list one session folder sees, the way ``ToolScope`` does for MCP servers.

Sources, highest first:

1. **project**: ``.golem/skills``, ``.agents/skills``, and ``.claude/skills``
   under the session folder.
2. **user**: ``~/.golem/skills``, ``~/.agents/skills``, ``~/.claude/skills``,
   then ``[skills] extra_dirs``.
3. **bundled**: skills that ship with golem.

The first skill of a name wins and the rest are listed as shadowed. A skill
with errors never wins, so a broken copy does not hide a working one. The same
folder reached twice, through a symlink, counts once.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from golem.config import SkillSettings
from golem.skills.model import SKILL_FILE, Skill
from golem.skills.parse import parse_skill

Origin = Literal["project", "user", "bundled"]

PROJECT_DIRS = (".golem/skills", ".agents/skills", ".claude/skills")
USER_DIRS = (".agents/skills", ".claude/skills")
"""Under the home folder. ``~/.golem/skills`` comes first, from the golem home."""
_CLAUDE = ".claude/skills"


@dataclass(frozen=True, slots=True)
class Source:
    origin: Origin
    path: Path


@dataclass(frozen=True, slots=True)
class Listed:
    """One skill as a session sees it."""

    skill: Skill
    origin: Origin
    shadowed_by: Path | None = None
    """The folder of the skill that won this name, when this one lost."""
    disabled: bool = False

    @property
    def usable(self) -> bool:
        return self.skill.valid and not self.disabled and self.shadowed_by is None


@dataclass(frozen=True, slots=True)
class SkillView:
    """The skills one session folder sees, winners and losers, in source order."""

    listed: tuple[Listed, ...]

    def get(self, name: str) -> Skill | None:
        """The usable skill of this name, or ``None``."""
        for entry in self.listed:
            if entry.usable and entry.skill.name == name:
                return entry.skill
        return None

    def usable(self) -> list[Skill]:
        return [entry.skill for entry in self.listed if entry.usable]


class SkillRegistry:
    """Finds skill folders and decides which one each name means."""

    def __init__(
        self,
        settings: SkillSettings,
        *,
        golem_skills: Path,
        user_home: Path | None = None,
        bundled: Path | None = None,
    ) -> None:
        self._settings = settings
        self._golem_skills = golem_skills
        self._home = user_home if user_home is not None else Path.home()
        self._bundled = bundled

    def sources(self, root: Path | None) -> list[Source]:
        """The folders read for a session in ``root``, highest first. They need not exist."""
        claude = self._settings.claude_dirs
        project = [d for d in PROJECT_DIRS if claude or d != _CLAUDE]
        user = [d for d in USER_DIRS if claude or d != _CLAUDE]
        found: list[Source] = []
        if root is not None:
            found += [Source("project", root / d) for d in project]
        found.append(Source("user", self._golem_skills))
        found += [Source("user", self._home / d) for d in user]
        found += [Source("user", self._expand(d)) for d in self._settings.extra_dirs]
        if self._bundled is not None:
            found.append(Source("bundled", self._bundled))
        return found

    def view(self, root: Path | None) -> SkillView:
        """Every skill a session in ``root`` sees, with the winner of each name."""
        disabled = set(self._settings.disabled)
        winners: dict[str, Path] = {}
        seen: set[Path] = set()
        found: list[tuple[Skill, Origin]] = []
        for source in self.sources(root):
            for skill in _skills_in(source.path):
                if skill.real_path in seen:
                    continue
                seen.add(skill.real_path)
                found.append((skill, source.origin))
                if skill.valid:
                    winners.setdefault(skill.name, skill.path)
        listed = [Listed(skill, origin, disabled=skill.name in disabled) for skill, origin in found]
        return SkillView(
            tuple(
                entry
                if winners.get(entry.skill.name) in (None, entry.skill.path)
                else replace(entry, shadowed_by=winners[entry.skill.name])
                for entry in listed
            )
        )

    def _expand(self, folder: str) -> Path:
        if folder == "~" or folder.startswith("~/"):
            return self._home / folder[2:]
        return Path(folder)


def _skills_in(folder: Path) -> Iterator[Skill]:
    """Each skill folder directly inside ``folder``, by name.

    A folder without a ``SKILL.md`` is not a skill. Names that start with
    ``.`` or ``_`` are skipped, so ``.git`` and ``_proposed`` never list.
    """
    try:
        entries = sorted(folder.iterdir())
    except OSError:
        return
    for entry in entries:
        if entry.name.startswith((".", "_")):
            continue
        if entry.is_dir() and (entry / SKILL_FILE).is_file():
            yield parse_skill(entry)


__all__ = ["Listed", "Origin", "SkillRegistry", "SkillView", "Source"]
