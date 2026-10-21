"""One aiosqlite connection to ``golem.db``.

The daemon is the only writer. Every statement goes through one lock, so a
transaction never interleaves with another coroutine's reads or writes.

Opening upgrades the file: it copies it to ``golem.db.bak-<schema>`` first,
then runs each pending migration in its own transaction and records it in
``schema_version``. A file from a newer daemon is refused, never changed.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import aiosqlite

from golem import __version__
from golem.store.backup import backup_path, backup_sqlite
from golem.store.migrations import MIGRATIONS

log = logging.getLogger("golem.store")

Params = tuple[object, ...]

_HAS_HISTORY = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"


class DatabaseTooNewError(Exception):
    """``golem.db`` was written by a newer daemon.

    ``needs`` is the golem version that upgraded it to ``found``, when the file
    recorded one. ``backup`` is the copy from before that upgrade, which this
    daemon can still open, when it exists.
    """

    def __init__(
        self,
        found: int,
        supported: int,
        *,
        needs: str | None = None,
        backup: Path | None = None,
    ) -> None:
        message = f"golem.db is at schema {found}, and this daemon reads up to schema {supported}."
        if needs is not None:
            message += f" It needs golem {needs} or newer."
        if backup is not None:
            message += f" {backup.name}, the copy from before that upgrade, opens with this one."
        super().__init__(message)
        self.found = found
        self.supported = supported
        self.needs = needs
        self.backup = backup


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
    async def open(
        cls, path: Path, *, golem_version: str = __version__
    ) -> AsyncGenerator[Database]:
        """Connect, apply pragmas and pending migrations, and close on exit.

        ``golem_version`` is recorded with each migration this call applies.
        """
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
            await database._migrate(path, golem_version)
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

    async def _migrate(self, path: Path, golem_version: str) -> None:
        current = await self.user_version()
        latest = len(MIGRATIONS)
        if current > latest:
            backup = backup_path(path, str(latest))
            raise DatabaseTooNewError(
                current,
                latest,
                needs=await self._written_by(current),
                backup=backup if backup.is_file() else None,
            )
        if current == latest:
            return
        if current > 0:
            backup = backup_path(path, str(current))
            await asyncio.to_thread(backup_sqlite, path, backup)
            log.info(
                "copied %s to %s before upgrading it to schema %d", path.name, backup.name, latest
            )
        applied_at = datetime.now(UTC).isoformat()
        for version, statements in enumerate(MIGRATIONS[current:], start=current + 1):
            async with self.transaction() as tx:
                for statement in statements:
                    await tx.execute(statement)
                if await tx.fetch_all(_HAS_HISTORY):
                    await tx.execute(
                        "INSERT INTO schema_version (version, golem_version, applied_at)"
                        " VALUES (?, ?, ?)",
                        (version, golem_version, applied_at),
                    )
                await tx.execute(f"PRAGMA user_version = {version}")

    async def _written_by(self, version: int) -> str | None:
        """The golem version that migrated this file to ``version``, if it says."""
        try:
            row = await self.fetch_one(
                "SELECT golem_version FROM schema_version WHERE version = ?", (version,)
            )
        except sqlite3.OperationalError:
            return None
        return None if row is None else str(row[0])


__all__ = ["Database", "DatabaseTooNewError", "Params", "Transaction"]
