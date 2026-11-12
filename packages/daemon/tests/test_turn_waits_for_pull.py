"""A turn whose model is still downloading waits for the download, then runs."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fakes import ToolCallingChatModel
from test_unreachable import _Daemon, _failed  # pyright: ignore[reportPrivateUsage]

from golem.models.pulls import PullError
from golem.store.database import Database
from golem_protocol.events import RunCompletedEvent, RunStartedEvent

REF = "ollama/qwen3:8b"


async def test_a_turn_waits_until_its_model_has_landed(database: Database, tmp_path: Path) -> None:
    daemon = _Daemon(database, ToolCallingChatModel(replies=["here"]), tmp_path)
    landed = asyncio.Event()
    asked: list[str] = []

    async def until_pulled(ref: str) -> None:
        asked.append(ref)
        await landed.wait()

    daemon.manager._runtime.until_pulled = until_pulled  # pyright: ignore[reportPrivateUsage]
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "hi")
    await asyncio.sleep(0.1)
    started = await daemon.events.for_run(run_id)
    assert any(isinstance(e, RunStartedEvent) for e in started)
    assert not any(isinstance(e, RunCompletedEvent) for e in started)
    assert asked == [REF]
    landed.set()
    events = await daemon.settled(run_id)
    assert isinstance(events[-1], RunCompletedEvent)


async def test_a_failed_download_ends_the_waiting_turn_with_its_error(
    database: Database, tmp_path: Path
) -> None:
    daemon = _Daemon(database, ToolCallingChatModel(replies=["never"]), tmp_path)

    async def until_pulled(ref: str) -> None:
        raise PullError(f"the download of {ref} failed: disk full")

    daemon.manager._runtime.until_pulled = until_pulled  # pyright: ignore[reportPrivateUsage]
    session_id = await daemon.manager.create(None)
    failed = _failed(await daemon.settled(await daemon.manager.send(session_id, "hi")))
    assert failed.data.message == f"the download of {REF} failed: disk full"


async def test_no_pull_manager_means_no_wait(database: Database, tmp_path: Path) -> None:
    daemon = _Daemon(database, ToolCallingChatModel(replies=["ok"]), tmp_path)
    assert daemon.manager._runtime.until_pulled is None  # pyright: ignore[reportPrivateUsage]
    session_id = await daemon.manager.create(None)
    events = await daemon.settled(await daemon.manager.send(session_id, "hi"))
    assert isinstance(events[-1], RunCompletedEvent)
