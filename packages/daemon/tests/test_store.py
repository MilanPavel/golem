"""``golem.db``: migrations, the event log, and the projected tables."""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
from typing import Literal

import pytest

from golem.store.database import Database, DatabaseTooNewError
from golem.store.events import EventLog
from golem.store.migrations import MIGRATIONS
from golem.store.records import RunRecords, SessionRecords
from golem.store.routine_runs import RoutineRuns
from golem_protocol.events import (
    AgentSnapshot,
    ChatEvent,
    EmptyEventData,
    HelperWaitData,
    HelperWaitEvent,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageStartedData,
    MessageStartedEvent,
    RunCompletedEvent,
    RunFailedData,
    RunFailedEvent,
    RunStartedEvent,
    SessionClosedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
    SessionParent,
)

_S = "s_a"
_R = "r_1"
_M = "m_reply"


def _ts(seq: int) -> str:
    return f"2026-10-14T10:00:{seq:02d}+00:00"


def _created(seq: int = 1) -> SessionCreatedEvent:
    return SessionCreatedEvent(
        seq=seq,
        session_id=_S,
        run_id=None,
        ts=_ts(seq),
        type="session.created",
        data=SessionCreatedData(model_profile="remote"),
    )


def _started(seq: int) -> RunStartedEvent:
    return RunStartedEvent(
        seq=seq, session_id=_S, run_id=_R, ts=_ts(seq), type="run.started", data=EmptyEventData()
    )


def _message_started(seq: int) -> MessageStartedEvent:
    return MessageStartedEvent(
        seq=seq,
        session_id=_S,
        run_id=_R,
        ts=_ts(seq),
        type="message.started",
        data=MessageStartedData(message_id=_M, role="assistant"),
    )


def _delta(seq: int, text: str) -> MessageDeltaEvent:
    return MessageDeltaEvent(
        seq=seq,
        session_id=_S,
        run_id=_R,
        ts=_ts(seq),
        type="message.delta",
        data=MessageDeltaData(message_id=_M, text=text),
    )


def _completed(seq: int, text: str) -> MessageCompletedEvent:
    return MessageCompletedEvent(
        seq=seq,
        session_id=_S,
        run_id=_R,
        ts=_ts(seq),
        type="message.completed",
        data=MessageCompletedData(message_id=_M, role="assistant", text=text),
    )


async def _append(log: EventLog, events: list[ChatEvent]) -> None:
    for event in events:
        await log.append(event)


