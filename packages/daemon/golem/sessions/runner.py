"""One chat turn: stream the graph and emit the run's events.

A turn may hold several model calls, with tool calls between them. Each
model call is its own assistant message. Each tool call is
``tool.requested``, ``tool.started``, then ``tool.completed`` or
``tool.failed``.

A cancelled turn still ends in the log. The open reply completes with the
text streamed so far, marked interrupted, each tool call still open fails,
and ``run.cancelled`` follows.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from golem.graphs.adapter import (
    ModelStarted,
    TextCompleted,
    TextDelta,
    ToolErrored,
    ToolFinished,
    ToolStarted,
    translate,
)
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
    ToolCompletedData,
    ToolFailedData,
    ToolRequestedData,
    ToolStartedData,
)

log = logging.getLogger("golem.sessions")

CancelReason = Literal["user", "shutdown"]

CANCELLED_TOOL = "cancelled before it finished"


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
    cwd: str | None = None


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
    """``open`` is the assistant message streaming now, ``parts`` its text so far.

    ``reply`` is the text of the newest finished one. ``calls`` are tool
    calls requested and not yet finished.
    """

    run_started: bool = False
    open: str | None = None
    reply: str | None = None
    parts: list[str] = field(default_factory=list[str])
    calls: list[str] = field(default_factory=list[str])


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
        progress.open = turn.assistant_message_id
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
            cwd=turn.cwd,
        )
        async with aclosing(stream):
            async for part in stream:
                await _apply(translate(part), progress, emit)
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


async def _apply(
    fact: object,
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> None:
    if isinstance(fact, ModelStarted):
        if fact.message_id == progress.open:
            return
        progress.open = fact.message_id
        progress.parts = []
        await emit(
            "message.started", MessageStartedData(message_id=fact.message_id, role="assistant")
        )
    elif isinstance(fact, TextDelta) and progress.open is not None:
        progress.parts.append(fact.text)
        await emit("message.delta", MessageDeltaData(message_id=progress.open, text=fact.text))
    elif isinstance(fact, TextCompleted):
        message_id = fact.message_id or progress.open
        if message_id is None:
            return
        progress.reply = fact.text
        progress.open = None
        await emit(
            "message.completed",
            MessageCompletedData(message_id=message_id, role="assistant", text=fact.text),
        )
        for call in fact.calls:
            progress.calls.append(call.call_id)
            await emit(
                "tool.requested",
                ToolRequestedData(
                    call_id=call.call_id, message_id=message_id, name=call.name, args=call.args
                ),
            )
    elif isinstance(fact, ToolStarted):
        await emit("tool.started", ToolStartedData(call_id=fact.call_id))
    elif isinstance(fact, ToolFinished):
        _done(progress, fact.call_id)
        await emit(
            "tool.completed",
            ToolCompletedData(
                call_id=fact.call_id,
                summary=fact.summary,
                preview=fact.preview,
                truncated=fact.truncated,
            ),
        )
    elif isinstance(fact, ToolErrored):
        _done(progress, fact.call_id)
        await emit("tool.failed", ToolFailedData(call_id=fact.call_id, message=fact.message))


def _done(progress: _Progress, call_id: str) -> None:
    if call_id in progress.calls:
        progress.calls.remove(call_id)


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
        for call_id in progress.calls:
            await events.emit(
                turn.session_id,
                turn.run_id,
                "tool.failed",
                ToolFailedData(call_id=call_id, message=CANCELLED_TOOL),
            )
        if progress.open is not None:
            await close_reply(
                runtime,
                events,
                session_id=turn.session_id,
                run_id=turn.run_id,
                user_message_id=turn.user_message_id,
                assistant_message_id=progress.open,
                partial="".join(progress.parts),
            )
        await events.emit(
            turn.session_id, turn.run_id, "run.cancelled", RunCancelledData(reason=reason)
        )
    except Exception:
        log.exception("could not record the end of cancelled run %s", turn.run_id)


__all__ = ["CancelReason", "RunControl", "Turn", "run_turn"]
