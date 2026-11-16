"""Clearing old tool results when the history fills the window."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import BaseMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ContextSettings
from golem.graphs.adapter import message_text
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    ContextChangedEvent,
    ModelCallStartedEvent,
    ToolCompletedEvent,
)

FILE = "line of a file\n" * 600  # about 9,000 characters
WINDOW = 32_768


class _Counting(ToolCallingChatModel):
    """Reports as input tokens a quarter of the characters it was sent."""

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        chars = sum(len(message_text(m)) for m in messages)
        self.usage = {
            "input_tokens": chars // 4,
            "output_tokens": 1,
            "total_tokens": chars // 4 + 1,
        }
        return super()._generate(messages, stop, run_manager, **kwargs)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    for n in range(13):
        (root / f"f{n}.txt").write_text(FILE, encoding="utf-8")
    return root


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.session_id = ""
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        log = SessionLog(self.events, EventBus(), records)
        self.manager = SessionManager(runtime, log, records, self.runs)

    async def finished(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 10) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _chat(database: Database, model: ToolCallingChatModel, settings: ContextSettings) -> _Chat:
    runtime = open_chat(
        ModelRouter(model=model),
        InMemorySaver(),
        window_of=lambda _profile, _overrides: ContextWindow(window=WINDOW),
        context=settings,
    )
    return _Chat(database, runtime)


def _reads(count: int) -> list[Any]:
    return [[("read_file", {"path": f"f{n}.txt"})] for n in range(count)]


async def _run(chat: _Chat, project: Path) -> list[ChatEvent]:
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "read them all")
    chat.session_id = session_id
    return await chat.finished(run_id)


SETTINGS = ContextSettings(reply_reserve=2000, keep_results=2)


async def test_old_results_are_cleared_once_and_the_checkpoint_keeps_them(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    chat = _chat(database, model, SETTINGS)
    events = await _run(chat, project)

    changed = [e for e in events if isinstance(e, ContextChangedEvent)]
    assert changed
    first = changed[0].data
    assert first.action == "cleared"
    assert (first.count or 0) > 0
    assert first.before_tokens is not None and first.after_tokens is not None
    assert first.after_tokens < first.before_tokens
    assert first.before_tokens >= 0.7 * (WINDOW - 2000)
    # One step down to 40%, then quiet until the history fills again.
    assert len(changed) <= 2

    stubbed = [
        [m for m in seen if isinstance(m, ToolMessage) and "[cleared to save" in message_text(m)]
        for seen in model.seen
    ]
    assert not any(stubbed[:2]) and any(stubbed)
    assert sum(len(s) > 0 for s in stubbed) > 1
    # What was sent never passed the room by much.
    for seen in model.seen:
        assert sum(len(message_text(m)) for m in seen) / 4 < WINDOW

    values = await chat.runtime.values(chat.session_id)
    stored = cast(list[BaseMessage], values["messages"])
    results = [m for m in stored if isinstance(m, ToolMessage)]
    assert len(results) == 13
    assert all(len(message_text(m)) >= len(FILE) - 100 for m in results)

    # The transcript is the same as without clearing.
    done = [e for e in events if isinstance(e, ToolCompletedEvent)]
    assert len(done) == 13


async def test_model_call_started_lists_the_cleared_results(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    chat = _chat(database, model, SETTINGS)
    events = await _run(chat, project)

    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    assert starts[0].cleared_ids == []
    last = starts[-1]
    assert last.cleared_ids
    assert not set(last.cleared_ids) & {m for m in last.message_ids[-4:]}
    assert set(last.cleared_ids) <= set(last.message_ids)
    # The ids sent are the ids of the messages the model saw.
    assert len(last.message_ids) == len(model.seen[-1])
    cleared = [m for m in model.seen[-1] if m.id in set(last.cleared_ids)]
    assert cleared and all("[cleared to save" in message_text(m) for m in cleared)
    # The events say it in order: the change comes before the call it changed.
    kinds = [e.type for e in events]
    at = kinds.index("context.changed")
    assert kinds[at + 1 :].index("model.call.started") >= 0
    assert starts[0].message_id != last.message_id


async def test_without_settings_or_a_window_nothing_is_cleared(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver(), context=SETTINGS)
    chat = _Chat(database, runtime)
    events = await _run(chat, project)
    assert not any(isinstance(e, ContextChangedEvent) for e in events)
    assert not any(isinstance(e, ModelCallStartedEvent) and e.data.cleared_ids for e in events)

    model = _Counting(replies=[*_reads(13), "done"])
    runtime = open_chat(
        ModelRouter(model=model),
        InMemorySaver(),
        window_of=lambda _profile, _overrides: ContextWindow(window=WINDOW),
    )
    events = await _run(_Chat(database, runtime), project)
    assert not any(isinstance(e, ContextChangedEvent) for e in events)


async def test_the_trace_counts_a_cleared_result_as_its_stub(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    chat = _chat(database, model, SETTINGS)
    events = await _run(chat, project)
    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    last = starts[-1]

    result = await chat.manager.trace_span(chat.session_id, last.message_id)
    assert result.context is not None
    assert result.context.cleared.count == len(last.cleared_ids) > 0
    assert result.context.cleared.tokens > 0
    stubs = [m for m in result.messages if m.id in set(last.cleared_ids)]
    assert all(m.text.startswith("[cleared to save context: read_file") for m in stubs)
    assert all(m.original is not None and len(m.original) > len(m.text) for m in stubs)
    assert result.context.reserve == SETTINGS.reply_reserve

    first = await chat.manager.trace_span(chat.session_id, starts[0].message_id)
    assert first.context is not None
    assert first.context.cleared.count == 0 and first.context.cleared.tokens == 0


async def test_each_call_shows_only_the_results_cleared_at_that_call(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    chat = _chat(database, model, SETTINGS)
    events = await _run(chat, project)
    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    cleared_later = set(starts[-1].cleared_ids)
    assert cleared_later
    # A call before clearing began: the same results are in it, in full.
    early = next(s for s in starts if not s.cleared_ids and cleared_later & set(s.message_ids))
    result = await chat.manager.trace_span(chat.session_id, early.message_id)
    assert result.context is not None and result.context.cleared.count == 0
    shown = {m.id: m for m in result.messages}
    for message_id in cleared_later & set(early.message_ids):
        assert shown[message_id].text.count("line of a file") == 600
    # Every call stubs exactly its own ids.
    for start in starts:
        span = await chat.manager.trace_span(chat.session_id, start.message_id)
        ids = set(start.cleared_ids)
        for m in span.messages:
            assert m.text.startswith("[cleared to save") == (m.id in ids)


async def test_the_trace_lists_each_change_with_the_call_right_after_it(
    database: Database, project: Path
) -> None:
    model = _Counting(replies=[*_reads(13), "done"])
    chat = _chat(database, model, SETTINGS)
    events = await _run(chat, project)

    changed = [e for e in events if isinstance(e, ContextChangedEvent)]
    listed = await chat.manager.trace_context_events(chat.session_id)
    assert [e.seq for e in listed] == [e.seq for e in changed]
    assert listed[0].action == "cleared"
    assert listed[0].room == WINDOW - SETTINGS.reply_reserve
    after = next(
        e for e in events if isinstance(e, ModelCallStartedEvent) and e.seq > listed[0].seq
    )
    assert listed[0].call_id == after.data.message_id
    assert listed[0].run_id == changed[0].run_id
