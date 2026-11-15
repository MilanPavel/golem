"""Keep ``sessions`` and ``runs`` in step with the event log.

Both tables are projections. They are written in the same transaction as the
event they follow, before the event row, so foreign keys hold.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, tzinfo

from golem.store.database import Transaction
from golem.store.records import decode_allowances, decode_names, encode_allowances
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    MessageDeltaEvent,
    MessageThinkingDeltaEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    ModelOptionsChangedEvent,
    ModelSelectedEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    RunStartedEvent,
    SessionChecksChangedEvent,
    SessionClosedEvent,
    SessionCreatedEvent,
    SessionModeChangedEvent,
    SessionUpdatedEvent,
    SkillActivatedEvent,
    SkillDeactivatedEvent,
    ToolOutputEvent,
)


async def project(tx: Transaction, event: ChatEvent) -> None:
    """Apply ``event`` to the projected tables."""
    if isinstance(event, SessionCreatedEvent):
        parent = event.data.forked_from
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at,"
            " forked_from_session_id, forked_from_message_id, cwd, origin, route)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.session_id,
                event.data.model_profile,
                event.ts,
                event.ts,
                None if parent is None else parent.session_id,
                None if parent is None else parent.message_id,
                event.data.cwd,
                None if event.data.origin in (None, "user") else event.data.origin,
                event.data.route or "pinned",
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
        if event.data.mcp_servers is not None:
            await tx.execute(
                "UPDATE sessions SET mcp_servers = ? WHERE session_id = ?",
                (json.dumps(event.data.mcp_servers), event.session_id),
            )
        if event.data.route is not None:
            await tx.execute(
                "UPDATE sessions SET route = ? WHERE session_id = ?",
                (event.data.route, event.session_id),
            )
    elif isinstance(event, SkillActivatedEvent) and event.data.how == "pinned":
        await _set_skills(tx, event.session_id, lambda names: [*names, event.data.name])
    elif isinstance(event, SkillDeactivatedEvent):
        await _set_skills(
            tx, event.session_id, lambda names: [n for n in names if n != event.data.name]
        )
    elif isinstance(event, ModelOptionsChangedEvent):
        await tx.execute(
            "UPDATE sessions SET options = ? WHERE session_id = ?",
            (json.dumps(event.data.options), event.session_id),
        )
    elif isinstance(event, SessionChecksChangedEvent):
        await tx.execute(
            "UPDATE sessions SET checks = ? WHERE session_id = ?",
            (int(event.data.on), event.session_id),
        )
    elif isinstance(event, SessionModeChangedEvent):
        await tx.execute(
            "UPDATE sessions SET permission_mode = ? WHERE session_id = ?",
            (event.data.mode, event.session_id),
        )
    elif isinstance(event, ModelSelectedEvent):
        await tx.execute(
            "UPDATE sessions SET model_profile = ? WHERE session_id = ?",
            (event.data.model_profile, event.session_id),
        )
    elif isinstance(event, ModelCallStartedEvent | ModelCallCompletedEvent):
        await project_model_call(tx, event)
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
    if not isinstance(event, MessageDeltaEvent | MessageThinkingDeltaEvent | ToolOutputEvent):
        await tx.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (event.ts, event.session_id),
        )


def local_day(ts: str, zone: tzinfo | None = None) -> str:
    """The local calendar date, ``YYYY-MM-DD``, of the ISO time ``ts``.

    ``zone`` is the user's time zone, and None means the machine's.
    """
    return datetime.fromisoformat(ts).astimezone(zone).date().isoformat()


async def project_model_call(
    tx: Transaction, event: ModelCallStartedEvent | ModelCallCompletedEvent
) -> None:
    """Write a call into ``model_calls``. Replaying the same events gives the same rows.

    ``started`` inserts the row, and ``completed`` fills in its tokens, cost and ``failed``.
    A ``completed`` with no ``started`` row changes nothing. An event with no ``tier`` (one
    from before it was recorded) is ``local`` for ollama and unknown for any other provider.
    """
    if isinstance(event, ModelCallStartedEvent):
        data = event.data
        tier = data.tier or ("local" if data.provider == "ollama" else None)
        await tx.execute(
            "INSERT OR REPLACE INTO model_calls (call_id, session_id, run_id, role, provider,"
            " model, tier, started_at, day) VALUES (?, ?, ?, 'chat', ?, ?, ?, ?, ?)",
            (
                data.message_id,
                event.session_id,
                event.run_id,
                data.provider,
                data.model,
                tier,
                event.ts,
                local_day(event.ts),
            ),
        )
        return
    done = event.data
    usage = done.usage
    await tx.execute(
        "UPDATE model_calls SET input = ?, output = ?, cache_read = ?, cache_write = ?,"
        " cost_usd = ?, failed = ? WHERE call_id = ?",
        (
            None if usage is None else usage.input,
            None if usage is None else usage.output,
            None if usage is None else usage.cache_read,
            None if usage is None else usage.cache_write,
            done.cost_usd,
            1 if done.failed else 0,
            done.message_id,
        ),
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


__all__ = ["local_day", "project", "project_model_call"]


async def _set_skills(
    tx: Transaction, session_id: str, change: Callable[[list[str]], list[str]]
) -> None:
    """Rewrite ``sessions.skills``, the pinned skills in pin order, with ``change``."""
    rows = await tx.fetch_all("SELECT skills FROM sessions WHERE session_id = ?", (session_id,))
    if not rows:
        return
    names = [name for name in change(list(decode_names(rows[0]["skills"]))) if name]
    unique = list(dict.fromkeys(names))
    await tx.execute(
        "UPDATE sessions SET skills = ? WHERE session_id = ?", (json.dumps(unique), session_id)
    )
