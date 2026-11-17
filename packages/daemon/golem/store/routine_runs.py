"""Read and write ``routine_runs``: one row for every firing of a routine (ADR-050).

``status`` is stored as ``running``, ``succeeded``, ``failed``, ``skipped`` or
``cancelled``. ``waiting`` is not stored: a ``running`` row whose session has a run
waiting on an approval reads as ``waiting``.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from golem.sessions.ids import new_id
from golem.store.database import Database, Params

__all__ = ["RoutineRunRecord", "RoutineRuns"]

_COLUMNS = (
    "r.routine_run_id, r.routine, r.scope, r.session_id, r.trigger, r.due_at, r.started_at,"
    " r.ended_at, r.reason, r.summary,"
    " CASE WHEN r.status = 'running' AND EXISTS ("
    "SELECT 1 FROM runs WHERE runs.session_id = r.session_id AND runs.status = 'waiting')"
    " THEN 'waiting' ELSE r.status END AS status"
)


@dataclass(frozen=True, slots=True)
class RoutineRunRecord:
    routine_run_id: str
    routine: str
    scope: str
    session_id: str | None
    trigger: str
    due_at: str | None
    started_at: str | None
    ended_at: str | None
    status: str
    reason: str | None
    summary: str | None


def _record(row: sqlite3.Row) -> RoutineRunRecord:
    return RoutineRunRecord(
        routine_run_id=row["routine_run_id"],
        routine=row["routine"],
        scope=row["scope"],
        session_id=row["session_id"],
        trigger=row["trigger"],
        due_at=row["due_at"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        status=row["status"],
        reason=row["reason"],
        summary=row["summary"],
    )


class RoutineRuns:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def _write(self, sql: str, params: Params) -> int:
        async with self._database.transaction() as tx:
            return await tx.execute(sql, params)

    async def start(
        self, routine: str, scope: str, trigger: str, due_at: str | None, at: str
    ) -> str:
        """Write a ``running`` row before its session exists. Returns its id."""
        run_id = new_id("rr")
        await self._write(
            "INSERT INTO routine_runs"
            " (routine_run_id, routine, scope, trigger, due_at, started_at, status)"
            " VALUES (?, ?, ?, ?, ?, ?, 'running')",
            (run_id, routine, scope, trigger, due_at, at),
        )
        return run_id

    async def skip(
        self, routine: str, scope: str, trigger: str, due_at: str | None, at: str, reason: str
    ) -> str:
        """Write a firing that did not happen. Returns its id."""
        run_id = new_id("rr")
        await self._write(
            "INSERT INTO routine_runs"
            " (routine_run_id, routine, scope, trigger, due_at, started_at, ended_at, status,"
            " reason) VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)",
            (run_id, routine, scope, trigger, due_at, at, at, reason),
        )
        return run_id

    async def attach(self, run_id: str, session_id: str) -> None:
        await self._write(
            "UPDATE routine_runs SET session_id = ? WHERE routine_run_id = ?", (session_id, run_id)
        )

    async def finish(
        self, run_id: str, status: str, at: str, summary: str | None, reason: str | None = None
    ) -> bool:
        """End a ``running`` row. False when it was not running (it ended already)."""
        changed = await self._write(
            "UPDATE routine_runs SET status = ?, ended_at = ?, summary = ?, reason = ?"
            " WHERE routine_run_id = ? AND status = 'running'",
            (status, at, summary, reason, run_id),
        )
        return changed > 0

    async def get(self, run_id: str) -> RoutineRunRecord | None:
        row = await self._database.fetch_one(
            f"SELECT {_COLUMNS} FROM routine_runs r WHERE r.routine_run_id = ?", (run_id,)
        )
        return None if row is None else _record(row)

    async def by_session(self, session_id: str) -> RoutineRunRecord | None:
        """The firing running in ``session_id``, if one is."""
        row = await self._database.fetch_one(
            f"SELECT {_COLUMNS} FROM routine_runs r WHERE r.session_id = ? AND r.ended_at IS NULL",
            (session_id,),
        )
        return None if row is None else _record(row)

    async def outcome(self, session_id: str) -> str | None:
        """The status of the newest agent run of a session, None when it has none."""
        row = await self._database.fetch_one(
            "SELECT status FROM runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1",
            (session_id,),
        )
        return None if row is None else row["status"]

    async def active(self, routine: str, scope: str) -> RoutineRunRecord | None:
        """The firing of this routine that is still running or waiting, if any."""
        row = await self._database.fetch_one(
            f"SELECT {_COLUMNS} FROM routine_runs r WHERE r.routine = ? AND r.scope = ?"
            " AND r.ended_at IS NULL ORDER BY r.started_at DESC LIMIT 1",
            (routine, scope),
        )
        return None if row is None else _record(row)

    async def open_runs(self) -> list[RoutineRunRecord]:
        """Every firing that has not ended, oldest first."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM routine_runs r WHERE r.ended_at IS NULL ORDER BY r.started_at"
        )
        return [_record(row) for row in rows]

    async def last_due(self, routine: str, scope: str) -> str | None:
        """The latest time a scheduled firing of this routine was due, fired or not."""
        row = await self._database.fetch_one(
            "SELECT due_at FROM routine_runs WHERE routine = ? AND scope = ?"
            " AND trigger = 'schedule' AND due_at IS NOT NULL ORDER BY due_at DESC LIMIT 1",
            (routine, scope),
        )
        return None if row is None else row["due_at"]

    async def recent(self, routine: str, scope: str, limit: int = 50) -> list[RoutineRunRecord]:
        """The newest firings of one routine, newest first."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM routine_runs r WHERE r.routine = ? AND r.scope = ?"
            " ORDER BY r.started_at DESC, r.rowid DESC LIMIT ?",
            (routine, scope, limit),
        )
        return [_record(row) for row in rows]
