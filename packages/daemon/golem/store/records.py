"""Read the projected ``sessions`` and ``runs`` tables."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from golem.store.database import Database

RunStatus = Literal["running", "completed", "failed", "cancelled"]


@dataclass(frozen=True, slots=True)
class SessionRecord:
    session_id: str
    model_profile: str
    title: str | None
    created_at: str
    updated_at: str


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
            "SELECT session_id, model_profile, title, created_at, updated_at"
            " FROM sessions WHERE session_id = ?",
            (session_id,),
        )
        if row is None:
            return None
        return SessionRecord(
            session_id=row["session_id"],
            model_profile=row["model_profile"],
            title=row["title"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


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


def _run(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        run_id=row["run_id"],
        session_id=row["session_id"],
        status=cast(RunStatus, row["status"]),
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        error=row["error"],
    )


__all__ = ["RunRecord", "RunRecords", "RunStatus", "SessionRecord", "SessionRecords"]
