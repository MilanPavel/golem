"""Thinking text: captured from the model, stored with the answer, never sent back."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, cast

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    MessageCompletedEvent,
    MessageThinkingDeltaEvent,
)


def _no_histories() -> list[list[BaseMessage]]:
    return []


class _Thinker(BaseChatModel):
    """Streams each reply as ``(thinking, text)`` pieces and records what it was sent."""

    replies: list[list[tuple[str, str]]]
    seen: list[list[BaseMessage]] = Field(default_factory=_no_histories)

    @property
    def _llm_type(self) -> str:
        return "thinker"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        raise AssertionError("the graph streams")

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        self.seen.append(list(messages))
        for thinking, text in self.replies.pop(0):
            extra = {"reasoning_content": thinking} if thinking else {}
            await asyncio.sleep(0.002)
            yield ChatGenerationChunk(message=AIMessageChunk(content=text, additional_kwargs=extra))


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.log = SessionLog(self.events, EventBus(), self.records)
        self.manager = SessionManager(runtime, self.log, self.records, self.runs)
        self.live: list[ChatEvent] = []
        """Every event as it was emitted. The store drops deltas once their message completes."""
        emit = self.log.emit

        async def recording(*args: Any, **kwargs: Any) -> ChatEvent:
            event = await emit(*args, **kwargs)
            self.live.append(event)
            return event

        self.log.emit = recording  # type: ignore[method-assign]

    async def ask(self, session_id: str, text: str) -> list[ChatEvent]:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return [e for e in self.live if e.run_id == run_id]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _chat(database: Database, model: BaseChatModel) -> _Chat:
    return _Chat(database, open_chat(ModelRouter(model=model), InMemorySaver()))


def _assistant(events: list[ChatEvent]) -> MessageCompletedEvent:
    (done,) = [
        e for e in events if isinstance(e, MessageCompletedEvent) and e.data.role == "assistant"
    ]
    return done


def _checkpoint(values: Mapping[str, object]) -> list[BaseMessage]:
    raw = values["messages"]
    assert isinstance(raw, list)
    return [m for m in cast(list[object], raw) if isinstance(m, BaseMessage)]


async def test_a_thinking_reply_completes_with_its_thinking_and_time(database: Database) -> None:
    model = _Thinker(replies=[[("Let me ", ""), ("see.", ""), ("", "39"), ("", "1")]])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    events = await chat.ask(session_id, "17*23?")

    thinking = [e.data.text for e in events if isinstance(e, MessageThinkingDeltaEvent)]
    assert thinking == ["Let me ", "see."]
    types = [e.type for e in events]
    assert types.index("message.thinking.delta") < types.index("message.delta")
    done = _assistant(events)
    assert done.data.text == "391"
    assert done.data.thinking == "Let me see."
    assert done.data.thinking_ms is not None and done.data.thinking_ms >= 0


async def test_a_reply_that_only_thinks_still_has_a_time(database: Database) -> None:
    chat = _chat(database, _Thinker(replies=[[("hmm", "")]]))
    session_id = await chat.manager.create(None)
    done = _assistant(await chat.ask(session_id, "q"))
    assert (done.data.text, done.data.thinking) == ("", "hmm")
    assert done.data.thinking_ms is not None and done.data.thinking_ms >= 0


async def test_a_think_tag_in_the_content_becomes_thinking(database: Database) -> None:
    model = _Thinker(replies=[[("", "<thi"), ("", "nk>a</th"), ("", "ink>b")]])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    events = await chat.ask(session_id, "q")
    done = _assistant(events)
    assert (done.data.thinking, done.data.text) == ("a", "b")
    assert [e.data.text for e in events if isinstance(e, MessageThinkingDeltaEvent)] == ["a"]


async def test_a_model_that_does_not_think_has_no_thinking(database: Database) -> None:
    chat = _chat(database, _Thinker(replies=[[("", "hel"), ("", "lo")]]))
    session_id = await chat.manager.create(None)
    events = await chat.ask(session_id, "q")
    done = _assistant(events)
    assert (done.data.text, done.data.thinking, done.data.thinking_ms) == ("hello", None, None)
    assert not any(isinstance(e, MessageThinkingDeltaEvent) for e in events)


async def test_earlier_thinking_is_not_sent_back_and_stays_in_the_checkpoint(
    database: Database,
) -> None:
    model = _Thinker(replies=[[("first thoughts", ""), ("", "one")], [("", "two")]])
    chat = _chat(database, model)
    session_id = await chat.manager.create(None)
    await chat.ask(session_id, "a")
    await chat.ask(session_id, "b")

    second_call = model.seen[1]
    assert [m.text for m in second_call] == ["a", "one", "b"]
    assert all("reasoning_content" not in m.additional_kwargs for m in second_call)
    stored = _checkpoint(await chat.runtime.values(session_id))
    assert stored[1].additional_kwargs["reasoning_content"] == "first thoughts"


async def test_a_reloaded_session_has_the_thinking(database: Database) -> None:
    chat = _chat(database, _Thinker(replies=[[("deep", ""), ("", "ok")]]))
    session_id = await chat.manager.create(None)
    await chat.ask(session_id, "q")

    stored = await EventLog(database).after(session_id)
    done = _assistant(stored)
    assert (done.data.thinking, done.data.text) == ("deep", "ok")
    assert not any(isinstance(e, MessageThinkingDeltaEvent) for e in stored)


async def test_a_message_from_an_old_log_has_no_thinking() -> None:
    data = {
        "seq": 1,
        "session_id": "s",
        "run_id": "r",
        "ts": "2026-10-07T10:00:02+00:00",
        "type": "message.completed",
        "data": {"message_id": "m", "role": "assistant", "text": "old"},
    }
    event = CHAT_EVENT.validate_python(data)
    assert isinstance(event, MessageCompletedEvent)
    assert (event.data.thinking, event.data.thinking_ms) == (None, None)