async def test_migrations_apply_once(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    async with Database.open(path) as database:
        assert await database.user_version() == len(MIGRATIONS)
        await EventLog(database).append(_created())
    async with Database.open(path) as database:
        assert await database.user_version() == len(MIGRATIONS)
        assert await EventLog(database).last_seq(_S) == 1


async def test_a_newer_schema_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    with sqlite3.connect(path) as raw:
        raw.execute(f"PRAGMA user_version = {len(MIGRATIONS) + 1}")
    with pytest.raises(DatabaseTooNewError):
        async with Database.open(path):
            pass


async def test_events_read_back_in_order_after_a_seq(database: Database) -> None:
    log = EventLog(database)
    events: list[ChatEvent] = [_created(), _started(2), _message_started(3)]
    await _append(log, events)
    assert await log.after(_S) == events
    assert await log.after(_S, 1) == events[1:]
    assert await log.after(_S, 3) == []
    assert await log.last_seq(_S) == 3
    assert await log.last_seq("s_other") == 0


async def test_completed_message_deletes_its_deltas(database: Database) -> None:
    log = EventLog(database)
    await _append(
        log, [_created(), _started(2), _message_started(3), _delta(4, "He"), _delta(5, "y")]
    )
    assert [event.seq for event in await log.for_run(_R)] == [2, 3, 4, 5]
    await log.append(_completed(6, "Hey"))
    assert [event.seq for event in await log.after(_S)] == [1, 2, 3, 6]
    assert await log.last_seq(_S) == 6


async def test_an_event_needs_its_session(database: Database) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        await EventLog(database).append(_started(1))
    assert await EventLog(database).last_seq(_S) == 0


async def test_sessions_and_runs_follow_the_log(database: Database) -> None:
    log = EventLog(database)
    sessions = SessionRecords(database)
    runs = RunRecords(database)
    await _append(log, [_created(), _started(2)])
    session = await sessions.get(_S)
    assert session is not None
    assert session.model_profile == "remote"
    assert session.updated_at == _ts(2)
    assert [run.run_id for run in await runs.running()] == [_R]

    await log.append(_delta(3, "x"))
    session = await sessions.get(_S)
    assert session is not None
    assert session.updated_at == _ts(2)

    await log.append(
        RunCompletedEvent(
            seq=4, session_id=_S, run_id=_R, ts=_ts(4), type="run.completed", data=EmptyEventData()
        )
    )
    run = await runs.get(_R)
    assert run is not None
    assert (run.status, run.ended_at, run.error) == ("completed", _ts(4), None)
    assert await runs.running() == []


async def test_closing_hides_the_session_and_keeps_its_events(database: Database) -> None:
    log = EventLog(database)
    sessions = SessionRecords(database)
    await log.append(_created())
    await log.append(
        SessionClosedEvent(
            seq=2,
            session_id=_S,
            run_id=None,
            ts=_ts(2),
            type="session.closed",
            data=EmptyEventData(),
        )
    )
    assert await sessions.recent(10) == []
    stored = await sessions.get(_S)
    assert stored is not None
    assert stored.closed_at == _ts(2)
    assert [event.type for event in await log.after(_S)] == ["session.created", "session.closed"]


async def test_a_failed_run_keeps_its_reason(database: Database) -> None:
    log = EventLog(database)
    await _append(log, [_created(), _started(2)])
    await log.append(
        RunFailedEvent(
            seq=3,
            session_id=_S,
            run_id=_R,
            ts=_ts(3),
            type="run.failed",
            data=RunFailedData(message="boom"),
        )
    )
    run = await RunRecords(database).get(_R)
    assert run is not None
    assert (run.status, run.error) == ("failed", "boom")


def _helper_created(seq: int, session_id: str = "s_helper") -> SessionCreatedEvent:
    return SessionCreatedEvent(
        seq=seq,
        session_id=session_id,
        run_id=None,
        ts=_ts(seq),
        type="session.created",
        data=SessionCreatedData(
            model_profile="remote",
            origin="agent:explorer",
            parent=SessionParent(session_id=_S, call_id="c_1", index=2),
            agent=AgentSnapshot(name="explorer", source="bundled", wish="cheapest"),
        ),
    )


def _wait(seq: int, state: Literal["parked", "resumed"]) -> HelperWaitEvent:
    return HelperWaitEvent(
        seq=seq,
        session_id=_S,
        run_id=_R,
        ts=_ts(seq),
        type="helper.wait",
        data=HelperWaitData(call_id="c_1", state=state, helper_ids=["s_helper"]),
    )


async def _columns(database: Database, session_id: str) -> tuple[object, ...]:
    row = await database.fetch_one(
        "SELECT parent_session_id, root_session_id, parent_call_id, helper_index, agent"
        " FROM sessions WHERE session_id = ?",
        (session_id,),
    )
    assert row is not None
    return tuple(row)


async def test_a_database_from_the_previous_schema_gains_the_helper_columns(
    tmp_path: Path,
) -> None:
    path = tmp_path / "golem.db"
    previous = len(MIGRATIONS) - 1
    with sqlite3.connect(path) as raw:
        for statements in MIGRATIONS[:previous]:
            for statement in statements:
                raw.execute(statement)
        raw.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
            " VALUES ('s_old', 'remote', 't', 't')"
        )
        raw.execute(f"PRAGMA user_version = {previous}")
    async with Database.open(path) as database:
        assert await database.user_version() == len(MIGRATIONS)
        assert await _columns(database, "s_old") == (None, None, None, None, None)
        run_columns = await database.fetch_all("PRAGMA table_info(runs)")
        assert "wait_reason" in [row["name"] for row in run_columns]
        sessions = SessionRecords(database)
        assert [a.session.session_id for a in await sessions.recent(10)] == ["s_old"]


