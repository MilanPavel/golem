"""``SessionLog`` numbering, payload checks, persistence, attach, and publish."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from golem.sessions.bus import EventBus
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

    def deliver(self, event: ChatEvent) -> None:
        self.events.append(event)

    @property
    def seqs(self) -> list[int]:
        return [event.seq for event in self.events]


def _log(events: EventLog) -> SessionLog:
    return SessionLog(events, EventBus())


async def _session(log: SessionLog, session_id: str) -> None:
    await log.emit(session_id, None, "session.created", SessionCreatedData(model_profile="remote"))


async def test_seq_counts_per_session(database: Database) -> None:
    log = _log(EventLog(database))
    await _session(log, "s_a")
    await _session(log, "s_b")
    a = await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    b = await log.emit("s_b", "r_2", "run.started", EmptyEventData())
    c = await log.emit("s_a", "r_1", "run.completed", EmptyEventData())
    assert [(a.session_id, a.seq), (b.session_id, b.seq), (c.session_id, c.seq)] == [
        ("s_a", 2),
        ("s_b", 2),
        ("s_a", 3),
    ]


async def test_emit_builds_and_stores_the_typed_event(database: Database) -> None:
    events = EventLog(database)
    log = _log(events)
    await _session(log, "s_a")
    event = await log.emit(
        "s_a", "r_1", "message.delta", MessageDeltaData(message_id="m_1", text="Hel")
    )
    assert isinstance(event, MessageDeltaEvent)
    assert event.data.text == "Hel"
    assert (await events.after("s_a", 1)) == [event]


async def test_seq_continues_from_the_log(database: Database) -> None:
    events = EventLog(database)
    await _session(_log(events), "s_a")
    event = await _log(events).emit("s_a", "r_1", "run.started", EmptyEventData())
    assert event.seq == 2


async def test_wrong_payload_is_rejected_and_does_not_use_a_seq(database: Database) -> None:
    log = _log(EventLog(database))
    await _session(log, "s_a")
    with pytest.raises(ValidationError):
        await log.emit("s_a", "r_1", "message.delta", EmptyEventData())
    event = await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    assert isinstance(event, RunStartedEvent)
    assert event.seq == 2


async def test_attach_replays_then_streams(database: Database) -> None:
    log = _log(EventLog(database))
    await _session(log, "s_a")
    await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    target = _Collect()
    assert await log.attach("s_a", 0, target) == 2
    await log.emit("s_a", "r_1", "run.completed", EmptyEventData())
    assert target.seqs == [1, 2, 3]


async def test_attach_after_seq_skips_what_the_client_has(database: Database) -> None:
    log = _log(EventLog(database))
    await _session(log, "s_a")
    await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    target = _Collect()
    assert await log.attach("s_a", 1, target) == 2
    assert target.seqs == [2]


async def test_only_attached_targets_get_a_session(database: Database) -> None:
    log = _log(EventLog(database))
    a, b = _Collect(), _Collect()
    await log.attach("s_a", 0, a)
    await log.attach("s_b", 0, b)
    await _session(log, "s_a")
    assert (a.seqs, b.seqs) == ([1], [])


async def test_detach_stops_live_events(database: Database) -> None:
    log = _log(EventLog(database))
    target = _Collect()
    await log.attach("s_a", 0, target)
    await _session(log, "s_a")
    log.detach("s_a", target)
    await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    assert target.seqs == [1]


async def test_a_target_that_went_away_is_dropped(database: Database) -> None:
    class Gone:
        calls = 0

        def deliver(self, event: ChatEvent) -> None:
            del event
            self.calls += 1
            raise ConnectionResetError

    log = _log(EventLog(database))
    gone, alive = Gone(), _Collect()
    await log.attach("s_a", 0, gone)
    await log.attach("s_a", 0, alive)
    await _session(log, "s_a")
    await log.emit("s_a", "r_1", "run.started", EmptyEventData())
    assert gone.calls == 1
    assert alive.seqs == [1, 2]
