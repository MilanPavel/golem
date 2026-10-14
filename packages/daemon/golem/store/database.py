"""One aiosqlite connection to ``golem.db``.

The daemon is the only writer. Every statement goes through one lock, so a
transaction never interleaves with another coroutine's reads or writes.
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

from golem.store.migrations import MIGRATIONS

Params = tuple[object, ...]


class DatabaseTooNewError(Exception):
    """``golem.db`` was written by a newer daemon."""

    def __init__(self, found: int, supported: int) -> None:
        super().__init__(f"golem.db schema {found} is newer than this daemon ({supported})")
        self.found = found
        self.supported = supported


class Transaction:
    """Statements inside :meth:`Database.transaction`."""

    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._connection = connection

    async def execute(self, sql: str, params: Params = ()) -> int:
        """Run one statement. Returns the number of rows it changed."""
        cursor = await self._connection.execute(sql, params)
        try:
            return cursor.rowcount
        finally:
            await cursor.close()

    async def fetch_all(self, sql: str, params: Params = ()) -> list[sqlite3.Row]:
        return list(await self._connection.execute_fetchall(sql, params))


class Database:
    """Open with :meth:`open`. Reads and writes are serialized."""

    def __init__(self, connection: aiosqlite.Connection) -> None:
        self._connection = connection
        self._lock = asyncio.Lock()

    @classmethod
    @asynccontextmanager
    async def open(cls, path: Path) -> AsyncGenerator[Database]:
        """Connect, apply pragmas and pending migrations, and close on exit."""
        connection = await aiosqlite.connect(path, isolation_level=None)
        try:
            connection.row_factory = sqlite3.Row
            for pragma in (
                "PRAGMA journal_mode = WAL",
                "PRAGMA synchronous = NORMAL",
                "PRAGMA foreign_keys = ON",
                "PRAGMA busy_timeout = 5000",
            ):
                await connection.execute(pragma)
            database = cls(connection)
            await database._migrate()
            yield database
        finally:
            await connection.close()

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[Transaction]:
        """``BEGIN IMMEDIATE`` … ``COMMIT``, or ``ROLLBACK`` on any exception."""
        async with self._lock:
            await self._connection.execute("BEGIN IMMEDIATE")
            try:
                yield Transaction(self._connection)
            except BaseException:
                await self._connection.execute("ROLLBACK")
                raise
            await self._connection.execute("COMMIT")

    async def fetch_all(self, sql: str, params: Params = ()) -> list[sqlite3.Row]:
        async with self._lock:
            return list(await self._connection.execute_fetchall(sql, params))

    async def fetch_one(self, sql: str, params: Params = ()) -> sqlite3.Row | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None

    async def user_version(self) -> int:
        row = await self.fetch_one("PRAGMA user_version")
        return 0 if row is None else int(row[0])

    async def _migrate(self) -> None:
        current = await self.user_version()
        if current > len(MIGRATIONS):
            raise DatabaseTooNewError(current, len(MIGRATIONS))
        for version, statements in enumerate(MIGRATIONS[current:], start=current + 1):
            async with self.transaction() as tx:
                for statement in statements:
                    await tx.execute(statement)
                await tx.execute(f"PRAGMA user_version = {version}")


__all__ = ["Database", "DatabaseTooNewError", "Params", "Transaction"]
