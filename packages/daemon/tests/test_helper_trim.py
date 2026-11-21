"""A finished helper is cut to a receipt after its keep days (ADR-059, section 9)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from golem.config import AgentSettings
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.trim import HelperTrimmer
from golem.store import events as events_module
from golem.store.database import Database, Transaction
from golem.store.events import EventLog
from golem.store.records import SessionRecords
from golem_protocol.events import CHAT_EVENT, ChatEvent

NOW = datetime(2026, 12, 20, 12, 0, tzinfo=UTC)


class _Fixture:
    def __init__(self, database: Database) -> None:
        self.database = database
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        self.log = SessionLog(self.events, EventBus(), self.records)
        self.settings = AgentSettings()
        self.dropped: list[str] = []
        self.now = NOW

        async def drop(session_id: str) -> None:
            self.dropped.append(session_id)

        self.drop = drop
        self.trimmer = self.make()

    def make(self, **more: Any) -> HelperTrimmer:
        return HelperTrimmer(
            self.records, self.log, lambda: self.settings, lambda: self.now, self.drop, **more
        )

    async def add(
        self, session_id: str, seq: int, kind: str, data: dict[str, Any], at: datetime
    ) -> int:
        event: ChatEvent = CHAT_EVENT.validate_python(
            {
                "seq": seq,
                "session_id": session_id,
                "run_id": None if kind == "session.created" else f"r_{session_id}",
                "ts": at.isoformat(),
                "type": kind,
                "data": data,
            }
        )
        await self.events.append(event)
        return seq + 1

    async def lead(self, session_id: str = "s_lead") -> None:
        await self.add(session_id, 1, "session.created", {"model_profile": "local"}, NOW)

    async def helper(
        self,
        sid: str,
        ended_days_ago: float,
        *,
        status: str = "completed",
        asked: bool = False,
        end: bool = True,
        lead: str = "s_lead",
    ) -> None:
        at = NOW - timedelta(days=ended_days_ago + 0.01)
        end_at = NOW - timedelta(days=ended_days_ago)
        parent = {"session_id": lead, "call_id": "c_1", "index": int(sid[-1])}
        agent = {"name": "explorer", "source": "bundled", "wish": "cheapest"}
        created = {"model_profile": "local", "parent": parent, "agent": agent}
        seq = await self.add(sid, 1, "session.created", created, at)
        seq = await self.add(sid, seq, "run.started", {}, at)
        brief = {"message_id": "m_brief", "role": "user", "text": "find x"}
        seq = await self.add(sid, seq, "message.completed", brief, at)
        call = {"message_id": "m_a1", "index": 1, "profile": "local", "provider": "ollama"}
        seq = await self.add(sid, seq, "model.call.started", call, at)
        done = {
            "message_id": "m_a1",
            "usage": {"input": 100, "output": 20},
            "latency_ms": 5,
            "cost_usd": 0.5,
        }
        seq = await self.add(sid, seq, "model.call.completed", done, at)
        tool = {"call_id": "t1", "message_id": "m_a1", "name": "read_file", "args": {"path": "a"}}
        seq = await self.add(sid, seq, "tool.requested", tool, at)
        if asked:
            ask: dict[str, Any] = {
                "call_id": "t1",
                "name": "shell",
                "args": {},
                "source": "built-in default",
            }
            seq = await self.add(sid, seq, "approval.needed", ask, at)
            answer = {"call_id": "t1", "name": "shell", "decision": "allow"}
            seq = await self.add(sid, seq, "approval.resolved", answer, at)
        reply = {"message_id": "m_a1", "role": "assistant", "text": "found it"}
        seq = await self.add(sid, seq, "message.completed", reply, at)
        if not end:
            return
        kind = {"completed": "run.completed", "failed": "run.failed", "cancelled": "run.cancelled"}
        data: dict[str, Any] = {
            "failed": {"message": "boom"},
            "cancelled": {"reason": "user"},
        }.get(status, {})
        seq = await self.add(sid, seq, kind[status], data, end_at)
        summary = {"run_id": f"r_{sid}", "status": status, "summary": "found it"}
        await self.add(sid, seq, "session.completed", summary, end_at)

    async def types(self, session_id: str) -> list[str]:
        return [event.type for event in await self.events.after(session_id)]


@pytest.fixture
async def fx(database: Database) -> _Fixture:
    found = _Fixture(database)
    await found.lead()
    return found


async def test_eight_days_is_trimmed_and_six_days_is_not(fx: _Fixture) -> None:
    await fx.helper("s_h1", 8)
    await fx.helper("s_h2", 6)
    assert await fx.trimmer.run_once() == 1
    assert fx.dropped == ["s_h1"]
    assert await fx.types("s_h1") == [
        "session.created",
        "message.completed",
        "message.completed",
        "session.completed",
        "session.trimmed",
    ]
    assert len(await fx.types("s_h2")) > 8


async def test_a_trim_keeps_rows_totals_and_the_leads_log(fx: _Fixture) -> None:
    await fx.helper("s_h1", 8)
    sql = "SELECT call_id, input, cost_usd FROM model_calls"
    before = [tuple(r) for r in await fx.database.fetch_all(sql)]
    lead_before = await fx.types("s_lead")
    await fx.trimmer.run_once()
    assert [tuple(r) for r in await fx.database.fetch_all(sql)] == before != []
    assert await fx.types("s_lead") == lead_before
    runs = await fx.database.fetch_all("SELECT status FROM runs WHERE session_id = 's_h1'")
    assert [r[0] for r in runs] == ["completed"]
    kept = await fx.events.after("s_h1")
    texts = [e.data.text for e in kept if e.type == "message.completed"]  # type: ignore[union-attr]
    assert texts == ["find x", "found it"]
    last = kept[-1]
    assert last.type == "session.trimmed" and last.data.removed > 0  # type: ignore[union-attr]
    assert last.seq == max(e.seq for e in kept) and last.run_id is None
    record = await fx.records.get("s_h1")
    assert record is not None and record.trimmed_at == NOW.isoformat()


async def test_a_trimmed_helper_is_not_due_again(fx: _Fixture) -> None:
    await fx.helper("s_h1", 8)
    assert await fx.trimmer.run_once() == 1
    assert await fx.trimmer.run_once() == 0


async def test_a_failed_or_asking_helper_waits_for_day_30(fx: _Fixture) -> None:
    await fx.helper("s_h1", 20, status="failed")
    await fx.helper("s_h2", 20, status="cancelled")
    await fx.helper("s_h3", 20, asked=True)
    await fx.helper("s_h4", 31, status="failed")
    await fx.helper("s_h5", 31, asked=True)
    assert await fx.trimmer.run_once() == 2
    assert sorted(fx.dropped) == ["s_h4", "s_h5"]


async def test_zero_keeps_for_ever(fx: _Fixture) -> None:
    await fx.helper("s_h1", 400)
    await fx.helper("s_h2", 400, status="failed")
    fx.settings = AgentSettings(keep_days=0)
    assert await fx.trimmer.run_once() == 1
    assert fx.dropped == ["s_h2"]
    fx.settings = AgentSettings(keep_days=0, keep_problem_days=0)
    await fx.helper("s_h3", 400, status="failed")
    assert await fx.trimmer.run_once() == 0


async def test_the_settings_are_read_on_every_pass(fx: _Fixture) -> None:
    await fx.helper("s_h1", 3)
    assert await fx.trimmer.run_once() == 0
    fx.settings = AgentSettings(keep_days=2)
    assert await fx.trimmer.run_once() == 1


def test_a_negative_keep_time_is_a_config_error() -> None:
    with pytest.raises(ValueError, match="keep_days"):
        AgentSettings(keep_days=-1)
    with pytest.raises(ValueError, match="keep_problem_days"):
        AgentSettings(keep_problem_days=-1)


async def test_a_running_waiting_or_parentless_session_is_untouched(fx: _Fixture) -> None:
    await fx.helper("s_h1", 20, end=False)
    await fx.helper("s_h2", 20, end=False)
    ask: dict[str, Any] = {
        "call_id": "t9",
        "name": "shell",
        "args": {},
        "source": "built-in default",
    }
    await fx.add("s_h2", 99, "approval.needed", ask, NOW)
    await fx.add("s_lead", 2, "run.started", {}, NOW - timedelta(days=30))
    await fx.add("s_lead", 3, "run.completed", {}, NOW - timedelta(days=29))
    assert await fx.trimmer.run_once() == 0
    assert fx.dropped == []


async def test_a_helper_of_a_waiting_lead_is_untouched(fx: _Fixture) -> None:
    await fx.lead("s_lead2")
    await fx.helper("s_h1", 20)
    await fx.helper("s_h2", 20, lead="s_lead2")
    await fx.add("s_lead", 2, "run.started", {}, NOW - timedelta(days=21))
    wait = {"call_id": "c_1", "state": "parked", "helper_ids": ["s_h1"]}
    await fx.add("s_lead", 3, "helper.wait", wait, NOW)
    assert await fx.trimmer.run_once() == 1
    assert fx.dropped == ["s_h2"]


async def test_a_pass_trims_one_batch(fx: _Fixture) -> None:
    fx.trimmer = fx.make(batch=2)
    for n in range(5):
        await fx.helper(f"s_h{n}", 10 + n)
    assert await fx.trimmer.run_once() == 2
    assert await fx.trimmer.run_once() == 2
    assert await fx.trimmer.run_once() == 1


async def test_a_trim_that_stops_in_the_middle_leaves_the_log_whole(
    fx: _Fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    await fx.helper("s_h1", 8)
    before = await fx.events.after("s_h1")

    async def stop(tx: Transaction, event: ChatEvent, message_id: str | None) -> None:
        del tx, event, message_id
        raise RuntimeError("the daemon stopped")

    monkeypatch.setattr(events_module, "_insert", stop)
    assert await fx.trimmer.run_once() == 0
    monkeypatch.undo()
    assert await fx.events.after("s_h1") == before
    record = await fx.records.get("s_h1")
    assert record is not None and record.trimmed_at is None
    assert await fx.trimmer.run_once() == 1


async def test_the_loop_runs_at_start_and_then_every_hour(fx: _Fixture) -> None:
    await fx.helper("s_h1", 8)
    sleeps: list[float] = []
    gate = asyncio.Event()

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) == 1:
            await fx.helper("s_h2", 9)
            return
        gate.set()
        await asyncio.sleep(3600)

    fx.trimmer = fx.make(sleep=sleep)
    fx.trimmer.start()
    await asyncio.wait_for(gate.wait(), 5)
    await fx.trimmer.aclose()
    assert sleeps[:2] == [3600.0, 3600.0]
    assert sorted(fx.dropped) == ["s_h1", "s_h2"]


class _Target:
    def __init__(self) -> None:
        self.got: list[ChatEvent] = []

    def deliver(self, event: ChatEvent) -> None:
        self.got.append(event)


async def test_attaching_to_a_trimmed_helper_returns_the_receipt(fx: _Fixture) -> None:
    await fx.helper("s_h1", 8)
    await fx.trimmer.run_once()
    target = _Target()
    last = await fx.log.attach("s_h1", 0, target)  # type: ignore[arg-type]
    assert [e.type for e in target.got] == await fx.types("s_h1")
    assert last == target.got[-1].seq


async def test_the_kept_events_project_to_the_same_row(fx: _Fixture, tmp_path: Any) -> None:
    await fx.helper("s_h1", 8)
    await fx.trimmer.run_once()
    sql = "SELECT parent_session_id, agent, trimmed_at FROM sessions WHERE session_id = 's_h1'"
    row = await fx.database.fetch_one(sql)
    async with Database.open(tmp_path / "again.db") as other:
        await EventLog(other).append((await fx.events.after("s_lead"))[0])
        replay = EventLog(other)
        for event in await fx.events.after("s_h1"):
            await replay.append(event)
        again = await other.fetch_one(sql)
    assert row is not None and again is not None and tuple(row) == tuple(again)
    assert row["trimmed_at"] == NOW.isoformat()
