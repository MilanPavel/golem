"""Reading one span: a model call's context and reply, a tool call's arguments and result."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.graphs.prompt import SystemPrompt
from golem.graphs.tools_node import ARTIFACT_CHARS
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager, SessionNotFoundError, SpanNotFoundError
from golem.store.artifacts import ArtifactStore
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.commands import TraceRunSpan


class _NoArgs(BaseModel):
    pass


async def _big(args: _NoArgs, ctx: ToolContext) -> ToolResult:
    del args, ctx
    return ToolResult(output="y" * (ARTIFACT_CHARS * 2), summary="big")


_BIG = Tool(name="big", description="lots", args=_NoArgs, run=_big, read_only=True)


class _Chat:
    def __init__(
        self,
        database: Database,
        model: ToolCallingChatModel,
        tools: ToolRegistry,
        window: ContextWindow | None = None,
    ) -> None:
        self.database = database
        self.runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            tools,
            artifacts=ArtifactStore(database),
            prompt=SystemPrompt((lambda _: "You are golem.",)),
            blobs=BlobStore(database),
            window_of=lambda _, __: window or ContextWindow(8192, None),
        )
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime,
            SessionLog(EventLog(database), EventBus(), records),
            records,
            self.runs,
            blobs=BlobStore(database),
        )

    async def ask(self, text: str, cwd: Path, session_id: str | None = None) -> tuple[str, str]:
        if session_id is None:
            session_id = await self.manager.create(None, cwd=str(cwd))
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        async with asyncio.timeout(5):
            await _until(done)
        return session_id, run_id


async def _until(check: Callable[[], Awaitable[bool]]) -> None:
    while not await check():
        await asyncio.sleep(0.01)


def _models(runs: list[TraceRunSpan]) -> list[str]:
    return [m.id for run in runs for m in run.children]


async def test_a_model_span_reads_its_context_reply_prompt_and_tools(
    database: Database, tmp_path: Path
) -> None:
    (tmp_path / "notes.txt").write_text("the answer is 42\n", encoding="utf-8")
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "It says 42."])
    model.usage = {"input_tokens": 900, "output_tokens": 20, "total_tokens": 920}
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("what is in notes?", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    first_id, second_id = _models(runs)

    first = await chat.manager.trace_span(session_id, first_id)
    assert [m.role for m in first.messages] == ["user"]
    assert first.messages[0].text == "what is in notes?"
    assert first.new_from == 0
    assert first.reply is not None and first.reply.id == first_id
    assert [call["name"] for call in first.reply.tool_calls] == ["read_file"]
    assert first.system_prompt == "You are golem."
    assert first.tools is not None
    assert "read_file" in [tool["function"]["name"] for tool in first.tools]  # type: ignore[index]
    assert first.context is not None
    assert first.context.window == 8192 and first.context.window_estimated is False
    assert first.context.used == 900
    assert [p.key for p in first.context.parts] == [
        "system",
        "tools",
        "user",
        "assistant",
        "tool_results",
    ]
    assert sum(p.tokens for p in first.context.parts) == 900
    tools_part = first.context.parts[1]
    assert ("read_file", None) in [(i.name, i.group) for i in tools_part.items]
    assert [i.name for i in first.context.parts[0].items] == ["section_1"]
    assert first.system_sections is not None and len(first.system_sections) == 1
    assert first.system_sections[0].chars == len("You are golem.")
    assert all(m.tokens is not None for m in first.messages)

    second = await chat.manager.trace_span(session_id, second_id)
    assert [m.role for m in second.messages] == ["user", "assistant", "tool"]
    assert second.new_from == 1  # the reply and the tool result are new
    assert second.messages[2].call_id == first.reply.tool_calls[0]["call_id"]
    assert second.reply is not None and second.reply.text == "It says 42."
    assert second.span.id == second_id and second.span.name == "model 2"
    assert second.provider is None


async def test_a_model_span_says_when_a_call_was_written_as_text(
    database: Database, tmp_path: Path
) -> None:
    (tmp_path / "notes.txt").write_text("the answer is 42\n", encoding="utf-8")
    recovered = "<function=read_file>\n<parameter=path>\nnotes.txt\n</parameter>\n</function>"
    model = ToolCallingChatModel(replies=[recovered, "<function=format_disk>\n</function>"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("what is in notes?", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    first_id, second_id = _models(runs)

    assert (await chat.manager.trace_span(session_id, first_id)).text_tool_calls == "recovered"
    assert (await chat.manager.trace_span(session_id, second_id)).text_tool_calls == "unread"


async def test_a_second_run_starts_after_the_first(database: Database, tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=["one", "two"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("first", tmp_path)
    await chat.ask("second", tmp_path, session_id)
    _, runs = await chat.manager.trace(session_id)
    assert len(runs) == 2
    _, last = _models(runs)
    detail = await chat.manager.trace_span(session_id, last)
    assert [m.text for m in detail.messages] == ["first", "one", "second"]
    assert detail.new_from == 1


async def test_a_tool_span_reads_its_arguments_and_result(
    database: Database, tmp_path: Path
) -> None:
    (tmp_path / "notes.txt").write_text("the answer is 42\n", encoding="utf-8")
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "ok"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("read it", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (tool,) = runs[0].children[0].children

    detail = await chat.manager.trace_span(session_id, tool.id)
    assert (detail.span.kind, detail.span.name) == ("tool", "read_file")
    assert detail.args == {"path": "notes.txt"}
    assert detail.result is not None and "the answer is 42" in detail.result
    assert detail.artifact_id is None
    assert detail.approval is None
    assert detail.messages == []


async def test_a_big_tool_output_names_its_artifact(database: Database, tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=[[("big", {})], "ok"])
    chat = _Chat(database, model, ToolRegistry([_BIG]))
    session_id, _ = await chat.ask("go", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (tool,) = runs[0].children[0].children

    detail = await chat.manager.trace_span(session_id, tool.id)
    assert detail.artifact_id is not None
    assert detail.result is not None and len(detail.result) < ARTIFACT_CHARS * 2
    assert detail.artifact_id in detail.result


async def test_an_old_session_without_model_call_events_still_reads(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("hi", tmp_path)
    async with database.transaction() as tx:
        await tx.execute("DELETE FROM events WHERE type LIKE 'model.call.%'")
    _, runs = await chat.manager.trace(session_id)
    (span,) = runs[0].children
    assert span.recorded is False
    assert span.context_window == 8192 and span.context_window_estimated is True

    detail = await chat.manager.trace_span(session_id, span.id)
    assert detail.context is not None
    assert detail.context.used is None and detail.context.window_estimated is True
    assert detail.context.window == 8192
    assert [m.text for m in detail.messages] == ["hi"]
    assert detail.reply is not None and detail.reply.text == "hello"
    assert (detail.system_prompt, detail.tools, detail.new_from) == (None, None, 0)


async def test_a_recorded_estimated_window_shows_in_the_span_and_its_detail(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _Chat(database, model, default_registry(), ContextWindow(4096, None, True))
    session_id, _ = await chat.ask("hi", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (span,) = runs[0].children
    assert span.recorded is True
    assert (span.context_window, span.context_window_estimated) == (4096, True)
    detail = await chat.manager.trace_span(session_id, span.id)
    assert detail.context is not None
    assert detail.context.window == 4096 and detail.context.window_estimated is True


async def test_a_recorded_exact_window_stays_exact(database: Database, tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _Chat(database, model, default_registry(), ContextWindow(4096, 4096))
    session_id, _ = await chat.ask("hi", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (span,) = runs[0].children
    assert span.context_window_estimated is False
    detail = await chat.manager.trace_span(session_id, span.id)
    assert detail.context is not None and detail.context.window_estimated is False


async def test_an_unknown_span_or_session_is_an_error(database: Database, tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("hi", tmp_path)
    with pytest.raises(SpanNotFoundError):
        await chat.manager.trace_span(session_id, "m_nope")
    with pytest.raises(SessionNotFoundError):
        await chat.manager.trace_span("s_nope", "m_nope")
    with pytest.raises(SessionNotFoundError):
        await chat.manager.trace("s_nope")


async def test_a_tool_span_has_no_context(database: Database, tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("x\n", encoding="utf-8")
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "ok"])
    chat = _Chat(database, model, default_registry())
    session_id, _ = await chat.ask("read", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (tool,) = runs[0].children[0].children
    detail = await chat.manager.trace_span(session_id, tool.id)
    assert detail.context is None


async def test_an_ollama_profile_without_ctx_has_no_window(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    chat = _Chat(database, model, default_registry(), ContextWindow())
    session_id, _ = await chat.ask("hi", tmp_path)
    _, runs = await chat.manager.trace(session_id)
    (span,) = runs[0].children
    assert (span.context_window, span.context_window_estimated) == (None, False)
    detail = await chat.manager.trace_span(session_id, span.id)
    assert detail.context is not None
    assert (detail.context.window, detail.context.window_estimated) == (None, False)
