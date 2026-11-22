"""The working clock of a helper: its time limit leaves out the waits (ADR-059, step 15.6.2)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from fakes import GatedChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_dispatcher_wiring import _dispatcher, _started, _until  # pyright: ignore

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.helper_clock import clock_paused, working_ms
from golem.sessions.log import SessionLog
from golem.sessions.manager import CLOCK_RECHECK, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    ModelCallCompletedData,
    ModelCallCompletedEvent,
)

BASE = datetime(2026, 11, 1, 12, 0, 0, tzinfo=UTC).timestamp()


class _Log:
    """A helper's stored events, built with the time of each in seconds from ``BASE``."""

    def __init__(self) -> None:
        self.events: list[ChatEvent] = []

    def add(
        self, at: float, kind: str, data: dict[str, Any] | None = None, run: str = "r1"
    ) -> _Log:
        self.events.append(
            CHAT_EVENT.validate_python(
                {
                    "seq": len(self.events) + 1,
                    "session_id": "h1",
                    "run_id": run,
                    "ts": datetime.fromtimestamp(BASE + at, UTC).isoformat(),
                    "type": kind,
                    "data": data or {},
                }
            )
        )
        return self

    def run(self, start: float, end: float | None = None, run: str = "r1") -> _Log:
        self.add(start, "run.started", run=run)
        if end is not None:
            self.add(end, "run.completed", run=run)
        return self

    def approval(self, asked: float, answered: float | None, call: str = "c1") -> _Log:
        need: dict[str, Any] = {"call_id": call, "name": "bash", "args": {}, "source": "tool"}
        self.add(asked, "approval.needed", need)
        if answered is not None:
            self.add(
                answered,
                "approval.resolved",
                {"call_id": call, "name": "bash", "decision": "allow"},
            )
        return self

    def consent(self, asked: float, answered: float | None) -> _Log:
        need = {"model_profile": "p", "tier": "budget", "why": "w", "alternatives": ["once"]}
        self.add(asked, "route.consent.needed", need)
        if answered is not None:
            self.add(answered, "route.consent.answered", {"answer": "once"})
        return self

    def call(self, sent: float, done: float | None, call: str, waited: int | None = None) -> _Log:
        self.add(
            sent,
            "model.call.started",
            {"message_id": call, "index": 1, "profile": "p", "message_ids": []},
        )
        if done is not None:
            data: dict[str, Any] = {"message_id": call, "latency_ms": round((done - sent) * 1000)}
            if waited is not None:
                data["waited_ms"] = waited
            self.add(done, "model.call.completed", data)
        return self

    def waiting(self, at: float, waiting: bool, call: str, reason: str = "slot") -> _Log:
        data: dict[str, Any] = {"message_id": call, "waiting": waiting}
        if waiting:
            data["reason"] = reason
        return self.add(at, "model.waiting", data)

    def worked(self, now: float) -> float:
        return working_ms(self.events, BASE + now) / 1000


def test_a_helper_that_waits_40_seconds_for_you_and_works_10_has_worked_10() -> None:
    log = _Log().run(0, 50).approval(5, 45)
    assert log.worked(60) == 10


def test_a_wait_for_the_paid_question_does_not_count_either() -> None:
    log = _Log().run(0, 30).consent(2, 22)
    assert log.worked(30) == 10


def test_overlapping_waits_count_once() -> None:
    log = _Log().run(0, 50).approval(10, 40).consent(20, 45)
    assert log.worked(50) == 15


def test_a_wait_that_is_open_now_counts_up_to_now() -> None:
    log = _Log().run(0).approval(10, None)
    assert log.worked(100) == 10
    assert clock_paused(log.events, BASE + 100)


def test_a_slot_wait_still_stored_counts_up_to_now_and_a_finished_one_counts_whole() -> None:
    open_now = _Log().run(0).call(4, None, "m1").waiting(5, True, "m1")
    assert open_now.worked(30) == 5
    assert clock_paused(open_now.events, BASE + 30)
    left = _Log().run(0, 40).call(4, None, "m1").waiting(5, True, "m1").waiting(25, False, "m1")
    assert left.worked(40) == 20


