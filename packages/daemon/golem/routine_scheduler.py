"""The routine scheduler: a routine fires on time as a headless session (ADR-050).

One asyncio task keeps each enabled routine's next due time, sleeps until the
earliest one, and wakes at least every 60 seconds. Every pass reads the routines
again, so a changed config file takes effect without a restart. A pass that finds
a due time long past (the daemon was down, or the Mac slept) follows the routine's
``missed`` setting: ``run_once`` fires it once, late, and ``skip`` drops it.

Every firing is a ``routine_runs`` row, written before the session starts. The row
is the history, and on a restart it says which due times were already seen.

A routine is read through :mod:`golem.routine_files`, so a project's routines run
only while the folder is in ``trusted_projects``, and trust is checked again at each
firing. The clock and the sleep are parameters, so a test drives time itself.
"""

from __future__ import annotations

import asyncio
import logging
import tomllib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from typing import Any, Literal, Protocol, cast

from pydantic import BaseModel

from golem.config import RoutineSettings
from golem.routine_files import project_config, read_project_routines, read_routines
from golem.routine_query import QueryRoutines
from golem.routine_watcher import fill_prompt
from golem.routines import ScheduleError, local_zone, next_after
from golem.sessions.summaries import cut_summary
from golem.store.inbox_posts import InboxPosts
from golem.store.routine_runs import RoutineRunRecord, RoutineRuns, WatchedFile
from golem_protocol.commands import RoutineFinished, RoutineFired
from golem_protocol.events import ChatEvent, SessionCompletedEvent
from golem_protocol.rpc import RoutineFinishedNotification, RoutineFiredNotification

__all__ = [
    "GRACE",
    "MAX_NAP",
    "Launcher",
    "Planned",
    "RoutineBlockedError",
    "RoutineBusyError",
    "RoutineNotFoundError",
    "RoutineScheduler",
    "WorkflowStarter",
    "routine_problem",
    "trusted_folders",
]

log = logging.getLogger("golem.routines")

MAX_NAP = 60.0
"""Seconds the loop sleeps at most, so a changed file and a slept Mac are noticed."""

GRACE = timedelta(seconds=120)
"""How late a due time may be and still count as on time. Later is a missed run."""

_WORKFLOW_OUTCOMES = {"done": "succeeded", "failed": "failed", "cancelled": "cancelled"}
"""A workflow run's end, as a firing's end."""

_OUTCOMES = {"completed": "succeeded", "failed": "failed", "cancelled": "cancelled"}
"""A run's end, as a firing's end."""

Trigger = Literal["schedule", "manual", "watch", "hook"]


class RoutineBusyError(Exception):
    """The routine's previous run is still running or waiting."""


class RoutineBlockedError(Exception):
    """The routine's project folder is not trusted."""


class RoutineNotFoundError(Exception):
    """No routine has this name in this scope."""


@dataclass(frozen=True, slots=True)
class Planned:
    """A routine as the scheduler sees it. ``folder`` is the project folder, None for the user's."""

    settings: RoutineSettings
    folder: Path | None = None

    @property
    def name(self) -> str:
        return self.settings.name

    @property
    def scope(self) -> str:
        return "user" if self.folder is None else str(self.folder)

    @property
    def key(self) -> tuple[str, str]:
        return (self.scope, self.name)


class Launcher(Protocol):
    """What a firing needs from the session layer."""

    async def create(self, routine: Planned) -> str:
        """Make the routine's session (origin, folder, model, MCP servers). Returns its id."""
        ...

    async def send(
        self, routine: Planned, session_id: str, read_folders: tuple[str, ...] = ()
    ) -> None:
        """Send the routine's prompt, or its ``/skill``, the way the composer does.

        ``read_folders`` are folders the session may read from (a watched folder).
        """
        ...


class WorkflowStarter(Protocol):
    """What a routine that has a ``workflow`` needs from the workflow service."""

    def problem(self, name: str, project: Path | None, inputs: dict[str, Any]) -> str | None:
        """Why the workflow cannot start with these inputs now, or None."""
        ...

    async def start_named(
        self, name: str, project: Path | None, inputs: dict[str, Any], trigger: str
    ) -> tuple[str, str | None]:
        """Start a run. Returns the workflow run id and its session id, None while it has none."""
        ...

    async def run_status(self, workflow_run_id: str) -> tuple[str, str | None] | None:
        """The ``(status, error)`` of a workflow run, None when there is no such run."""
        ...


