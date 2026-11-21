"""Approvals: a run waits on a tool call, survives a restart, and goes on with the answer."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.graphs.tools_node import CHANGED_RESULT, DENIED_RESULT
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import (
    NOT_APPROVED,
    ApprovalNotFoundError,
    SessionBusyError,
    SessionManager,
    _LiveRun,  # pyright: ignore[reportPrivateUsage]
)
from golem.sessions.runner import RunControl
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.devices import DeviceStore
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    ToolCompletedEvent,
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
    assert (asked.name, asked.source) == ("risky_a", "built-in default (balanced)")
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


async def test_the_duration_of_an_approved_call_leaves_out_the_wait(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("risky_a", {}), ("risky_b", {})], "done"])
    daemon = _daemon(database, model, counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    first = await daemon.settled(run_id)
    await asyncio.sleep(0.3)  # the user is slow to answer
    await daemon.manager.respond(session_id, _needed(first)[0].data.call_id, "allow")
    second = await daemon.settled(run_id)
    await daemon.manager.respond(session_id, _needed(second)[-1].data.call_id, "deny")
    events = await daemon.settled(run_id)

    (completed,) = [e for e in events if isinstance(e, ToolCompletedEvent)]
    assert completed.data.duration_ms is not None and completed.data.duration_ms < 250
    (denied,) = [e for e in events if isinstance(e, ToolFailedEvent)]
    assert denied.data.duration_ms is None


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
    assert record is not None and record.allowed_tools == (("risky_a", None),)

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


class _CmdArgs(BaseModel):
    command: str


class _Commands:
    """A tool whose rules match its command, like ``shell``, that records what ran."""

    def __init__(self) -> None:
        self.ran: list[str] = []

    def registry(self) -> ToolRegistry:
        async def run(args: _CmdArgs, ctx: ToolContext) -> ToolResult:
            del ctx
            self.ran.append(args.command)
            return ToolResult(output=f"ran {args.command}", summary="ran")

        cmd = Tool(name="cmd", description="runs", args=_CmdArgs, run=run, match_arg="command")
        return ToolRegistry([cmd])


def _commands_daemon(
    database: Database, replies: list[Reply], commands: _Commands, config: Path
) -> _Daemon:
    daemon = _Daemon.__new__(_Daemon)
    runtime = open_chat(
        ModelRouter(model=ToolCallingChatModel(replies=replies)),
        InMemorySaver(),
        commands.registry(),
        Policy(config, home=config.parent),
    )
    daemon.events = EventLog(database)
    daemon.runs = RunRecords(database)
    daemon.records = SessionRecords(database)
    daemon.manager = SessionManager(
        runtime, SessionLog(daemon.events, EventBus(), daemon.records), daemon.records, daemon.runs
    )
    return daemon


def _cmd(*commands: str) -> list[tuple[str, dict[str, Any]]]:
    return [("cmd", {"command": command}) for command in commands]


async def test_always_allow_writes_one_rule_and_the_command_stops_asking(
    database: Database, tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    commands = _Commands()
    replies: list[Reply] = [_cmd("git status"), "one", _cmd("git status"), "two", _cmd("ls"), "x"]
    daemon = _commands_daemon(database, replies, commands, config)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = _needed(await daemon.settled(run_id))[0].data
    assert asked.subject == "git status"

    await daemon.manager.respond(session_id, asked.call_id, "allow_always")
    events = await daemon.settled(run_id)
    resolved = next(event for event in events if isinstance(event, ApprovalResolvedEvent))
    assert resolved.data.rule == "~/config.toml rule 1"
    assert 'match = "git status"' in config.read_text(encoding="utf-8")

    second = await daemon.settled(await daemon.manager.send(session_id, "again"))
    assert _needed(second) == []
    third = await daemon.settled(await daemon.manager.send(session_id, "other"))
    assert [event.data.subject for event in _needed(third)] == ["ls"]
    assert commands.ran == ["git status", "git status"]


async def test_a_rule_written_mid_reply_never_answers_a_later_question(
    database: Database, tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    commands = _Commands()
    replies: list[Reply] = [_cmd("make", "make", "rm -rf build"), "done"]
    daemon = _commands_daemon(database, replies, commands, config)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    first = _needed(await daemon.settled(run_id))
    assert [event.data.subject for event in first] == ["make"]

    await daemon.manager.respond(session_id, first[0].data.call_id, "allow_always")
    second = _needed(await daemon.settled(run_id))
    assert [event.data.subject for event in second] == ["make", "rm -rf build"]
    assert commands.ran == []

    await daemon.manager.respond(session_id, second[-1].data.call_id, "deny")
    events = await daemon.settled(run_id)
    assert events[-1].type == "run.completed"
    assert commands.ran == ["make", "make"]


async def test_a_call_that_would_ask_out_of_turn_is_refused(
    database: Database, tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    config.write_text(
        '[[rule]]\ntool = "cmd"\nmatch = "lint"\naction = "allow"\n', encoding="utf-8"
    )
    commands = _Commands()
    replies: list[Reply] = [_cmd("lint", "deploy"), "done"]
    daemon = _commands_daemon(database, replies, commands, config)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = _needed(await daemon.settled(run_id))
    assert [event.data.subject for event in asked] == ["deploy"]

    config.write_text("", encoding="utf-8")
    await daemon.manager.respond(session_id, asked[0].data.call_id, "allow")
    events = await daemon.settled(run_id)
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert [event.data.message for event in failed] == [CHANGED_RESULT]
    assert commands.ran == ["deploy"]


async def test_allow_for_the_session_keys_on_the_command_and_can_be_revoked(
    database: Database, tmp_path: Path
) -> None:
    commands = _Commands()
    replies: list[Reply] = [
        _cmd("git status"),
        "a",
        _cmd("git status"),
        "b",
        _cmd("ls"),
        _cmd("git status"),
        "d",
    ]
    daemon = _commands_daemon(database, replies, commands, tmp_path / "config.toml")
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    call_id = _needed(await daemon.settled(run_id))[0].data.call_id
    await daemon.manager.respond(session_id, call_id, "allow_session")
    await daemon.settled(run_id)
    assert await daemon.manager.allowances(session_id) == [("cmd", "git status")]

    again = await daemon.settled(await daemon.manager.send(session_id, "again"))
    assert _needed(again) == []
    other = await daemon.settled(await daemon.manager.send(session_id, "other"))
    assert [event.data.subject for event in _needed(other)] == ["ls"]
    await daemon.manager.cancel(other[-1].run_id or "")

    assert await daemon.manager.revoke(session_id, "cmd", "git status") is True
    assert await daemon.manager.revoke(session_id, "cmd", "git status") is False
    record = await daemon.records.get(session_id)
    assert record is not None and record.allowed_tools == ()
    revoked = await daemon.settled(await daemon.manager.send(session_id, "once more"))
    assert [event.data.subject for event in _needed(revoked)] == ["git status"]


async def test_a_cancel_that_meets_a_run_as_it_parks_still_ends_it(
    database: Database, counter: _Counter, tmp_path: Path
) -> None:
    # The run's task was still alive when the cancel came, but the run had already parked on
    # its question, so the task ended by itself and nothing wrote ``run.cancelled``.
    replies: list[Reply] = [[("safe", {}), ("risky_a", {})], "fresh"]
    daemon = _daemon(database, ToolCallingChatModel(replies=replies), counter, tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    await daemon.settled(run_id)
    runs = daemon.manager._runs  # pyright: ignore[reportPrivateUsage]
    tail = asyncio.create_task(asyncio.sleep(60))
    runs[run_id] = _LiveRun(tail, RunControl())

    assert await daemon.manager.cancel(run_id) is True

    events = await daemon.events.for_run(run_id)
    assert events[-1].type == "run.cancelled"
    assert await daemon.manager.cancel(run_id) is False
    runs.pop(run_id, None)
    next_events = await daemon.settled(await daemon.manager.send(session_id, "again"))
    assert next_events[-1].type == "run.completed"


async def test_always_allow_from_a_phone_records_its_device_with_the_rule(
    database: Database, tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    commands = _Commands()
    replies: list[Reply] = [_cmd("git status"), "one", _cmd("ls"), "two"]
    daemon = _commands_daemon(database, replies, commands, config)
    devices = DeviceStore(database)
    daemon.manager.devices = devices
    phone = await devices.add(_device_key(), "iPhone 16", "2026-11-21T10:00:00+01:00")

    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = _needed(await daemon.settled(run_id))[0].data
    await daemon.manager.respond(session_id, asked.call_id, "allow_always", device=phone.id)
    events = await daemon.settled(run_id)
    resolved = next(event for event in events if isinstance(event, ApprovalResolvedEvent))
    assert resolved.data.device == phone.id
    assert resolved.data.rule == "~/config.toml rule 1"
    [origin] = await devices.rule_origins("~/config.toml rule 1")
    assert (origin.device_id, origin.device_name) == (phone.id, "iPhone 16")
    assert "iphone" not in config.read_text(encoding="utf-8").lower()
    assert phone.id not in config.read_text(encoding="utf-8")

    # An answer from a browser or a terminal has no device, and writes no origin.
    run_two = await daemon.manager.send(session_id, "again")
    asked_again = _needed(await daemon.settled(run_two))[0].data
    await daemon.manager.respond(session_id, asked_again.call_id, "allow_always")
    later = await daemon.settled(run_two)
    last = next(event for event in later if isinstance(event, ApprovalResolvedEvent))
    assert last.data.device is None
    assert await devices.rule_origins("~/config.toml rule 2") == []


def _device_key() -> bytes:
    private = ec.generate_private_key(ec.SECP256R1())
    return private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
