"""The protocol view of a session row."""

from __future__ import annotations

from golem.store.records import SessionActivity
from golem_protocol.commands import SessionSummary

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


def summarize(activity: SessionActivity) -> SessionSummary:
    session = activity.session
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
    )


__all__ = ["SUMMARY_CHARS", "SUMMARY_LINES", "cut_summary", "summarize"]
