"""``memory.db``: the records of long-term memory and word search over them (ADR-061).

This store holds rows and keeps the search table in step. It has no rule about
who may write or what a memory may say: the service on top of it owns those.
"""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncGenerator, Iterable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, cast

from golem import __version__
from golem.memory.migrations import has_fts5, migrations
from golem.memory.records import (
    SCOPES,
    Author,
    KeptBy,
    MemoryRecord,
    Privacy,
    Scope,
    SourceRow,
    State,
)
from golem.memory.search import like_pattern, match_expression, words
from golem.store.database import Database, Params, Transaction

SearchKind = Literal["fts", "like"]

_COLUMNS = (
    "id, scope, folder, session_id, title, text, author, agent, call_id, state, kept_by,"
    " privacy, always, uses, last_used_at, created_at, updated_at"
)
_SOURCE_COLUMNS = "memory_id, path, sha256, size, mtime_ns, checked_at"
_INSERT = f"INSERT INTO memories ({_COLUMNS}) VALUES ({', '.join('?' * 17)})"
_SEARCH_TABLE = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'"
_NEWEST_FIRST = "ORDER BY created_at DESC, id DESC"

Records = list[MemoryRecord]
"""``list`` is a method name in the class, so its signatures use this."""


class MemoryStore:
    """Open with :meth:`open`. Every method is one statement or one transaction."""

    def __init__(self, database: Database, *, search_kind: SearchKind) -> None:
        self._database = database
        self.search_kind: SearchKind = search_kind
        """``fts`` ranks with FTS5. ``like`` is the fallback: substrings, newest first."""

    @classmethod
    @asynccontextmanager
    async def open(
        cls, path: Path, *, fts: bool | None = None, golem_version: str = __version__
    ) -> AsyncGenerator[MemoryStore]:
        """Open ``memory.db`` with its own migrations, and close on exit.

        ``fts`` says whether to make the FTS5 table. None asks SQLite. A file made
        without it keeps searching with ``LIKE``.
        """
        use_fts = has_fts5() if fts is None else fts
        async with Database.open(
            path, migrations(fts=use_fts), golem_version=golem_version
        ) as database:
            has_table = await database.fetch_one(_SEARCH_TABLE) is not None
            yield cls(database, search_kind="fts" if use_fts and has_table else "like")

    async def add(self, record: MemoryRecord) -> None:
        """Insert a memory and its sources. The id must be new."""
        async with self._database.transaction() as tx:
            await tx.execute(_INSERT, _values(record))
            await _write_sources(tx, record)

    async def get(self, memory_id: str) -> MemoryRecord | None:
        records = await self._read(f"SELECT {_COLUMNS} FROM memories WHERE id = ?", (memory_id,))
        return records[0] if records else None

    async def update(self, record: MemoryRecord) -> bool:
        """Replace everything but ``id`` and ``created_at``, sources included.

        Returns False when there is no such memory.
        """
        async with self._database.transaction() as tx:
            changed = await tx.execute(
                "UPDATE memories SET scope = ?, folder = ?, session_id = ?, title = ?, text = ?,"
                " author = ?, agent = ?, call_id = ?, state = ?, kept_by = ?, privacy = ?,"
                " always = ?, uses = ?, last_used_at = ?, updated_at = ? WHERE id = ?",
                (*_values(record)[1:15], record.updated_at, record.id),
            )
            if changed:
                await tx.execute("DELETE FROM memory_sources WHERE memory_id = ?", (record.id,))
                await _write_sources(tx, record)
            return changed > 0

    async def delete_many(self, ids: Iterable[str]) -> int:
        """Delete memories, their sources and their search entries. Returns how many existed."""
        deleted = 0
        async with self._database.transaction() as tx:
            for memory_id in dict.fromkeys(ids):
                deleted += await tx.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        return deleted

    async def list(
        self,
        scope: Scope | None = None,
        folder: str | None = None,
        state: State | None = None,
        limit: int = 50,
        after: str | None = None,
    ) -> Records:
        """Newest first. ``after`` is the id of the last row of the page before.

        An ``after`` that is not a memory gives an empty page.
        """
        where, params = _filters(scope, folder, state)
        if after is not None:
            where.append("(created_at, id) < (SELECT created_at, id FROM memories WHERE id = ?)")
            params.append(after)
        return await self._read(
            f"SELECT {_COLUMNS} FROM memories{_where(where)} {_NEWEST_FIRST} LIMIT ?",
            (*params, limit),
        )

    async def counts(
        self, folder: str | None = None, state: State | None = None
    ) -> dict[Scope, int]:
        """How many memories each scope has, filtered like :meth:`list`."""
        where, params = _filters(None, folder, state)
        rows = await self._database.fetch_all(
            f"SELECT scope, count(*) AS n FROM memories{_where(where)} GROUP BY scope",
            tuple(params),
        )
        found = {str(row["scope"]): int(row["n"]) for row in rows}
        return {scope: found.get(scope, 0) for scope in SCOPES}

    async def tally(self, folder: str | None) -> list[tuple[Scope, Privacy, int]]:
        """How many kept memories there are by scope and stamp: yours, ``folder``'s, history."""
        rows = await self._database.fetch_all(
            "SELECT scope, privacy, count(*) AS n FROM memories WHERE state = 'kept' AND"
            " (scope != 'project' OR folder = ?) GROUP BY scope, privacy",
            (folder,),
        )
        return [
            (cast(Scope, str(r["scope"])), cast(Privacy, str(r["privacy"])), int(r["n"]))
            for r in rows
        ]

    async def search(
        self,
        query: str,
        scope: Scope | None = None,
        folder: str | None = None,
        limit: int = 8,
    ) -> Records:
        """Memories that hold any word of ``query``, best first.

        With FTS5 the words match by stem ("retries" finds "retry") and rank with
        ``bm25``, a ``title`` hit worth twice a ``text`` hit. With ``LIKE`` they
        match as substrings and come newest first. A query with no word finds nothing.
        """
        found = words(query)
        if not found:
            return []
        where, params = _filters(scope, folder, None)
        if self.search_kind == "fts":
            # bm25 only works inside the query that has the MATCH, so rank there.
            return await self._read(
                f"SELECT {_COLUMNS} FROM memories JOIN"
                " (SELECT id AS hit, bm25(memory_fts, 0.0, 2.0, 1.0) AS rank FROM memory_fts"
                " WHERE memory_fts MATCH ?) ON hit = id"
                f"{_where(where)} ORDER BY rank, created_at DESC, id DESC LIMIT ?",
                (match_expression(query), *params, limit),
            )
        like = "(title LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')"
        where.append("(" + " OR ".join([like] * len(found)) + ")")
        for word in found:
            params.extend((like_pattern(word),) * 2)
        return await self._read(
            f"SELECT {_COLUMNS} FROM memories{_where(where)} {_NEWEST_FIRST} LIMIT ?",
            (*params, limit),
        )

    async def _read(self, sql: str, params: Params) -> Records:
        rows = await self._database.fetch_all(sql, params)
        if not rows:
            return []
        marks = ", ".join("?" * len(rows))
        sources = await self._database.fetch_all(
            f"SELECT {_SOURCE_COLUMNS} FROM memory_sources WHERE memory_id IN ({marks})"
            " ORDER BY path",
            tuple(row["id"] for row in rows),
        )
        by_memory: dict[str, list[SourceRow]] = {}
        for source in sources:
            by_memory.setdefault(str(source["memory_id"]), []).append(_source(source))
        return [_record(row, tuple(by_memory.get(str(row["id"]), ()))) for row in rows]


