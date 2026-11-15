"""The ``model_calls`` table: its projection, its backfill, and what ``Usage`` reads from it."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ModelPrice
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.usage import EVER, Reference, Usage, backfill
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.projection import local_day, project_model_call
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    EmptyEventData,
    ModelCallCompletedData,
    ModelCallCompletedEvent,
    ModelCallStartedData,
    ModelCallStartedEvent,
    SessionCreatedData,
    TokenUsage,
)

PRICE = ModelPrice(input=3.0, output=15.0)
USAGE = {"input_tokens": 1000, "output_tokens": 200, "total_tokens": 1200}


async def _rows(database: Database) -> list[tuple[object, ...]]:
    rows = await database.fetch_all(
        "SELECT call_id, session_id, role, provider, model, tier, day, input, output, cost_usd,"
        " failed FROM model_calls ORDER BY started_at, call_id"
    )
    return [tuple(row) for row in rows]


async def _session(log: SessionLog, session_id: str = "s_1") -> None:
    await log.emit(session_id, None, "session.created", SessionCreatedData(model_profile="x"))
    await log.emit(session_id, f"r_{session_id}", "run.started", EmptyEventData())


async def _call(
    log: SessionLog,
    message_id: str,
    *,
    session_id: str = "s_1",
    provider: str = "deepseek",
    tier: str | None = "budget",
    usage: TokenUsage | None = None,
    cost: float | None = None,
    failed: bool = False,
) -> None:
    await log.emit(
        session_id,
        f"r_{session_id}",
        "model.call.started",
        ModelCallStartedData.model_validate(
            {
                "message_id": message_id,
                "index": 1,
                "profile": "p",
                "provider": provider,
                "model": "m",
                "tier": tier,
            }
        ),
    )
    await log.emit(
        session_id,
        f"r_{session_id}",
        "model.call.completed",
        ModelCallCompletedData(
            message_id=message_id, usage=usage, latency_ms=5, failed=failed, cost_usd=cost
        ),
    )


def _log(database: Database) -> SessionLog:
    return SessionLog(EventLog(database), EventBus(), SessionRecords(database))


async def test_a_run_with_two_calls_leaves_two_rows(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", usage=TokenUsage(input=100, output=10, cache_read=40), cost=0.5)
    await _call(log, "m_2", usage=TokenUsage(input=200, output=20), cost=0.25)
    rows = await _rows(database)
    assert [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows] == [
        ("m_1", "s_1", "chat", "deepseek", "m", "budget"),
        ("m_2", "s_1", "chat", "deepseek", "m", "budget"),
    ]
    assert [(r[7], r[8], r[9], r[10]) for r in rows] == [(100, 10, 0.5, 0), (200, 20, 0.25, 0)]
    cache = await database.fetch_one("SELECT cache_read FROM model_calls WHERE call_id = 'm_1'")
    assert cache is not None
    assert cache[0] == 40


async def test_a_failed_call_is_marked_and_has_no_cost(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", failed=True)
    (row,) = await _rows(database)
    assert (row[7], row[9], row[10]) == (None, None, 1)


async def test_a_completed_event_with_no_started_row_is_ignored(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await log.emit(
        "s_1",
        "r_1",
        "model.call.completed",
        ModelCallCompletedData(message_id="m_x", latency_ms=1, cost_usd=1.0),
    )
    assert await _rows(database) == []


async def test_a_call_with_no_tier_is_local_for_ollama_and_unknown_otherwise(
    database: Database,
) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", provider="ollama", tier=None)
    await _call(log, "m_2", provider="deepseek", tier=None)
    assert [r[5] for r in await _rows(database)] == ["local", None]


async def test_replaying_the_events_twice_leaves_the_same_rows(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", usage=TokenUsage(input=100, output=10), cost=0.5)
    await _call(log, "m_2", provider="ollama", tier="local", usage=TokenUsage(input=7, output=1))
    first = await _rows(database)
    await database.fetch_all("DELETE FROM model_calls")
    assert await backfill(database) == 4
    again = await _rows(database)
    assert await backfill(database) == 0  # the table is not empty any more
    assert [r[:6] + r[7:] for r in again] == [r[:6] + r[7:] for r in first]
    # Replaying onto its own rows changes nothing either.
    events = await EventLog(database).after("s_1", 0)
    async with database.transaction() as tx:
        for event in events:
            if isinstance(event, ModelCallStartedEvent | ModelCallCompletedEvent):
                await project_model_call(tx, event)
    assert await _rows(database) == again


async def test_backfill_fills_an_empty_table_from_old_events(database: Database) -> None:
    log = _log(database)
    await _session(log)
    # An old event: no tier, no cost.
    await _call(log, "m_1", provider="ollama", tier=None, usage=TokenUsage(input=50, output=5))
    await database.fetch_all("DELETE FROM model_calls")
    assert await backfill(database) == 2
    (row,) = await _rows(database)
    assert (row[0], row[5], row[7], row[8], row[9]) == ("m_1", "local", 50, 5, None)


async def test_spent_counts_only_paid_rows_for_a_day_and_for_a_session(
    database: Database,
) -> None:
    clock = _Clock()
    usage = Usage(database, clock=clock, zone=UTC)
    log = _log(database)
    await _session(log, "s_1")
    await _session(log, "s_2")
    await _call(log, "m_1", cost=0.5)
    await _call(log, "m_2", cost=0.0, provider="ollama", tier="local")
    await _call(log, "m_3", cost=None)
    await _call(log, "m_4", session_id="s_2", cost=0.25)
    await usage.record_role_call(
        session_id="s_1",
        role="titles",
        provider="deepseek",
        model="m",
        tier="budget",
        usage=TokenUsage(input=10, output=2),
        cost_usd=0.125,
    )
    today = usage.today()
    assert await usage.spent(day=today) == pytest.approx(0.875)
    assert await usage.spent(session_id="s_1") == pytest.approx(0.625)
    assert await usage.spent(day="1999-01-01") == 0.0
    plan = await database.fetch_all(
        "EXPLAIN QUERY PLAN SELECT SUM(cost_usd) FROM model_calls WHERE cost_usd > 0 AND day = ?",
        (today,),
    )
    assert "model_calls_day" in " ".join(str(r[3]) for r in plan)


class _Clock:
    """A UTC clock that tests move."""

    def __init__(self, now: datetime | None = None) -> None:
        self.now = now or datetime.now(UTC)

    def __call__(self) -> datetime:
        return self.now


async def test_summary_totals_by_model_and_by_day(database: Database) -> None:
    usage = Usage(database, zone=UTC)
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", usage=TokenUsage(input=100, output=10), cost=0.5)
    await _call(
        log, "m_2", provider="ollama", tier="local", usage=TokenUsage(input=1_000_000, output=0)
    )
    await usage.record_role_call(
        session_id="s_1",
        role="titles",
        provider="deepseek",
        model="m",
        tier="budget",
        usage=TokenUsage(input=10, output=2),
        cost_usd=0.25,
    )
    found = await usage.summary(since_day=usage.days_back(6))
    assert (found.totals.calls, found.totals.input, found.totals.output) == (3, 1_000_110, 12)
    assert found.totals.cost_usd == pytest.approx(0.75)
    assert found.totals.saved_usd == 0.0
    assert found.saved_reference is None
    assert [(m.provider, m.tier, m.calls, m.cost_usd) for m in found.by_model] == [
        ("deepseek", "budget", 2, 0.75),
        ("ollama", "local", 1, 0.0),
    ]
    assert len(found.by_day) == 7
    assert found.by_day[-1].day == usage.today()
    assert (found.by_day[-1].local_tokens, found.by_day[-1].paid_tokens) == (1_000_000, 122)
    assert all(d.cost_usd == 0 for d in found.by_day[:-1])
    mine = await usage.summary(since_day=EVER, session_id="s_1")
    assert mine.totals.calls == 3
    assert mine.by_day == []
    other = await usage.summary(since_day=EVER, session_id="nobody")
    assert other.totals.calls == 0


async def test_saved_usd_prices_local_tokens_at_the_reference(database: Database) -> None:
    usage = Usage(database, zone=UTC)
    log = _log(database)
    await _session(log)
    await _call(
        log,
        "m_1",
        provider="ollama",
        tier="local",
        usage=TokenUsage(input=2_000_000, output=1_000_000),
    )
    await _call(log, "m_2", usage=TokenUsage(input=5_000_000, output=0), cost=1.0)
    since = usage.today()
    without = await usage.summary(since_day=since)
    assert without.totals.saved_usd == 0.0
    reference = Reference("deepseek/deepseek-chat", ModelPrice(input=0.5, output=1.0))
    found = await usage.summary(since_day=since, reference=reference)
    assert found.totals.saved_usd == pytest.approx(2.0)
    assert found.saved_reference == "deepseek/deepseek-chat"


async def test_days_are_local_days_around_midnight() -> None:
    zone = timezone(timedelta(hours=-5))
    # 03:30 UTC is 22:30 the evening before in UTC-5.
    assert local_day("2026-03-02T03:30:00+00:00", zone) == "2026-03-01"
    assert local_day("2026-03-02T05:00:00+00:00", zone) == "2026-03-02"
    assert local_day("2026-03-02T04:59:59+00:00", zone) == "2026-03-01"


async def test_today_follows_the_zone_and_the_clock(database: Database) -> None:
    clock = _Clock(datetime(2026, 3, 2, 3, 30, tzinfo=UTC))
    zone = timezone(timedelta(hours=-5))
    usage = Usage(database, clock=clock, zone=zone)
    assert usage.today() == "2026-03-01"
    await usage.record_role_call(
        session_id=None,
        role="titles",
        provider=None,
        model=None,
        tier=None,
        usage=None,
        cost_usd=0.5,
    )
    clock.now = datetime(2026, 3, 2, 5, 0, tzinfo=UTC)
    assert usage.today() == "2026-03-02"
    assert usage.days_back(6) == "2026-02-24"
    assert await usage.spent(day="2026-03-01") == 0.5
    assert await usage.spent(day="2026-03-02") == 0.0
    week = await usage.summary(since_day=usage.days_back(6))
    assert [d.day for d in week.by_day][-2:] == ["2026-03-01", "2026-03-02"]
    assert week.by_day[-2].cost_usd == 0.5


async def test_a_real_run_fills_the_table_and_cost_get_sums_it(
    database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "notes.txt").write_text("42\n", encoding="utf-8")
    model = ToolCallingChatModel(
        replies=[[("read_file", {"path": "notes.txt"})], "done"], usage=USAGE
    )
    runtime = open_chat(
        ModelRouter(model=model),
        InMemorySaver(),
        price_of=lambda _profile: PRICE,
        tier_of=lambda _profile: "frontier",
    )
    events = EventLog(database)
    records = SessionRecords(database)
    runs = RunRecords(database)
    manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
    session_id = await manager.create(None, cwd=str(project))
    run_id = await manager.send(session_id, "read it")
    async with asyncio.timeout(3):
        while (run := await runs.get(run_id)) is None or run.status == "running":
            await asyncio.sleep(0.01)
    rows = await _rows(database)
    assert len(rows) == 2
    paid = sum(float(r[9]) for r in rows)  # type: ignore[arg-type]
    assert paid == pytest.approx(2 * (1000 * 3 + 200 * 15) / 1_000_000)
    usage = Usage(database)
    assert await usage.spent(session_id=session_id) == pytest.approx(paid)
    summary = await usage.summary(since_day=EVER, session_id=session_id)
    assert summary.totals.cost_usd == pytest.approx(paid)
    assert summary.totals.calls == 2
