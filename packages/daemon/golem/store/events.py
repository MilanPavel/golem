"""Append-only session events.

``message.delta`` and ``message.thinking.delta`` rows live only while their message is open. The
``message.completed`` for that message deletes them in the same transaction, and
``tool.writing`` rows with them.
``tool.output`` rows live only while their tool call runs, and the call's
``tool.completed`` or ``tool.failed`` deletes them.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence

from golem.store.database import Database, Transaction
from golem.store.projection import project
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    MessageStartedEvent,
    MessageThinkingDeltaEvent,
    ModelWaitingEvent,
    SessionTrimmedData,
    SessionTrimmedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolOutputEvent,
    ToolWritingEvent,
)

_RECEIPT_TYPES = ("session.created", "session.completed")
"""Event types a trimmed helper keeps, besides its brief and its final answer."""

_DELETE_CHUNK = 500

_COLUMNS = "session_id, seq, ts, type, run_id, data"


class EventLog:
    """Reads and writes the ``events`` table of ``golem.db``."""

    def __init__(self, database: Database) -> None:
        self._database = database

    async def append(self, event: ChatEvent) -> None:
        """Store ``event``, update the projections, and coalesce deltas."""
        message_id = _message_id(event)
        async with self._database.transaction() as tx:
            await project(tx, event)
            await _insert(tx, event, message_id)
            if isinstance(event, MessageCompletedEvent):
                await tx.execute(
                    "DELETE FROM events"
                    " WHERE session_id = ? AND message_id = ?"
                    " AND type IN ('message.delta', 'message.thinking.delta', 'tool.writing',"
                    " 'model.waiting')",
                    (event.session_id, message_id),
                )
            elif isinstance(event, ToolCompletedEvent | ToolFailedEvent):
                await tx.execute(
                    "DELETE FROM events"
                    " WHERE session_id = ? AND message_id = ? AND type = 'tool.output'",
                    (event.session_id, event.data.call_id),
                )

    async def trim(self, session_id: str, ts: str) -> SessionTrimmedEvent | None:
        """Cut a session's log to its receipt and append ``session.trimmed``, in one transaction.

        The receipt is ``session.created``, the brief (the first user message), the final answer
        (the last assistant message) and ``session.completed``. Everything else is removed. A
        crash or an error leaves the log as it was. Returns the new event, or None when the
        session has none to trim or is trimmed already.
        """
        async with self._database.transaction() as tx:
            rows = await tx.fetch_all(
                "SELECT seq, type, data FROM events WHERE session_id = ? ORDER BY seq",
                (session_id,),
            )
            if not rows or any(row["type"] == "session.trimmed" for row in rows):
                return None
            keep = _receipt(rows)
            gone = [int(row["seq"]) for row in rows if int(row["seq"]) not in keep]
            event = SessionTrimmedEvent(
                seq=int(rows[-1]["seq"]) + 1,
                session_id=session_id,
                ts=ts,
                type="session.trimmed",
                data=SessionTrimmedData(removed=len(gone)),
            )
            await project(tx, event)
            for start in range(0, len(gone), _DELETE_CHUNK):
                chunk = gone[start : start + _DELETE_CHUNK]
                marks = ", ".join("?" for _ in chunk)
                await tx.execute(
                    f"DELETE FROM events WHERE session_id = ? AND seq IN ({marks})",
                    (session_id, *chunk),
                )
            await _insert(tx, event, None)
            return event

    async def after(self, session_id: str, after_seq: int = 0) -> list[ChatEvent]:
        """Events for ``session_id`` with ``seq > after_seq``, in order."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE session_id = ? AND seq > ? ORDER BY seq",
            (session_id, after_seq),
        )
        return [_decode(row) for row in rows]

    async def of_types(self, types: Sequence[str]) -> list[ChatEvent]:
        """Every stored event of the given types, by session and in order."""
        marks = ", ".join("?" for _ in types)
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE type IN ({marks}) ORDER BY session_id, seq",
            tuple(types),
        )
        return [_decode(row) for row in rows]

    async def for_run(self, run_id: str) -> list[ChatEvent]:
        """Every stored event of one run, in order."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE run_id = ? ORDER BY seq",
            (run_id,),
        )
        return [_decode(row) for row in rows]

    async def for_runs(self, run_ids: Sequence[str]) -> dict[str, list[ChatEvent]]:
        """Every stored event of each of ``run_ids``, in order, in one query."""
        if not run_ids:
            return {}
        marks = ", ".join("?" for _ in run_ids)
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE run_id IN ({marks}) ORDER BY run_id, seq",
            tuple(run_ids),
        )
        found: dict[str, list[ChatEvent]] = {run_id: [] for run_id in run_ids}
        for row in rows:
            found[str(row["run_id"])].append(_decode(row))
        return found

    async def last_wait(self, run_id: str) -> ModelWaitingEvent | None:
        """The newest stored ``model.waiting`` of one run. A completed message deletes its own."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE run_id = ? AND type = 'model.waiting'"
            " ORDER BY seq DESC LIMIT 1",
            (run_id,),
        )
        found = [_decode(row) for row in rows]
        return found[0] if found and isinstance(found[0], ModelWaitingEvent) else None

    async def last_seq(self, session_id: str) -> int:
        """The highest stored ``seq``, or 0 for a session with no events."""
        row = await self._database.fetch_one(
            "SELECT COALESCE(MAX(seq), 0) FROM events WHERE session_id = ?",
            (session_id,),
        )
        return 0 if row is None else int(row[0])


async def _insert(tx: Transaction, event: ChatEvent, message_id: str | None) -> None:
    await tx.execute(
        "INSERT INTO events (session_id, seq, ts, type, run_id, message_id, data)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            event.session_id,
            event.seq,
            event.ts,
            event.type,
            event.run_id,
            message_id,
            event.data.model_dump_json(),
        ),
    )


def _receipt(rows: Sequence[sqlite3.Row]) -> set[int]:
    """The ``seq`` of each event a trimmed helper keeps."""
    keep: set[int] = set()
    brief: int | None = None
    answer: int | None = None
    for row in rows:
        seq = int(row["seq"])
        if row["type"] in _RECEIPT_TYPES:
            keep.add(seq)
        elif row["type"] == "message.completed":
            role = json.loads(row["data"]).get("role")
            if role == "user" and brief is None:
                brief = seq
            elif role == "assistant":
                answer = seq
    keep.update(seq for seq in (brief, answer) if seq is not None)
    return keep


def _message_id(event: ChatEvent) -> str | None:
    if isinstance(
        event,
        MessageStartedEvent
        | MessageDeltaEvent
        | MessageThinkingDeltaEvent
        | MessageCompletedEvent
        | ToolWritingEvent
        | ModelWaitingEvent,
    ):
        return event.data.message_id
    if isinstance(event, ToolOutputEvent):
        return event.data.call_id
    return None


def _decode(row: sqlite3.Row) -> ChatEvent:
    return CHAT_EVENT.validate_python(
        {
            "session_id": row["session_id"],
            "seq": row["seq"],
            "ts": row["ts"],
            "type": row["type"],
            "run_id": row["run_id"],
            "data": json.loads(row["data"]),
        }
    )


__all__ = ["EventLog"]
