"""Stamp, number, persist, and deliver session events.

``seq`` continues from the event log, so it survives a daemon restart. It is
monotonic per session but not dense: coalesced deltas leave gaps.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from pydantic import BaseModel

from golem.store.events import EventLog
from golem_protocol.events import CHAT_EVENT, ChatEvent, EventType

log = logging.getLogger("golem.sessions")

EventSink = Callable[[ChatEvent], Awaitable[None]]


async def discard(event: ChatEvent) -> None:
    """A sink for events nobody is listening to, such as recovery at startup."""
    del event


class SessionLog:
    """Owns ``seq`` for every session. One emit per session at a time."""

    def __init__(self, events: EventLog) -> None:
        self._events = events
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
        """Persist the next event for ``session_id``, then hand it to ``sink``.

        The emit is shielded: cancelling the caller cannot leave an event
        half-written or a ``seq`` used but not stored.

        Raises :class:`pydantic.ValidationError` when ``data`` is not the
        payload ``kind`` carries. A client that went away is not an error.
        """
        return await asyncio.shield(self._emit(sink, session_id, run_id, kind, data))

    async def _emit(
        self,
        sink: EventSink,
        session_id: str,
        run_id: str | None,
        kind: EventType,
        data: BaseModel,
    ) -> ChatEvent:
        async with self._lock(session_id):
            last = self._seq.get(session_id)
            if last is None:
                last = await self._events.last_seq(session_id)
            event = CHAT_EVENT.validate_python(
                {
                    "seq": last + 1,
                    "session_id": session_id,
                    "run_id": run_id,
                    "ts": datetime.now(UTC).isoformat(),
                    "type": kind,
                    "data": data,
                }
            )
            await self._events.append(event)
            self._seq[session_id] = event.seq
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


__all__ = ["EventSink", "SessionLog", "discard"]
