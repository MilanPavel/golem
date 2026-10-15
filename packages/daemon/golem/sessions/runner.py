"""One chat turn: stream the graph and emit the run's events.

A cancelled turn still ends in the log. The open reply completes with the
text streamed so far, marked interrupted, and ``run.cancelled`` follows.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from golem.graphs.adapter import TextCompleted, TextDelta, translate
from golem.graphs.chat import ChatRuntime
from golem.sessions.interrupted import close_reply
from golem.sessions.log import SessionLog
from golem_protocol.events import (
    EmptyEventData,
    EventType,
    MessageCompletedData,
    MessageDeltaData,
    MessageStartedData,
    RunCancelledData,
    RunFailedData,
)

log = logging.getLogger("golem.sessions")

CancelReason = Literal["user", "shutdown"]


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


@dataclass
class RunControl:
    """Shared by a run task and whoever may stop it.

    ``started`` is set once the task is inside its cancel handler. Cancel only
    after that, or the turn ends without ``run.cancelled``.
    """

    started: asyncio.Event = field(default_factory=asyncio.Event)
    reason: CancelReason | None = None


@dataclass
class _Progress:
    run_started: bool = False
    reply_opened: bool = False
    reply: str | None = None
    parts: list[str] = field(default_factory=list[str])


async def run_turn(
    runtime: ChatRuntime, events: SessionLog, turn: Turn, control: RunControl
) -> str | None:
    """Run ``turn`` to the end. A failure becomes ``run.failed``, not an exception.

    Returns the reply when the run completed, and None when it failed.
    Cancellation is re-raised after ``run.cancelled`` is in the log.
    """
    progress = _Progress()

    async def emit(kind: EventType, data: BaseModel) -> None:
        await events.emit(turn.session_id, turn.run_id, kind, data)

    try:
        control.started.set()
        await emit(
            "message.completed",
            MessageCompletedData(message_id=turn.user_message_id, role="user", text=turn.text),
        )
        # Emits are shielded: once one is awaited, it lands even if this task is cancelled.
        progress.run_started = True
        await emit("run.started", EmptyEventData())
        progress.reply_opened = True
        await emit(
            "message.started",
            MessageStartedData(message_id=turn.assistant_message_id, role="assistant"),
        )
        stream = runtime.stream(
            session_id=turn.session_id,
            text=turn.text,
            model_profile=turn.model_profile,
            schema_version=turn.schema_version,
            user_message_id=turn.user_message_id,
            assistant_message_id=turn.assistant_message_id,
        )
        async with aclosing(stream):
            async for part in stream:
                fact = translate(part)
                if isinstance(fact, TextDelta):
                    progress.parts.append(fact.text)
                    await emit(
                        "message.delta",
                        MessageDeltaData(message_id=turn.assistant_message_id, text=fact.text),
                    )
                elif isinstance(fact, TextCompleted):
                    progress.reply = fact.text
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
        await _stopped(runtime, events, turn, progress, control.reason or "shutdown")
        raise
    except Exception as exc:
        log.exception("run %s failed", turn.run_id)
        message = str(exc).strip() or type(exc).__name__
        await emit("run.failed", RunFailedData(message=message))
        return None
    return "".join(progress.parts) if progress.reply is None else progress.reply


async def _stopped(
    runtime: ChatRuntime,
    events: SessionLog,
    turn: Turn,
    progress: _Progress,
    reason: CancelReason,
) -> None:
    log.info("run %s cancelled (%s)", turn.run_id, reason)
    try:
        if not progress.run_started:
            await events.emit(turn.session_id, turn.run_id, "run.started", EmptyEventData())
        if progress.reply_opened and progress.reply is None:
            await close_reply(
                runtime,
                events,
                session_id=turn.session_id,
                run_id=turn.run_id,
                user_message_id=turn.user_message_id,
                assistant_message_id=turn.assistant_message_id,
                partial="".join(progress.parts),
            )
        await events.emit(
            turn.session_id, turn.run_id, "run.cancelled", RunCancelledData(reason=reason)
        )
    except Exception:
        log.exception("could not record the end of cancelled run %s", turn.run_id)


__all__ = ["CancelReason", "RunControl", "Turn", "run_turn"]
