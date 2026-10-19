"""The tool loop: graph, events, cancel, recovery, and provider formats."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import MAX_MODEL_CALLS, ChatRuntime, open_chat
from golem.graphs.tools_node import CANCELLED_RESULT
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import STOPPED_MESSAGE, open_turn, recover_runs
from golem.sessions.runner import CANCELLED_TOOL
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import (
    ChatEvent,
    MessageCompletedEvent,
    MessageStartedEvent,
    RunFailedEvent,
    SessionCreatedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolRequestedEvent,
)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "notes.txt").write_text("the answer is 42\n", encoding="utf-8")
    return root


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.log = SessionLog(self.events, EventBus(), self.records)
        self.manager = SessionManager(runtime, self.log, self.records, self.runs)

    async def finished(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _chat(
    database: Database, model: ToolCallingChatModel, tools: ToolRegistry | None = None
) -> _Chat:
    return _Chat(database, open_chat(ModelRouter(model=model), InMemorySaver(), tools))


def _messages(values: Mapping[str, object]) -> list[BaseMessage]:
    raw = values["messages"]
    assert isinstance(raw, list)
    return [item for item in cast(list[object], raw) if isinstance(item, BaseMessage)]


async def test_the_model_reads_a_file_then_answers(database: Database, project: Path) -> None:
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "It says 42."])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "what is in notes?")
    events = await chat.finished(run_id)

    assert [event.type for event in events] == [
        "message.completed",
        "run.started",
        "message.started",
        "message.completed",
        "tool.requested",
        "tool.started",
        "tool.completed",
        "message.started",
        "message.completed",
        "run.completed",
    ]
    requested = events[4]
    assert isinstance(requested, ToolRequestedEvent)
    assert (requested.data.name, requested.data.args) == ("read_file", {"path": "notes.txt"})
    assert requested.data.message_id == events[3].data.message_id  # type: ignore[union-attr]
    completed = events[6]
    assert isinstance(completed, ToolCompletedEvent)
    assert completed.data.summary == "1 line"
    assert "the answer is 42" in completed.data.preview
    first, second = events[2], events[7]
    assert isinstance(first, MessageStartedEvent) and isinstance(second, MessageStartedEvent)
    assert first.data.message_id != second.data.message_id
    final = events[8]
    assert isinstance(final, MessageCompletedEvent)
    assert (final.data.message_id, final.data.text) == (second.data.message_id, "It says 42.")

    assert model.bound == ["read_file", "list_dir", "glob", "grep"]
    tool_result = model.seen[1][-1]
    assert isinstance(tool_result, ToolMessage)
    assert "the answer is 42" in tool_result.text
    stored = _messages(await chat.runtime.values(session_id))
    assert [message.id for message in stored] == [
        events[0].data.message_id,  # type: ignore[union-attr]
        first.data.message_id,
        "t_call_1",
        second.data.message_id,
    ]


async def test_a_path_outside_the_folder_fails_and_the_model_hears_why(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "/etc/hosts"})], "I can't."])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    events = await chat.finished(await chat.manager.send(session_id, "read hosts"))

    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert len(failed) == 1
    assert "outside the project folder" in failed[0].data.message
    result = model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.status == "error"
    assert result.text.startswith("error: /etc/hosts is outside")
    assert events[-1].type == "run.completed"


async def test_a_session_without_a_folder_says_so(database: Database) -> None:
    model = ToolCallingChatModel(replies=[[("list_dir", {})], "No folder."])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    events = await chat.finished(await chat.manager.send(session_id, "ls"))
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert "no project folder" in failed[0].data.message


async def test_a_model_that_never_stops_calling_tools_fails_the_run(
    database: Database, project: Path
) -> None:
    calls: list[str | list[tuple[str, dict[str, Any]]]] = [
        [("list_dir", {})] for _ in range(MAX_MODEL_CALLS + 5)
    ]
    chat = _chat(database, ToolCallingChatModel(replies=calls))
    session_id = await chat.manager.create(None, cwd=str(project))
    events = await chat.finished(await chat.manager.send(session_id, "loop"))
    failed = events[-1]
    assert isinstance(failed, RunFailedEvent)
    assert failed.data.message == f"the run stopped after {MAX_MODEL_CALLS} model calls"


class _SlowArgs(BaseModel):
    pass


def _gated_registry() -> tuple[ToolRegistry, asyncio.Event, asyncio.Event]:
    started = asyncio.Event()
    release = asyncio.Event()

    async def run(args: _SlowArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        started.set()
        await release.wait()
        return ToolResult(output="slow done", summary="done")

    slow = Tool(name="slow", description="waits", args=_SlowArgs, run=run, read_only=True)
    return ToolRegistry([*READ_ONLY_TOOLS, slow]), started, release


async def test_cancel_during_a_tool_leaves_a_history_the_next_turn_accepts(
    database: Database, project: Path
) -> None:
    registry, started, _ = _gated_registry()
    model = ToolCallingChatModel(replies=[[("slow", {})], "fresh answer"])
    chat = _chat(database, model, registry)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "be slow")
    async with asyncio.timeout(2):
        await started.wait()

    assert await chat.manager.cancel(run_id) is True
    events = await chat.events.for_run(run_id)
    assert [event.type for event in events[-2:]] == ["tool.failed", "run.cancelled"]
    failed = events[-2]
    assert isinstance(failed, ToolFailedEvent)
    assert failed.data.message == CANCELLED_TOOL

    next_events = await chat.finished(await chat.manager.send(session_id, "again"))
    assert next_events[-1].type == "run.completed"
    history = model.seen[-1]
    cancelled = [message for message in history if isinstance(message, ToolMessage)]
    assert [message.text for message in cancelled] == [CANCELLED_RESULT]


async def test_recovery_fails_open_tool_calls(database: Database, project: Path) -> None:
    registry, started, _ = _gated_registry()
    model = ToolCallingChatModel(replies=[[("slow", {})], "after restart"])
    chat = _chat(database, model, registry)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "be slow")
    async with asyncio.timeout(2):
        await started.wait()
    turn = open_turn(await chat.events.for_run(run_id))
    assert turn.open_calls == ["call_1"]
    assert turn.assistant_message_id is None

    closed = await recover_runs(chat.runs, chat.events, chat.log, chat.runtime)
    assert closed == [run_id]
    events = await chat.events.for_run(run_id)
    assert [event.type for event in events[-2:]] == ["tool.failed", "run.failed"]
    failed = events[-2]
    assert isinstance(failed, ToolFailedEvent)
    assert failed.data.message == STOPPED_MESSAGE


async def test_a_model_that_refuses_tools_is_asked_without_them(database: Database) -> None:
    class Refuses:
        async def ainvoke(self, messages: object) -> object:
            del messages
            raise RuntimeError("gemma3 does not support tools (status code: 400)")

    class NoTools(ToolCallingChatModel):
        def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
            del tools, kwargs
            return Refuses()

    model = NoTools(replies=["plain answer", "second"])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    events = await chat.finished(await chat.manager.send(session_id, "hi"))
    final = events[-2]
    assert isinstance(final, MessageCompletedEvent)
    assert final.data.text == "plain answer"
    assert events[-1].type == "run.completed"


def _tool_history() -> list[BaseMessage]:
    return [
        HumanMessage(content="what is in notes?", id="m_u"),
        AIMessage(
            content="",
            id="m_a",
            tool_calls=[{"name": "read_file", "args": {"path": "notes.txt"}, "id": "call_1"}],
        ),
        ToolMessage(content="     1|42", tool_call_id="call_1", name="read_file", id="t_call_1"),
        AIMessage(content="It says 42.", id="m_b"),
        HumanMessage(content="thanks", id="m_u2"),
    ]


def test_a_tool_history_converts_for_every_provider() -> None:
    history = _tool_history()
    schemas = default_registry().schemas()

    anthropic = ChatAnthropic(model_name="claude-test", api_key="k", timeout=None, stop=None)  # pyright: ignore[reportArgumentType]
    body = cast(dict[str, Any], anthropic._get_request_payload(history, tools=schemas))  # pyright: ignore[reportPrivateUsage, reportUnknownMemberType]
    blocks = [block for message in body["messages"] for block in _blocks(message)]
    assert {"tool_use", "tool_result"} <= {block.get("type") for block in blocks}

    openai = ChatOpenAI(model="gpt-test", api_key="k")  # pyright: ignore[reportArgumentType]
    sent = cast(dict[str, Any], openai._get_request_payload(history))  # pyright: ignore[reportPrivateUsage, reportUnknownMemberType]
    roles = [message["role"] for message in sent["messages"]]
    assert roles == ["user", "assistant", "tool", "assistant", "user"]
    assert sent["messages"][2]["tool_call_id"] == "call_1"

    ollama = ChatOllama(model="qwen3:8b")
    converted = ollama._convert_messages_to_ollama_messages(history)  # pyright: ignore[reportPrivateUsage]
    assert [message["role"] for message in converted] == [
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
    ]


def _blocks(message: dict[str, Any]) -> list[dict[str, Any]]:
    content = message.get("content")
    if not isinstance(content, list):
        return []
    return [
        cast(dict[str, Any], block)
        for block in cast(list[object], content)
        if isinstance(block, dict)
    ]


async def test_the_folder_is_stored_and_a_fork_keeps_it(database: Database, project: Path) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    events = await chat.finished(await chat.manager.send(session_id, "hi"))
    reply = events[-2]
    assert isinstance(reply, MessageCompletedEvent)

    record = await chat.records.get(session_id)
    assert record is not None and record.cwd == str(project)
    fork_id = await chat.manager.fork(session_id, reply.data.message_id)
    created = (await chat.events.after(fork_id))[0]
    assert isinstance(created, SessionCreatedEvent)
    assert created.data.cwd == str(project)


async def test_a_session_without_a_folder_takes_the_senders(
    database: Database, project: Path, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("list_dir", {"path": ""})], "one file", "again"])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    events = await chat.finished(
        await chat.manager.send(session_id, "list files", cwd=str(project))
    )
    assert [event.type for event in events if event.type.startswith("tool.")] == [
        "tool.requested",
        "tool.started",
        "tool.completed",
    ]
    updated = [e for e in await chat.events.after(session_id) if e.type == "session.updated"]
    assert [e.data.cwd for e in updated] == [str(project)]  # type: ignore[union-attr]
    record = await chat.records.get(session_id)
    assert record is not None and record.cwd == str(project)

    await chat.finished(await chat.manager.send(session_id, "again", cwd=str(tmp_path)))
    record = await chat.records.get(session_id)
    assert record is not None and record.cwd == str(project)


async def test_a_denied_call_never_runs_and_the_model_hears_why(
    database: Database, project: Path, tmp_path: Path
) -> None:
    (project / ".golem").mkdir()
    (project / ".golem" / "policy.toml").write_text(
        '[[rule]]\ntool = "read_file"\npath = "notes.txt"\naction = "deny"\n', encoding="utf-8"
    )
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "Denied."])
    runtime = open_chat(
        ModelRouter(model=model), InMemorySaver(), policy=Policy(None, home=tmp_path)
    )
    chat = _Chat(database, runtime)
    session_id = await chat.manager.create(None, cwd=str(project))
    events = await chat.finished(await chat.manager.send(session_id, "read notes"))
    tool_events = [event for event in events if event.type.startswith("tool.")]
    assert [event.type for event in tool_events] == ["tool.requested", "tool.failed"]
    failed = tool_events[1]
    assert isinstance(failed, ToolFailedEvent)
    assert failed.data.message == "read_file is denied by ~/project/.golem/policy.toml rule 1"
    result = model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.text == f"error: {failed.data.message}"
