"""Keep ``sessions`` and ``runs`` in step with the event log.

Both tables are projections. They are written in the same transaction as the
event they follow, before the event row, so foreign keys hold.
"""

from __future__ import annotations

from golem.store.database import Transaction
from golem_protocol.events import (
    ChatEvent,
    MessageDeltaEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
    SessionCreatedEvent,
    SessionUpdatedEvent,
)


async def project(tx: Transaction, event: ChatEvent) -> None:
    """Apply ``event`` to the projected tables."""
    if isinstance(event, SessionCreatedEvent):
        parent = event.data.forked_from
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at,"
            " forked_from_session_id, forked_from_message_id) VALUES (?, ?, ?, ?, ?, ?)",
            (
                event.session_id,
                event.data.model_profile,
                event.ts,
                event.ts,
                None if parent is None else parent.session_id,
                None if parent is None else parent.message_id,
            ),
        )
        return
    if isinstance(event, SessionUpdatedEvent):
        await tx.execute(
            "UPDATE sessions SET title = ? WHERE session_id = ?",
            (event.data.title, event.session_id),
        )
    elif isinstance(event, RunStartedEvent):
        await tx.execute(
            "INSERT INTO runs (run_id, session_id, status, started_at) VALUES (?, ?, 'running', ?)",
            (event.run_id, event.session_id, event.ts),
        )
    elif isinstance(event, RunCompletedEvent):
        await _finish_run(tx, event.run_id, "completed", event.ts, None)
    elif isinstance(event, RunFailedEvent):
        await _finish_run(tx, event.run_id, "failed", event.ts, event.data.message)
    elif isinstance(event, RunCancelledEvent):
        await _finish_run(tx, event.run_id, "cancelled", event.ts, None)
    if not isinstance(event, MessageDeltaEvent):
        await tx.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (event.ts, event.session_id),
        )


async def _finish_run(
    tx: Transaction,
    run_id: str,
    status: str,
    ts: str,
    error: str | None,
) -> None:
    await tx.execute(
        "UPDATE runs SET status = ?, ended_at = ?, error = ? WHERE run_id = ?",
        (status, ts, error, run_id),
    )


__all__ = ["project"]
