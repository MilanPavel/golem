"""Stamp, number, and deliver session events.

``seq`` is counted in memory per session and starts again at 1 after a
daemon restart.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from pydantic import BaseModel, TypeAdapter

from golem_protocol.events import ChatEvent, EventType

log = logging.getLogger("golem.sessions")

EventSink = Callable[[ChatEvent], Awaitable[None]]

_EVENTS: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)


class SessionLog:
    """Owns ``seq`` for every session. One emit per session at a time."""

    def __init__(self) -> None:
        self._seq: dict[str, int] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def emit(
        self,
        sink: EventSink,
        session_id: str,
        run_id: str | None,
        kind: EventType,
        data: BaseModel,
    ) -> ChatEvent:
        """Build the next event for ``session_id`` and hand it to ``sink``.

        Raises :class:`pydantic.ValidationError` when ``data`` is not the
        payload ``kind`` carries. A client that went away is not an error.
        """
        async with self._lock(session_id):
            seq = self._seq.get(session_id, 0) + 1
            event = _EVENTS.validate_python(
                {
                    "seq": seq,
                    "session_id": session_id,
                    "run_id": run_id,
                    "ts": datetime.now(UTC).isoformat(),
                    "type": kind,
                    "data": data,
                }
            )
            self._seq[session_id] = seq
            try:
                await sink(event)
            except (ConnectionError, OSError):
                log.debug("client went away during %s", kind)
            return event

    def _lock(self, session_id: str) -> asyncio.Lock:
        lock = self._locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[session_id] = lock
        return lock


__all__ = ["EventSink", "SessionLog"]