def test_time_between_runs_does_not_count() -> None:
    log = _Log().run(0, 10, "r1").run(100, 105, "r2")
    assert log.worked(200) == 15
    assert not clock_paused(_Log().run(0, 10).run(100, None, "r2").events, BASE + 101)
    assert clock_paused(log.events, BASE + 200)


def test_a_call_with_waited_ms_and_a_stored_wait_counts_once() -> None:
    log = (
        _Log()
        .run(0, 30)
        .call(2, 22, "m1", waited=15_000)
        .waiting(3, True, "m1")
        .waiting(17, False, "m1")
    )
    assert log.worked(30) == 15


def test_waited_ms_is_taken_off_the_working_time() -> None:
    log = _Log().run(0, 30).call(2, 22, "m1", waited=15_000)
    assert log.worked(30) == 15


def test_a_waited_call_inside_an_approval_wait_counts_once() -> None:
    log = _Log().run(0, 50).approval(5, 45).call(10, 30, "m1", waited=10_000)
    assert log.worked(50) == 10


def test_a_wait_for_you_and_the_clock_never_go_below_zero() -> None:
    assert _Log().run(0, 10).approval(0, 10).worked(10) == 0
    assert _Log().worked(10) == 0


def test_the_clock_rebuilt_from_events_read_back_gives_the_same_working_time() -> None:
    log = _Log().run(0, 50).approval(5, 45).call(46, 49, "m1", waited=2_000)
    again = [CHAT_EVENT.validate_json(e.model_dump_json()) for e in log.events]
    assert working_ms(again, BASE + 60) == working_ms(log.events, BASE + 60) == 8_000


async def test_the_clock_rebuilt_after_a_restart_gives_the_same_working_time(
    database: Database,
) -> None:
    chat = _Chat(database)
    session_id = await chat.manager.create(None)
    base = await chat.events.last_seq(session_id)
    log = _Log().run(0, 50).approval(5, 45).call(46, 49, "m1", waited=2_000)
    for event in log.events:
        await chat.events.append(
            event.model_copy(update={"session_id": session_id, "seq": base + event.seq})
        )
    before = working_ms(await chat.events.after(session_id, 0), BASE + 60)
    # A new process reads the same file: nothing but the stored events is kept.
    after = working_ms(await EventLog(database).after(session_id, 0), BASE + 60)
    assert before == after == 8_000


def test_the_protocol_keeps_waited_ms_and_leaves_it_out_when_there_is_none() -> None:
    data = ModelCallCompletedData(message_id="m1", latency_ms=5, waited_ms=1500)
    assert ModelCallCompletedData.model_validate_json(data.model_dump_json()).waited_ms == 1500
    assert "waited_ms" not in ModelCallCompletedData(message_id="m1", latency_ms=5).model_dump(
        exclude_none=True
    )


class _Chat:
    def __init__(self, database: Database, model: Any = None, slots: int = 1) -> None:
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.router = ModelRouter(GolemSettings(default_model="ollama/qwen3:8b"), model=model)
        runtime = open_chat(self.router, InMemorySaver(), dispatcher=_dispatcher(slots))
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def finished(self, run_id: str) -> None:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status not in ("running", "waiting")

        await _until(done)

    async def completed(self, session_id: str) -> list[ModelCallCompletedEvent]:
        return [
            e
            for e in await self.events.after(session_id, 0)
            if isinstance(e, ModelCallCompletedEvent)
        ]


async def test_a_call_that_waited_for_a_slot_stores_how_long_on_model_call_completed(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model)
    one_session = await chat.manager.create(None)
    one = await chat.manager.send(one_session, "first")
    await _until(_started(model))
    two_session = await chat.manager.create(None)
    two = await chat.manager.send(two_session, "second")
    await asyncio.sleep(0.2)
    model.release.set()
    await chat.finished(one)
    await chat.finished(two)

    (first,) = await chat.completed(one_session)
    (second,) = await chat.completed(two_session)
    assert first.data.waited_ms is None
    assert second.data.waited_ms is not None and second.data.waited_ms >= 150


