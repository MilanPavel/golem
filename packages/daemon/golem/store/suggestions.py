"""What ``chat.suggestions`` keeps in ``golem.db``: the last result, and the dismissed lines."""

from __future__ import annotations

import json
from typing import cast

from golem.store.database import Database

__all__ = ["SuggestionStore", "same_line"]

MAX_MESSAGE_CHARS = 200
MAX_MESSAGES = 200


def same_line(line: str) -> str:
    """The key two lines are compared by: lower case, with the spaces folded."""
    return " ".join(line.casefold().split())


class SuggestionStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def load(self) -> tuple[str, list[dict[str, str]]] | None:
        """The time the last result was made, and its raw entries. None before the first."""
        row = await self._database.fetch_one("SELECT made_at, data FROM chat_suggestions")
        if row is None:
            return None
        try:
            data = json.loads(row["data"])
        except ValueError:
            return None
        if not isinstance(data, list):
            return str(row["made_at"]), []
        return str(row["made_at"]), [
            cast("dict[str, str]", item)
            for item in cast("list[object]", data)
            if isinstance(item, dict)
        ]

    async def save(self, made_at: str, entries: list[dict[str, str]]) -> None:
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO chat_suggestions (id, made_at, data) VALUES (1, ?, ?)"
                " ON CONFLICT (id) DO UPDATE SET made_at = excluded.made_at, data = excluded.data",
                (made_at, json.dumps(entries)),
            )

    async def dismiss(self, line: str, at: str) -> None:
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT OR IGNORE INTO dismissed_suggestions (line, at) VALUES (?, ?)",
                (same_line(line), at),
            )

    async def dismissed(self) -> set[str]:
        rows = await self._database.fetch_all("SELECT line FROM dismissed_suggestions")
        return {str(row["line"]) for row in rows}

    async def your_messages(self, since: str) -> list[str]:
        """Your own short messages since ``since``, newest first, from chats you opened.

        A message of a helper (its brief) and one that ran a skill are left out, and so is
        one over 200 characters. At most 200.
        """
        rows = await self._database.fetch_all(
            "SELECT e.data FROM events e JOIN sessions s ON s.session_id = e.session_id"
            " WHERE e.type = 'message.completed' AND e.ts >= ? AND s.parent_session_id IS NULL"
            " ORDER BY e.ts DESC, e.seq DESC LIMIT 5000",
            (since,),
        )
        found: list[str] = []
        for row in rows:
            try:
                data = json.loads(row["data"])
            except ValueError:
                continue
            if data.get("role") != "user" or data.get("skill"):
                continue
            text = " ".join(str(data.get("text", "")).split())
            if text and len(text) <= MAX_MESSAGE_CHARS:
                found.append(text)
                if len(found) == MAX_MESSAGES:
                    break
        return found
