"""Append-only session events.

``message.delta`` rows live only while their message is open. The
``message.completed`` for that message deletes them in the same transaction.
"""

from __future__ import annotations

import json
import sqlite3

from golem.store.database import Database
from golem.store.projection import project
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    MessageStartedEvent,
)

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
            if isinstance(event, MessageCompletedEvent):
                await tx.execute(
                    "DELETE FROM events"
                    " WHERE session_id = ? AND message_id = ? AND type = 'message.delta'",
                    (event.session_id, message_id),
                )

    async def after(self, session_id: str, after_seq: int = 0) -> list[ChatEvent]:
        """Events for ``session_id`` with ``seq > after_seq``, in order."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE session_id = ? AND seq > ? ORDER BY seq",
            (session_id, after_seq),
        )
        return [_decode(row) for row in rows]

    async def for_run(self, run_id: str) -> list[ChatEvent]:
        """Every stored event of one run, in order."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM events WHERE run_id = ? ORDER BY seq",
            (run_id,),
        )
        return [_decode(row) for row in rows]

    async def last_seq(self, session_id: str) -> int:
        """The highest stored ``seq``, or 0 for a session with no events."""
        row = await self._database.fetch_one(
            "SELECT COALESCE(MAX(seq), 0) FROM events WHERE session_id = ?",
            (session_id,),
        )
        return 0 if row is None else int(row[0])


def _message_id(event: ChatEvent) -> str | None:
    if isinstance(event, MessageStartedEvent | MessageDeltaEvent | MessageCompletedEvent):
        return event.data.message_id
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
