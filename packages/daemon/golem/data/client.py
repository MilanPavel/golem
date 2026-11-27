"""The daemon's side of the data worker: one child process, started on the first request.

The worker is :mod:`golem.data.worker`, one JSON line each way (the pattern of
``golem.mcp.transport.StdioTransport``). A query that runs past its time limit is
cancelled, and when the worker has not answered ``kill_after`` seconds later it is killed.
A worker that exits starts again on the next request, after a wait that doubles from
``backoff_first`` to ``backoff_max`` and goes back to the first after a minute of running.
The sources it had are attached again by the new worker. Anything a source will need to
sign in with goes over the pipe, never in argv or the environment.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from golem.config import DataSettings
from golem.data.types import EXTENSION_FILES, DataError, SourceSpec
from golem.paths import GolemPaths

log = logging.getLogger(__name__)

MAX_LINE_BYTES = 64 * 1024 * 1024
"""The longest answer: 10000 rows of wide text fit well inside it."""
STDERR_LINES = 200
LOAD_BATCH = 5000
"""Rows of one ``load_table`` request."""


@dataclass(frozen=True, slots=True)
class Timing:
    """How long the client waits. Tests make it fast."""

    backoff_first: float = 0.5
    backoff_max: float = 30.0
    stable_seconds: float = 60.0
    kill_after: float = 2.0
    stop_seconds: float = 2.0
    install_seconds: float = 300.0


DEFAULT_TIMING = Timing()


def worker_argv() -> list[str]:
    """How to start the worker. A frozen app cannot run ``-m``: its binary has a subcommand."""
    if getattr(sys, "frozen", False):
        return [sys.executable, "data-worker"]
    return [sys.executable, "-m", "golem.data.worker"]


class DataWorker:
    def __init__(
        self,
        settings: DataSettings,
        paths: GolemPaths,
        *,
        argv: list[str] | None = None,
        timing: Timing = DEFAULT_TIMING,
    ) -> None:
        self._settings = settings
        self._paths = paths
        self._argv = argv if argv is not None else worker_argv()
        self._timing = timing
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr: deque[str] = deque(maxlen=STDERR_LINES)
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._tags: dict[str, int] = {}
        self._next_id = 0
        self._sources: dict[str, SourceSpec] = {}
        self._info: dict[str, dict[str, Any]] = {}
        self._start_lock = asyncio.Lock()
        self._failures = 0
        self._started_at = 0.0
        self._retry_at = 0.0
        self._closed = False

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self.running and self._process is not None else None

    def stderr_tail(self, count: int) -> list[str]:
        return list(self._stderr)[-count:]

    # -- what a caller asks for ---------------------------------------------------------------

    def server_info(self, name: str) -> dict[str, Any]:
        """What a database told on connect (``version``, ``can_write``). Empty for a file."""
        return self._info.get(name, {})

    async def attach(self, spec: SourceSpec) -> list[dict[str, Any]]:
        """Open a source. It stays open, and a restarted worker opens it again."""
        result = await self.request(
            "attach", self._attach_args(spec), timeout=self._attach_seconds()
        )
        self._sources[spec.name] = spec
        self._info[spec.name] = result.get("info") or {}
        return result["tables"]

    async def detach(self, name: str) -> None:
        self._sources.pop(name, None)
        self._info.pop(name, None)
        if self.running:
            await self.request("detach", {"name": name}, timeout=10)

    async def tables(self, source: str) -> list[dict[str, str]]:
        return (await self.request("tables", {"source": source}, timeout=30))["tables"]

    async def describe(self, source: str, table: str) -> dict[str, Any]:
        timeout = self._settings.query_timeout_seconds
        return await self.request("describe", {"source": source, "table": table}, timeout=timeout)

    async def profile(self, source: str, table: str, *, tag: str | None = None) -> dict[str, Any]:
        """The shape of each column of one table: shapes, counts, bins and top values."""
        timeout = self._settings.query_timeout_seconds
        return await self.request(
            "profile", {"source": source, "table": table}, timeout=timeout, tag=tag
        )

    async def browse(
        self, source: str, table: str, args: dict[str, Any], *, tag: str | None = None
    ) -> dict[str, Any]:
        """One page of a table: ``columns``, ``rows``, ``total_rows`` (when asked), ``elapsed_ms``.

        ``args`` hold ``offset``, ``limit``, ``sort``, ``filters``, ``search`` and ``count``.
        The worker builds the SQL from them and checks every name.
        """
        timeout = self._settings.query_timeout_seconds
        return await self.request(
            "browse", {"source": source, "table": table, **args}, timeout=timeout, tag=tag
        )

    async def browse_keep(
        self,
        source: str,
        table: str,
        args: dict[str, Any],
        *,
        store: Path,
        result_id: str,
        label: str,
    ) -> dict[str, Any]:
        """The whole view of a table into a kept result file, up to the usual row cap.

        ``args`` hold ``sort``, ``filters`` and ``search``. The worker builds the SQL as
        :meth:`browse` does.
        """
        sent: dict[str, Any] = {
            "source": source,
            "table": table,
            "sort": args.get("sort"),
            "filters": args.get("filters") or [],
            "search": args.get("search"),
            "limit": self._settings.max_rows,
            "store": str(store),
            "label": label,
        }
        return await self.request(
            "browse", sent, timeout=self._settings.query_timeout_seconds, tag=result_id
        )

    async def query(
        self,
        source: str,
        sql: str,
        limit: int | None = None,
        *,
        result_id: str | None = None,
        store: Path | None = None,
    ) -> dict[str, Any]:
        """Run ``sql`` over ``source``: columns, rows, ``truncated`` and ``elapsed_ms``.

        With ``result_id`` the query can be stopped by :meth:`cancel` while it runs. With
        ``store`` the rows are also written to that Parquet file.
        """
        rows = min(limit or self._settings.max_rows, self._settings.max_rows)
        args: dict[str, Any] = {"source": source, "sql": sql, "limit": rows}
        if store is not None:
            args["store"] = str(store)
        return await self.request(
            "query", args, timeout=self._settings.query_timeout_seconds, tag=result_id
        )

    async def result_page(
        self,
        path: Path,
        offset: int,
        limit: int,
        sort_column: str | None = None,
        sort_desc: bool = False,
    ) -> dict[str, Any]:
        """``limit`` rows from ``offset`` of a kept result file: columns, rows, ``total_rows``."""
        args = {
            "path": str(path),
            "offset": offset,
            "limit": limit,
            "sort_column": sort_column,
            "sort_desc": sort_desc,
        }
        return await self.request("result_page", args, timeout=self._settings.query_timeout_seconds)

    async def export(self, path: Path, target: Path, fmt: str) -> int:
        """Write all rows of the kept result file ``path`` to the new file ``target``."""
        args = {
            "path": str(path),
            "target": str(target),
            "format": fmt,
            "extension_dir": str(self._paths.data_extensions_dir),
        }
        answer = await self.request("export", args, timeout=self._settings.query_timeout_seconds)
        return int(answer["rows"])

    async def load_table(
        self,
        source: str,
        table: str,
        columns: list[dict[str, str]],
        rows: list[list[Any]],
        *,
        batch: int = LOAD_BATCH,
    ) -> int:
        """Fill ``table`` of the built-in source with ``rows``, replacing what it had.

        Rows go in batches, so one request never nears the line limit. Returns the row count.
        """
        count = 0
        for start in range(0, max(len(rows), 1), batch):
            args = {
                "source": source,
                "table": table,
                "columns": columns,
                "rows": rows[start : start + batch],
                "replace": start == 0,
            }
            answer = await self.request("load_table", args, timeout=60)
            count = int(answer["rows"])
        return count

    async def cancel(self, result_id: str) -> bool:
        """Stop the running query started with ``result_id``. False when none is running."""
        ident = self._tags.get(result_id)
        process = self._process
        if ident is None or process is None or process.returncode is not None:
            return False
        await self._send(process, {"id": 0, "op": "cancel", "args": {"id": ident}})
        return True

    async def ensure_extension(self, name: str) -> None:
        """Install DuckDB's extension ``name`` into golem's folder, once. Never at query time."""
        from golem.data.engine import extension_installed

        directory = self._paths.data_extensions_dir
        if name not in EXTENSION_FILES:
            raise DataError(f"golem has no data extension called {name}.")
        if extension_installed(directory, name):
            return
        await self.request(
            "install_extension",
            {"name": name, "extension_dir": str(directory)},
            timeout=self._timing.install_seconds,
        )

    async def request(
        self, op: str, args: dict[str, Any], timeout: float | None = None, *, tag: str | None = None
    ) -> Any:
        """Send one request and wait for its answer. Raises :class:`DataError`.

        ``tag`` names the request, so :meth:`cancel` can stop it.
        """
        process = await self._ensure_started()
        self._next_id += 1
        ident = self._next_id
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[ident] = future
        if tag is not None:
            self._tags[tag] = ident
        try:
            await self._send(process, {"id": ident, "op": op, "args": args})
            if timeout is None:
                return await future
            try:
                return await asyncio.wait_for(asyncio.shield(future), timeout)
            except TimeoutError:
                await self._cut(process, ident, future, timeout)
                raise DataError(
                    f"The query took longer than {timeout:g} seconds and was cancelled."
                ) from None
        finally:
            self._pending.pop(ident, None)
            if tag is not None and self._tags.get(tag) == ident:
                del self._tags[tag]

    async def close(self) -> None:
        """Close stdin, then SIGTERM, then SIGKILL, as the stdio transport does."""
        self._closed = True
        await self._stop()

    # -- the process --------------------------------------------------------------------------

    def _attach_args(self, spec: SourceSpec) -> dict[str, Any]:
        return {
            "spec": spec.to_json(),
            "memory": self._settings.worker_memory,
            "threads": self._settings.threads,
            "extension_dir": str(self._paths.data_extensions_dir),
            "temp_dir": str(self._paths.data_temp_dir),
        }

    def _attach_seconds(self) -> float:
        return max(self._settings.query_timeout_seconds, 60.0)

    async def _ensure_started(self) -> asyncio.subprocess.Process:
        if self._closed:
            raise DataError("The data engine is shut down.")
        async with self._start_lock:
            process = self._process
            if process is not None and process.returncode is None:
                return process
            wait = self._retry_at - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            await self._spawn()
            assert self._process is not None
            for spec in list(self._sources.values()):
                try:
                    await self._call_started(
                        "attach", self._attach_args(spec), self._attach_seconds()
                    )
                except DataError as exc:
                    log.warning("data source %s did not come back: %s", spec.name, exc)
            return self._process

    async def _call_started(self, op: str, args: dict[str, Any], timeout: float) -> Any:
        """A request made while ``_ensure_started`` holds the lock: no start of its own."""
        process = self._process
        assert process is not None
        self._next_id += 1
        ident = self._next_id
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[ident] = future
        try:
            await self._send(process, {"id": ident, "op": op, "args": args})
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            raise DataError(f"The data worker did not answer {op} in time.") from None
        finally:
            self._pending.pop(ident, None)

    async def _spawn(self) -> None:
        try:
            process = await asyncio.create_subprocess_exec(
                *self._argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=MAX_LINE_BYTES,
                start_new_session=True,
            )
        except OSError as exc:
            self._failed()
            raise DataError(f"The data worker did not start: {exc.strerror or exc}") from exc
        self._process = process
        self._started_at = time.monotonic()
        self._reader = asyncio.create_task(self._read_stdout(process), name="data-stdout")
        self._stderr_task = asyncio.create_task(self._read_stderr(process), name="data-stderr")

    def _failed(self) -> None:
        """Note an exit nobody asked for, and set how long the next start waits."""
        if time.monotonic() - self._started_at >= self._timing.stable_seconds:
            self._failures = 0
        delay = min(self._timing.backoff_first * (2**self._failures), self._timing.backoff_max)
        self._failures += 1
        self._retry_at = time.monotonic() + delay

    async def _send(self, process: asyncio.subprocess.Process, message: dict[str, Any]) -> None:
        if process.stdin is None or process.returncode is not None:
            raise DataError(self._exit_reason(process))
        try:
            process.stdin.write(json.dumps(message, ensure_ascii=False).encode() + b"\n")
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise DataError(self._exit_reason(process)) from exc

    async def _cut(
        self,
        process: asyncio.subprocess.Process,
        ident: int,
        future: asyncio.Future[Any],
        timeout: float,
    ) -> None:
        """Cancel a request that ran out of time; kill the worker when it ignores that."""
        with contextlib.suppress(DataError):
            await self._send(process, {"id": 0, "op": "cancel", "args": {"id": ident}})
        try:
            await asyncio.wait_for(asyncio.shield(future), self._timing.kill_after)
        except TimeoutError:
            log.warning("the data worker ignored a cancel after %gs: killing it", timeout)
            self._kill(process)
        except DataError:
            pass  # it answered, with the cancel's error

    def _kill(self, process: asyncio.subprocess.Process) -> None:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal.SIGKILL)

    async def _stop(self) -> None:
        process, self._process = self._process, None
        if process is not None:
            if process.stdin is not None:
                with contextlib.suppress(OSError):
                    process.stdin.close()
            if process.returncode is None:
                for sig in (None, signal.SIGTERM, signal.SIGKILL):
                    if sig is not None:
                        with contextlib.suppress(ProcessLookupError, PermissionError):
                            os.killpg(process.pid, sig)
                    try:
                        await asyncio.wait_for(process.wait(), self._timing.stop_seconds)
                        break
                    except TimeoutError:
                        continue
        for task in (self._reader, self._stderr_task):
            if task is not None and task is not asyncio.current_task():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        self._reader = self._stderr_task = None
        self._fail_pending("The data engine is shut down.")

    async def _read_stdout(self, process: asyncio.subprocess.Process) -> None:
        assert process.stdout is not None
        try:
            while line := await process.stdout.readline():
                self._deliver(line)
        except ValueError:
            log.warning("the data worker sent an answer over %d MB", MAX_LINE_BYTES // 2**20)
            self._kill(process)
        await process.wait()
        if self._process is process:
            self._process = None
            if not self._closed:
                self._failed()
        self._fail_pending(self._exit_reason(process))

    def _deliver(self, line: bytes) -> None:
        try:
            message = json.loads(line)
            future = self._pending.get(message["id"])
        except (ValueError, KeyError, TypeError):
            log.debug("the data worker wrote a line that is not an answer")
            return
        if future is None or future.done():
            return
        if message.get("ok"):
            future.set_result(message.get("result"))
        else:
            future.set_exception(DataError(str(message.get("error", "The data worker failed."))))

    def _fail_pending(self, reason: str) -> None:
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(DataError(reason))

    async def _read_stderr(self, process: asyncio.subprocess.Process) -> None:
        assert process.stderr is not None
        with contextlib.suppress(ValueError):
            while line := await process.stderr.readline():
                text = line.decode(errors="replace").rstrip()
                if text:
                    self._stderr.append(text)
                    log.debug("data worker: %s", text)

    def _exit_reason(self, process: asyncio.subprocess.Process) -> str:
        code = process.returncode
        said = self._stderr[-1] if self._stderr else ""
        reason = (
            "The data worker stopped"
            if code is None
            else f"The data worker stopped (exit code {code})"
        )
        return f"{reason}: {said}" if said else f"{reason}. Try the query again."
