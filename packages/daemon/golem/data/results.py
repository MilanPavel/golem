"""Kept query results: where the files are, which artifact names them, and when they go.

A ``data_query`` result is a Parquet file in ``~/.golem/data/results/``, written by the data
worker (see ``golem.data.parquet``). The tool also records it as an artifact of the kind
``table``, so a result belongs to its session and goes with it. Files older than 30 days go,
then the oldest until all of them take at most 1 GB, once at start and once a day.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from golem.data.types import DataError

log = logging.getLogger(__name__)

MAX_AGE_SECONDS = 30 * 24 * 3600
MAX_BYTES = 1024**3
INTERVAL_SECONDS = 24 * 3600
KIND = "table"
"""The artifact kind of a kept result."""
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_PART_SECONDS = 24 * 3600
"""A half-written file older than this is the leftover of a crash."""


class TableArtifacts(Protocol):
    """The part of the artifact store the results use."""

    async def tables(self, session_id: str | None = None) -> list[tuple[str, str, str]]: ...

    async def drop(self, artifact_ids: list[str]) -> None: ...


@dataclass(frozen=True, slots=True)
class Cleaned:
    files: int
    bytes: int


def wire_rows(rows: Sequence[Sequence[Any]]) -> list[list[Any]]:
    """Rows with a list or a struct as JSON text: a cell on the wire is a scalar."""
    return [
        [json.dumps(v, ensure_ascii=False) if isinstance(v, list | dict) else v for v in row]
        for row in rows
    ]


def table_record(
    *,
    result_id: str,
    source: str,
    sql: str,
    columns: Sequence[dict[str, str]],
    rows: int,
    truncated: bool,
) -> str:
    """The text of a ``table`` artifact: what ``read_artifact`` shows of a kept result."""
    return json.dumps(
        {
            "result_id": result_id,
            "source": source,
            "sql": sql,
            "rows": rows,
            "truncated": truncated,
            "columns": list(columns),
            "created": datetime.now(UTC).isoformat(),
        },
        ensure_ascii=False,
    )


class ResultStore:
    def __init__(
        self,
        directory: Path,
        *,
        max_age: float = MAX_AGE_SECONDS,
        max_bytes: int = MAX_BYTES,
        interval: float = INTERVAL_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.directory = directory
        self.artifacts: TableArtifacts | None = None
        self._max_age = max_age
        self._max_bytes = max_bytes
        self._interval = interval
        self._clock = clock
        self._task: asyncio.Task[None] | None = None

    def path(self, result_id: str) -> Path:
        """The file of a result. Raises :class:`DataError` for an id that is not one of ours."""
        if _ID.match(result_id) is None:
            raise DataError("That is not a result id.")
        return self.directory / f"{result_id}.parquet"

    # -- clean-up ---------------------------------------------------------------------------

    def start(self) -> None:
        """Clean now, then once a day, until :meth:`aclose`."""
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="golem-data-results")

    async def aclose(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _loop(self) -> None:
        while True:
            try:
                await self.clean()
            except Exception:
                log.exception("could not clean the kept query results")
            await asyncio.sleep(self._interval)

    async def clean(self) -> Cleaned:
        """Delete results older than the age limit, then the oldest above the size limit."""
        found = await asyncio.to_thread(self._sweep)
        await self._forget_missing()
        return found

    def _sweep(self) -> Cleaned:
        if not self.directory.is_dir():
            return Cleaned(0, 0)
        now = self._clock()
        files: list[tuple[float, int, Path]] = []
        gone = freed = 0
        for entry in self.directory.iterdir():
            try:
                info = entry.stat()
            except OSError:
                continue
            if entry.suffix == ".part":
                if now - info.st_mtime > _PART_SECONDS:
                    entry.unlink(missing_ok=True)
                continue
            if entry.suffix != ".parquet" or not entry.is_file():
                continue
            if now - info.st_mtime > self._max_age:
                entry.unlink(missing_ok=True)
                gone, freed = gone + 1, freed + info.st_size
                continue
            files.append((info.st_mtime, info.st_size, entry))
        total = sum(size for _, size, _ in files)
        for _, size, entry in sorted(files):
            if total <= self._max_bytes:
                break
            entry.unlink(missing_ok=True)
            total -= size
            gone, freed = gone + 1, freed + size
        return Cleaned(gone, freed)

    async def _forget_missing(self) -> None:
        """Drop the artifacts of results whose file is gone."""
        if self.artifacts is None:
            return
        missing = [
            artifact_id
            for artifact_id, _, data in await self.artifacts.tables()
            if (path := self._file_of(data)) is None or not path.is_file()
        ]
        await self.artifacts.drop(missing)

    def _file_of(self, data: str) -> Path | None:
        try:
            return self.path(str(json.loads(data)["result_id"]))
        except (ValueError, KeyError, TypeError, DataError):
            return None

    async def forget_session(self, session_id: str) -> int:
        """Delete the results of a session that is gone. Returns how many files went."""
        if self.artifacts is None:
            return 0
        found = await self.artifacts.tables(session_id)
        count = 0
        for _, _, data in found:
            path = self._file_of(data)
            if path is not None and path.is_file():
                path.unlink(missing_ok=True)
                count += 1
        await self.artifacts.drop([artifact_id for artifact_id, _, _ in found])
        return count


__all__ = [
    "INTERVAL_SECONDS",
    "KIND",
    "MAX_AGE_SECONDS",
    "MAX_BYTES",
    "Cleaned",
    "ResultStore",
    "TableArtifacts",
    "table_record",
    "wire_rows",
]
