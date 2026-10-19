"""Approvals: a run waits on a tool call, survives a restart, and goes on with the answer."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.graphs.tools_node import DENIED_RESULT
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import (
    NOT_APPROVED,
    ApprovalNotFoundError,
    SessionBusyError,
    SessionManager,
)
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    ToolFailedEvent,
)


class _NoArgs(BaseModel):
    pass


class _Counter:
    def __init__(self) -> None:
        self.runs: dict[str, int] = {}

    def tool(self, name: str, *, read_only: bool) -> Tool[_NoArgs]:
        async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
            del args, ctx
            self.runs[name] = self.runs.get(name, 0) + 1
            return ToolResult(output=f"{name} ran", summary="ran")

        return Tool(name=name, description=name, args=_NoArgs, run=run, read_only=read_only)

    def registry(self) -> ToolRegistry:
        return ToolRegistry(
            [
                self.tool("safe", read_only=True),
                self.tool("risky_a", read_only=False),
                self.tool("risky_b", read_only=False),
            ]
        )


class _Daemon:
    """One daemon process over a database and a checkpointer, so a test can restart it."""

    def __init__(
        self,
        database: Database,
        saver: InMemorySaver,
        model: ToolCallingChatModel,
        counter: _Counter,
        home: Path,
    ) -> None:
        runtime = open_chat(
            ModelRouter(model=model), saver, counter.registry(), Policy(None, home=home)
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), self.records), self.records, self.runs
        )

    async def settled(self, run_id: str) -> list[ChatEvent]:
        """Wait until the run waits or ends, then return its events."""

        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


Reply = str | list[tuple[str, dict[str, Any]]]


@pytest.fixture
def counter() -> _Counter:
    return _Counter()


def _daemon(
    database: Database, model: ToolCallingChatModel, counter: _Counter, tmp_path: Path
) -> _Daemon:
    return _Daemon(database, InMemorySaver(), model, counter, tmp_path)


def _needed(events: list[ChatEvent]) -> list[ApprovalNeededEvent]:
    return [event for event in events if isinstance(event, ApprovalNeededEvent)]


def _tool_types(events: list[ChatEvent]) -> list[str]:
    return [event.type for event in events if event.type.startswith(("tool.", "approval."))]


async def test_mixed_decisions_in_one_turn_run_each_call_once(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [[("safe", {}), ("risky_a", {}), ("risky_b", {})], "done"]
    model = ToolCallingChatModel(replies=replies)
    daemon = _daemon(database, model, counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")

    first = await daemon.settled(run_id)
    assert _tool_types(first) == [
        "tool.requested",
        "tool.requested",
        "tool.requested",
        "approval.needed",
    ]
    assert counter.runs == {}
    asked = _needed(first)[0].data
    assert (asked.name, asked.source) == ("risky_a", "built-in default")
    run = await daemon.runs.get(run_id)
    assert run is not None and run.status == "waiting"
    activity = await daemon.records.activity(session_id)
    assert activity is not None and summarize(activity).status == "waiting"

    assert await daemon.manager.respond(session_id, asked.call_id, "allow") == run_id
    second = await daemon.settled(run_id)
    assert _needed(second)[-1].data.name == "risky_b"
    assert counter.runs == {}

    await daemon.manager.respond(session_id, _needed(second)[-1].data.call_id, "deny")
    events = await daemon.settled(run_id)
    assert events[-1].type == "run.completed"
    assert counter.runs == {"safe": 1, "risky_a": 1}
    assert _tool_types(events)[3:] == [
        "approval.needed",
        "approval.resolved",
        "approval.needed",
        "approval.resolved",
        "tool.started",
        "tool.completed",
        "tool.started",
        "tool.completed",
        "tool.failed",
    ]
    denied = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert denied[0].data.message == DENIED_RESULT
    results = [message for message in model.seen[-1] if isinstance(message, ToolMessage)]
    assert [message.text for message in results] == [
        "safe ran",
        "risky_a ran",
        f"error: {DENIED_RESULT}",
    ]


async def test_allow_for_the_session_covers_later_calls(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [
        [("risky_a", {}), ("risky_a", {})],
        "once",
        [("risky_a", {})],
        "twice",
    ]
    daemon = _daemon(database, ToolCallingChatModel(replies=replies), counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = _needed(await daemon.settled(run_id))
    assert len(asked) == 1

    await daemon.manager.respond(session_id, asked[0].data.call_id, "allow_session")
    events = await daemon.settled(run_id)
    assert events[-1].type == "run.completed"
    assert len(_needed(events)) == 1
    assert counter.runs == {"risky_a": 2}
    resolved = [event for event in events if isinstance(event, ApprovalResolvedEvent)]
    assert resolved[0].data.decision == "allow_session"
    record = await daemon.records.get(session_id)
    assert record is not None and record.allowed_tools == ("risky_a",)

    later = await daemon.settled(await daemon.manager.send(session_id, "again"))
    assert _needed(later) == []
    assert counter.runs == {"risky_a": 3}


async def test_an_approval_survives_a_daemon_restart(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    saver = InMemorySaver()
    replies: list[Reply] = [[("risky_a", {})], "after restart"]
    model = ToolCallingChatModel(replies=replies)
    before = _Daemon(database, saver, model, counter, tmp_path)
    session_id = await before.manager.create(None)
    run_id = await before.manager.send(session_id, "go")
    call_id = _needed(await before.settled(run_id))[0].data.call_id

    after = _Daemon(database, saver, model, counter, tmp_path)
    assert await after.manager.respond(session_id, call_id, "allow") == run_id
    events = await after.settled(run_id)
    assert events[-1].type == "run.completed"
    assert counter.runs == {"risky_a": 1}


async def test_a_waiting_session_refuses_messages_and_wrong_answers(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [[("risky_a", {})], "ok"]
    daemon = _daemon(database, ToolCallingChatModel(replies=replies), counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)

    with pytest.raises(SessionBusyError):
        await daemon.manager.send(session_id, "hello?")
    with pytest.raises(ApprovalNotFoundError):
        await daemon.manager.respond(session_id, "call_nope", "allow")
    other = await daemon.manager.create(None)
    with pytest.raises(ApprovalNotFoundError):
        await daemon.manager.respond(other, "call_1", "allow")


async def test_cancelling_a_waiting_run_fails_its_calls_and_the_next_turn_works(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [[("safe", {}), ("risky_a", {})], "fresh"]
    model = ToolCallingChatModel(replies=replies)
    daemon = _daemon(database, model, counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)

    assert await daemon.manager.cancel(run_id) is True
    events = await daemon.events.for_run(run_id)
    assert [event.type for event in events[-3:]] == ["tool.failed", "tool.failed", "run.cancelled"]
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert {event.data.message for event in failed} == {NOT_APPROVED}
    assert counter.runs == {}
    assert await daemon.manager.cancel(run_id) is False

    next_events = await daemon.settled(await daemon.manager.send(session_id, "again"))
    assert next_events[-1].type == "run.completed"


async def test_closing_a_waiting_session_cancels_its_run(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [[("risky_a", {})]]
    daemon = _daemon(database, ToolCallingChatModel(replies=replies), counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)

    await daemon.manager.close(session_id)
    run = await daemon.runs.get(run_id)
    assert run is not None and run.status == "cancelled"


async def test_an_answer_right_after_the_question_is_not_busy(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    replies: list[Reply] = [[("risky_a", {})], "done"]
    daemon = _daemon(database, ToolCallingChatModel(replies=replies), counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")

    async def asked() -> bool:
        return any(isinstance(e, ApprovalNeededEvent) for e in await daemon.events.for_run(run_id))

    await _until(asked, timeout=3)
    call_id = _needed(await daemon.events.for_run(run_id))[0].data.call_id
    assert await daemon.manager.respond(session_id, call_id, "allow") == run_id
    events = await daemon.settled(run_id)
    assert events[-1].type == "run.completed"
