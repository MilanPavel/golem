"""Headless sessions (ADR-050): a run with nobody attached ends or waits, and says so."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.summaries import SUMMARY_CHARS, cut_summary, summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import (
    ApprovalNeededEvent,
    ChatEvent,
    SessionCompletedEvent,
    SessionCreatedEvent,
)

Reply = str | list[tuple[str, dict[str, Any]]]


class _NoArgs(BaseModel):
    pass


class _Attached:
    def __init__(self) -> None:
        self.seen: list[ChatEvent] = []

    def deliver(self, event: ChatEvent) -> None:
        self.seen.append(event)


def _registry() -> ToolRegistry:
    async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        return ToolResult(output="ran", summary="ran")

    return ToolRegistry(
        [Tool(name="ask_tool", description="asks", args=_NoArgs, run=run, read_only=False)]
    )


class _Daemon:
    """One daemon process over a database and a checkpointer, so a test can restart it."""

    def __init__(
        self, database: Database, saver: InMemorySaver, replies: list[Reply], home: Path
    ) -> None:
        runtime = open_chat(
            ModelRouter(model=ToolCallingChatModel(replies=replies)),
            saver,
            _registry(),
            Policy(None, home=home),
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), self.records), self.records, self.runs
        )

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)

    async def status(self, session_id: str) -> str:
        activity = await self.records.activity(session_id)
        assert activity is not None
        return summarize(activity).status


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _needed(events: list[ChatEvent]) -> list[ApprovalNeededEvent]:
    return [event for event in events if isinstance(event, ApprovalNeededEvent)]


def _completed(events: list[ChatEvent]) -> list[SessionCompletedEvent]:
    return [event for event in events if isinstance(event, SessionCompletedEvent)]


async def test_a_headless_run_waits_and_a_new_connection_finishes_it(
    database: Database, tmp_path: Path
) -> None:
    daemon = _Daemon(database, InMemorySaver(), [[("ask_tool", {})], "all done"], tmp_path)
    manager = daemon.manager
    session_id = await manager.create(None, origin="cli")
    run_id = await manager.send(session_id, "go")
    events = await daemon.settled(run_id)

    assert await daemon.status(session_id) == "waiting"
    assert _completed(events) == []
    call_id = _needed(events)[0].data.call_id
    activity = await daemon.records.activity(session_id)
    assert activity is not None
    assert summarize(activity).origin == "cli"
    assert summarize(activity).status == "waiting"

    assert await manager.respond(session_id, call_id, "allow") == run_id
    events = await daemon.settled(run_id)
    assert events[-1].type == "session.completed"
    done = _completed(await daemon.events.after(session_id, 0))
    assert len(done) == 1
    assert (done[0].data.run_id, done[0].data.status, done[0].data.summary) == (
        run_id,
        "completed",
        "all done",
    )
    assert await daemon.status(session_id) == "idle"


async def test_the_same_across_a_daemon_restart(database: Database, tmp_path: Path) -> None:
    saver = InMemorySaver()
    replies: list[Reply] = [[("ask_tool", {})], "after restart"]
    before = _Daemon(database, saver, replies, tmp_path)
    session_id = await before.manager.create(None, origin="routine:daily")
    run_id = await before.manager.send(session_id, "go")
    call_id = _needed(await before.settled(run_id))[0].data.call_id

    after = _Daemon(database, saver, replies[1:], tmp_path)
    assert await after.status(session_id) == "waiting"
    activity = await after.records.activity(session_id)
    assert activity is not None
    assert summarize(activity).origin == "routine:daily"
    assert await after.manager.respond(session_id, call_id, "allow") == run_id
    await after.settled(run_id)

    done = _completed(await after.events.after(session_id, 0))
    assert [(e.data.status, e.data.summary) for e in done] == [("completed", "after restart")]


async def test_detaching_a_client_cancels_nothing(database: Database, tmp_path: Path) -> None:
    daemon = _Daemon(database, InMemorySaver(), [[("ask_tool", {})], "still here"], tmp_path)
    manager = daemon.manager
    session_id = await manager.create(None, origin="cli")
    client = _Attached()
    await manager.attach(session_id, 0, client)
    run_id = await manager.send(session_id, "go")
    call_id = _needed(await daemon.settled(run_id))[0].data.call_id

    manager.detach_all(client)
    seen = len(client.seen)
    await asyncio.sleep(0.05)
    assert await daemon.status(session_id) == "waiting"
    assert not any(event.type == "run.cancelled" for event in await daemon.events.for_run(run_id))

    await manager.respond(session_id, call_id, "allow")
    await daemon.settled(run_id)
    assert (await daemon.runs.get(run_id)).status == "completed"  # type: ignore[union-attr]
    assert len(client.seen) == seen


async def test_cancelling_a_headless_run_says_so_without_a_summary(
    database: Database, tmp_path: Path
) -> None:
    daemon = _Daemon(database, InMemorySaver(), [[("ask_tool", {})]], tmp_path)
    session_id = await daemon.manager.create(None, origin="cli")
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)
    assert await daemon.manager.cancel(run_id)
    done = _completed(await daemon.events.after(session_id, 0))
    assert [(e.data.status, e.data.summary) for e in done] == [("cancelled", None)]


async def test_a_user_session_has_no_origin_and_no_session_completed(
    database: Database, tmp_path: Path
) -> None:
    daemon = _Daemon(database, InMemorySaver(), ["hi"], tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)
    events = await daemon.events.after(session_id, 0)
    created = next(e for e in events if isinstance(e, SessionCreatedEvent))
    assert created.data.origin is None
    assert _completed(events) == []
    activity = await daemon.records.activity(session_id)
    assert activity is not None
    assert summarize(activity).origin == "user"


def test_a_summary_is_cut_to_a_few_lines_and_a_few_characters() -> None:
    assert cut_summary(None) is None
    assert cut_summary("  \n ") is None
    assert cut_summary("short answer\n") == "short answer"
    assert cut_summary("1\n2\n3\n4\n5") == "1\n2\n3\n4…"
    long = cut_summary("x" * 1000)
    assert long is not None
    assert len(long) == SUMMARY_CHARS
    assert long.endswith("…")
