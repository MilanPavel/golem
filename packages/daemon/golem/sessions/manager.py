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
from collections.abc import Coroutine
from dataclasses import dataclass, field
from pathlib import Path

from golem.graphs.adapter import PlainMessage, plain_messages
from golem.graphs.chat import ChatRuntime
from golem.graphs.state import SCHEMA_VERSION
from golem.models.router import ModelIdentity, ModelRouter
from golem.permissions.engine import Allowance
from golem.sessions.approvals import pending_approval
from golem.sessions.bus import EventTarget, SummaryTarget
from golem.sessions.ids import new_id
from golem.sessions.log import SessionLog
from golem.sessions.runner import (
    CancelReason,
    Resume,
    RunControl,
    Turn,
    fail_calls,
    resume_turn,
    run_turn,
)
from golem.sessions.titles import TitleGenerator, choose_title, clean_title, fork_title
from golem.store.records import RunRecords, SessionActivity, SessionRecords
from golem_protocol.events import (
    ApprovalDecision,
    ChatEvent,
    EmptyEventData,
    ForkedFrom,
    MessageCompletedEvent,
    ModelSelectedData,
    RunCancelledData,
    SessionAllowance,
    SessionCreatedData,
    SessionUpdatedData,
)

NOT_APPROVED = "cancelled before it was approved"

log = logging.getLogger("golem.sessions")


class SessionNotFoundError(Exception):
    """No session row and no checkpoint for this id."""


class SessionBusyError(Exception):
    """A run is already in progress for this session, or waits for an approval."""


class ApprovalNotFoundError(Exception):
    """No run of this session waits on this tool call."""


class RuleWriteError(Exception):
    """An "always allow" answer could not write its rule."""


class BlankTitleError(Exception):
    """Nothing is left of the title once it is cleaned."""


class MessageNotFoundError(Exception):
    """The session has no completed message with this id to fork at."""


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
    cwd: str | None = None
    allowed_tools: set[Allowance] = field(default_factory=set[Allowance])
    title: str | None = None
    titling: bool = False
    closed: bool = False
    task: asyncio.Task[None] | None = None


@dataclass(frozen=True, slots=True)
class _LiveRun:
    task: asyncio.Task[None]
    control: RunControl


