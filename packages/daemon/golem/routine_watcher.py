"""The watch trigger: a routine with ``on = { watch, glob }`` fires once per new file (ADR-050).

A pass lists each watched folder with ``os.scandir`` and follows every file that is
not yet known. A file fires when it is new, matches the glob, and has been unchanged
(size and mtime) for ``settle`` seconds, so a download or a slow copy fires once, when
it is done. Dotfiles, folders, and ``.crdownload``, ``.download`` and ``.part`` files
are never watched.

Files already in a folder when its watch starts are ignored: the first listing of a
routine is its baseline. After a restart the baseline is taken again, so an old file
does not fire, and ``routine_runs`` remembers ``(routine, path, size, mtime)`` of every
file that fired, so a file that comes back as it was does not fire twice either.

This is a polling watcher, not ``watchfiles``: that dependency could not be added to
``uv.lock`` offline, and it can replace the listing behind this class. The clock, the
interval and the settle time are parameters, so a test drives time itself.

A folder that is missing or cannot be read is a problem of its routine, logged once
and listed in ``routine.list`` ``issues`` until it works again.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import shlex
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from golem.routine_files import RoutineProblem

if TYPE_CHECKING:
    from golem.routine_scheduler import Planned

__all__ = ["FileWatcher", "WatchSource", "fill_prompt"]

log = logging.getLogger("golem.routines")

SETTLE = 2.0
"""Seconds a new file must stay unchanged before it fires."""

INTERVAL = 1.0
"""Seconds between two listings."""

RELOAD = 10.0
"""Seconds after which the routines are read again, unless ``reload`` says sooner."""

PARTIAL = (".crdownload", ".download", ".part")
"""Suffixes of a download that is not finished."""

_PLACEHOLDER = re.compile(r"\{(path|name|dir)\}")


def fill_prompt(prompt: str, path: Path) -> str:
    """``prompt`` with ``{path}`` (absolute), ``{name}`` and ``{dir}`` filled in.

    A ``/skill args`` prompt gets the values quoted for the shell, one word each.
    """
    values = {"path": str(path), "name": path.name, "dir": str(path.parent)}
    quoted = prompt.lstrip().startswith("/")

    def one(found: re.Match[str]) -> str:
        value = values[found.group(1)]
        return shlex.quote(value) if quoted else value

    return _PLACEHOLDER.sub(one, prompt)


class WatchSource(Protocol):
    """What the watcher needs from the scheduler."""

    async def watched(self) -> list[Planned]: ...

    async def fire_watch(self, routine: Planned, path: Path, size: int, mtime_ns: int) -> bool: ...

    def config_file(self, routine: Planned) -> Path: ...


@dataclass(slots=True)
class _Candidate:
    size: int
    mtime_ns: int
    since: float


@dataclass(slots=True)
class _Watch:
    signature: tuple[str, str, str]
    known: set[str]
    pending: dict[str, _Candidate] = field(default_factory=dict[str, _Candidate])


def _folder_of(routine: Planned) -> Path | None:
    on = routine.settings.on
    if on is None:
        return None
    folder = Path(on.watch).expanduser()
    if not folder.is_absolute():
        if routine.folder is None:
            return None
        folder = routine.folder / folder
    return folder


def _wanted(name: str, glob: str) -> bool:
    if name.startswith(".") or name.lower().endswith(PARTIAL):
        return False
    return fnmatchcase(name.lower(), glob.lower())


def _list(folder: Path, glob: str) -> dict[str, tuple[int, int]]:
    """The files of ``folder`` that match ``glob``, as ``{path: (size, mtime_ns)}``."""
    found: dict[str, tuple[int, int]] = {}
    with os.scandir(folder) as entries:
        for entry in entries:
            if not _wanted(entry.name, glob):
                continue
            try:
                if not entry.is_file():
                    continue
                info = entry.stat()
            except OSError:
                continue  # gone between the listing and the stat
            found[entry.path] = (info.st_size, info.st_mtime_ns)
    return found


class FileWatcher:
    def __init__(
        self,
        source: WatchSource,
        *,
        settle: float = SETTLE,
        interval: float = INTERVAL,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source = source
        self._settle = settle
        self._interval = interval
        self._clock = clock
        self._watches: dict[tuple[str, str], _Watch] = {}
        self._problems: dict[tuple[str, str], RoutineProblem] = {}
        self._routines: list[Planned] = []
        self._loaded: float | None = None
        self._stale = True
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="golem-watcher")

    async def aclose(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    def reload(self) -> None:
        """Read the routines again on the next pass, because the config changed."""
        self._stale = True
        self._wake.set()

    def problems(self) -> list[RoutineProblem]:
        """The watched folders that cannot be read now, one problem each."""
        return list(self._problems.values())

    async def scan(self) -> None:
        """One pass over every watched folder."""
        now = self._clock()
        if self._stale or self._loaded is None or now - self._loaded >= RELOAD:
            self._routines = await self._source.watched()
            self._loaded, self._stale = now, False
        live = {routine.key for routine in self._routines}
        for key in list(self._watches):
            if key not in live:
                del self._watches[key]
        for key in list(self._problems):
            if key not in live:
                del self._problems[key]
        for routine in self._routines:
            try:
                await self._scan_one(routine, now)
            except Exception:
                log.exception("could not watch for routine %s", routine.name)

    async def _loop(self) -> None:
        while True:
            self._wake.clear()
            try:
                await self.scan()
            except Exception:
                log.exception("the file watcher could not scan")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), self._interval)

    async def _scan_one(self, routine: Planned, now: float) -> None:
        on = routine.settings.on
        folder = _folder_of(routine)
        if on is None:
            return
        if folder is None:
            self._problem(routine, f"{on.watch} is not an absolute path")
            return
        try:
            listing = await asyncio.to_thread(_list, folder, on.glob)
        except FileNotFoundError:
            self._problem(routine, f"{folder} does not exist")
            return
        except NotADirectoryError:
            self._problem(routine, f"{folder} is not a folder")
            return
        except OSError as exc:
            self._problem(routine, f"{folder} cannot be read: {exc.strerror or exc}")
            return
        if self._problems.pop(routine.key, None) is not None:
            log.info("routine %s can watch %s again", routine.name, folder)
        signature = (str(folder), on.glob, str(routine.folder))
        watch = self._watches.get(routine.key)
        if watch is None or watch.signature != signature:
            self._watches[routine.key] = _Watch(signature, set(listing))
            return
        watch.known &= set(listing)
        for path in list(watch.pending):
            if path not in listing:
                del watch.pending[path]
        for path, (size, mtime_ns) in listing.items():
            if path in watch.known:
                continue
            seen = watch.pending.get(path)
            if seen is None or (seen.size, seen.mtime_ns) != (size, mtime_ns):
                watch.pending[path] = _Candidate(size, mtime_ns, now)
            elif now - seen.since >= self._settle and await self._source.fire_watch(
                routine, Path(path), size, mtime_ns
            ):
                watch.known.add(path)
                del watch.pending[path]

    def _problem(self, routine: Planned, why: str) -> None:
        message = f"routine {routine.name}: cannot watch, {why}"
        found = self._problems.get(routine.key)
        if found is None or found.message != message:
            log.warning(message, extra={"routine": routine.name})
        self._problems[routine.key] = RoutineProblem(
            str(self._source.config_file(routine)), message
        )
