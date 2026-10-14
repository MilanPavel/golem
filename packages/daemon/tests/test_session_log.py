"""``SessionLog`` numbering, payload checks, and a sink that went away."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from golem.sessions.log import SessionLog
from golem_protocol.events import (
    ChatEvent,
    EmptyEventData,
    MessageDeltaData,
    MessageDeltaEvent,
    RunStartedEvent,
)


class _Collect:
    def __init__(self) -> None:
        self.events: list[ChatEvent] = []

    async def __call__(self, event: ChatEvent) -> None:
        self.events.append(event)


async def test_seq_counts_per_session() -> None:
    sink = _Collect()
    log = SessionLog()
    await log.emit(sink, "s_a", "r_1", "run.started", EmptyEventData())
    await log.emit(sink, "s_b", "r_2", "run.started", EmptyEventData())
    await log.emit(sink, "s_a", "r_1", "run.completed", EmptyEventData())
    assert [(event.session_id, event.seq) for event in sink.events] == [
        ("s_a", 1),
        ("s_b", 1),
        ("s_a", 2),
    ]


async def test_emit_builds_the_typed_event() -> None:
    sink = _Collect()
    event = await SessionLog().emit(
        sink,
        "s_a",
        "r_1",
        "message.delta",
        MessageDeltaData(message_id="m_1", text="Hel"),
    )
    assert isinstance(event, MessageDeltaEvent)
    assert event.data.text == "Hel"
    assert sink.events == [event]


async def test_wrong_payload_is_rejected_and_does_not_use_a_seq() -> None:
    sink = _Collect()
    log = SessionLog()
    with pytest.raises(ValidationError):
        await log.emit(sink, "s_a", "r_1", "message.delta", EmptyEventData())
    event = await log.emit(sink, "s_a", "r_1", "run.started", EmptyEventData())
    assert isinstance(event, RunStartedEvent)
    assert event.seq == 1


async def test_a_sink_that_went_away_is_not_an_error() -> None:
    async def gone(event: ChatEvent) -> None:
        del event
        raise ConnectionResetError

    log = SessionLog()
    await log.emit(gone, "s_a", "r_1", "run.started", EmptyEventData())
    sink = _Collect()
    await log.emit(sink, "s_a", "r_1", "run.completed", EmptyEventData())
    assert sink.events[0].seq == 2
