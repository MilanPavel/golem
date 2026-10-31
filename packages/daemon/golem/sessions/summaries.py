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
    )


__all__ = ["summarize"]