def routine_problem(
    settings: RoutineSettings, folder: Path | None, workflows: WorkflowStarter | None
) -> str | None:
    """What is wrong with the workflow of a routine, or None.

    A watch routine passes ``path``, so the workflow must declare that input.
    """
    if settings.workflow is None or workflows is None:
        return None
    given: dict[str, Any] = dict(settings.inputs)
    if settings.on is not None:
        given.setdefault("path", "")
    found = workflows.problem(settings.workflow, folder, given)
    return None if found is None else f"{settings.name}: {found}"


@dataclass(slots=True)
class _Plan:
    schedule: str
    next_at: datetime


def trusted_folders(user_file: Path) -> list[Path]:
    """The folders in ``trusted_projects`` of the user's file, resolved."""
    try:
        data = tomllib.loads(user_file.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    listed: object = data.get("trusted_projects", [])
    found: list[Path] = []
    for raw in cast(list[object], listed) if isinstance(listed, list) else []:
        if isinstance(raw, str):
            path = Path(raw).expanduser()
            if path.is_absolute():
                found.append(path.resolve())
    return found


class RoutineScheduler:
    def __init__(
        self,
        *,
        runs: RoutineRuns,
        launcher: Launcher,
        user_file: Path,
        broadcast: Callable[[BaseModel], None],
        now: Callable[[], datetime] | None = None,
        sleep: Callable[[float], Awaitable[object]] = asyncio.sleep,
        zone: tzinfo | None = None,
        workflows: WorkflowStarter | None = None,
        queries: QueryRoutines | None = None,
        inbox: InboxPosts | None = None,
        tell: Callable[[str, str, str | None, str | None], Awaitable[None]] | None = None,
    ) -> None:
        self._workflows = workflows
        self._queries = queries
        self._inbox = inbox
        self._tell = tell
        self._runs = runs
        self._launcher = launcher
        self._user_file = user_file
        self._broadcast = broadcast
        self._zone = zone
        self._now = now or (lambda: datetime.now(zone or local_zone()))
        self._sleep = sleep
        self._plans: dict[tuple[str, str], _Plan] = {}
        self._lock = asyncio.Lock()
        self._wake = asyncio.Event()
        self._first_pass = True
        self._task: asyncio.Task[None] | None = None
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="golem-routines")

    async def aclose(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        pending = list(self._tasks)
        for item in pending:
            item.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

    async def drain(self) -> None:
        """Wait for the firings being ended. For tests and shutdown."""
        while self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    def reload(self) -> None:
        """Plan again now, because the config changed."""
        self._wake.set()

    def next_at(self, routine: Planned) -> datetime | None:
        """The planned next firing of a routine, None when it has none."""
        plan = self._plans.get(routine.key)
        return None if plan is None else plan.next_at

    def on_event(self, event: ChatEvent) -> None:
        """The bus calls this for every event. A finished headless run ends its firing."""
        if isinstance(event, SessionCompletedEvent):
            task = asyncio.create_task(self._session_ended(event), name="golem-routine-finished")
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    def on_workflow_ended(self, workflow_run_id: str, status: str, error: str | None) -> None:
        """The workflow service calls this when a run ends. It ends the firing that started it."""
        task = asyncio.create_task(
            self._workflow_ended(workflow_run_id, status, error), name="golem-routine-workflow"
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def tick(self) -> None:
        """One pass: re-read the routines, plan them, and fire what is due."""
        async with self._lock:
            now = self._now()
            found = await asyncio.to_thread(self._load)
            first, self._first_pass = self._first_pass, False
            live = {routine.key for routine in found if self._schedulable(routine)}
            for key in list(self._plans):
                if key not in live:
                    del self._plans[key]
            for routine in found:
                if not self._schedulable(routine):
                    continue
                text = routine.settings.schedule or ""
                plan = self._plans.get(routine.key)
                if plan is None or plan.schedule != text:
                    plan = await self._plan_new(routine, text, now, first)
                    if plan is None:
                        continue
                    self._plans[routine.key] = plan
                if plan.next_at <= now:
                    await self._due(routine, plan, now)

    async def run(self, name: str, folder: Path | None = None) -> tuple[str, str | None]:
        """Fire a routine now (``routine.run``). Returns ``(routine_run_id, session_id)``.

        The session id is None for a workflow whose run has no session yet.

        Raises :class:`RoutineNotFoundError`, :class:`RoutineBlockedError` and
        :class:`RoutineBusyError`.
        """
        async with self._lock:
            found = await asyncio.to_thread(self._load)
            wanted = None if folder is None else folder.resolve()
            for routine in found:
                if routine.name == name and routine.folder == wanted:
                    fired = await self._fire(routine, "manual", None, manual=True)
                    assert fired is not None
                    return fired
        if folder is not None and folder.resolve() not in trusted_folders(self._user_file):
            raise RoutineBlockedError(f"{folder} is not in trusted_projects")
        raise RoutineNotFoundError(name)

    async def watched(self) -> list[Planned]:
        """The enabled routines with an ``on`` trigger, of the user's file and trusted projects."""
        found = await asyncio.to_thread(self._load)
        return [r for r in found if r.settings.enabled and r.settings.on is not None]

    def config_file(self, routine: Planned) -> Path:
        """The file a routine is written in."""
        return self._user_file if routine.folder is None else project_config(routine.folder)

    async def fire_watch(self, routine: Planned, path: Path, size: int, mtime_ns: int) -> bool:
        """Fire a ``watch`` routine for one settled file (4.3.1).

        ``{path}``, ``{name}`` and ``{dir}`` are filled into the prompt, and the file's folder
        is a read root of the new session. Returns False when the firing must wait (the
        routine's previous run is still going, or the folder is not trusted): the watcher
        offers the file again later. True means the file is taken, fired now or fired before.
        """
        file = WatchedFile(str(path), size, mtime_ns)
        async with self._lock:
            if await self._runs.has_fired_for(routine.name, routine.scope, file):
                return True
            if await self._runs.active(routine.name, routine.scope) is not None:
                return False
            if routine.folder is not None and routine.folder not in trusted_folders(
                self._user_file
            ):
                return False
            if routine.settings.workflow is not None or routine.settings.query is not None:
                await self._fire(routine, "watch", None, watched=file, path=path)
                return True
            update = {"prompt": fill_prompt(routine.settings.text, path)}
            filled = replace(routine, settings=routine.settings.model_copy(update=update))
            await self._fire(filled, "watch", None, watched=file, read_folders=(str(path.parent),))
            return True

    async def reconcile(self) -> None:
        """End the firings a stopped daemon left open, when their session has finished."""
        for row in await self._runs.open_runs():
            if row.workflow_run_id is not None and self._workflows is not None:
                found = await self._workflows.run_status(row.workflow_run_id)
                if found is None:
                    await self._end(row, "failed", None, "the workflow run is gone")
                elif found[0] in _WORKFLOW_OUTCOMES:
                    await self._end(row, _WORKFLOW_OUTCOMES[found[0]], None, found[1])
                continue
            if row.session_id is None:
                await self._end(row, "failed", None, "the daemon stopped before the session began")
                continue
            outcome = await self._runs.outcome(row.session_id)
            if outcome in _OUTCOMES:
                await self._end(row, _OUTCOMES[outcome], None, None)

    async def _loop(self) -> None:
        try:
            await self.reconcile()
        except Exception:
            log.exception("could not reconcile the routine runs")
        while True:
            self._wake.clear()
            try:
                await self.tick()
            except Exception:
                log.exception("the routine scheduler could not plan")
            await self._nap(self._delay())

    def _delay(self) -> float:
        if not self._plans:
            return MAX_NAP
        soonest = min(plan.next_at for plan in self._plans.values())
        wait = (soonest - self._now()).total_seconds()
        return min(MAX_NAP, max(0.5, wait))

    async def _nap(self, seconds: float) -> None:
        sleeper = asyncio.ensure_future(self._sleep(seconds))
        waker = asyncio.ensure_future(self._wake.wait())
        try:
            await asyncio.wait({sleeper, waker}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            sleeper.cancel()
            waker.cancel()

    @staticmethod
    def _schedulable(routine: Planned) -> bool:
        return routine.settings.enabled and routine.settings.schedule is not None

    def _load(self) -> list[Planned]:
        """Every routine that may run: the user's, and those of trusted project folders."""
        user = read_routines(self._user_file)
        found = [Planned(settings) for settings in user.routines]
        problems = list(user.problems)
        for folder in trusted_folders(self._user_file):
            read = read_project_routines(self._user_file, folder, True)
            found.extend(Planned(settings, folder) for settings in read.routines)
            problems += read.problems
        for problem in problems:
            log.warning("routine not loaded: %s", problem)
        for routine in found:
            if routine.settings.enabled:
                why = routine_problem(routine.settings, routine.folder, self._workflows)
                if why is not None:
                    log.warning("routine cannot start its workflow: %s", why)
        return found

    async def _plan_new(
        self, routine: Planned, text: str, now: datetime, first: bool
    ) -> _Plan | None:
        """The first plan of a routine. After a start, the last due time says what was missed."""
        reference = now
        if first:
            last = await self._runs.last_due(routine.name, routine.scope)
            if last is not None:
                reference = datetime.fromisoformat(last)
        try:
            return _Plan(text, next_after(text, reference, self._zone or now.tzinfo))
        except ScheduleError as exc:
            log.warning(
                "routine %s has no next time: %s",
                routine.name,
                exc,
                extra={"routine": routine.name},
            )
            return None

    async def _due(self, routine: Planned, plan: _Plan, now: datetime) -> None:
        due = plan.next_at
        try:
            plan.next_at = next_after(plan.schedule, now, self._zone or now.tzinfo)
        except ScheduleError:
            del self._plans[routine.key]
        if now - due <= GRACE:
            await self._fire(routine, "schedule", due)
        elif routine.settings.missed == "run_once":
            log.info(
                "routine %s missed %s, running it once",
                routine.name,
                due.isoformat(),
                extra={"routine": routine.name},
            )
            await self._fire(routine, "schedule", due)
        else:
            log.info(
                "routine %s missed %s, skipping it",
                routine.name,
                due.isoformat(),
                extra={"routine": routine.name},
            )
            await self._skipped(routine, "schedule", due, "missed")

    async def _fire(
        self,
        routine: Planned,
        trigger: Trigger,
        due: datetime | None,
        *,
        manual: bool = False,
        watched: WatchedFile | None = None,
        read_folders: tuple[str, ...] = (),
        path: Path | None = None,
    ) -> tuple[str, str | None] | None:
        """Start a run. Returns the row and session ids, or None when the firing was skipped."""
        if await self._runs.active(routine.name, routine.scope) is not None:
            if manual:
                raise RoutineBusyError(f"{routine.name} is still running or waiting")
            await self._skipped(routine, trigger, due, "still running")
            return None
        if routine.folder is not None and routine.folder not in trusted_folders(self._user_file):
            if manual:
                raise RoutineBlockedError(f"{routine.folder} is not in trusted_projects")
            await self._skipped(routine, trigger, due, "untrusted")
            return None
        at = self._now()
        run_id = await self._runs.start(
            routine.name, routine.scope, trigger, _stamp(due), _stamp(at) or "", watched
        )
        try:
            if routine.settings.workflow is not None:
                session_id = await self._start_workflow(run_id, routine, trigger, path)
            elif routine.settings.query is not None:
                session_id = None
            else:
                session_id = await self._launcher.create(routine)
            if session_id is not None:
                await self._runs.attach(run_id, session_id)
        except Exception as exc:
            await self._failed(run_id, routine, exc)
            if manual:
                raise
            return None
        log.info(
            "routine %s fired (%s), session %s",
            routine.name,
            trigger,
            session_id,
            extra={"routine": routine.name},
        )
        self._broadcast(
            RoutineFiredNotification(
                params=RoutineFired(
                    routine=routine.name,
                    routine_run_id=run_id,
                    session_id=session_id,
                    trigger=trigger,
                    scope=routine.scope,
                )
            )
        )
        if routine.settings.query is not None:
            task = asyncio.create_task(self._run_query(run_id, routine), name="golem-routine-query")
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            return run_id, None
        if routine.settings.workflow is not None or session_id is None:
            return run_id, session_id
        try:
            if read_folders:
                await self._launcher.send(routine, session_id, read_folders)
            else:
                await self._launcher.send(routine, session_id)
        except Exception as exc:
            await self._failed(run_id, routine, exc)
        return run_id, session_id

    async def _run_query(self, run_id: str, routine: Planned) -> None:
        """Run the routine's saved query with no session and no model, then post and end the run."""
        query = routine.settings.query
        assert query is not None
        row = await self._runs.get(run_id)
        if row is None:
            return
        try:
            if self._queries is None:
                raise RuntimeError("this daemon cannot run saved queries")
            answer = await self._queries.run(query.source, query.saved, routine.folder)
        except Exception as exc:
            log.warning(
                "routine %s: its query failed: %s",
                routine.name,
                exc,
                extra={"routine": routine.name},
            )
            error = " ".join(str(exc).split())[:300] or type(exc).__name__
            await self._post(routine, run_id, 0, [], [], error)
            await self._end(row, "failed", None, error)
            return
        posted = routine.settings.posts == "always" or answer.row_count > 0
        if posted:
            await self._post(routine, run_id, answer.row_count, answer.columns, answer.rows, None)
        said = "posted" if posted else "nothing posted"
        await self._end(row, "succeeded", f"{_rows_word(answer.row_count)}, {said}", None)

    async def _post(
        self,
        routine: Planned,
        run_id: str,
        row_count: int,
        columns: list[str],
        rows: list[list[Any]],
        error: str | None,
    ) -> None:
        """Leave the result in the Inbox, and tell the phone the name and the count only."""
        query = routine.settings.query
        assert query is not None
        try:
            if self._inbox is not None:
                await self._inbox.add(
                    routine=routine.name,
                    scope=routine.scope,
                    source=query.source,
                    saved=query.saved,
                    row_count=row_count,
                    columns=columns,
                    rows=rows,
                    error=error,
                    at=_stamp(self._now()) or "",
                )
            if self._tell is not None:
                body = "could not run" if error is not None else _rows_word(row_count)
                await self._tell(routine.name, body, None, run_id)
        except Exception:
            log.exception("could not post the result of routine %s", routine.name)

    async def _start_workflow(
        self, run_id: str, routine: Planned, trigger: Trigger, path: Path | None
    ) -> str | None:
        """Start the routine's workflow through the service. Returns the run's session id,
        None while the run has none (a step makes one when it needs it)."""
        settings = routine.settings
        assert settings.workflow is not None
        if self._workflows is None:
            raise RuntimeError("this daemon cannot start workflows")
        inputs: dict[str, Any] = dict(settings.inputs)
        if path is not None:
            inputs["path"] = str(path)
        workflow_run_id, session_id = await self._workflows.start_named(
            settings.workflow, routine.folder, inputs, f"routine:{settings.name}"
        )
        await self._runs.attach_workflow(run_id, workflow_run_id)
        found = await self._workflows.run_status(workflow_run_id)
        if found is not None and found[0] in _WORKFLOW_OUTCOMES:
            await self._workflow_ended(workflow_run_id, found[0], found[1])  # ended already
        return session_id

    async def _workflow_ended(self, workflow_run_id: str, status: str, error: str | None) -> None:
        try:
            row = await self._runs.by_workflow(workflow_run_id)
            if row is None:
                return
            await self._end(row, _WORKFLOW_OUTCOMES[status], None, error)
        except Exception:
            log.exception("could not end the routine run of workflow run %s", workflow_run_id)

    async def _failed(self, run_id: str, routine: Planned, exc: Exception) -> None:
        log.warning(
            "routine %s could not start: %s",
            routine.name,
            exc,
            exc_info=True,
            extra={"routine": routine.name},
        )
        row = await self._runs.get(run_id)
        if row is not None:
            await self._end(row, "failed", None, str(exc)[:200] or type(exc).__name__)

    async def _skipped(
        self, routine: Planned, trigger: Trigger, due: datetime | None, reason: str
    ) -> None:
        at = self._now()
        run_id = await self._runs.skip(
            routine.name, routine.scope, trigger, _stamp(due), _stamp(at) or "", reason
        )
        log.info("routine %s skipped: %s", routine.name, reason, extra={"routine": routine.name})
        self._finished(routine.name, run_id, "skipped", reason, None)

    async def _session_ended(self, event: SessionCompletedEvent) -> None:
        try:
            row = await self._runs.by_session(event.session_id)
            if row is None or row.workflow_run_id is not None:
                return
            status = _OUTCOMES[event.data.status]
            await self._end(row, status, event.data.summary, None)
        except Exception:
            log.exception("could not end the routine run of session %s", event.session_id)

    async def _end(
        self, row: RoutineRunRecord, status: str, summary: str | None, reason: str | None
    ) -> None:
        text = cut_summary(summary)
        if await self._runs.finish(
            row.routine_run_id, status, _stamp(self._now()) or "", text, reason
        ):
            log.info("routine %s finished: %s", row.routine, status, extra={"routine": row.routine})
            self._finished(row.routine, row.routine_run_id, status, reason, text)

    def _finished(
        self, routine: str, run_id: str, status: str, reason: str | None, summary: str | None
    ) -> None:
        self._broadcast(
            RoutineFinishedNotification(
                params=RoutineFinished(
                    routine=routine,
                    routine_run_id=run_id,
                    status=status,  # pyright: ignore[reportArgumentType]
                    reason=reason,
                    summary=summary,
                )
            )
        )


def _rows_word(count: int) -> str:
    return "1 row" if count == 1 else f"{count} rows"


def _stamp(moment: datetime | None) -> str | None:
    return None if moment is None else moment.astimezone(UTC).isoformat()