class _Timer:
    """A manager whose helper has stored ``log``, with a clock and a sleep a test moves."""

    def __init__(self, manager: SessionManager, log: _Log, monkeypatch: pytest.MonkeyPatch) -> None:
        self.manager = manager
        self.log = log
        self.now = BASE
        self.asked: list[float] = []
        self.stopped: list[str] = []
        self.tick: asyncio.Queue[None] = asyncio.Queue()

        async def stored(session_id: str) -> list[ChatEvent]:
            del session_id
            return list(log.events)

        async def pause(seconds: float) -> None:
            self.asked.append(seconds)
            await self.tick.get()

        async def stop(helper_id: str, run_id: str, timed_out: bool) -> None:
            del run_id
            assert timed_out
            self.stopped.append(helper_id)

        monkeypatch.setattr(manager._events, "stored", stored)  # pyright: ignore
        monkeypatch.setattr(manager, "_limit_stop", stop)
        manager.pause = pause
        manager.wall_clock = lambda: self.now
        self.task = asyncio.create_task(manager._time_limit("h1", "r1", 20))  # pyright: ignore

    async def step(self, to: float) -> None:
        """Move the clock to ``to`` seconds, wake the timer and let it look again."""
        seen = len(self.asked)
        self.now = BASE + to
        self.tick.put_nowait(None)
        async with asyncio.timeout(3):
            while len(self.asked) == seen and not self.task.done():
                await asyncio.sleep(0)

    async def first(self) -> None:
        async with asyncio.timeout(3):
            while not self.asked:
                await asyncio.sleep(0)


async def test_a_helper_that_waited_40_seconds_for_you_is_not_stopped_at_20_seconds(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _Log().run(0).approval(1, None)
    timer = _Timer(_Chat(database).manager, log, monkeypatch)
    timer.now = BASE + 1
    await timer.first()
    assert timer.asked == [CLOCK_RECHECK]
    await timer.step(41)
    assert not timer.stopped
    log.add(41, "approval.resolved", {"call_id": "c1", "name": "bash", "decision": "allow"})
    await timer.step(45)
    assert not timer.stopped
    # It has worked 1 s before the question and 4 s since.
    assert timer.asked[-1] == pytest.approx(15)
    await timer.step(60.5)
    await asyncio.wait_for(timer.task, 3)
    assert timer.stopped == ["h1"]


async def test_a_helper_is_stopped_once_it_has_worked_the_limit(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    timer = _Timer(_Chat(database).manager, _Log().run(0), monkeypatch)
    timer.now = BASE + 5
    await timer.first()
    assert timer.asked == [pytest.approx(15)]
    await timer.step(20)
    await asyncio.wait_for(timer.task, 3)
    assert timer.stopped == ["h1"]


async def test_a_local_only_helper_does_not_work_while_it_waits_for_a_slot(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _Log().run(0).call(1, None, "m1").waiting(2, True, "m1", "slot")
    timer = _Timer(_Chat(database).manager, log, monkeypatch)
    timer.now = BASE + 2
    await timer.first()
    assert timer.asked == [CLOCK_RECHECK]
    await timer.step(120)
    assert not timer.stopped
    log.waiting(120, False, "m1")
    log.call(120, 130, "m2")
    await timer.step(125)
    assert not timer.stopped
    assert timer.asked[-1] == pytest.approx(13)


async def test_a_cloud_only_helper_does_not_work_while_a_provider_backs_off(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _Log().run(0).call(1, None, "m1").waiting(2, True, "m1", "provider")
    timer = _Timer(_Chat(database).manager, log, monkeypatch)
    timer.now = BASE + 2
    await timer.first()
    assert timer.asked == [CLOCK_RECHECK]
    await timer.step(90)
    assert not timer.stopped
    # The wait ended and its call went on: 8 s of backoff were stored on the call.
    log.events.clear()
    log.run(0).call(1, 100, "m1", waited=88_000)
    await timer.step(100)
    assert not timer.stopped
    assert timer.asked[-1] == pytest.approx(8)


async def test_a_timer_armed_after_a_restart_counts_the_time_worked_and_not_the_waits(
    database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _Log().run(0, 30).approval(5, 25).run(200, None, "r2")
    timer = _Timer(_Chat(database).manager, log, monkeypatch)
    timer.now = BASE + 203
    await timer.first()
    # 10 s of the first run and 3 s of the second are worked: 7 s are left.
    assert timer.asked == [pytest.approx(7)]
    await timer.step(210)
    await asyncio.wait_for(timer.task, 3)
    assert timer.stopped == ["h1"]
