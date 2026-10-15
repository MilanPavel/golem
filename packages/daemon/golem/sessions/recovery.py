"""Close the runs a stopped daemon left open.

A run still ``running`` at startup lost its task. Its log gets the end it
never wrote: the open assistant message completes, then ``run.failed``. The
partial reply also goes into the checkpoint, so the model sees what the user
saw.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from golem.graphs.chat import ChatRuntime
from golem.sessions.interrupted import close_reply
from golem.sessions.log import SessionLog
from golem.store.events import EventLog
from golem.store.records import RunRecord, RunRecords
from golem_protocol.events import (
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    MessageStartedEvent,
    RunFailedData,
)

log = logging.getLogger("golem.sessions")

STOPPED_MESSAGE = "the daemon stopped during this run"


@dataclass(frozen=True, slots=True)
class OpenTurn:
    """What one unfinished run's events say about its messages."""

    user_message_id: str | None
    assistant_message_id: str | None
    partial: str


def open_turn(events: list[ChatEvent]) -> OpenTurn:
    """Find the user message and the assistant message that never completed."""
    user: str | None = None
    started: str | None = None
    completed: set[str] = set()
    parts: dict[str, list[str]] = {}
    for event in events:
        if isinstance(event, MessageCompletedEvent):
            if event.data.role == "user":
                user = event.data.message_id
            completed.add(event.data.message_id)
        elif isinstance(event, MessageStartedEvent):
            started = event.data.message_id
        elif isinstance(event, MessageDeltaEvent):
            parts.setdefault(event.data.message_id, []).append(event.data.text)
    if started is None or started in completed:
        return OpenTurn(user_message_id=user, assistant_message_id=None, partial="")
    return OpenTurn(
        user_message_id=user,
        assistant_message_id=started,
        partial="".join(parts.get(started, [])),
    )


async def recover_runs(
    runs: RunRecords,
    events: EventLog,
    session_log: SessionLog,
    runtime: ChatRuntime,
) -> list[str]:
    """Close every open run. Returns the ids closed.

    A run that fails to close is logged and stays open for the next start.
    """
    closed: list[str] = []
    for run in await runs.running():
        try:
            await _close(run, events, session_log, runtime)
        except Exception:
            log.exception("could not close run %s", run.run_id)
            continue
        closed.append(run.run_id)
    if closed:
        log.info("closed %d run(s) left open by a stopped daemon", len(closed))
    return closed


async def _close(
    run: RunRecord,
    events: EventLog,
    session_log: SessionLog,
    runtime: ChatRuntime,
) -> None:
    turn = open_turn(await events.for_run(run.run_id))
    if turn.assistant_message_id is not None:
        await close_reply(
            runtime,
            session_log,
            session_id=run.session_id,
            run_id=run.run_id,
            user_message_id=turn.user_message_id,
            assistant_message_id=turn.assistant_message_id,
            partial=turn.partial,
        )
    await session_log.emit(
        run.session_id,
        run.run_id,
        "run.failed",
        RunFailedData(message=STOPPED_MESSAGE),
    )


__all__ = ["STOPPED_MESSAGE", "OpenTurn", "open_turn", "recover_runs"]
