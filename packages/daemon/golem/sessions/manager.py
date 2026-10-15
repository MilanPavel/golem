"""Sessions: their rows and events live in ``golem.db``, their model context
in the checkpointer.

A session found only in the checkpointer predates the event log. Resolving it
writes the ``session.created`` it never had, with an empty history before it.

A session without a title gets one after its first completed run, from a
task that does not keep the session busy.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from golem.graphs.adapter import PlainMessage, plain_messages
from golem.graphs.chat import ChatRuntime
from golem.graphs.state import SCHEMA_VERSION
from golem.models.router import ModelIdentity
from golem.sessions.bus import EventTarget, SummaryTarget
from golem.sessions.ids import new_id
from golem.sessions.log import SessionLog
from golem.sessions.runner import CancelReason, RunControl, Turn, run_turn
from golem.sessions.titles import TitleGenerator, choose_title
from golem.store.records import RunRecords, SessionActivity, SessionRecords
from golem_protocol.events import SessionCreatedData, SessionUpdatedData

log = logging.getLogger("golem.sessions")


class SessionNotFoundError(Exception):
    """No session row and no checkpoint for this id."""


class SessionBusyError(Exception):
    """A run is already in progress for this session."""


class RunNotFoundError(Exception):
    """No run with this id, in progress or finished."""


@dataclass(frozen=True, slots=True)
class SessionView:
    """Checkpoint text for one session. Provider types stay in the graph."""

    session_id: str
    model_profile: str
    model_provider: str | None
    model_name: str | None
    messages: list[PlainMessage]


class SchemaMismatchError(Exception):
    """The checkpoint's ``schema_version`` is not the one this process writes."""

    def __init__(self, found: object) -> None:
        super().__init__(f"unsupported schema_version {found}")
        self.found = found


@dataclass
class _LiveSession:
    session_id: str
    model_profile: str
    schema_version: int
    title: str | None = None
    titling: bool = False
    task: asyncio.Task[None] | None = None


@dataclass(frozen=True, slots=True)
class _LiveRun:
    task: asyncio.Task[None]
    control: RunControl


