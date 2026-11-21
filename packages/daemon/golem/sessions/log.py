"""Stamp, number, persist, and publish session events.

``seq`` continues from the event log, so it survives a daemon restart. It is
monotonic per session but not dense: coalesced deltas leave gaps.

Emit and attach take the same per-session lock. An attach reads the replay
and subscribes before the next event can be stored, so a client sees every
event once, in order.

Watchers of the session list get the session's summary after every stored
event except deltas, read in the same lock, so summaries arrive in order. A
``model.waiting`` counts only when the open wait the summary carries changes.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel

from golem.sessions.bus import EventBus, EventTarget, SummaryTarget
from golem.sessions.summaries import QUEUED_REASONS, summarize
from golem.store.events import EventLog
from golem.store.records import SessionActivity, SessionRecords
from golem_protocol.commands import PendingHelper, PendingItem, SessionSummary
from golem_protocol.events import CHAT_EVENT, ChatEvent, EventType, WaitReason

if TYPE_CHECKING:
    from golem.sessions.approvals import PendingKey

log = logging.getLogger("golem.sessions")

STEP_EVERY = 1.0
"""Seconds between two summaries a helper's new steps push."""

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
        self._waits: dict[str, tuple[WaitReason, str]] = {}
        """The wait each session's last summary carried, so a repeat is not sent again."""
        self._helper_counts: dict[str, tuple[int, int]] = {}
        """The helper counts each lead's last summary carried, so a repeat is not sent again."""
        self._lead_items: dict[str, list[PendingItem]] = {}
        """The pending list each lead's last summary carried, so a repeat is not sent again."""
        self._steps: dict[str, str] = {}
        """A helper's newest step, as one line."""
        self._step_pushed: dict[str, float] = {}
        """When a helper's summary last went out for a step, on ``clock``."""
        self.clock: Callable[[], float] = time.monotonic
        """Seconds, replaceable in tests. It paces the summary a helper's new step pushes."""

    async def helpers(self, activity: SessionActivity) -> tuple[int, int] | None:
        """``(running, waiting)`` of a lead's helpers, None when none has a run in progress."""
        if activity.session.closed_at is not None or activity.session.parent_session_id:
            return None
        counts = await self._records.helper_counts(activity.session.session_id)
        return counts if counts != (0, 0) else None

    async def pending_items(
        self,
        activity: SessionActivity,
        own: PendingItem | None,
        helpers: tuple[int, int] | None,
    ) -> list[PendingItem]:
        """Everything ``activity`` waits for, oldest first: its own item, and for a lead those
        of its helpers that wait for you, the same question once with a ``count``.

        ``own`` and ``helpers`` are what :meth:`pending` and :meth:`helpers` said. A session
        with no helper waiting reads nothing more; a lead with some reads two queries, whatever
        their number.
        """
        items = [] if own is None else [own]
        if helpers is None or helpers[1] == 0:
            return items
        # approvals reaches this module through recovery, so it is imported here.
        from golem.sessions.approvals import group_helper_items, pending_entry

        waiting = await self._records.waiting_helpers(activity.session.session_id)
        events = await self._events.for_runs([helper.run_id for helper in waiting])
        asked: list[tuple[PendingItem, PendingKey, PendingHelper]] = []
        for helper in waiting:
            found = pending_entry(events.get(helper.run_id, []))
            if found is None:
                continue
            item, key = found
            head = f"{helper.agent} · "
            label = item.label
            if label is None and helper.title is not None and helper.title.startswith(head):
                label = helper.title[len(head) :][:120] or None
            asked.append(
                (
                    item,
                    key,
                    PendingHelper(
                        session_id=helper.session_id,
                        agent=helper.agent or "helper",
                        label=label,
                        index=helper.index,
                    ),
                )
            )
        return sorted([*items, *group_helper_items(asked)], key=lambda item: item.since)

    def step(self, session_id: str) -> str | None:
        """A helper's newest step, None before its first or once its run ended."""
        return self._steps.get(session_id)

    async def note_step(
        self, session_id: str, line: str, live: Callable[[], bool] = lambda: True
    ) -> None:
        """Remember ``line`` as the helper's newest step, and push its summary, at most once a
        second. A step inside that second shows with the next summary. ``live`` says the run
        that took the step goes on: a step that comes in after its run ended is dropped."""
        async with self._lock(session_id):
            if not live():
                return
            self._steps[session_id] = line
            now = self.clock()
            last = self._step_pushed.get(session_id)
            if (last is not None and now - last < STEP_EVERY) or not self._bus.watched:
                return
            self._step_pushed[session_id] = now
            activity = await self._records.activity(session_id)
            if activity is not None:
                self._bus.publish_summary(await self._summary(activity, await self.wait(activity)))

    def clear_step(self, session_id: str) -> None:
        """Forget a helper's steps: its run ended."""
        self._steps.pop(session_id, None)
        self._step_pushed.pop(session_id, None)

    async def _summary(
        self, activity: SessionActivity, wait: tuple[WaitReason, str] | None
    ) -> SessionSummary:
        session_id = activity.session.session_id
        helpers = await self.helpers(activity)
        if helpers is None:
            self._helper_counts.pop(session_id, None)
        else:
            self._helper_counts[session_id] = helpers
        own = await self.pending(activity)
        items = await self.pending_items(activity, own, helpers)
        if items:
            self._lead_items[session_id] = items
        else:
            self._lead_items.pop(session_id, None)
        return summarize(
            activity,
            self.local_only(activity.session.cwd),
            own,
            wait,
            helpers,
            self.step(session_id),
            items,
        )

    async def _push_lead(self, lead_id: str) -> None:
        """Send a lead's summary when what its helpers do changed: a helper's state is the
        lead's too (ADR-059)."""
        # One push at a time per lead, in its lock: two helpers' events must not publish a
        # newer summary before an older one.
        async with self._lock(lead_id):
            activity = await self._records.activity(lead_id)
            if activity is None:
                return
            counts = await self.helpers(activity)
            items = await self.pending_items(activity, await self.pending(activity), counts)
            if counts == self._helper_counts.get(lead_id) and items == self._lead_items.get(
                lead_id, []
            ):
                return
            self._bus.publish_summary(await self._summary(activity, await self.wait(activity)))

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

    async def trim(self, session_id: str, ts: str) -> ChatEvent | None:
        """Cut a finished helper's log to its receipt (ADR-059, section 9), under the session's
        lock so no attach reads half of it. Returns ``session.trimmed``, None when there is
        nothing to trim."""
        async with self._lock(session_id):
            event = await self._events.trim(session_id, ts)
            if event is None:
                return None
            self._seq[session_id] = event.seq
            self._bus.publish(event)
            if self._bus.watched:
                activity = await self._records.activity(session_id)
                if activity is not None:
                    self._bus.publish_summary(await self._summary(activity, None))
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

    async def wait(self, activity: SessionActivity) -> tuple[WaitReason, str] | None:
        """The open wait of the session's running run, as ``(reason, line)``.

        It is the run's newest stored ``model.waiting``: one that starts a ``slot``,
        ``provider`` or ``load`` wait sets it, one that ends a wait clears it, and a message
        that completes deletes its own. A run that ended, was cancelled or was recovered after a
        restart is not running, so it reads nothing.
        """
        if not activity.running or activity.session.closed_at is not None:
            return None
        run_id = await self._records.running_run_id(activity.session.session_id)
        if run_id is None:
            return None
        found = await self._events.last_wait(run_id)
        if found is None or not found.data.waiting or found.data.line is None:
            return None
        if found.data.reason not in QUEUED_REASONS:
            return None
        return found.data.reason, found.data.line

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
            if (event.type not in _DELTAS or event.type == "model.waiting") and self._bus.watched:
                activity = await self._records.activity(session_id)
                if activity is not None:
                    wait = await self.wait(activity)
                    before = self._waits.get(session_id)
                    if wait is None:
                        self._waits.pop(session_id, None)
                    else:
                        self._waits[session_id] = wait
                    # A wait event is a summary change only when the carried wait changed, so
                    # the dispatcher's once-a-second notices (position moves) send no summary.
                    if event.type == "model.waiting" and wait == before:
                        return event
                    self._bus.publish_summary(await self._summary(activity, wait))
                    lead = activity.session.parent_session_id
                    if lead is not None:
                        await self._push_lead(lead)
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
