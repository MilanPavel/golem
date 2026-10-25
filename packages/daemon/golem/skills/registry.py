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

A parsed skill is kept until its ``SKILL.md`` stamp (mtime and size) changes.
While the daemon runs, :meth:`SkillRegistry.check` polls the stamps, and
``[skills]`` in ``config.toml``, and sends ``skill.registry.changed`` for what
moved, the way MCP, models, and rules reload.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import stat
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from golem.config import SkillSettings
from golem.skills.model import SKILL_FILE, Skill
from golem.skills.parse import parse_skill
from golem_protocol.commands import ListedSkill, SkillRegistryChanged
from golem_protocol.rpc import SkillRegistryChangedNotification

log = logging.getLogger(__name__)

Origin = Literal["project", "user", "bundled"]
Stamp = tuple[int, int]
Broadcast = Callable[[BaseModel], None]
Fingerprint = tuple[tuple[Path, tuple[tuple[str, Stamp], ...]], ...]

RELOAD_SECONDS = 2.0

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
    """Finds skill folders and decides which one each name means.

    ``load_settings`` reads ``[skills]`` again when ``config_file`` changes. A
    file that does not validate keeps the last good settings.
    """

    def __init__(
        self,
        settings: SkillSettings,
        *,
        golem_skills: Path,
        user_home: Path | None = None,
        bundled: Path | None = None,
        config_file: Path | None = None,
        load_settings: Callable[[], SkillSettings] | None = None,
        broadcast: Broadcast | None = None,
        reload_seconds: float = RELOAD_SECONDS,
    ) -> None:
        self._settings = settings
        self._golem_skills = golem_skills
        self._home = user_home if user_home is not None else Path.home()
        self._bundled = bundled
        self._config_file = config_file
        self._config_stamp = None if config_file is None else _stamp(config_file)
        self._load_settings = load_settings
        self.broadcast: Broadcast = broadcast or (lambda _notification: None)
        self._reload_seconds = reload_seconds
        self._cache: dict[Path, tuple[Stamp, Skill]] = {}
        self._roots: set[Path] = set()
        """Session folders a view was asked for. Their project skills are watched."""
        self._fingerprints: dict[Path | None, Fingerprint] = {None: self._fingerprint(None)}
        self._watcher: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Watch the skill folders and ``config.toml`` until :meth:`aclose`."""
        self._watcher = asyncio.get_running_loop().create_task(self._watch(), name="skills-watch")

    async def aclose(self) -> None:
        if self._watcher is not None:
            self._watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watcher
            self._watcher = None

    def check(self) -> list[Path | None]:
        """Look for changes once, and announce each.

        Returns the folders whose project skills changed, or ``[None]`` when
        the user's or golem's skills, or the settings, changed.
        """
        if self._reload_settings():
            for key in [None, *self._roots]:
                self._fingerprints[key] = self._fingerprint(key)
            changed: list[Path | None] = [None]
        else:
            changed = []
            for key in [None, *sorted(self._roots)]:
                now = self._fingerprint(key)
                if now != self._fingerprints.get(key):
                    self._fingerprints[key] = now
                    changed.append(key)
        for key in changed:
            root = None if key is None else str(key)
            self._announce(SkillRegistryChangedNotification(params=SkillRegistryChanged(root=root)))
        return changed

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
        if root is not None and root not in self._roots:
            self._roots.add(root)
            self._fingerprints[root] = self._fingerprint(root)
        disabled = set(self._settings.disabled)
        winners: dict[str, Path] = {}
        seen: set[Path] = set()
        found: list[tuple[Skill, Origin]] = []
        for source in self.sources(root):
            for skill in self._skills_in(source.path):
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

    def _skills_in(self, folder: Path) -> Iterator[Skill]:
        """Each skill in ``folder``, parsed again only when its ``SKILL.md`` changed."""
        for entry, stamp in _entries(folder):
            cached = self._cache.get(entry)
            if cached is None or cached[0] != stamp:
                cached = (stamp, parse_skill(entry))
                self._cache[entry] = cached
            yield cached[1]

    def _fingerprint(self, key: Path | None) -> Fingerprint:
        """What a change shows up in: each source's skill folders and their stamps.

        ``None`` covers the user's and golem's folders, a session folder only its own.
        """
        if key is None:
            sources = self.sources(None)
        else:
            sources = [source for source in self.sources(key) if source.origin == "project"]
        return tuple(
            (source.path, tuple((entry.name, stamp) for entry, stamp in _entries(source.path)))
            for source in sources
        )

    def _reload_settings(self) -> bool:
        """Read ``[skills]`` again if ``config.toml`` changed. True when the settings did."""
        if self._config_file is None or self._load_settings is None:
            return False
        stamp = _stamp(self._config_file)
        if stamp == self._config_stamp:
            return False
        self._config_stamp = stamp
        try:
            settings = self._load_settings()
        except (OSError, ValueError) as exc:
            log.warning(
                "keeping the last good [skills]; %s does not validate: %s", self._config_file, exc
            )
            return False
        if settings == self._settings:
            return False
        self._settings = settings
        log.info("reloaded [skills] from %s", self._config_file)
        return True

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self._reload_seconds)
            try:
                self.check()
            except Exception:
                log.exception("checking the skill folders failed")

    def _announce(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.debug("broadcast failed", exc_info=True)


def listed_skill(entry: Listed) -> ListedSkill:
    """One entry of a view, as ``skill.list`` sends it."""
    skill = entry.skill
    return ListedSkill(
        name=skill.name,
        description=skill.description,
        source=entry.origin,
        path=str(skill.path),
        usable=entry.usable,
        shadowed_by=None if entry.shadowed_by is None else str(entry.shadowed_by),
        disabled=entry.disabled,
        errors=list(skill.errors),
        warnings=list(skill.warnings),
        user_invocable=skill.user_invocable,
        model_invocable=skill.model_invocable,
        argument_hint=skill.argument_hint,
        allowed_tools=list(skill.allowed_tools),
        model=skill.model,
    )


def _entries(folder: Path) -> list[tuple[Path, Stamp]]:
    """Each skill folder directly inside ``folder``, by name, with its ``SKILL.md`` stamp.

    A folder without a ``SKILL.md`` is not a skill. Names that start with
    ``.`` or ``_`` are skipped, so ``.git`` and ``_proposed`` never list.
    """
    try:
        children = sorted(folder.iterdir())
    except OSError:
        return []
    found: list[tuple[Path, Stamp]] = []
    for child in children:
        if child.name.startswith((".", "_")):
            continue
        stamp = _stamp(child / SKILL_FILE)
        if stamp is not None:
            found.append((child, stamp))
    return found


def _stamp(path: Path) -> Stamp | None:
    """mtime and size, following symlinks. ``None`` for a missing file or a folder."""
    try:
        info = path.stat()
    except OSError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return None
    return info.st_mtime_ns, info.st_size


__all__ = ["Listed", "Origin", "SkillRegistry", "SkillView", "Source", "listed_skill"]
