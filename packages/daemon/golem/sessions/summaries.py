"""The protocol view of a session row."""

from __future__ import annotations

from golem.store.records import SessionActivity
from golem_protocol.commands import SessionSummary


def summarize(activity: SessionActivity) -> SessionSummary:
    session = activity.session
    return SessionSummary(
        session_id=session.session_id,
        model_profile=session.model_profile,
        title=session.title,
        status="running" if activity.running else "idle",
        created_at=session.created_at,
        updated_at=session.updated_at,
        last_seq=activity.last_seq,
    )


__all__ = ["summarize"]
