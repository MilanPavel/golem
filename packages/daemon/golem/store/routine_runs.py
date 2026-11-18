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

__all__ = ["HeadlessRun", "RoutineRunRecord", "RoutineRuns", "WatchedFile"]

_COLUMNS = (
    "r.routine_run_id, r.routine, r.scope, r.session_id, r.trigger, r.due_at, r.started_at,"
    " r.ended_at, r.reason, r.summary, r.watch_path,"
    " CASE WHEN r.status = 'running' AND EXISTS ("
    "SELECT 1 FROM runs WHERE runs.session_id = r.session_id AND runs.status = 'waiting')"
    " THEN 'waiting' ELSE r.status END AS status"
)


@dataclass(frozen=True, slots=True)
class WatchedFile:
    """A file a ``watch`` firing is for: its absolute path, size and mtime (ns) when it fired."""

    path: str | None
    size: int | None
    mtime_ns: int | None


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
    watch_path: str | None = None


@dataclass(frozen=True, slots=True)
class HeadlessRun:
    """A session whose origin is not ``user``, joined with its firing when it has one."""

    session_id: str
    origin: str
    routine_run_id: str | None
    routine: str | None
    scope: str | None
    trigger: str | None
    status: str
    started_at: str | None
    ended_at: str | None
    reason: str | None
    summary: str | None
    watch_path: str | None


_LAST_RUN = (
    "(SELECT {col} FROM runs WHERE runs.session_id = s.session_id"
    " ORDER BY runs.started_at DESC, runs.rowid DESC LIMIT 1)"
)
_HEADLESS = (
    "SELECT s.session_id, s.origin, s.created_at, r.routine_run_id, r.routine, r.scope, r.trigger,"
    " r.status AS fired_status, r.started_at AS fired_at, r.ended_at AS fired_end, r.reason AS"
    " fired_reason, r.summary AS fired_summary, r.watch_path,"
    " EXISTS (SELECT 1 FROM runs WHERE runs.session_id = s.session_id"
    " AND runs.status = 'waiting') AS waiting,"
    " " + _LAST_RUN.format(col="status") + " AS last_status,"
    " " + _LAST_RUN.format(col="ended_at") + " AS last_end,"
    " " + _LAST_RUN.format(col="error") + " AS last_error,"
    " (SELECT json_extract(e.data, '$.summary') FROM events e"
    "  WHERE e.session_id = s.session_id AND e.type = 'session.completed'"
    "  ORDER BY e.seq DESC LIMIT 1) AS last_summary"
    " FROM sessions s LEFT JOIN routine_runs r ON r.session_id = s.session_id"
    " WHERE COALESCE(s.origin, 'user') != 'user'"
)
_ASK_STATUS = {"completed": "succeeded", "failed": "failed", "cancelled": "cancelled"}


def _headless(row: sqlite3.Row) -> HeadlessRun:
    if row["routine_run_id"] is not None:
        waiting = row["fired_status"] == "running" and bool(row["waiting"])
        return HeadlessRun(
            session_id=row["session_id"],
            origin=row["origin"],
            routine_run_id=row["routine_run_id"],
            routine=row["routine"],
            scope=row["scope"],
            trigger=row["trigger"],
            status="waiting" if waiting else row["fired_status"],
            started_at=row["fired_at"],
            ended_at=row["fired_end"],
            reason=row["fired_reason"],
            summary=row["fired_summary"],
            watch_path=row["watch_path"],
        )
    last = row["last_status"]
    status = (
        "waiting"
        if row["waiting"]
        else "running"
        if last == "running"
        else "queued"
        if last is None
        else _ASK_STATUS.get(last, "failed")
    )
    return HeadlessRun(
        session_id=row["session_id"],
        origin=row["origin"],
        routine_run_id=None,
        routine=None,
        scope=None,
        trigger=None,
        status=status,
        started_at=row["created_at"],
        ended_at=row["last_end"] if status in ("succeeded", "failed", "cancelled") else None,
        reason=row["last_error"] if status == "failed" else None,
        summary=row["last_summary"],
        watch_path=None,
    )


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
        watch_path=row["watch_path"],
    )


class RoutineRuns:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def _write(self, sql: str, params: Params) -> int:
        async with self._database.transaction() as tx:
            return await tx.execute(sql, params)

    async def start(
        self,
        routine: str,
        scope: str,
        trigger: str,
        due_at: str | None,
        at: str,
        watched: WatchedFile | None = None,
    ) -> str:
        """Write a ``running`` row before its session exists. Returns its id.

        ``watched`` is the file a ``watch`` firing is for.
        """
        run_id = new_id("rr")
        file = watched or WatchedFile(None, None, None)
        await self._write(
            "INSERT INTO routine_runs"
            " (routine_run_id, routine, scope, trigger, due_at, started_at, status,"
            " watch_path, watch_size, watch_mtime_ns)"
            " VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)",
            (run_id, routine, scope, trigger, due_at, at, file.path, file.size, file.mtime_ns),
        )
        return run_id

    async def has_fired_for(self, routine: str, scope: str, file: WatchedFile) -> bool:
        """Whether a ``watch`` firing of this routine already took this file as it is now."""
        row = await self._database.fetch_one(
            "SELECT 1 FROM routine_runs WHERE routine = ? AND scope = ? AND trigger = 'watch'"
            " AND watch_path = ? AND watch_size = ? AND watch_mtime_ns = ? LIMIT 1",
            (routine, scope, file.path, file.size, file.mtime_ns),
        )
        return row is not None

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

    async def headless(self, limit: int, session_id: str | None = None) -> list[HeadlessRun]:
        """The headless sessions, newest start first, each with its firing if it has one.

        A routine firing that never got a session (a skipped one) is not a row.
        """
        where = " AND s.session_id = ?" if session_id is not None else ""
        params: tuple[object, ...] = (session_id, limit) if session_id is not None else (limit,)
        rows = await self._database.fetch_all(
            f"{_HEADLESS}{where} ORDER BY COALESCE(r.started_at, s.created_at) DESC,"
            " s.session_id DESC LIMIT ?",
            params,
        )
        return [_headless(row) for row in rows]
