"""Big tool output, kept out of the checkpoint in ``golem.db``'s ``artifacts`` table.

The model gets a preview and the artifact's id, and reads the rest in pages
with ``read_artifact``. An artifact belongs to one session and is read only
through it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from golem.sessions.ids import new_id
from golem.store.database import Database
from golem.tools.registry import ArtifactPage


class ArtifactStore:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def put(self, session_id: str, call_id: str | None, kind: str, text: str) -> str:
        """Store ``text`` for ``session_id`` and return the new artifact's id."""
        artifact_id = new_id("a")
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO artifacts (artifact_id, session_id, call_id, kind, size, created_at,"
                " data) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    artifact_id,
                    session_id,
                    call_id,
                    kind,
                    len(text),
                    datetime.now(UTC).isoformat(),
                    text,
                ),
            )
        return artifact_id

    async def read(
        self, session_id: str, artifact_id: str, offset: int, limit: int
    ) -> ArtifactPage | None:
        """``limit`` characters from ``offset``, or None for an artifact of another session."""
        row = await self._database.fetch_one(
            "SELECT size, substr(data, ?, ?) AS page FROM artifacts"
            " WHERE artifact_id = ? AND session_id = ?",
            (max(0, offset) + 1, max(0, limit), artifact_id, session_id),
        )
        if row is None:
            return None
        return ArtifactPage(text=str(row["page"]), offset=max(0, offset), size=int(row["size"]))


__all__ = ["ArtifactStore"]
