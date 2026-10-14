"""One chat turn: stream the graph and emit the run's events."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from pydantic import BaseModel

from golem.graphs.adapter import TextCompleted, TextDelta, translate
from golem.graphs.chat import ChatRuntime
from golem.sessions.log import EventSink, SessionLog
from golem_protocol.events import (
    EmptyEventData,
    EventType,
    MessageCompletedData,
    MessageDeltaData,
    MessageStartedData,
    RunFailedData,
)

log = logging.getLogger("golem.sessions")


@dataclass(frozen=True, slots=True)
class Turn:
    """What one ``message.send`` asked for, with the ids already chosen."""

    session_id: str
    run_id: str
    text: str
    model_profile: str
    schema_version: int
    user_message_id: str
    assistant_message_id: str


async def run_turn(runtime: ChatRuntime, events: SessionLog, turn: Turn, sink: EventSink) -> None:
    """Run ``turn`` to the end. A failure becomes ``run.failed``, not an exception."""

    async def emit(kind: EventType, data: BaseModel) -> None:
        await events.emit(sink, turn.session_id, turn.run_id, kind, data)

    try:
        await emit(
            "message.completed",
            MessageCompletedData(message_id=turn.user_message_id, role="user", text=turn.text),
        )
        await emit("run.started", EmptyEventData())
        await emit(
            "message.started",
            MessageStartedData(message_id=turn.assistant_message_id, role="assistant"),
        )
        async for part in runtime.stream(
            session_id=turn.session_id,
            text=turn.text,
            model_profile=turn.model_profile,
            schema_version=turn.schema_version,
        ):
            fact = translate(part)
            if isinstance(fact, TextDelta):
                await emit(
                    "message.delta",
                    MessageDeltaData(message_id=turn.assistant_message_id, text=fact.text),
                )
            elif isinstance(fact, TextCompleted):
                await emit(
                    "message.completed",
                    MessageCompletedData(
                        message_id=turn.assistant_message_id,
                        role="assistant",
                        text=fact.text,
                    ),
                )
        await emit("run.completed", EmptyEventData())
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.exception("run %s failed", turn.run_id)
        message = str(exc).strip() or type(exc).__name__
        await emit("run.failed", RunFailedData(message=message))


__all__ = ["Turn", "run_turn"]
