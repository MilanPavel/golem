"""Stamp, number, persist, and publish session events.

``seq`` continues from the event log, so it survives a daemon restart. It is
monotonic per session but not dense: coalesced deltas leave gaps.

Emit and attach take the same per-session lock. An attach reads the replay
and subscribes before the next event can be stored, so a client sees every
event once, in order.

Watchers of the session list get the session's summary after every stored
event except deltas, read in the same lock, so summaries arrive in order.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from pydantic import BaseModel

from golem.sessions.bus import EventBus, EventTarget, SummaryTarget
from golem.sessions.summaries import summarize
from golem.store.events import EventLog
from golem.store.records import SessionActivity, SessionRecords
from golem_protocol.commands import PendingItem
from golem_protocol.events import CHAT_EVENT, ChatEvent, EventType

log = logging.getLogger("golem.sessions")

_DELTAS = (
    "message.delta",
    "message.thinking.delta",
    "tool.output",
    "tool.writing",
    "model.waiting",
)
"""Events that do not change a session's summary."""


class SessionLog:
    """Owns ``seq`` for every session. One emit or attach per session at a time."""

    def __init__(self, events: EventLog, bus: EventBus, records: SessionRecords) -> None:
        self._events = events
        self._bus = bus
        self._records = records
        self.local_only: Callable[[str | None], bool] = lambda _cwd: False
        """Says whether a folder stays on this Mac, for the summaries."""
        self.after_emit: Callable[[ChatEvent], Awaitable[None]] | None = None
        """Told of each event once it is stored and published, outside the session's lock.

        The session manager uses it to put a helper's tool calls into its lead's log."""
        self._seq: dict[str, int] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def emit(
        self,
        session_id: str,
        run_id: str | None,
        kind: EventType,
        data: BaseModel,
    ) -> ChatEvent:
        """Persist the next event for ``session_id``, then publish it.

        The emit is shielded: cancelling the caller cannot leave an event
        half-written or a ``seq`` used but not stored.

        Raises :class:`pydantic.ValidationError` when ``data`` is not the
        payload ``kind`` carries.
        """
        event = await asyncio.shield(self._emit(session_id, run_id, kind, data))
        if self.after_emit is not None:
            try:
                await self.after_emit(event)
            except Exception:
                # The event is stored. What follows it must not fail the run that emitted it.
                log.exception("after_emit failed for %s", event.type)
        return event

    async def attach(self, session_id: str, after_seq: int, target: EventTarget) -> int:
        """Queue stored events after ``after_seq`` on ``target``, then subscribe it.

        Returns the newest ``seq`` at that moment. A target already attached
        gets the replay again; the client drops what it has seen.
        """
        async with self._lock(session_id):
            for event in await self._events.after(session_id, after_seq):
                target.deliver(event)
            self._bus.subscribe(session_id, target)
            return await self._last(session_id)

    async def watch(self, limit: int, target: SummaryTarget) -> list[SessionActivity]:
        """Send ``target`` every later summary, then read the newest ``limit`` sessions.

        A summary may arrive before the list it is newer than. ``last_seq``
        tells the client which one to keep.
        """
        self._bus.watch(target)
        return await self._records.recent(limit)

    async def pending(self, activity: SessionActivity) -> PendingItem | None:
        """What the waiting run of a session waits for. Idle sessions read nothing."""
        if not activity.waiting or activity.session.closed_at is not None:
            return None
        run_id = await self._records.waiting_run_id(activity.session.session_id)
        if run_id is None:
            return None
        # approvals reaches this module through recovery, so it is imported here.
        from golem.sessions.approvals import pending_item

        return pending_item(await self._events.for_run(run_id))

    async def for_run(self, run_id: str) -> list[ChatEvent]:
        """Every stored event of one run, in order."""
        return await self._events.for_run(run_id)

    async def stored(self, session_id: str) -> list[ChatEvent]:
        """Every stored event of ``session_id``, in order."""
        return await self._events.after(session_id, 0)

    async def since(self, session_id: str, after_seq: int) -> list[ChatEvent]:
        """The stored events of ``session_id`` after ``after_seq``, in order."""
        return await self._events.after(session_id, after_seq)

    def detach(self, session_id: str, target: EventTarget) -> None:
        self._bus.unsubscribe(session_id, target)

    def detach_all(self, target: object) -> None:
        self._bus.unsubscribe_all(target)

    async def _emit(
        self,
        session_id: str,
        run_id: str | None,
        kind: EventType,
        data: BaseModel,
    ) -> ChatEvent:
        async with self._lock(session_id):
            event = CHAT_EVENT.validate_python(
                {
                    "seq": await self._last(session_id) + 1,
                    "session_id": session_id,
                    "run_id": run_id,
                    "ts": datetime.now(UTC).isoformat(),
                    "type": kind,
                    "data": data,
                }
            )
            await self._events.append(event)
            self._seq[session_id] = event.seq
            self._bus.publish(event)
            if event.type not in _DELTAS and self._bus.watched:
                activity = await self._records.activity(session_id)
                if activity is not None:
                    self._bus.publish_summary(
                        summarize(
                            activity,
                            self.local_only(activity.session.cwd),
                            await self.pending(activity),
                        )
                    )
            return event

    async def _last(self, session_id: str) -> int:
        last = self._seq.get(session_id)
        if last is None:
            last = await self._events.last_seq(session_id)
            self._seq[session_id] = last
        return last

    def _lock(self, session_id: str) -> asyncio.Lock:
        lock = self._locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[session_id] = lock
        return lock


__all__ = ["SessionLog"]