class SessionManager:
    """Create, attach, list, inspect, send, and cancel, for one daemon process."""

    def __init__(
        self,
        runtime: ChatRuntime,
        events: SessionLog,
        records: SessionRecords,
        runs: RunRecords,
        *,
        titles: TitleGenerator | None = None,
    ) -> None:
        self._runtime = runtime
        self._events = events
        self._records = records
        self._run_records = runs
        self._titles = titles
        self._sessions: dict[str, _LiveSession] = {}
        self._runs: dict[str, _LiveRun] = {}
        self._naming: set[asyncio.Task[None]] = set()
        self._lock = asyncio.Lock()

    async def create(self, model_profile: str | None) -> str:
        """Store a new session and its ``session.created``. Nobody is attached yet."""
        profile = self._runtime.router.profile_name if model_profile is None else model_profile
        async with self._lock:
            session = _LiveSession(
                session_id=new_id("s"),
                model_profile=profile,
                schema_version=SCHEMA_VERSION,
            )
            await self._announce(session)
            self._sessions[session.session_id] = session
            return session.session_id

    async def attach(self, session_id: str, after_seq: int, target: EventTarget) -> int:
        """Replay events after ``after_seq`` to ``target``, then stream live ones.

        Returns the newest ``seq``. Raises :class:`SessionNotFoundError` or
        :class:`SchemaMismatchError`.
        """
        async with self._lock:
            await self._resolve(session_id)
        return await self._events.attach(session_id, after_seq, target)

    def detach(self, session_id: str, target: EventTarget) -> None:
        """Stop live events for ``session_id`` on ``target``."""
        self._events.detach(session_id, target)

    def detach_all(self, target: object) -> None:
        """Forget ``target`` everywhere, as a watcher too. Called when its connection closes."""
        self._events.detach_all(target)

    async def recent(self, limit: int) -> list[SessionActivity]:
        """Sessions with the newest activity first."""
        return await self._records.recent(limit)

    async def watch(self, limit: int, target: SummaryTarget) -> list[SessionActivity]:
        """Like :meth:`recent`, and ``target`` gets each later change as a summary."""
        return await self._events.watch(limit, target)

    async def inspect(self, session_id: str) -> SessionView:
        """The messages the next model call would see. Does not start a run."""
        async with self._lock:
            session = await self._resolve(session_id)
            values = await self._runtime.values(session_id)
            identity = self._runtime.router.identity(session.model_profile)
            return SessionView(
                session_id=session.session_id,
                model_profile=session.model_profile,
                model_provider=identity.provider,
                model_name=identity.name,
                messages=plain_messages(values),
            )

    def configured_model(self) -> ModelIdentity:
        """The model ``daemon.status`` reports for this process."""
        return self._runtime.router.identity()

    async def send(self, session_id: str, text: str) -> str:
        """Start one graph run. Returns ``run_id`` before the model finishes.

        The run's events go to the targets attached to ``session_id``.

        Raises :class:`SessionNotFoundError`, :class:`SessionBusyError`,
        :class:`SchemaMismatchError`, or :class:`~golem.models.router.ModelConfigError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                raise SessionBusyError(session_id)
            self._runtime.router.chat_model(session.model_profile)
            turn = Turn(
                session_id=session.session_id,
                run_id=new_id("r"),
                text=text,
                model_profile=session.model_profile,
                schema_version=session.schema_version,
                user_message_id=new_id("m"),
                assistant_message_id=new_id("m"),
            )
            control = RunControl()
            task = asyncio.create_task(
                self._turn(session, turn, control),
                name=f"golem-run-{turn.run_id}",
            )
            session.task = task
            self._runs[turn.run_id] = _LiveRun(task=task, control=control)
            task.add_done_callback(lambda done: self._finished(turn.run_id, done))
            await control.started.wait()
            return turn.run_id

    async def cancel(self, run_id: str) -> bool:
        """Stop a run in progress. Returns once ``run.cancelled`` is in the log.

        Returns False for a run that already ended. Raises
        :class:`RunNotFoundError` for an id the daemon never ran.
        """
        live = self._runs.get(run_id)
        if live is not None and not live.task.done():
            await self._stop([live], "user")
            return True
        if await self._run_records.get(run_id) is None:
            raise RunNotFoundError(run_id)
        return False

    async def cancel_all(self) -> None:
        """Stop every run in progress, with the reason ``shutdown``, and any title being chosen.

        A session whose title was cancelled gets one after its next completed run.
        """
        await self._stop(list(self._runs.values()), "shutdown")
        naming = set(self._naming)
        for task in naming:
            task.cancel()
        if naming:
            await asyncio.wait(naming)

    async def _stop(self, runs: list[_LiveRun], reason: CancelReason) -> None:
        for run in runs:
            if run.control.reason is None:
                run.control.reason = reason
                run.task.cancel()
        tasks = {run.task for run in runs}
        if tasks:
            await asyncio.wait(tasks)

    async def _turn(self, session: _LiveSession, turn: Turn, control: RunControl) -> None:
        reply = await run_turn(self._runtime, self._events, turn, control)
        if reply is None or self._titles is None or session.title is not None or session.titling:
            return
        session.titling = True
        task = asyncio.create_task(
            self._name(session, self._titles, turn.text, reply),
            name=f"golem-title-{session.session_id}",
        )
        self._naming.add(task)
        task.add_done_callback(self._named)

    async def _name(
        self, session: _LiveSession, titles: TitleGenerator, prompt: str, reply: str
    ) -> None:
        try:
            title = await choose_title(
                titles, model_profile=session.model_profile, prompt=prompt, reply=reply
            )
            await self._events.emit(
                session.session_id, None, "session.updated", SessionUpdatedData(title=title)
            )
            session.title = title
        finally:
            session.titling = False

    async def _resolve(self, session_id: str) -> _LiveSession:
        existing = self._sessions.get(session_id)
        if existing is not None:
            return existing
        record = await self._records.get(session_id)
        values = await self._runtime.values(session_id)
        if values and values.get("schema_version") != SCHEMA_VERSION:
            raise SchemaMismatchError(values.get("schema_version"))
        if record is not None:
            profile = record.model_profile
        else:
            found = values.get("model_profile")
            if not isinstance(found, str) or found == "":
                raise SessionNotFoundError(session_id)
            profile = found
        session = _LiveSession(
            session_id=session_id,
            model_profile=profile,
            schema_version=SCHEMA_VERSION,
            title=None if record is None else record.title,
        )
        if record is None:
            await self._announce(session)
        self._sessions[session_id] = session
        return session

    async def _announce(self, session: _LiveSession) -> None:
        chosen = self._runtime.router.identity(session.model_profile)
        await self._events.emit(
            session.session_id,
            None,
            "session.created",
            SessionCreatedData(
                model_profile=session.model_profile,
                model_provider=chosen.provider,
                model_name=chosen.name,
            ),
        )

    def _finished(self, run_id: str, task: asyncio.Task[None]) -> None:
        self._runs.pop(run_id, None)
        _report(task, "run task failed")

    def _named(self, task: asyncio.Task[None]) -> None:
        self._naming.discard(task)
        _report(task, "title task failed")


def _report(task: asyncio.Task[None], message: str) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error(message, exc_info=exc)


__all__ = [
    "RunNotFoundError",
    "SchemaMismatchError",
    "SessionBusyError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionView",
]
