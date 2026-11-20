"""Every wait names its reason in ``model.waiting`` (ADR-060, section 6, step 18.4.2)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from itertools import pairwise
from pathlib import Path
from typing import Any

from fakes import GatedChatModel, ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel
from test_approvals import _Counter, _daemon
from test_dispatcher import (
    ANTHROPIC,
    QWEN,
    FakeClock,
    _call,
    _dispatcher,
    _Probe,
    _settle,
    _start,
)

from golem.config import GolemSettings
from golem.graphs.adapter import ApprovalAsked, ConsentAsked, HelpersParked
from golem.graphs.chat import open_chat
from golem.models.dispatcher import Dispatcher, Wait
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.runner import _apply, _Progress
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ApprovalNeededEvent,
    EventType,
    ModelWaitingData,
    ModelWaitingEvent,
)

LOCAL = "ollama/qwen3:8b"
CLOUD = "anthropic/claude-sonnet-4-5"


async def _fast(seconds: float) -> None:
    """A sleep that runs 50 times faster, so a one second notice takes 20 ms."""
    await asyncio.sleep(seconds / 50)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


class _Chat:
    """A daemon over a gated model whose sessions are named, and whose waits are collected."""

    def __init__(self, database: Database, model: Any, default: str, slots: int) -> None:
        self.events = EventLog(database)
        records = SessionRecords(database)
        self.runs = RunRecords(database)
        self.router = ModelRouter(GolemSettings(default_model=default), model=model)
        self.dispatcher = Dispatcher(
            lambda call: 2 if call.role != "job" else 4, local_slots=slots, sleep=_fast
        )
        self.manager: SessionManager
        runtime = open_chat(
            self.router,
            InMemorySaver(),
            dispatcher=self.dispatcher,
            label_of=lambda sid, role: self.manager.label_of(sid, role),
        )
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def send(self, title: str) -> tuple[str, str]:
        session_id = await self.manager.create(None)
        await self.manager.rename(session_id, title)
        return session_id, await self.manager.send(session_id, "hi")

    async def waits(self, session_id: str) -> list[ModelWaitingData]:
        return [
            e.data for e in await self.events.after(session_id) if isinstance(e, ModelWaitingEvent)
        ]

    async def finished(self, run_id: str) -> None:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)


async def test_local_only_the_third_chat_waits_with_position_one_and_the_holders_title(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, LOCAL, slots=2)
    (_, first), (_, second), (third_session, third) = [
        await chat.send(title) for title in ("Alpha", "Beta", "Gamma")
    ]

    async def two_run() -> bool:
        return len(model.seen) == 2

    await _until(two_run)

    async def told() -> bool:
        return any(w.waiting for w in await chat.waits(third_session))

    await _until(told)
    [wait] = [w for w in await chat.waits(third_session) if w.waiting]
    assert (wait.reason, wait.line, wait.position, wait.holder) == (
        "slot",
        "qwen3:8b",
        1,
        "Alpha",
    )
    assert wait.retry_in_ms is None
    assert "provider" not in wait.model_dump_json(exclude_none=True)

    model.release.set()
    for run in (first, second, third):
        await chat.finished(run)


async def test_cloud_only_a_hosted_wait_is_a_provider_wait_with_the_providers_name(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, CLOUD, slots=2)
    sent = [await chat.send(f"Chat {n}") for n in range(5)]

    async def four_run() -> bool:
        return len(model.seen) == 4

    await _until(four_run)
    fifth_session, _ = sent[4]

    async def told() -> bool:
        return any(w.waiting for w in await chat.waits(fifth_session))

    await _until(told)
    [wait] = [w for w in await chat.waits(fifth_session) if w.waiting]
    assert (wait.reason, wait.line, wait.position) == ("provider", "anthropic", 1)
    assert wait.holder == "Chat 0"
    assert "local" not in wait.model_dump_json(exclude_none=True)

    model.release.set()
    for _, run in sent:
        await chat.finished(run)


def _told(clock: FakeClock, sink: list[tuple[float, Wait | None]]) -> Callable[[Wait | None], None]:
    return lambda wait: sink.append((clock.now, wait))


async def test_a_wait_of_one_second_or_less_sends_nothing() -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    order: list[str] = []
    holder = await _start(d, QWEN, "holder", order)
    sink: list[tuple[float, Wait | None]] = []
    waiter = _Probe(d, _call(QWEN, "waiter"), order, _told(clock, sink))
    await _settle()
    await clock.advance(0.99)
    await holder.finish()
    await _settle()
    await waiter.finish()
    assert sink == []


async def test_new_events_go_out_at_most_once_a_second() -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    order: list[str] = []
    holder = await _start(d, QWEN, "holder", order)
    ahead = await _start(d, QWEN, "ahead", order)
    sink: list[tuple[float, Wait | None]] = []
    waiter = _Probe(d, _call(QWEN, "waiter"), order, _told(clock, sink))
    await _settle()
    await clock.advance(1.5)
    assert [(w.position, w.reason) for _, w in sink if w] == [(2, "slot")]
    # The position changes 0.5 s after the last event: the new one waits for the second to pass.
    first_at = sink[0][0]
    ahead.task.cancel()  # the call in front gives up: the position goes from 2 to 1
    await asyncio.gather(ahead.task, return_exceptions=True)
    await _settle()
    await clock.advance(0.2)
    assert len(sink) == 1
    await clock.advance(2.0)
    assert [w.position for _, w in sink if w] == [2, 1]
    assert all(b[0] - a[0] >= 1.0 for a, b in pairwise(sink))
    assert sink[-1][0] >= first_at + 1.0
    await holder.finish()
    await waiter.finish()


async def test_a_provider_wait_names_the_provider_and_the_backoff_left() -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    order: list[str] = []
    d.refused(ANTHROPIC, retry_after=10.0)
    sink: list[tuple[float, Wait | None]] = []
    waiter = _Probe(d, _call(ANTHROPIC, "waiter"), order, _told(clock, sink))
    await _settle()
    await clock.advance(1.5)
    [(_, wait)] = sink
    assert wait is not None
    assert (wait.reason, wait.line, wait.position) == ("provider", "anthropic", 1)
    assert wait.retry_in is not None and 8.0 < wait.retry_in <= 9.0
    await clock.advance(10.0)
    await waiter.finish()
    assert sink[-1][1] is None


class _Sink:
    def __init__(self) -> None:
        self.sent: list[ModelWaitingData] = []

    async def __call__(self, kind: EventType, data: BaseModel) -> None:
        if isinstance(data, ModelWaitingData):
            assert kind == "model.waiting"
            self.sent.append(data)


async def test_the_runner_writes_you_budget_and_team_once_each() -> None:
    sink = _Sink()
    progress = _Progress(user_message_id="u1")
    await _apply(ApprovalAsked("c1", "risky", {}, "rule", message_id="m1"), progress, sink)
    await _apply(ConsentAsked("anthropic/big", "frontier", "why", None, ()), progress, sink)
    await _apply(HelpersParked(("c2", "c3")), progress, sink)
    assert [(w.reason, w.message_id, w.waiting) for w in sink.sent] == [
        ("you", "m1", True),
        ("budget", "u1", True),
        ("team", "u1", True),
    ]


async def test_an_approval_writes_you_and_ends_it_when_answered(
    database: Database, tmp_path: Path
) -> None:
    counter = _Counter()
    model = ToolCallingChatModel(replies=[[("risky_a", {})], "done"])
    daemon = _daemon(database, model, counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = await daemon.settled(run_id)
    you = [e.data for e in asked if isinstance(e, ModelWaitingEvent)]
    assert [(w.reason, w.waiting) for w in you] == [("you", True)]

    [needed] = [e for e in asked if e.type == "approval.needed"]
    assert isinstance(needed, ApprovalNeededEvent)
    await daemon.manager.respond(session_id, needed.data.call_id, "allow")
    done = await daemon.settled(run_id)
    ends = [e.data for e in done if isinstance(e, ModelWaitingEvent)]
    assert [(w.reason, w.waiting) for w in ends] == [("you", True), ("you", False)]
