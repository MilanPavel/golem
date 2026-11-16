"""The ``delegate`` section of the system prompt: small windows only, and the same every call."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import SystemMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.child import CHILD_PROMPT
from golem.graphs.delegate_prompt import DELEGATE_PROMPT, DELEGATE_TEXT, delegate_section
from golem.graphs.prompt import PromptContext, SystemPrompt
from golem.models.gate import ServerGate
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ModelCallStartedEvent


@pytest.mark.parametrize(
    ("window", "tools", "shown"),
    [
        (32_768, ("read_file", "delegate"), True),
        (65_536, ("delegate",), True),
        (65_537, ("delegate",), False),
        (200_000, ("read_file", "delegate"), False),
        (None, ("read_file", "delegate"), False),
        (32_768, ("read_file",), False),
        (32_768, (), False),
    ],
)
def test_the_section_needs_delegate_and_a_known_small_window(
    window: int | None, tools: tuple[str, ...], shown: bool
) -> None:
    context = PromptContext(state={}, tools=tools, window=window)
    assert delegate_section(context) == (DELEGATE_TEXT if shown else None)


def test_the_text_is_short() -> None:
    assert len(DELEGATE_TEXT.splitlines()) <= 4
    assert len(DELEGATE_TEXT) < 300


class _Chat:
    def __init__(self, database: Database, model: ToolCallingChatModel, window: int | None) -> None:
        self.runtime: ChatRuntime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            default_registry(),
            prompt=SystemPrompt(sections=(DELEGATE_PROMPT,)),
            blobs=BlobStore(database),
            window_of=lambda _profile, _overrides: ContextWindow(window=window),
            gate=ServerGate(slots=1),
        )
        self.runs = RunRecords(database)
        self.events = EventLog(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def send(self, session_id: str, text: str) -> list[ModelCallStartedEvent]:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        events = await self.events.for_run(run_id)
        return [e for e in events if isinstance(e, ModelCallStartedEvent)]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_inspect_shows_the_section_for_a_small_window(database: Database) -> None:
    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), 32_768)
    session_id = await chat.manager.create(None)
    view = await chat.manager.inspect(session_id)
    await chat.manager.cancel_all()

    assert [m.role for m in view.messages] == ["system"]
    assert view.messages[0].text == DELEGATE_TEXT


async def test_inspect_leaves_it_out_for_a_large_or_unknown_window(database: Database) -> None:
    for window in (200_000, None):
        chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), window)
        session_id = await chat.manager.create(None)
        view = await chat.manager.inspect(session_id)
        await chat.manager.cancel_all()
        assert view.messages == []


async def test_two_calls_of_a_run_send_the_same_prompt_and_name_the_section(
    database: Database,
) -> None:
    model = ToolCallingChatModel(replies=[[("list_dir", {"path": "."})], "done"])
    chat = _Chat(database, model, 32_768)
    session_id = await chat.manager.create(None)
    first, second = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()

    assert first.data.system_prompt_sha == second.data.system_prompt_sha is not None
    assert [s.name for s in first.data.system_sections or []] == ["delegate"]
    assert isinstance(model.seen[0][0], SystemMessage)
    assert model.seen[0][0].content == DELEGATE_TEXT


async def test_a_helper_gets_its_own_prompt_not_the_section(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look around"})], "found", "ok"])
    chat = _Chat(database, model, 32_768)
    session_id = await chat.manager.create(None, cwd=str(tmp_path))
    await chat.send(session_id, "what is this repo")
    await chat.manager.cancel_all()

    parent_first, helper_first = model.seen[0][0], model.seen[1][0]
    assert isinstance(parent_first, SystemMessage)
    assert parent_first.content == DELEGATE_TEXT
    assert isinstance(helper_first, SystemMessage)
    assert helper_first.content == CHILD_PROMPT
