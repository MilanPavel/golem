"""Read and write ``inbox_posts``: what a query routine left in the Inbox, until it is done."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

from golem.sessions.ids import new_id
from golem.store.database import Database

__all__ = ["InboxPostRecord", "InboxPosts"]


@dataclass(frozen=True, slots=True)
class InboxPostRecord:
    post_id: str
    routine: str
    scope: str
    source: str
    saved: str
    row_count: int
    columns: list[str]
    rows: list[list[Any]]
    error: str | None
    at: str


def _record(row: sqlite3.Row) -> InboxPostRecord:
    return InboxPostRecord(
        post_id=row["post_id"],
        routine=row["routine"],
        scope=row["scope"],
        source=row["source"],
        saved=row["saved"],
        row_count=row["row_count"],
        columns=json.loads(row["columns_json"]),
        rows=json.loads(row["rows_json"]),
        error=row["error"],
        at=row["at"],
    )


class InboxPosts:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def add(
        self,
        *,
        routine: str,
        scope: str,
        source: str,
        saved: str,
        row_count: int,
        columns: list[str],
        rows: list[list[Any]],
        error: str | None,
        at: str,
    ) -> InboxPostRecord:
        post_id = new_id("ib")
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO inbox_posts (post_id, routine, scope, source, saved, row_count,"
                " columns_json, rows_json, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    post_id,
                    routine,
                    scope,
                    source,
                    saved,
                    row_count,
                    json.dumps(columns),
                    json.dumps(rows, default=str),
                    error,
                    at,
                ),
            )
        return InboxPostRecord(
            post_id, routine, scope, source, saved, row_count, columns, rows, error, at
        )

    async def open_posts(self) -> list[InboxPostRecord]:
        """The posts not yet done, newest first."""
        rows = await self._database.fetch_all(
            "SELECT * FROM inbox_posts WHERE done_at IS NULL ORDER BY at DESC, rowid DESC"
        )
        return [_record(row) for row in rows]

    async def done(self, post_id: str, at: str) -> bool:
        """Mark a post done. False when there is no open post with this id."""
        async with self._database.transaction() as tx:
            changed = await tx.execute(
                "UPDATE inbox_posts SET done_at = ? WHERE post_id = ? AND done_at IS NULL",
                (at, post_id),
            )
        return changed > 0
