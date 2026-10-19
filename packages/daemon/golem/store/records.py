"""Read the projected ``sessions`` and ``runs`` tables."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from golem.store.database import Database

RunStatus = Literal["running", "completed", "failed", "cancelled"]

_ACTIVITY = (
    "SELECT s.session_id, s.model_profile, s.title, s.created_at, s.updated_at, s.closed_at,"
    " s.cwd,"
    " EXISTS (SELECT 1 FROM runs r"
    "  WHERE r.session_id = s.session_id AND r.status = 'running') AS running,"
    " (SELECT COALESCE(MAX(e.seq), 0) FROM events e"
    "  WHERE e.session_id = s.session_id) AS last_seq"
    " FROM sessions s"
)


@dataclass(frozen=True, slots=True)
class SessionRecord:
    session_id: str
    model_profile: str
    title: str | None
    created_at: str
    updated_at: str
    closed_at: str | None
    cwd: str | None = None


@dataclass(frozen=True, slots=True)
class SessionActivity:
    """A session row plus whether a run is open and its newest ``seq``."""

    session: SessionRecord
    running: bool
    last_seq: int


@dataclass(frozen=True, slots=True)
class RunRecord:
    run_id: str
    session_id: str
    status: RunStatus
    started_at: str
    ended_at: str | None
    error: str | None


class SessionRecords:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def get(self, session_id: str) -> SessionRecord | None:
        row = await self._database.fetch_one(
            "SELECT session_id, model_profile, title, created_at, updated_at, closed_at, cwd"
            " FROM sessions WHERE session_id = ?",
            (session_id,),
        )
        return None if row is None else _session(row)

    async def activity(self, session_id: str) -> SessionActivity | None:
        """One session's row, whether a run is open, and its newest ``seq``."""
        row = await self._database.fetch_one(f"{_ACTIVITY} WHERE s.session_id = ?", (session_id,))
        return None if row is None else _activity(row)

    async def recent(self, limit: int) -> list[SessionActivity]:
        """Open sessions with the newest activity first. Closed ones stay in the log."""
        rows = await self._database.fetch_all(
            f"{_ACTIVITY} WHERE s.closed_at IS NULL"
            " ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?",
            (limit,),
        )
        return [_activity(row) for row in rows]


class RunRecords:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def get(self, run_id: str) -> RunRecord | None:
        row = await self._database.fetch_one(
            "SELECT run_id, session_id, status, started_at, ended_at, error"
            " FROM runs WHERE run_id = ?",
            (run_id,),
        )
        return None if row is None else _run(row)

    async def running(self) -> list[RunRecord]:
        """Runs a stopped daemon left open, oldest first."""
        rows = await self._database.fetch_all(
            "SELECT run_id, session_id, status, started_at, ended_at, error"
            " FROM runs WHERE status = 'running' ORDER BY started_at",
        )
        return [_run(row) for row in rows]


def _session(row: sqlite3.Row) -> SessionRecord:
    return SessionRecord(
        session_id=row["session_id"],
        model_profile=row["model_profile"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        closed_at=row["closed_at"],
        cwd=row["cwd"],
    )


def _activity(row: sqlite3.Row) -> SessionActivity:
    return SessionActivity(
        session=_session(row),
        running=bool(row["running"]),
        last_seq=int(row["last_seq"]),
    )


def _run(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        run_id=row["run_id"],
        session_id=row["session_id"],
        status=cast(RunStatus, row["status"]),
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        error=row["error"],
    )


__all__ = [
    "RunRecord",
    "RunRecords",
    "RunStatus",
    "SessionActivity",
    "SessionRecord",
    "SessionRecords",
]
