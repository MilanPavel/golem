"""The working clock of a helper (ADR-059): its time limit counts working time only.

Working time is the time inside the helper's runs, less the time it waited for you (an
approval, the paid-model question), for a slot, for a model load and for a provider that
backed off. It is rebuilt from the stored events each time, so it survives a restart.

The waits for a model are read from ``waited_ms`` of ``model.call.completed``, and from a
``model.waiting`` that is still stored: one open now, or left by a call that never completed.
A wait is never counted twice. ``helper.state`` is not read: nothing writes it. ``helper.wait``
is the lead waiting for its helpers, so it is not read either.

Pure: no I/O, and no manager.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    ModelWaitingEvent,
    RouteConsentAnsweredEvent,
    RouteConsentNeededEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
)

type Span = tuple[float, float]

_MODEL_WAITS = ("slot", "load", "provider")


def _seconds(ts: str) -> float | None:
    try:
        return datetime.fromisoformat(ts).timestamp()
    except ValueError:
        return None


def _merged(spans: Sequence[Span]) -> list[Span]:
    out: list[Span] = []
    for start, end in sorted(spans):
        if end <= start:
            continue
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def _length(spans: Sequence[Span]) -> float:
    return sum(end - start for start, end in spans)


def _overlap(a: Sequence[Span], b: Sequence[Span]) -> float:
    """The length of what two merged lists of spans share."""
    total = 0.0
    for a_start, a_end in a:
        for b_start, b_end in b:
            total += max(0.0, min(a_end, b_end) - max(a_start, b_start))
    return total


class _Read:
    """The spans of the runs and of the waits in ``events``, none past ``now``."""

    def __init__(self, events: Sequence[ChatEvent], now: float) -> None:
        self.now = now
        runs: dict[str, float] = {}
        ended: dict[str, float] = {}
        user: float | None = None
        asked: list[Span] = []
        model_open: dict[str, float] = {}
        model_spans: dict[str, list[Span]] = {}
        started: dict[str, float] = {}
        counted: dict[str, tuple[float, int]] = {}
        for event in sorted(events, key=lambda e: e.seq):
            at = _seconds(event.ts)
            if at is None:
                continue
            if isinstance(event, RunStartedEvent):
                runs.setdefault(event.run_id, at)
            elif isinstance(event, RunCompletedEvent | RunFailedEvent | RunCancelledEvent):
                ended[event.run_id] = at
            elif isinstance(event, ApprovalNeededEvent | RouteConsentNeededEvent):
                user = at if user is None else user
            elif isinstance(event, ApprovalResolvedEvent | RouteConsentAnsweredEvent):
                if user is not None:
                    asked.append((user, at))
                user = None
            elif isinstance(event, ModelCallStartedEvent):
                started[event.data.message_id] = at
            elif isinstance(event, ModelCallCompletedEvent):
                if event.data.waited_ms:
                    counted[event.data.message_id] = (at, event.data.waited_ms)
            elif isinstance(event, ModelWaitingEvent):
                call = event.data.message_id
                if event.data.waiting:
                    if event.data.reason in _MODEL_WAITS:
                        model_open.setdefault(call, at)
                elif call in model_open:
                    model_spans.setdefault(call, []).append((model_open.pop(call), at))
        self.user_open = user is not None
        if user is not None:
            asked.append((user, now))
        self.model_open = bool(model_open)
        waits = list(asked)
        for call, begun in model_open.items():
            model_spans.setdefault(call, []).append((begun, now))
        for call, spans in model_spans.items():
            if call not in counted:
                waits.extend(spans)
        for call, (done, waited) in counted.items():
            begun = started.get(call)
            if begun is None:
                begun = done - waited / 1000
            waits.append((begun, min(done, begun + waited / 1000)))
        self.waits = _merged([(min(s, now), min(e, now)) for s, e in waits])
        self.run_open = any(run not in ended for run in runs)
        self.runs = _merged([(s, min(ended.get(run, now), now)) for run, s in runs.items()])
        self.runs = [(s, e) for s, e in self.runs if s < now]


def working_ms(events: Sequence[ChatEvent], now: float) -> int:
    """The working time of a helper at ``now`` (epoch seconds), in ms, from its stored events."""
    read = _Read(events, now)
    seconds = _length(read.runs) - _overlap(read.runs, read.waits)
    return max(0, round(seconds * 1000))


def clock_paused(events: Sequence[ChatEvent], now: float) -> bool:
    """Whether the clock stands still at ``now``: no run is open, or the helper waits."""
    read = _Read(events, now)
    return not read.run_open or read.user_open or read.model_open