def _where(clauses: list[str]) -> str:
    return " WHERE " + " AND ".join(clauses) if clauses else ""


def _filters(
    scope: Scope | None, folder: str | None, state: State | None
) -> tuple[list[str], list[object]]:
    where: list[str] = []
    params: list[object] = []
    for column, value in (("scope", scope), ("folder", folder), ("state", state)):
        if value is not None:
            where.append(f"{column} = ?")
            params.append(value)
    return where, params


def _values(record: MemoryRecord) -> Params:
    return (
        record.id,
        record.scope,
        record.folder,
        record.session_id,
        record.title,
        record.text,
        record.author,
        record.agent,
        record.call_id,
        record.state,
        record.kept_by,
        record.privacy,
        int(record.always),
        record.uses,
        record.last_used_at,
        record.created_at,
        record.updated_at,
    )


async def _write_sources(tx: Transaction, record: MemoryRecord) -> None:
    for source in record.sources:
        await tx.execute(
            f"INSERT INTO memory_sources ({_SOURCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)",
            (
                record.id,
                source.path,
                source.sha256,
                source.size,
                source.mtime_ns,
                source.checked_at,
            ),
        )


def _record(row: sqlite3.Row, sources: tuple[SourceRow, ...]) -> MemoryRecord:
    return MemoryRecord(
        id=str(row["id"]),
        scope=cast(Scope, row["scope"]),
        folder=row["folder"],
        session_id=row["session_id"],
        title=str(row["title"]),
        text=str(row["text"]),
        author=cast(Author, row["author"]),
        agent=row["agent"],
        call_id=row["call_id"],
        state=cast(State, row["state"]),
        kept_by=cast(KeptBy | None, row["kept_by"]),
        privacy=cast(Privacy, row["privacy"]),
        always=bool(row["always"]),
        uses=int(row["uses"]),
        last_used_at=row["last_used_at"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        sources=sources,
    )


def _source(row: sqlite3.Row) -> SourceRow:
    return SourceRow(
        path=str(row["path"]),
        sha256=str(row["sha256"]),
        size=int(row["size"]),
        mtime_ns=int(row["mtime_ns"]),
        checked_at=str(row["checked_at"]),
    )


__all__ = ["MemoryStore", "SearchKind"]
