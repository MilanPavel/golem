"""In-memory sessions whose model context lives in the checkpointer.

Events are live notifications. Nothing is written to an event log. A daemon
restart keeps the checkpoint and starts ``seq`` at 1 again.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from golem.graphs.adapter import PlainMessage, plain_messages
from golem.graphs.chat import ChatRuntime
from golem.graphs.state import SCHEMA_VERSION
from golem.models.router import ModelIdentity
from golem.sessions.ids import new_id
from golem.sessions.log import EventSink, SessionLog
from golem.sessions.runner import Turn, run_turn
from golem_protocol.events import SessionCreatedData

log = logging.getLogger("golem.sessions")


class SessionNotFoundError(Exception):
    """No in-memory session and no checkpoint for this id."""


class SessionBusyError(Exception):
    """A run is already in progress for this session."""


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
    task: asyncio.Task[None] | None = None


class SessionManager:
    """``session.create`` and ``message.send`` for one daemon process."""

    def __init__(self, runtime: ChatRuntime) -> None:
        self._runtime = runtime
        self._events = SessionLog()
        self._sessions: dict[str, _LiveSession] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._lock = asyncio.Lock()

    async def create(self, model_profile: str | None, sink: EventSink) -> str:
        """Remember a new session and emit ``session.created``."""
        profile = self._runtime.router.profile_name if model_profile is None else model_profile
        chosen = self._runtime.router.identity(profile)
        async with self._lock:
            session = _LiveSession(
                session_id=new_id("s"),
                model_profile=profile,
                schema_version=SCHEMA_VERSION,
            )
            self._sessions[session.session_id] = session
            await self._events.emit(
                sink,
                session.session_id,
                None,
                "session.created",
                SessionCreatedData(
                    model_profile=profile,
                    model_provider=chosen.provider,
                    model_name=chosen.name,
                ),
            )
            return session.session_id

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
            turn = Turn(
                session_id=session.session_id,
                run_id=new_id("r"),
                text=text,
                model_profile=session.model_profile,
                schema_version=session.schema_version,
                user_message_id=new_id("m"),
                assistant_message_id=new_id("m"),
            )
            task = asyncio.create_task(
                run_turn(self._runtime, self._events, turn, sink),
                name=f"golem-run-{turn.run_id}",
            )
            session.task = task
            self._tasks.add(task)
            task.add_done_callback(self._finished)
            return turn.run_id

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

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.error("run task failed", exc_info=exc)


__all__ = [
    "SchemaMismatchError",
    "SessionBusyError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionView",
]
