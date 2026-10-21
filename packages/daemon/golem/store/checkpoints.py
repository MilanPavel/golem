"""``checkpoints.db``, opened only after a LangGraph upgrade has backed it up.

LangGraph owns that file's format. golem.db's ``library_versions`` keeps the
versions of the packages that last opened it. When one of them changes, the
file is copied to ``checkpoints.db.bak-<langgraph version>`` before the new
code touches it. Losing it costs the model's memory, not the history
(ADR-006), so this is a safety net, not a migration.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.store.backup import backup_path, backup_sqlite
from golem.store.database import Database

log = logging.getLogger("golem.store")

CHECKPOINT_LIBRARIES = ("langgraph", "langgraph-checkpoint", "langgraph-checkpoint-sqlite")
_UNRECORDED = "unrecorded"


def installed_libraries() -> dict[str, str]:
    """The versions of the packages that read and write ``checkpoints.db``."""
    found: dict[str, str] = {}
    for name in CHECKPOINT_LIBRARIES:
        try:
            found[name] = version(name)
        except PackageNotFoundError:
            found[name] = "unknown"
    return found


async def protect_checkpoints(
    database: Database, path: Path, installed: Mapping[str, str]
) -> Path | None:
    """Back up ``path`` if ``installed`` differs from what last opened it.

    Returns the copy, or ``None`` when nothing changed or there is no file.
    The new versions are recorded once the copy exists, before LangGraph opens
    the file, so a start that fails later does not overwrite the copy.
    """
    rows = await database.fetch_all("SELECT name, version FROM library_versions")
    recorded = {str(row["name"]): str(row["version"]) for row in rows}
    if recorded == dict(installed):
        return None
    backup: Path | None = None
    if path.is_file():
        backup = backup_path(path, recorded.get("langgraph", _UNRECORDED))
        await asyncio.to_thread(backup_sqlite, path, backup)
        log.info(
            "copied %s to %s before opening it with langgraph %s",
            path.name,
            backup.name,
            installed.get("langgraph", "unknown"),
        )
    recorded_at = datetime.now(UTC).isoformat()
    async with database.transaction() as tx:
        await tx.execute("DELETE FROM library_versions")
        for name, value in installed.items():
            await tx.execute(
                "INSERT INTO library_versions (name, version, recorded_at) VALUES (?, ?, ?)",
                (name, value, recorded_at),
            )
    return backup


@asynccontextmanager
async def open_checkpoints(
    database: Database, path: Path, installed: Mapping[str, str] | None = None
) -> AsyncGenerator[AsyncSqliteSaver]:
    """Protect ``path``, then open LangGraph's saver on it for the life of the block."""
    await protect_checkpoints(
        database, path, installed_libraries() if installed is None else installed
    )
    async with AsyncSqliteSaver.from_conn_string(str(path)) as saver:
        await saver.setup()
        yield saver


__all__ = ["CHECKPOINT_LIBRARIES", "installed_libraries", "open_checkpoints", "protect_checkpoints"]
