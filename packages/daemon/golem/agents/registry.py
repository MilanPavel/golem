"""Which agent types a session sees: the folders golem reads, in order, and who wins a name.

Like the skill registry, this holds no single list: :meth:`AgentRegistry.view`
builds the list one session folder sees.

Sources, highest first:

1. **project**: ``.golem/agents`` under the session folder. Read only when the
   folder is trusted (``trusted_projects``), because an agent file picks tools
   and a prompt.
2. **user**: ``~/.golem/agents``, then ``[agents] extra_dirs``.
3. **bundled**: the agent files that ship with golem.

The first valid agent of a name wins and the rest are listed as shadowed. An
agent with errors never wins, so a broken copy does not hide a working one. The
same file reached twice, through a symlink, counts once.

A parsed file is kept until its stamp (mtime and size) changes.
:meth:`AgentRegistry.check` polls the stamps, and ``[agents]`` in
``config.toml``, and calls ``on_change`` for what moved. The server turns that
into the ``agent.registry.changed`` notification, the way skills do.
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

from golem.agents.model import AGENT_SUFFIX, Agent
from golem.agents.parse import parse_agent
from golem.config import AgentSettings

log = logging.getLogger(__name__)

Origin = Literal["project", "user", "bundled"]
Stamp = tuple[int, int]
Fingerprint = tuple[tuple[Path, tuple[tuple[str, Stamp], ...]], ...]
Changed = Callable[[Path | None], None]
"""Called with the session folder whose project agents changed, or ``None`` for the rest."""

RELOAD_SECONDS = 2.0

PROJECT_DIR = ".golem/agents"


@dataclass(frozen=True, slots=True)
class Source:
    origin: Origin
    path: Path


@dataclass(frozen=True, slots=True)
class Listed:
    """One agent as a session sees it."""

    agent: Agent
    origin: Origin
    shadowed_by: Path | None = None
    """The file of the agent that won this name, when this one lost."""

    @property
    def usable(self) -> bool:
        return self.agent.valid and self.shadowed_by is None


@dataclass(frozen=True, slots=True)
class AgentView:
    """The agents one session folder sees, winners and losers, in source order."""

    listed: tuple[Listed, ...]

    def get(self, name: str) -> Agent | None:
        """The usable agent of this name, or ``None``."""
        for entry in self.listed:
            if entry.usable and entry.agent.name == name:
                return entry.agent
        return None

    def usable(self) -> list[Agent]:
        return [entry.agent for entry in self.listed if entry.usable]


class AgentRegistry:
    """Finds agent files and decides which one each name means.

    ``trusted`` says whether a session folder is in ``trusted_projects``.
    ``load_settings`` reads ``[agents]`` again when ``config_file`` changes. A
    file that does not validate keeps the last good settings.
    """

    def __init__(
        self,
        settings: AgentSettings,
        *,
        golem_agents: Path,
        trusted: Callable[[Path], bool],
        user_home: Path | None = None,
        bundled: Path | None = None,
        config_file: Path | None = None,
        load_settings: Callable[[], AgentSettings] | None = None,
        on_change: Changed | None = None,
        reload_seconds: float = RELOAD_SECONDS,
    ) -> None:
        self._settings = settings
        self._golem_agents = golem_agents
        self._trusted = trusted
        self._home = user_home if user_home is not None else Path.home()
        self._bundled = bundled
        self._config_file = config_file
        self._config_stamp = None if config_file is None else _stamp(config_file)
        self._load_settings = load_settings
        self.on_change: Changed = on_change or (lambda _root: None)
        self._reload_seconds = reload_seconds
        self._cache: dict[Path, tuple[Stamp, Agent]] = {}
        self._roots: set[Path] = set()
        """Session folders a view was asked for. Their project agents are watched."""
        self._fingerprints: dict[Path | None, Fingerprint] = {None: self._fingerprint(None)}
        self._watcher: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Watch the agent folders and ``config.toml`` until :meth:`aclose`."""
        self._watcher = asyncio.get_running_loop().create_task(self._watch(), name="agents-watch")

    async def aclose(self) -> None:
        if self._watcher is not None:
            self._watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watcher
            self._watcher = None

    def check(self) -> list[Path | None]:
        """Look for changes once, and announce each.

        Returns the folders whose project agents changed, or ``[None]`` when
        the user's or golem's agents, or the settings, changed.
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
            try:
                self.on_change(key)
            except Exception:
                log.debug("announcing an agent change failed", exc_info=True)
        return changed

    def sources(self, root: Path | None) -> list[Source]:
        """The folders read for a session in ``root``, highest first. They need not exist.

        A ``root`` that is not trusted gets no project folder.
        """
        found: list[Source] = []
        if root is not None and self._trusted(root):
            found.append(Source("project", root / PROJECT_DIR))
        found.append(Source("user", self._golem_agents))
        found += [Source("user", self._expand(d)) for d in self._settings.extra_dirs]
        if self._bundled is not None:
            found.append(Source("bundled", self._bundled))
        return found

    def view(self, root: Path | None) -> AgentView:
        """Every agent a session in ``root`` sees, with the winner of each name."""
        if root is not None and root not in self._roots:
            self._roots.add(root)
            self._fingerprints[root] = self._fingerprint(root)
        winners: dict[str, Path] = {}
        seen: set[Path] = set()
        found: list[Listed] = []
        for source in self.sources(root):
            for agent in self._agents_in(source.path):
                if agent.real_path in seen:
                    continue
                seen.add(agent.real_path)
                found.append(Listed(agent, source.origin))
                if agent.valid:
                    winners.setdefault(agent.name, agent.path)
        return AgentView(
            tuple(
                entry
                if winners.get(entry.agent.name) in (None, entry.agent.path)
                else replace(entry, shadowed_by=winners[entry.agent.name])
                for entry in found
            )
        )

    def blocked(self, root: Path | None) -> list[Agent]:
        """Agents in the project folder of ``root`` when ``root`` is not trusted.

        :meth:`view` never reads that folder. This reads it only so a list can show what is
        held back. These agents are never started and win no name.
        """
        if root is None or self._trusted(root):
            return []
        return list(self._agents_in(root / PROJECT_DIR))

    def _expand(self, folder: str) -> Path:
        if folder == "~" or folder.startswith("~/"):
            return self._home / folder[2:]
        return Path(folder)

    def _agents_in(self, folder: Path) -> Iterator[Agent]:
        """Each agent in ``folder``, parsed again only when its file changed."""
        for entry, stamp in _entries(folder):
            cached = self._cache.get(entry)
            if cached is None or cached[0] != stamp:
                cached = (stamp, parse_agent(entry))
                self._cache[entry] = cached
            yield cached[1]

    def _fingerprint(self, key: Path | None) -> Fingerprint:
        """What a change shows up in: each source's agent files and their stamps.

        ``None`` covers the user's and golem's folders, a session folder only
        its own project folder. A folder that stops or starts being trusted
        changes its fingerprint, because its source appears or goes.
        """
        if key is None:
            sources = self.sources(None)
        else:
            sources = [source for source in self.sources(key) if source.origin == "project"]
            if not sources:
                return ()
        return tuple(
            (source.path, tuple((entry.name, stamp) for entry, stamp in _entries(source.path)))
            for source in sources
        )

    def _reload_settings(self) -> bool:
        """Read ``[agents]`` again if ``config.toml`` changed. True when the settings did."""
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
                "keeping the last good [agents]; %s does not validate: %s", self._config_file, exc
            )
            return False
        if settings == self._settings:
            return False
        self._settings = settings
        log.info("reloaded [agents] from %s", self._config_file)
        return True

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self._reload_seconds)
            try:
                self.check()
            except Exception:
                log.exception("checking the agent folders failed")


def _entries(folder: Path) -> list[tuple[Path, Stamp]]:
    """Each ``*.md`` file directly inside ``folder``, by name, with its stamp.

    Names that start with ``.`` or ``_`` are skipped, so a draft such as
    ``_wip.md`` never lists.
    """
    try:
        children = sorted(folder.iterdir())
    except OSError:
        return []
    found: list[tuple[Path, Stamp]] = []
    for child in children:
        if child.name.startswith((".", "_")) or child.suffix != AGENT_SUFFIX:
            continue
        stamp = _stamp(child)
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


__all__ = ["AgentRegistry", "AgentView", "Listed", "Origin", "Source"]
