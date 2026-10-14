"""``SessionLog`` numbering, payload checks, persistence, and a sink that went away."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from golem.sessions.log import SessionLog
from golem.store.database import Database
from golem.store.events import EventLog
from golem_protocol.events import (
    ChatEvent,
    EmptyEventData,
    MessageDeltaData,
    MessageDeltaEvent,
    RunStartedEvent,
    SessionCreatedData,
)


class _Collect:
    def __init__(self) -> None:
        self.events: list[ChatEvent] = []

    async def __call__(self, event: ChatEvent) -> None:
        self.events.append(event)


async def _session(log: SessionLog, session_id: str) -> None:
    await log.emit(
        _Collect(),
        session_id,
        None,
        "session.created",
        SessionCreatedData(model_profile="remote"),
    )


async def test_seq_counts_per_session(database: Database) -> None:
    sink = _Collect()
    log = SessionLog(EventLog(database))
    await _session(log, "s_a")
    await _session(log, "s_b")
    await log.emit(sink, "s_a", "r_1", "run.started", EmptyEventData())
    await log.emit(sink, "s_b", "r_2", "run.started", EmptyEventData())
    await log.emit(sink, "s_a", "r_1", "run.completed", EmptyEventData())
    assert [(event.session_id, event.seq) for event in sink.events] == [
        ("s_a", 2),
        ("s_b", 2),
        ("s_a", 3),
    ]


async def test_emit_builds_and_stores_the_typed_event(database: Database) -> None:
    sink = _Collect()
    events = EventLog(database)
    log = SessionLog(events)
    await _session(log, "s_a")
    event = await log.emit(
        sink,
        "s_a",
        "r_1",
        "message.delta",
        MessageDeltaData(message_id="m_1", text="Hel"),
    )
    assert isinstance(event, MessageDeltaEvent)
    assert event.data.text == "Hel"
    assert sink.events == [event]
    assert (await events.after("s_a", 1)) == [event]


async def test_seq_continues_from_the_log(database: Database) -> None:
    events = EventLog(database)
    await _session(SessionLog(events), "s_a")
    reopened = SessionLog(events)
    event = await reopened.emit(_Collect(), "s_a", "r_1", "run.started", EmptyEventData())
    assert event.seq == 2


async def test_wrong_payload_is_rejected_and_does_not_use_a_seq(database: Database) -> None:
    sink = _Collect()
    log = SessionLog(EventLog(database))
    await _session(log, "s_a")
    with pytest.raises(ValidationError):
        await log.emit(sink, "s_a", "r_1", "message.delta", EmptyEventData())
    event = await log.emit(sink, "s_a", "r_1", "run.started", EmptyEventData())
    assert isinstance(event, RunStartedEvent)
    assert event.seq == 2


async def test_a_sink_that_went_away_is_not_an_error(database: Database) -> None:
    async def gone(event: ChatEvent) -> None:
        del event
        raise ConnectionResetError

    log = SessionLog(EventLog(database))
    await _session(log, "s_a")
    await log.emit(gone, "s_a", "r_1", "run.started", EmptyEventData())
    sink = _Collect()
    await log.emit(sink, "s_a", "r_1", "run.completed", EmptyEventData())
    assert sink.events[0].seq == 3