class SessionManager:
    """Create, attach, list, inspect, send, cancel, and close, for one daemon process."""

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

    async def create(self, model_profile: str | None, *, cwd: str | None = None) -> str:
        """Store a new session and its ``session.created``. Nobody is attached yet.

        ``cwd`` is the folder its file tools work in. None gives it no file tools.
        """
        profile = self._runtime.router.profile_name if model_profile is None else model_profile
        async with self._lock:
            session = _LiveSession(
                session_id=new_id("s"),
                model_profile=profile,
                schema_version=SCHEMA_VERSION,
                cwd=cwd,
            )
            await self._announce(session)
            self._sessions[session.session_id] = session
            return session.session_id

    async def fork(self, session_id: str, at_message_id: str) -> str:
        """A new session with ``session_id``'s history up to ``at_message_id``.

        The new thread starts from the checkpoint that ends at that message.
        Its log gets the parent's ``message.completed`` events up to it, with
        their original ``run_id`` and new ``seq``. Nobody is attached yet.

        Raises :class:`MessageNotFoundError`, :class:`SessionNotFoundError`,
        or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            source = await self._resolve(session_id)
            history = _completed_through(await self._events.stored(session_id), at_message_id)
            if history is None:
                raise MessageNotFoundError(at_message_id)
            fork = _LiveSession(
                session_id=new_id("s"),
                model_profile=source.model_profile,
                schema_version=SCHEMA_VERSION,
                cwd=source.cwd,
            )
            if not await self._runtime.fork(
                session_id, fork.session_id, at_message_id=at_message_id
            ):
                raise MessageNotFoundError(at_message_id)
            await self._announce(fork, ForkedFrom(session_id=session_id, message_id=at_message_id))
            for event in history:
                await self._events.emit(
                    fork.session_id, event.run_id, "message.completed", event.data
                )
            if source.title is not None:
                await self._set_title(fork, fork_title(source.title))
            self._sessions[fork.session_id] = fork
            return fork.session_id

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

    async def close(self, session_id: str) -> str:
        """Hide ``session_id`` from the list. Its events stay in the log.

        A run still in progress is cancelled first. Closing a session that is
        already hidden returns its id.

        Raises :class:`SessionNotFoundError`.
        """
        while True:
            async with self._lock:
                record = await self._records.get(session_id)
                if record is None:
                    raise SessionNotFoundError(session_id)
                if record.closed_at is not None:
                    self._sessions.pop(session_id, None)
                    return session_id
                session = self._sessions.get(session_id)
                if session is not None:
                    session.closed = True
                live = self._run_for(session)
                naming = [
                    task
                    for task in self._naming
                    if task.get_name() == f"golem-title-{session_id}" and not task.done()
                ]
                if live is None and not naming:
                    waiting = await self._run_records.waiting(session_id)
                    if waiting is not None:
                        await self._cancel_waiting(session_id, waiting.run_id)
                    await self._events.emit(session_id, None, "session.closed", EmptyEventData())
                    self._sessions.pop(session_id, None)
                    return session_id
            if live is not None:
                await self._stop([live], "user")
            for task in naming:
                task.cancel()
            if naming:
                await asyncio.wait(naming)

    async def rename(self, session_id: str, title: str) -> str:
        """Set the title by hand. Returns it cleaned.

        Raises :class:`BlankTitleError`, :class:`SessionNotFoundError`, or
        :class:`SchemaMismatchError`.
        """
        cleaned = clean_title(title)
        if cleaned == "":
            raise BlankTitleError(session_id)
        async with self._lock:
            session = await self._resolve(session_id)
            await self._set_title(session, cleaned)
        return cleaned

    @property
    def router(self) -> ModelRouter:
        return self._runtime.router

    async def set_model(self, session_id: str, model: str) -> ModelIdentity:
        """Use ``model`` from the session's next run, and store ``model.selected``.

        A run in progress keeps the model it started with. Choosing the
        model the session already uses stores nothing.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`, or
        :class:`~golem.models.router.ModelConfigError` when ``model`` does not
        resolve or its provider has no key.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            router = self._runtime.router
            router.chat_model(model)
            identity = router.identity(model)
            if session.model_profile == model:
                return identity
            await self._events.emit(
                session_id,
                None,
                "model.selected",
                ModelSelectedData(
                    model_profile=model,
                    model_provider=identity.provider,
                    model_name=identity.name,
                    reason="user",
                ),
            )
            session.model_profile = model
            return identity

    def configured_model(self) -> ModelIdentity:
        """The model ``daemon.status`` reports for this process."""
        return self._runtime.router.identity()

    async def send(self, session_id: str, text: str, *, cwd: str | None = None) -> str:
        """Start one graph run. Returns ``run_id`` before the model finishes.

        The run's events go to the targets attached to ``session_id``. A
        session without a folder takes ``cwd`` first, with ``session.updated``.

        Raises :class:`SessionNotFoundError`, :class:`SessionBusyError`,
        :class:`SchemaMismatchError`, or :class:`~golem.models.router.ModelConfigError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                raise SessionBusyError(session_id)
            if await self._run_records.waiting(session_id) is not None:
                raise SessionBusyError(session_id)
            self._runtime.router.chat_model(session.model_profile)
            if session.cwd is None and cwd is not None:
                await self._events.emit(
                    session_id, None, "session.updated", SessionUpdatedData(cwd=cwd)
                )
                session.cwd = cwd
            turn = Turn(
                session_id=session.session_id,
                run_id=new_id("r"),
                text=text,
                model_profile=session.model_profile,
                schema_version=session.schema_version,
                user_message_id=new_id("m"),
                assistant_message_id=new_id("m"),
                cwd=session.cwd,
                allowed_tools=_ordered(session.allowed_tools),
            )
            control = RunControl()
            await self._start(session, turn.run_id, control, self._turn(session, turn, control))
            return turn.run_id

    async def respond(self, session_id: str, call_id: str, decision: ApprovalDecision) -> str:
        """Answer the tool call ``session_id``'s run waits on, and go on with that run.

        Returns the run's id once ``approval.resolved`` is in the log.

        ``allow_always`` writes an allow rule for exactly this call first in
        the user's ``config.toml`` before the run goes on.

        Raises :class:`ApprovalNotFoundError`, :class:`SessionNotFoundError`,
        :class:`SessionBusyError`, :class:`RuleWriteError`, or
        :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            run = await self._run_records.waiting(session_id)
            live = session.task is not None and not session.task.done()
            if run is None:
                if live:
                    raise SessionBusyError(session_id)
                raise ApprovalNotFoundError(call_id)
            if live and session.task is not None:
                # approval.needed is stored before the paused task has finished closing its stream.
                await asyncio.wait({session.task})
            pending = pending_approval(await self._events.for_run(run.run_id))
            if pending is None or pending.call_id != call_id:
                raise ApprovalNotFoundError(call_id)
            rule: str | None = None
            if decision == "allow_always":
                rule = await self._remember(session, pending.name, pending.args)
            if decision == "allow_session":
                session.allowed_tools.add((pending.name, pending.subject))
            resume = Resume(
                session_id=session_id,
                run_id=run.run_id,
                call_id=call_id,
                name=pending.name,
                decision=decision,
                user_message_id=pending.user_message_id,
                open_calls=pending.open_calls,
                cwd=session.cwd,
                allowed_tools=_ordered(session.allowed_tools),
                asked=pending.asked,
                subject=pending.subject,
                rule=rule,
                diff=pending.diff,
            )
            control = RunControl()
            work = self._resumed(session, resume, control, pending.prompt)
            await self._start(session, run.run_id, control, work)
            return run.run_id

    async def allowances(self, session_id: str) -> list[Allowance]:
        """What ``session_id`` allows for the rest of the session."""
        async with self._lock:
            session = await self._resolve(session_id)
            return list(_ordered(session.allowed_tools))

    async def revoke(self, session_id: str, tool: str, subject: str | None) -> bool:
        """Stop allowing ``tool`` with ``subject`` for the rest of the session.

        Stores ``session.updated`` with the list that is left. Returns False
        when it was not allowed.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if (tool, subject) not in session.allowed_tools:
                return False
            session.allowed_tools.discard((tool, subject))
            left = [
                SessionAllowance(tool=name, subject=item)
                for name, item in _ordered(session.allowed_tools)
            ]
            await self._events.emit(
                session_id, None, "session.updated", SessionUpdatedData(allowed_tools=left)
            )
            return True

    async def _remember(self, session: _LiveSession, name: str, args: dict[str, object]) -> str:
        root = None if session.cwd is None else Path(session.cwd)
        policy = self._runtime.policy
        try:
            return await asyncio.to_thread(policy.remember, self._runtime.tools, name, args, root)
        except (OSError, ValueError) as exc:
            raise RuleWriteError(str(exc)) from exc

    async def _start(
        self,
        session: _LiveSession,
        run_id: str,
        control: RunControl,
        work: Coroutine[None, None, None],
    ) -> None:
        task = asyncio.create_task(work, name=f"golem-run-{run_id}")
        session.task = task
        self._runs[run_id] = _LiveRun(task=task, control=control)
        task.add_done_callback(lambda done: self._finished(run_id, done))
        await control.started.wait()

    async def cancel(self, run_id: str) -> bool:
        """Stop a run in progress. Returns once ``run.cancelled`` is in the log.

        Returns False for a run that already ended. Raises
        :class:`RunNotFoundError` for an id the daemon never ran.
        """
        live = self._runs.get(run_id)
        if live is not None and not live.task.done():
            await self._stop([live], "user")
            return True
        record = await self._run_records.get(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        if record.status == "waiting":
            async with self._lock:
                return await self._cancel_waiting(record.session_id, run_id)
        return False

    async def _cancel_waiting(self, session_id: str, run_id: str) -> bool:
        """End a run that waits for an approval. Its next turn repairs the checkpoint."""
        current = await self._run_records.get(run_id)
        if current is None or current.status != "waiting":
            return False
        pending = pending_approval(await self._events.for_run(run_id))
        calls = () if pending is None else pending.open_calls
        await fail_calls(self._events, session_id, run_id, calls, NOT_APPROVED)
        await self._events.emit(
            session_id, run_id, "run.cancelled", RunCancelledData(reason="user")
        )
        return True

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
        self._title_after(session, turn.text, reply)

    async def _resumed(
        self, session: _LiveSession, resume: Resume, control: RunControl, prompt: str | None
    ) -> None:
        reply = await resume_turn(self._runtime, self._events, resume, control)
        if prompt is not None:
            self._title_after(session, prompt, reply)

    def _title_after(self, session: _LiveSession, prompt: str, reply: str | None) -> None:
        if reply is None or self._titles is None or session.title is not None or session.titling:
            return
        session.titling = True
        task = asyncio.create_task(
            self._name(session, self._titles, prompt, reply),
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
            async with self._lock:
                if session.title is None and not session.closed:
                    await self._set_title(session, title)
        finally:
            session.titling = False

    async def _set_title(self, session: _LiveSession, title: str) -> None:
        await self._events.emit(
            session.session_id, None, "session.updated", SessionUpdatedData(title=title)
        )
        session.title = title

    def _run_for(self, session: _LiveSession | None) -> _LiveRun | None:
        if session is None or session.task is None or session.task.done():
            return None
        for run in self._runs.values():
            if run.task is session.task:
                return run
        return None

    async def _resolve(self, session_id: str) -> _LiveSession:
        existing = self._sessions.get(session_id)
        if existing is not None:
            if existing.closed:
                raise SessionNotFoundError(session_id)
            return existing
        record = await self._records.get(session_id)
        if record is not None and record.closed_at is not None:
            raise SessionNotFoundError(session_id)
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
            cwd=None if record is None else record.cwd,
            allowed_tools=set() if record is None else set(record.allowed_tools),
        )
        if record is None:
            await self._announce(session)
        self._sessions[session_id] = session
        return session

    async def _announce(self, session: _LiveSession, forked_from: ForkedFrom | None = None) -> None:
        chosen = self._runtime.router.identity(session.model_profile)
        await self._events.emit(
            session.session_id,
            None,
            "session.created",
            SessionCreatedData(
                model_profile=session.model_profile,
                model_provider=chosen.provider,
                model_name=chosen.name,
                forked_from=forked_from,
                cwd=session.cwd,
            ),
        )

    def _finished(self, run_id: str, task: asyncio.Task[None]) -> None:
        self._runs.pop(run_id, None)
        _report(task, "run task failed")

    def _named(self, task: asyncio.Task[None]) -> None:
        self._naming.discard(task)
        _report(task, "title task failed")


def _ordered(allowed: set[Allowance]) -> tuple[Allowance, ...]:
    return tuple(sorted(allowed, key=lambda pair: (pair[0], pair[1] or "")))


def _completed_through(
    events: list[ChatEvent], message_id: str
) -> list[MessageCompletedEvent] | None:
    """The completed messages up to and including ``message_id``, or None if it never completed."""
    completed: list[MessageCompletedEvent] = []
    for event in events:
        if isinstance(event, MessageCompletedEvent):
            completed.append(event)
            if event.data.message_id == message_id:
                return completed
    return None


def _report(task: asyncio.Task[None], message: str) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error(message, exc_info=exc)


__all__ = [
    "ApprovalNotFoundError",
    "BlankTitleError",
    "MessageNotFoundError",
    "RuleWriteError",
    "RunNotFoundError",
    "SchemaMismatchError",
    "SessionBusyError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionView",
]