async def test_a_helper_session_fills_the_columns_and_stays_out_of_the_lists(
    database: Database,
) -> None:
    log = EventLog(database)
    await _append(log, [_created(), _started(2), _helper_created(3)])
    assert await _columns(database, "s_helper") == (_S, _S, "c_1", 2, "explorer")
    assert await _columns(database, _S) == (None, None, None, None, None)
    sessions = SessionRecords(database)
    assert [a.session.session_id for a in await sessions.recent(10)] == [_S]
    assert [run.session_id for run in await RoutineRuns(database).headless(10)] == []


async def test_a_second_helper_for_the_same_call_and_index_is_refused(database: Database) -> None:
    log = EventLog(database)
    await _append(log, [_created(), _helper_created(2)])
    with pytest.raises(sqlite3.IntegrityError):
        await log.append(_helper_created(3, "s_other"))


async def test_the_lead_parks_for_its_team_and_goes_on(database: Database) -> None:
    log = EventLog(database)
    runs = RunRecords(database)
    await _append(log, [_created(), _started(2), _wait(3, "parked")])
    run = await runs.get(_R)
    assert run is not None and run.status == "waiting"
    reason = await database.fetch_one("SELECT wait_reason FROM runs WHERE run_id = ?", (_R,))
    assert reason is not None and reason[0] == "team"
    await log.append(_wait(4, "resumed"))
    run = await runs.get(_R)
    assert run is not None and run.status == "running"
    reason = await database.fetch_one("SELECT wait_reason FROM runs WHERE run_id = ?", (_R,))
    assert reason is not None and reason[0] is None


async def test_a_cancel_during_begin_leaves_no_transaction_open(database: Database) -> None:
    # BEGIN runs on the connection's thread, so a cancelled caller cannot stop it. Left
    # open, it made every later transaction fail with "cannot start a transaction within
    # a transaction".
    async def write() -> None:
        async with database.transaction():
            await asyncio.sleep(0)

    for _ in range(50):
        task = asyncio.create_task(write())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        async with database.transaction():
            pass


async def test_the_migration_removes_empty_workflow_sessions_only(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    async with Database.open(path, MIGRATIONS[:31]):  # up to migration 31; 32 is under test
        pass
    with sqlite3.connect(path) as raw:
        for sid, origin in (
            ("s_empty", "workflow:a"),
            ("s_chat", "workflow:b"),
            ("s_lead", "workflow:c"),
            ("s_user", None),
        ):
            raw.execute(
                "INSERT INTO sessions (session_id, model_profile, created_at, updated_at, origin)"
                " VALUES (?, 'm', 't', 't', ?)",
                (sid, origin),
            )
            raw.execute(
                "INSERT INTO events (session_id, seq, ts, type, data) VALUES (?, 1, 't',"
                " 'session.created', '{}')",
                (sid,),
            )
        raw.execute(
            "INSERT INTO events (session_id, seq, ts, type, data) VALUES"
            " ('s_chat', 2, 't', 'message.completed', '{}')"
        )
        raw.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at, origin,"
            " parent_session_id) VALUES ('s_child', 'm', 't', 't', 'agent:x', 's_lead')"
        )
        for run, sid in (("wr_1", "s_empty"), ("wr_2", "s_chat"), ("wr_3", "s_lead")):
            raw.execute(
                "INSERT INTO workflow_runs (workflow_run_id, workflow_id, name, path, session_id,"
                " created_at) VALUES (?, 'w', 'a', 'p', ?, 't')",
                (run, sid),
            )
    async with Database.open(path) as database:
        assert await database.user_version() == len(MIGRATIONS)
        sessions = await database.fetch_all("SELECT session_id FROM sessions ORDER BY 1")
        assert [row["session_id"] for row in sessions] == ["s_chat", "s_child", "s_lead", "s_user"]
        events = await database.fetch_all("SELECT DISTINCT session_id FROM events ORDER BY 1")
        assert [row["session_id"] for row in events] == ["s_chat", "s_lead", "s_user"]
        runs = await database.fetch_all(
            "SELECT workflow_run_id, session_id FROM workflow_runs ORDER BY 1"
        )
        assert [(row[0], row[1]) for row in runs] == [
            ("wr_1", None),
            ("wr_2", "s_chat"),
            ("wr_3", "s_lead"),
        ]
