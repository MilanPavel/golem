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

from golem.store.database import Database
from golem.store.projection import project
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    MessageStartedEvent,
    MessageThinkingDeltaEvent,
    ModelWaitingEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolOutputEvent,
    ToolWritingEvent,
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
