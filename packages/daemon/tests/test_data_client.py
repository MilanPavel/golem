"""The data worker as the daemon runs it: a real child process, lazy start, limits and restarts."""

from __future__ import annotations

import asyncio
import os
import signal
import sys
import time
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from golem.config import DataSettings
from golem.data.client import DataWorker, Timing, worker_argv
from golem.data.types import DataError, SourceSpec
from golem.paths import GolemPaths

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
SLOW_QUERY = "select count(*) from range(1000000000000) a, range(1000000000000) b"
HANGING_WORKER = """
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if request["op"] == "ping":
        print(json.dumps({"id": request["id"], "ok": True, "result": {}}), flush=True)
"""


@pytest.fixture
def csv_folder(tmp_path: Path) -> Path:
    folder = tmp_path / "files"
    folder.mkdir()
    lines = "\n".join(str(n) for n in range(50))
    (folder / "numbers.csv").write_text(f"n\n{lines}\n")
    return folder


def _settings(**extra: float) -> DataSettings:
    return DataSettings.model_validate({"query_timeout_seconds": 5, "threads": 1, **extra})


@pytest.fixture
async def worker(tmp_path: Path) -> AsyncIterator[DataWorker]:
    client = DataWorker(_settings(), GolemPaths(tmp_path / "home"), timing=FAST)
    yield client
    await client.close()


def _spec(folder: Path) -> SourceSpec:
    return SourceSpec(name="nums", kind="files", location=str(folder / "*.csv"))


def test_a_frozen_app_starts_the_worker_through_a_subcommand(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert worker_argv() == [sys.executable, "-m", "golem.data.worker"]
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert worker_argv() == [sys.executable, "data-worker"]


async def test_the_worker_starts_on_the_first_request(worker: DataWorker, csv_folder: Path) -> None:
    assert worker.pid is None
    tables = await worker.attach(_spec(csv_folder))
    assert tables == [{"name": "numbers", "type": "view"}]
    assert worker.pid is not None
    result = await worker.query("nums", "select count(*) as c from numbers")
    assert result["rows"] == [[50]]
    assert result["columns"] == [{"name": "c", "type": "BIGINT"}]
    described = await worker.describe("nums", "numbers")
    assert described["rows"] == 50


async def test_a_query_over_the_row_limit_is_cut(tmp_path: Path, csv_folder: Path) -> None:
    client = DataWorker(_settings(max_rows=10), GolemPaths(tmp_path / "home"), timing=FAST)
    try:
        await client.attach(_spec(csv_folder))
        cut = await client.query("nums", "select * from numbers")
        assert len(cut["rows"]) == 10
        assert cut["truncated"] is True
        asked = await client.query("nums", "select * from numbers", limit=3)
        assert len(asked["rows"]) == 3
        assert asked["truncated"] is True
        over = await client.query("nums", "select * from numbers", limit=5000)
        assert len(over["rows"]) == 10
    finally:
        await client.close()


async def test_a_refused_query_is_a_plain_error_and_the_worker_stays(
    worker: DataWorker, csv_folder: Path
) -> None:
    await worker.attach(_spec(csv_folder))
    pid = worker.pid
    with pytest.raises(DataError, match="Only one statement per query"):
        await worker.query("nums", "select 1; select 2")
    with pytest.raises(DataError, match="Catalog Error"):
        await worker.query("nums", "select * from missing")
    with pytest.raises(DataError, match="The source nope is not attached"):
        await worker.query("nope", "select 1")
    assert worker.pid == pid
    assert (await worker.query("nums", "select 1"))["rows"] == [[1]]


async def test_a_slow_query_is_cancelled_at_the_time_limit_and_the_next_one_works(
    tmp_path: Path, csv_folder: Path
) -> None:
    client = DataWorker(
        _settings(query_timeout_seconds=0.5), GolemPaths(tmp_path / "home"), timing=FAST
    )
    try:
        await client.attach(_spec(csv_folder))
        pid = client.pid
        started = time.monotonic()
        with pytest.raises(DataError, match=r"longer than 0\.5 seconds and was cancelled"):
            await client.query("nums", SLOW_QUERY)
        assert time.monotonic() - started < 3
        assert client.pid == pid  # cancelled, not killed
        assert (await client.query("nums", "select count(*) from numbers"))["rows"] == [[50]]
    finally:
        await client.close()


async def test_a_worker_that_ignores_the_cancel_is_killed_and_replaced(tmp_path: Path) -> None:
    script = tmp_path / "hang.py"
    script.write_text(HANGING_WORKER)
    client = DataWorker(
        _settings(), GolemPaths(tmp_path / "home"), argv=[sys.executable, str(script)], timing=FAST
    )
    try:
        await client.request("ping", {})
        first = client.pid
        assert first is not None
        with pytest.raises(DataError, match=r"longer than 0\.2 seconds"):
            await client.request("hang", {}, timeout=0.2)
        await asyncio.sleep(0.1)
        assert client.pid is None
        with pytest.raises(ProcessLookupError):
            os.kill(first, 0)
        await client.request("ping", {})
        assert client.pid is not None
        assert client.pid != first
    finally:
        await client.close()


async def test_killing_the_worker_mid_query_is_a_clean_error_and_the_next_request_restarts(
    tmp_path: Path, csv_folder: Path
) -> None:
    timing = Timing(backoff_first=0.3, backoff_max=0.3, kill_after=0.3, stop_seconds=1.0)
    client = DataWorker(_settings(), GolemPaths(tmp_path / "home"), timing=timing)
    try:
        await client.attach(_spec(csv_folder))
        first = client.pid
        assert first is not None
        running = asyncio.create_task(client.query("nums", SLOW_QUERY))
        await asyncio.sleep(0.5)
        os.killpg(first, signal.SIGKILL)
        with pytest.raises(DataError, match="The data worker stopped"):
            await running
        started = time.monotonic()
        # The new worker attaches the source again by itself.
        result = await client.query("nums", "select count(*) from numbers")
        assert result["rows"] == [[50]]
        assert time.monotonic() - started >= 0.25  # the backoff
        assert client.pid not in (None, first)
    finally:
        await client.close()


async def test_close_stops_the_worker_and_later_requests_are_refused(
    worker: DataWorker, csv_folder: Path
) -> None:
    await worker.attach(_spec(csv_folder))
    pid = worker.pid
    assert pid is not None
    await worker.close()
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
    with pytest.raises(DataError, match="shut down"):
        await worker.query("nums", "select 1")


async def test_an_extension_already_installed_needs_no_worker(tmp_path: Path) -> None:
    paths = GolemPaths(tmp_path / "home")
    client = DataWorker(_settings(), paths, timing=FAST)
    try:
        extension = (
            paths.data_extensions_dir / "v1.5.5" / "osx_arm64" / "sqlite_scanner.duckdb_extension"
        )
        extension.parent.mkdir(parents=True)
        extension.write_bytes(b"")
        await client.ensure_extension("sqlite")
        assert client.pid is None
        with pytest.raises(DataError, match="no data extension called nope"):
            await client.ensure_extension("nope")
    finally:
        await client.close()


async def test_a_worker_that_cannot_start_is_a_plain_error(tmp_path: Path) -> None:
    client = DataWorker(
        _settings(), GolemPaths(tmp_path / "home"), argv=[str(tmp_path / "missing")], timing=FAST
    )
    with pytest.raises(DataError, match="did not start"):
        await client.request("ping", {})
    await client.close()
