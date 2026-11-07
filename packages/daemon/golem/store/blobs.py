"""Text sent to a model that many calls share, in ``golem.db``'s ``blobs`` table.

A blob is kept once, under the sha256 of its text. A model call records the
hash, so the system prompt and the tool schemas of a long session are stored
once, not once per call.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from golem.store.database import Database


class BlobStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def put(self, kind: str, text: str) -> str:
        """Store ``text`` unless it is already there, and return its sha256 hex."""
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO blobs (sha256, kind, size, created_at, text) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (sha256) DO NOTHING",
                (digest, kind, len(text), datetime.now(UTC).isoformat(), text),
            )
        return digest

    async def get(self, sha256: str) -> tuple[str, str] | None:
        """``(kind, text)`` of the blob with this hash, or None."""
        row = await self._database.fetch_one(
            "SELECT kind, text FROM blobs WHERE sha256 = ?", (sha256,)
        )
        return None if row is None else (str(row["kind"]), str(row["text"]))


__all__ = ["BlobStore"]
