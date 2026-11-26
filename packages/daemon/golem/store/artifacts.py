"""Big tool output, kept out of the checkpoint in ``golem.db``'s ``artifacts`` table.

The model gets a preview and the artifact's id, and reads the rest in pages
with ``read_artifact``. An artifact belongs to one session and is read only
through it, or through the lead of a helper session that made it.
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
        """``limit`` characters from ``offset``, or None for an artifact of another session.

        The artifacts of the helper sessions of ``session_id`` (those with it as their root)
        count as its own.
        """
        row = await self._database.fetch_one(
            "SELECT size, kind, substr(data, ?, ?) AS page FROM artifacts"
            " WHERE artifact_id = ? AND (session_id = ? OR session_id IN"
            " (SELECT s.session_id FROM sessions s WHERE s.root_session_id = ?))",
            (max(0, offset) + 1, max(0, limit), artifact_id, session_id, session_id),
        )
        if row is None:
            return None
        return ArtifactPage(
            text=str(row["page"]),
            offset=max(0, offset),
            size=int(row["size"]),
            kind=str(row["kind"]),
        )

    async def tables(self, session_id: str | None = None) -> list[tuple[str, str, str]]:
        """``(artifact_id, session_id, data)`` of the kept query results, of one session or all."""
        where, args = ("AND session_id = ?", (session_id,)) if session_id else ("", ())
        rows = await self._database.fetch_all(
            f"SELECT artifact_id, session_id, data FROM artifacts WHERE kind = 'table' {where}",
            args,
        )
        return [(str(r["artifact_id"]), str(r["session_id"]), str(r["data"])) for r in rows]

    async def drop(self, artifact_ids: list[str]) -> None:
        """Remove these artifacts."""
        if not artifact_ids:
            return
        async with self._database.transaction() as tx:
            for artifact_id in artifact_ids:
                await tx.execute("DELETE FROM artifacts WHERE artifact_id = ?", (artifact_id,))


__all__ = ["ArtifactStore"]
