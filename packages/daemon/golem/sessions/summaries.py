"""The protocol view of a session row."""

from __future__ import annotations

from golem.store.records import SessionActivity
from golem_protocol.commands import PendingItem, SessionSummary
from golem_protocol.events import WaitReason

SUMMARY_CHARS = 280
"""How much of the last reply ``session.completed`` carries (ADR-050)."""

SUMMARY_LINES = 4


def cut_summary(reply: str | None) -> str | None:
    """The reply cut to a few lines and ``SUMMARY_CHARS`` characters, with "…" when cut."""
    if reply is None:
        return None
    lines = [line.rstrip() for line in reply.strip().splitlines()]
    text = "\n".join(lines[:SUMMARY_LINES])
    cut = len(lines) > SUMMARY_LINES
    if len(text) > SUMMARY_CHARS:
        text = text[: SUMMARY_CHARS - 1].rstrip()
        cut = True
    if text == "":
        return None
    return f"{text}…" if cut else text


QUEUED_REASONS: tuple[WaitReason, ...] = ("slot", "provider", "load")
"""The waits a summary carries. The others (``you``, ``budget``, ``team``) show in ``status``."""


def summarize(
    activity: SessionActivity,
    local_only: bool = False,
    pending: PendingItem | None = None,
    wait: tuple[WaitReason, str] | None = None,
    helpers: tuple[int, int] | None = None,
    step: str | None = None,
    items: list[PendingItem] | None = None,
    branch: str | None = None,
) -> SessionSummary:
    """The row of ``activity``. ``wait`` is the open wait of its running run, and only a running
    session carries it. ``helpers`` is ``(running, waiting)`` of a lead's helpers, None for no
    helper at work. ``step`` is a helper's newest step, and only a helper with a run open
    carries it. ``items`` is a lead's pending list, its own item and its helpers', oldest first;
    without it the list is ``pending``. ``pending`` is the first item that is not a ``batch``
    or a ``review``, because an older client reads it and knows only approval and consent.
    ``branch`` is the branch checked out in the session's folder, None when there is none."""
    session = activity.session
    listed = items if items is not None else ([] if pending is None else [pending])
    pending = next((item for item in listed if item.kind not in ("batch", "review")), None)
    at_work = (activity.running or activity.waiting) and session.closed_at is None
    shown = step if at_work and session.parent_session_id is not None else None
    queued = wait if wait is not None and activity.running and session.closed_at is None else None
    return SessionSummary(
        session_id=session.session_id,
        model_profile=session.model_profile,
        title=session.title,
        status=(
            "closed"
            if session.closed_at is not None
            else "running"
            if activity.running
            else "waiting"
            if activity.waiting
            else "idle"
        ),
        created_at=session.created_at,
        updated_at=session.updated_at,
        last_seq=activity.last_seq,
        cwd=session.cwd,
        forked_from=session.forked_from,
        origin=session.origin,
        parent_session_id=session.parent_session_id,
        agent=session.agent,
        route=session.route,
        plan_first=session.plan_first,
        local_only=local_only,
        pending=pending,
        pending_items=listed,
        wait_reason=None if queued is None else queued[0],
        wait_line=None if queued is None else queued[1],
        helpers_running=None if helpers is None else helpers[0],
        helpers_waiting=None if helpers is None else helpers[1],
        step=shown,
        trimmed_at=session.trimmed_at,
        branch=branch,
    )


__all__ = ["QUEUED_REASONS", "SUMMARY_CHARS", "SUMMARY_LINES", "cut_summary", "summarize"]
