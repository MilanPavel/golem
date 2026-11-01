"""The system prompt is built for each model call, sent first, and never stored."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import cast

from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import open_chat
from golem.graphs.prompt import PromptContext, SystemPrompt
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords


class _Chat:
    def __init__(
        self, database: Database, model: ToolCallingChatModel, prompt: SystemPrompt | None
    ) -> None:
        self.saver = InMemorySaver()
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.runtime = open_chat(ModelRouter(model=model), self.saver, prompt=prompt)
        self.manager = SessionManager(
            self.runtime, SessionLog(EventLog(database), EventBus(), records), records, self.runs
        )

    async def send(self, session_id: str, text: str, cwd: str | None = None) -> None:
        run_id = await self.manager.send(session_id, text, cwd=cwd)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _stored(values: Mapping[str, object]) -> list[BaseMessage]:
    messages = values.get("messages")
    assert isinstance(messages, list)
    return [m for m in cast(list[object], messages) if isinstance(m, BaseMessage)]


def test_sections_are_joined_and_empty_ones_left_out() -> None:
    prompt = SystemPrompt(
        sections=(lambda _: "First.", lambda _: None, lambda _: "  \n", lambda _: "\nSecond.\n")
    )
    assert prompt.text(PromptContext(state={})) == "First.\n\nSecond."
    assert SystemPrompt().message(PromptContext(state={})) is None


async def test_without_a_prompt_the_model_sees_only_the_history(database: Database) -> None:
    model = ToolCallingChatModel(replies=["Hi."])
    chat = _Chat(database, model, None)
    session_id = await chat.manager.create(None)
    await chat.send(session_id, "hello")
    await chat.manager.cancel_all()

    assert [m.type for m in model.seen[0]] == ["human"]
    view = await chat.manager.inspect(session_id)
    assert [m.role for m in view.messages] == ["user", "assistant"]


async def test_the_prompt_goes_first_on_every_call_and_never_into_the_checkpoint(
    database: Database, tmp_path: Path
) -> None:
    seen: list[PromptContext] = []
    rules = ["Answer in French."]

    def section(context: PromptContext) -> str:
        seen.append(context)
        return rules[0]

    model = ToolCallingChatModel(replies=["Bonjour.", "Hallo."])
    chat = _Chat(database, model, SystemPrompt(sections=(section,)))
    session_id = await chat.manager.create(None, cwd=str(tmp_path))
    await chat.send(session_id, "hello")
    rules[0] = "Answer in German."
    await chat.send(session_id, "again")
    await chat.manager.cancel_all()

    first, second = model.seen
    assert isinstance(first[0], SystemMessage) and first[0].text == "Answer in French."
    assert [m.type for m in first] == ["system", "human"]
    # Built again for the next call: the new text, and still only one system message.
    assert isinstance(second[0], SystemMessage) and second[0].text == "Answer in German."
    assert [m.type for m in second] == ["system", "human", "ai", "human"]
    assert seen[0].cwd == str(tmp_path)

    stored = _stored(await chat.runtime.values(session_id))
    assert [m.type for m in stored] == ["human", "ai", "human", "ai"]
    for checkpoint in chat.saver.list(None):
        messages = checkpoint.checkpoint["channel_values"].get("messages", [])
        assert not any(isinstance(m, SystemMessage) for m in messages)


async def test_inspect_shows_the_system_prompt_as_the_first_row(database: Database) -> None:
    model = ToolCallingChatModel(replies=["Ok."])
    chat = _Chat(database, model, SystemPrompt(sections=(lambda _: "Be brief.",)))
    session_id = await chat.manager.create(None)

    before = await chat.manager.inspect(session_id)
    assert [(m.role, m.text) for m in before.messages] == [("system", "Be brief.")]
    assert before.stored == 0

    await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    after = await chat.manager.inspect(session_id)
    assert [m.role for m in after.messages] == ["system", "user", "assistant"]
    assert after.stored == 2
