"""Keep ``sessions`` and ``runs`` in step with the event log.

Both tables are projections. They are written in the same transaction as the
event they follow, before the event row, so foreign keys hold.
"""

from __future__ import annotations

from golem.store.database import Transaction
from golem.store.records import decode_allowances, encode_allowances
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    MessageDeltaEvent,
    ModelSelectedEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
    SessionClosedEvent,
    SessionCreatedEvent,
    SessionUpdatedEvent,
    ToolOutputEvent,
)


async def project(tx: Transaction, event: ChatEvent) -> None:
    """Apply ``event`` to the projected tables."""
    if isinstance(event, SessionCreatedEvent):
        parent = event.data.forked_from
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at,"
            " forked_from_session_id, forked_from_message_id, cwd) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event.session_id,
                event.data.model_profile,
                event.ts,
                event.ts,
                None if parent is None else parent.session_id,
                None if parent is None else parent.message_id,
                event.data.cwd,
            ),
        )
        return
    if isinstance(event, SessionUpdatedEvent):
        if event.data.title is not None:
            await tx.execute(
                "UPDATE sessions SET title = ? WHERE session_id = ?",
                (event.data.title, event.session_id),
            )
        if event.data.cwd is not None:
            await tx.execute(
                "UPDATE sessions SET cwd = ? WHERE session_id = ?",
                (event.data.cwd, event.session_id),
            )
        if event.data.allowed_tools is not None:
            pairs = [(item.tool, item.subject) for item in event.data.allowed_tools]
            await tx.execute(
                "UPDATE sessions SET allowed_tools = ? WHERE session_id = ?",
                (encode_allowances(pairs), event.session_id),
            )
    elif isinstance(event, ModelSelectedEvent):
        await tx.execute(
            "UPDATE sessions SET model_profile = ? WHERE session_id = ?",
            (event.data.model_profile, event.session_id),
        )
    elif isinstance(event, SessionClosedEvent):
        await tx.execute(
            "UPDATE sessions SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL",
            (event.ts, event.session_id),
        )
    elif isinstance(event, RunStartedEvent):
        await tx.execute(
            "INSERT INTO runs (run_id, session_id, status, started_at) VALUES (?, ?, 'running', ?)",
            (event.run_id, event.session_id, event.ts),
        )
    elif isinstance(event, ApprovalNeededEvent):
        await tx.execute(
            "UPDATE runs SET status = 'waiting' WHERE run_id = ? AND status = 'running'",
            (event.run_id,),
        )
    elif isinstance(event, ApprovalResolvedEvent):
        await tx.execute(
            "UPDATE runs SET status = 'running' WHERE run_id = ? AND status = 'waiting'",
            (event.run_id,),
        )
        if event.data.decision == "allow_session":
            await _allow_tool(tx, event.session_id, event.data.name, event.data.subject)
    elif isinstance(event, RunCompletedEvent):
        await _finish_run(tx, event.run_id, "completed", event.ts, None)
    elif isinstance(event, RunFailedEvent):
        await _finish_run(tx, event.run_id, "failed", event.ts, event.data.message)
    elif isinstance(event, RunCancelledEvent):
        await _finish_run(tx, event.run_id, "cancelled", event.ts, None)
    if not isinstance(event, MessageDeltaEvent | ToolOutputEvent):
        await tx.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (event.ts, event.session_id),
        )


async def _allow_tool(tx: Transaction, session_id: str, name: str, subject: str | None) -> None:
    rows = await tx.fetch_all(
        "SELECT allowed_tools FROM sessions WHERE session_id = ?", (session_id,)
    )
    allowed = decode_allowances(rows[0]["allowed_tools"] if rows else None)
    if (name, subject) not in allowed:
        allowed.append((name, subject))
    await tx.execute(
        "UPDATE sessions SET allowed_tools = ? WHERE session_id = ?",
        (encode_allowances(allowed), session_id),
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
