"""Finds workflow files, decides which may run, and reads them in a subprocess.

Sources: ``<project>/workflows/*.py`` for each trusted project folder, and the user's
``workflows`` folder. A project folder that is not trusted lists its files as
``untrusted`` and never imports them.

A file is imported only in a short-lived ``python -I`` subprocess that prints the specs
it found as JSON. A crash, a hang, ``sys.exit``, a syntax or import error becomes a
``broken`` entry with the error tail, so the daemon never runs user code itself.

:meth:`WorkflowRegistry.refresh` rescans and reloads only the files whose stamp (mtime and
size) changed. :meth:`WorkflowRegistry.watch` calls it on a timer.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

from golem.workflow import Manual, OnFile, OnRestart, Schedule, Trigger, WorkflowSpec

log = logging.getLogger(__name__)

State = Literal["ok", "broken", "untrusted"]
Stamp = tuple[int, int]

LOAD_TIMEOUT = 10.0
WATCH_SECONDS = 3.0
PROJECT_DIR = "workflows"
_MARK = "@@golem-workflows@@"
_TAIL = 2000

_LOADER = r"""
import dataclasses, importlib.util, json, sys, traceback
path, mark = sys.argv[1], sys.argv[2]
try:
    spec = importlib.util.spec_from_file_location("golem_user_workflow", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["golem_user_workflow"] = module
    spec.loader.exec_module(module)
    found = [
        dataclasses.asdict(v.__golem_workflow__)
        for v in vars(module).values()
        if callable(v) and hasattr(v, "__golem_workflow__")
    ]
    out = {"specs": found}
except BaseException:
    out = {"error": traceback.format_exc()}
sys.stdout.write("\n" + mark + json.dumps(out) + "\n")
sys.stdout.flush()
"""


@dataclass(frozen=True, slots=True)
class WorkflowEntry:
    id: str
    """``<path>::<name>``; for a file with no workflow, the path."""
    name: str
    path: Path
    project: Path | None
    """The project folder, or ``None`` for the user's folder."""
    state: State
    spec: WorkflowSpec | None
    error: str | None
    mtime: float


def _trigger(value: object) -> Trigger | None:
    if not isinstance(value, dict):
        return None
    raw = cast(dict[str, object], value)
    kind = raw.get("kind")
    if kind == "schedule":
        return Schedule(str(raw["expr"]))
    if kind == "on_file":
        return OnFile(str(raw["path"]))
    if kind == "manual":
        return Manual()
    return None


def _restart(value: object) -> OnRestart:
    return "fail" if value == "fail" else "ask" if value == "ask" else "resume"


def _spec(raw: dict[str, object]) -> WorkflowSpec:
    listed: object = raw.get("inputs") or []
    if not isinstance(listed, list):
        raise TypeError("inputs is not a list")
    inputs = cast(list[list[object]], listed)
    return WorkflowSpec(
        name=str(raw["name"]),
        trigger=_trigger(raw.get("trigger")),
        inputs=tuple((str(pair[0]), str(pair[1])) for pair in inputs),
        description=str(raw.get("description") or ""),
        line=int(str(raw.get("line") or 0)),
        on_restart=_restart(raw.get("on_restart")),
    )


def load_file(path: Path, timeout: float = LOAD_TIMEOUT) -> tuple[list[WorkflowSpec], str | None]:
    """Import ``path`` in a subprocess. Returns its specs, or an error text."""
    try:
        done = subprocess.run(
            [sys.executable, "-I", "-c", _LOADER, str(path), _MARK],
            capture_output=True,
            text=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
            cwd=path.parent,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return [], f"importing took longer than {timeout:g} s and was stopped"
    except OSError as exc:
        return [], f"could not start python: {exc}"
    for line in reversed(done.stdout.splitlines()):
        if line.startswith(_MARK):
            try:
                out = json.loads(line[len(_MARK) :])
                if "error" in out:
                    return [], str(out["error"])[-_TAIL:]
                return [_spec(s) for s in out["specs"]], None
            except (ValueError, KeyError, TypeError) as exc:
                return [], f"unreadable loader output: {exc}"
    tail = (done.stderr or done.stdout).strip()[-_TAIL:]
    return [], f"the file ended the process (exit {done.returncode})" + (
        f":\n{tail}" if tail else ""
    )


def _stamp(path: Path) -> Stamp | None:
    try:
        info = path.stat()
    except OSError:
        return None
    return info.st_mtime_ns, info.st_size


def _files(folder: Path) -> list[Path]:
    try:
        children = sorted(folder.glob("*.py"))
    except OSError:
        return []
    return [c for c in children if not c.name.startswith((".", "_")) and c.is_file()]


class WorkflowRegistry:
    def __init__(
        self,
        *,
        user_dir: Path,
        projects: Callable[[], Iterable[Path]],
        trusted: Callable[[Path], bool],
        load_timeout: float = LOAD_TIMEOUT,
        on_change: Callable[[], None] | None = None,
    ) -> None:
        """``projects`` lists the project folders to look in; ``trusted`` is the same rule
        as for agent files (``trusted_projects``), checked at every refresh."""
        self._user_dir = user_dir
        self._projects = projects
        self._trusted = trusted
        self._timeout = load_timeout
        self._on_change = on_change
        self._cache: dict[Path, tuple[Stamp, bool, list[WorkflowEntry]]] = {}
        self._entries: list[WorkflowEntry] = []
        self._task: asyncio.Task[None] | None = None
        self._scan = threading.Lock()

    def entries(self) -> list[WorkflowEntry]:
        return list(self._entries)

    def refresh(self) -> bool:
        """Rescan; reload the files that changed. True when the list changed.

        Callers (the watch loop and handlers) run in threads; one scan at a time.
        """
        with self._scan:
            return self._refresh()

    def _refresh(self) -> bool:
        sources: list[tuple[Path, Path | None]] = [(f, None) for f in _files(self._user_dir)]
        for project in self._projects():
            sources.extend((f, project) for f in _files(project / PROJECT_DIR))
        seen: set[Path] = set()
        entries: list[WorkflowEntry] = []
        for path, project in sources:
            stamp = _stamp(path)
            if stamp is None or path in seen:
                continue
            seen.add(path)
            ok = project is None or self._trusted(project)
            cached = self._cache.get(path)
            if cached is None or cached[0] != stamp or cached[1] != ok:
                cached = (stamp, ok, self._load(path, project, stamp, ok))
                self._cache[path] = cached
            entries.extend(cached[2])
        for gone in set(self._cache) - seen:
            del self._cache[gone]
        entries = _mark_duplicates(entries)
        changed = entries != self._entries
        self._entries = entries
        if changed and self._on_change is not None:
            self._on_change()
        return changed

    def _load(
        self, path: Path, project: Path | None, stamp: Stamp, trusted: bool
    ) -> list[WorkflowEntry]:
        mtime = stamp[0] / 1e9

        def one(
            name: str, state: State, spec: WorkflowSpec | None, error: str | None
        ) -> WorkflowEntry:
            ident = f"{path}::{name}" if spec is not None else str(path)
            return WorkflowEntry(ident, name, path, project, state, spec, error, mtime)

        if not trusted:
            return [one(path.stem, "untrusted", None, "this folder is not in trusted_projects")]
        specs, error = load_file(path, self._timeout)
        if error is not None:
            return [one(path.stem, "broken", None, error)]
        if not specs:
            return [one(path.stem, "broken", None, "the file defines no @workflow function")]
        return [one(s.name, "ok", s, None) for s in specs]

    def start(self, seconds: float = WATCH_SECONDS) -> None:
        self._task = asyncio.get_running_loop().create_task(self.watch(seconds))

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def watch(self, seconds: float = WATCH_SECONDS) -> None:
        """Refresh every ``seconds`` until cancelled. Loading runs off the event loop."""
        while True:
            try:
                await asyncio.to_thread(self.refresh)
            except Exception:
                log.exception("refreshing workflow files failed")
            await asyncio.sleep(seconds)


def _mark_duplicates(entries: list[WorkflowEntry]) -> list[WorkflowEntry]:
    counts: dict[tuple[Path | None, str], int] = {}
    for e in entries:
        if e.state == "ok":
            counts[(e.project, e.name)] = counts.get((e.project, e.name), 0) + 1
    out: list[WorkflowEntry] = []
    for e in entries:
        if e.state == "ok" and counts[(e.project, e.name)] > 1:
            e = WorkflowEntry(
                e.id, e.name, e.path, e.project, "broken", None, "name used twice", e.mtime
            )
        out.append(e)
    return out


__all__ = ["WorkflowEntry", "WorkflowRegistry", "load_file"]
