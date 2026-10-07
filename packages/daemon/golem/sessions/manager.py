"""In-memory sessions whose model context lives in the checkpointer.

Events are live notifications. Nothing is written to an event log. A daemon
restart keeps the checkpoint and starts ``seq`` at 1 again.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from golem.graphs.adapter import TextCompleted, TextDelta, translate
from golem.graphs.chat import ChatRuntime
from golem.graphs.state import SCHEMA_VERSION
from golem.sessions.ids import new_id
from golem_protocol.events import (
    ChatEvent,
    EmptyEventData,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageStartedData,
    MessageStartedEvent,
    RunCompletedEvent,
    RunFailedData,
    RunFailedEvent,
    RunStartedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
)

log = logging.getLogger("golem.sessions")

EventSink = Callable[[ChatEvent], Awaitable[None]]


class SessionNotFoundError(Exception):
    """No in-memory session and no checkpoint for this id."""


class SessionBusyError(Exception):
    """A run is already in progress for this session."""


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
    seq: int = 0
    task: asyncio.Task[None] | None = None


class SessionManager:
    """``session.create`` and ``message.send`` for one daemon process."""

    def __init__(self, runtime: ChatRuntime) -> None:
        self._runtime = runtime
        self._sessions: dict[str, _LiveSession] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._lock = asyncio.Lock()

    async def create(self, model_profile: str | None, sink: EventSink) -> str:
        """Remember a new session and emit ``session.created``."""
        profile = self._runtime.router.profile_name if model_profile is None else model_profile
        async with self._lock:
            session = _LiveSession(
                session_id=new_id("s"),
                model_profile=profile,
                schema_version=SCHEMA_VERSION,
            )
            self._sessions[session.session_id] = session
            await self._emit(
                session,
                sink,
                lambda seq, ts: SessionCreatedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=None,
                    ts=ts,
                    type="session.created",
                    data=SessionCreatedData(model_profile=profile),
                ),
            )
            return session.session_id

    async def send(self, session_id: str, text: str, sink: EventSink) -> str:
        """Start one graph run. Returns ``run_id`` before the model finishes.

        Raises :class:`SessionNotFoundError`, :class:`SessionBusyError`,
        :class:`SchemaMismatchError`, or :class:`~golem.models.router.ModelConfigError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                raise SessionBusyError(session_id)
            self._runtime.router.chat_model(session.model_profile)
            run_id = new_id("r")
            user_message_id = new_id("m")
            assistant_message_id = new_id("m")
            task = asyncio.create_task(
                self._run(session, run_id, text, user_message_id, assistant_message_id, sink),
                name=f"golem-run-{run_id}",
            )
            session.task = task
            self._tasks.add(task)
            task.add_done_callback(self._finished)
            return run_id

    async def cancel_all(self) -> None:
        """Cancel in-flight runs. The checkpoint keeps the last completed step."""
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(set(tasks))

    async def _resolve(self, session_id: str) -> _LiveSession:
        existing = self._sessions.get(session_id)
        if existing is not None:
            return existing
        values = await self._runtime.values(session_id)
        if not values:
            raise SessionNotFoundError(session_id)
        profile = values.get("model_profile")
        schema = values.get("schema_version")
        if not isinstance(profile, str) or profile == "":
            raise SessionNotFoundError(session_id)
        if schema != SCHEMA_VERSION:
            raise SchemaMismatchError(schema)
        session = _LiveSession(
            session_id=session_id,
            model_profile=profile,
            schema_version=SCHEMA_VERSION,
        )
        self._sessions[session_id] = session
        return session

    async def _run(
        self,
        session: _LiveSession,
        run_id: str,
        text: str,
        user_message_id: str,
        assistant_message_id: str,
        sink: EventSink,
    ) -> None:
        try:
            await self._emit(
                session,
                sink,
                lambda seq, ts: MessageCompletedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=run_id,
                    ts=ts,
                    type="message.completed",
                    data=MessageCompletedData(
                        message_id=user_message_id,
                        role="user",
                        text=text,
                    ),
                ),
            )
            await self._emit(
                session,
                sink,
                lambda seq, ts: RunStartedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=run_id,
                    ts=ts,
                    type="run.started",
                    data=EmptyEventData(),
                ),
            )
            await self._emit(
                session,
                sink,
                lambda seq, ts: MessageStartedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=run_id,
                    ts=ts,
                    type="message.started",
                    data=MessageStartedData(message_id=assistant_message_id, role="assistant"),
                ),
            )
            async for part in self._runtime.stream(
                session_id=session.session_id,
                text=text,
                model_profile=session.model_profile,
                schema_version=session.schema_version,
            ):
                fact = translate(part)
                if isinstance(fact, TextDelta):
                    await self._emit(
                        session,
                        sink,
                        lambda seq, ts, fragment=fact.text: MessageDeltaEvent(
                            seq=seq,
                            session_id=session.session_id,
                            run_id=run_id,
                            ts=ts,
                            type="message.delta",
                            data=MessageDeltaData(message_id=assistant_message_id, text=fragment),
                        ),
                    )
                elif isinstance(fact, TextCompleted):
                    await self._emit(
                        session,
                        sink,
                        lambda seq, ts, full=fact.text: MessageCompletedEvent(
                            seq=seq,
                            session_id=session.session_id,
                            run_id=run_id,
                            ts=ts,
                            type="message.completed",
                            data=MessageCompletedData(
                                message_id=assistant_message_id,
                                role="assistant",
                                text=full,
                            ),
                        ),
                    )
            await self._emit(
                session,
                sink,
                lambda seq, ts: RunCompletedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=run_id,
                    ts=ts,
                    type="run.completed",
                    data=EmptyEventData(),
                ),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception("run %s failed", run_id)
            message = str(exc).strip() or type(exc).__name__
            await self._emit(
                session,
                sink,
                lambda seq, ts, reason=message: RunFailedEvent(
                    seq=seq,
                    session_id=session.session_id,
                    run_id=run_id,
                    ts=ts,
                    type="run.failed",
                    data=RunFailedData(message=reason),
                ),
            )

    async def _emit(
        self,
        session: _LiveSession,
        sink: EventSink,
        build: Callable[[int, str], ChatEvent],
    ) -> None:
        session.seq += 1
        event = build(session.seq, datetime.now(UTC).isoformat())
        try:
            await sink(event)
        except (ConnectionError, OSError):
            log.debug("client went away during %s", event.type)

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.error("run task failed", exc_info=exc)


__all__ = [
    "EventSink",
    "SchemaMismatchError",
    "SessionBusyError",
    "SessionManager",
    "SessionNotFoundError",
]
