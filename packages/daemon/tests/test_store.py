"""``golem.db``: migrations, the event log, and the projected tables."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from golem.store.database import Database, DatabaseTooNewError
from golem.store.events import EventLog
from golem.store.migrations import MIGRATIONS
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    EmptyEventData,
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
    SessionCreatedData,
    SessionCreatedEvent,
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
