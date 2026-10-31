"""Read the projected ``sessions`` and ``runs`` tables."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Literal, cast

from golem.permissions.engine import Allowance
from golem.store.database import Database

RunStatus = Literal["running", "waiting", "completed", "failed", "cancelled"]

_ACTIVITY = (
    "SELECT s.session_id, s.model_profile, s.title, s.created_at, s.updated_at, s.closed_at,"
    " s.cwd, s.allowed_tools, s.mcp_servers,"
    " EXISTS (SELECT 1 FROM runs r"
    "  WHERE r.session_id = s.session_id AND r.status = 'running') AS running,"
    " EXISTS (SELECT 1 FROM runs r"
    "  WHERE r.session_id = s.session_id AND r.status = 'waiting') AS waiting,"
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
    allowed_tools: tuple[Allowance, ...] = ()
    mcp_servers: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SessionActivity:
    """A session row, whether a run is open or waits for an approval, and its newest ``seq``."""

    session: SessionRecord
    running: bool
    last_seq: int
    waiting: bool = False


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
            "SELECT session_id, model_profile, title, created_at, updated_at, closed_at, cwd,"
            " allowed_tools, mcp_servers"
            " FROM sessions WHERE session_id = ?",
            (session_id,),
        )
        return None if row is None else _session(row)

    async def activity(self, session_id: str) -> SessionActivity | None:
        """One session's row, whether a run is open, and its newest ``seq``."""
        row = await self._database.fetch_one(f"{_ACTIVITY} WHERE s.session_id = ?", (session_id,))
        return None if row is None else _activity(row)

    async def recent(self, limit: int, cwd: str | None = None) -> list[SessionActivity]:
        """Open sessions with the newest activity first. Closed ones stay in the log.

        With ``cwd``, only the sessions in that folder.
        """
        rows = await self._database.fetch_all(
            f"{_ACTIVITY} WHERE s.closed_at IS NULL AND (? IS NULL OR s.cwd = ?)"
            " ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?",
            (cwd, cwd, limit),
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

    async def waiting(self, session_id: str) -> RunRecord | None:
        """The run of ``session_id`` that waits for an approval, if any."""
        row = await self._database.fetch_one(
            "SELECT run_id, session_id, status, started_at, ended_at, error"
            " FROM runs WHERE session_id = ? AND status = 'waiting'"
            " ORDER BY started_at DESC LIMIT 1",
            (session_id,),
        )
        return None if row is None else _run(row)

    async def running(self) -> list[RunRecord]:
        """Runs a stopped daemon left open, oldest first."""
        rows = await self._database.fetch_all(
            "SELECT run_id, session_id, status, started_at, ended_at, error"
            " FROM runs WHERE status = 'running' ORDER BY started_at",
        )
        return [_run(row) for row in rows]


def decode_allowances(raw: object) -> list[Allowance]:
    """``sessions.allowed_tools``: ``[tool, subject]`` pairs.

    A bare name, as older rows hold, is a tool with no subject.
    """
    if not isinstance(raw, str):
        return []
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        return []
    found: list[Allowance] = []
    for item in cast(list[object], parsed):
        if isinstance(item, str):
            found.append((item, None))
        elif isinstance(item, list) and len(cast(list[object], item)) == 2:
            tool, subject = cast(list[object], item)
            if isinstance(tool, str) and (subject is None or isinstance(subject, str)):
                found.append((tool, subject))
    return found


def decode_names(raw: object) -> tuple[str, ...]:
    """``sessions.mcp_servers``: a JSON list of names."""
    if not isinstance(raw, str):
        return ()
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        return ()
    return tuple(item for item in cast(list[object], parsed) if isinstance(item, str))


def encode_allowances(allowed: list[Allowance]) -> str:
    return json.dumps([[tool, subject] for tool, subject in allowed])


def _session(row: sqlite3.Row) -> SessionRecord:
    return SessionRecord(
        session_id=row["session_id"],
        model_profile=row["model_profile"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        closed_at=row["closed_at"],
        cwd=row["cwd"],
        allowed_tools=tuple(decode_allowances(row["allowed_tools"])),
        mcp_servers=decode_names(row["mcp_servers"]),
    )


def _activity(row: sqlite3.Row) -> SessionActivity:
    return SessionActivity(
        session=_session(row),
        running=bool(row["running"]),
        last_seq=int(row["last_seq"]),
        waiting=bool(row["waiting"]),
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
