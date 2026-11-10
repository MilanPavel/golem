"""Each model call stores its system prompt and tool schemas by hash, and reports the hashes."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any, cast

from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import open_chat
from golem.graphs.prompt import PromptContext, Section, SystemPrompt
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow, WindowOf
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import (
    ChatEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    PromptSectionInfo,
)


class _RefusesTools(ToolCallingChatModel):
    """Takes tools until a call that carries them, which its server refuses."""

    refuse: bool = False

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        super().bind_tools(tools, **kwargs)
        return self.model_copy(update={"refuse": True})

    def _generate(self, messages: list[BaseMessage], *args: Any, **kwargs: Any) -> Any:
        if self.refuse:
            raise RuntimeError("registry.ollama.ai/x does not support tools")
        return super()._generate(messages, *args, **kwargs)


class _Chat:
    def __init__(
        self,
        database: Database,
        model: ToolCallingChatModel,
        prompt: SystemPrompt | None,
        window_of: WindowOf | None = None,
        note_loaded: Callable[[str, int | None], Awaitable[int | None]] | None = None,
    ) -> None:
        self.database = database
        self.runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            default_registry(),
            prompt=prompt,
            blobs=BlobStore(database),
            window_of=window_of,
            note_loaded=note_loaded,
        )
        self.completed: list[ModelCallCompletedEvent] = []
        self.events = EventLog(database)
        self.runs = RunRecords(database)
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
        events: list[ChatEvent] = await self.events.for_run(run_id)
        self.completed = [e for e in events if isinstance(e, ModelCallCompletedEvent)]
        return [e for e in events if isinstance(e, ModelCallStartedEvent)]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_the_same_text_is_stored_once_and_read_back_byte_for_byte(
    database: Database,
) -> None:
    blobs = BlobStore(database)
    text = "Answer in French.\n\nnaïve café ✓"
    first = await blobs.put("system_prompt", text)
    second = await blobs.put("system_prompt", text)

    assert first == second == hashlib.sha256(text.encode()).hexdigest()
    assert await blobs.get(first) == ("system_prompt", text)
    assert await blobs.get("0" * 64) is None
    rows = await database.fetch_all("SELECT size FROM blobs")
    assert [int(row["size"]) for row in rows] == [len(text)]


async def test_two_calls_with_one_prompt_share_a_blob(database: Database) -> None:
    model = ToolCallingChatModel(replies=[[("todo_write", {"todos": []})], "done"])
    chat = _Chat(database, model, SystemPrompt(sections=(lambda _: "Be brief.",)))
    session_id = await chat.manager.create(None)
    first, second = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()

    assert first.data.system_prompt_sha == second.data.system_prompt_sha is not None
    assert first.data.tools_sha == second.data.tools_sha is not None
    rows = await database.fetch_all("SELECT kind FROM blobs ORDER BY kind")
    assert [row["kind"] for row in rows] == ["system_prompt", "tools"]

    blobs = BlobStore(database)
    assert await blobs.get(first.data.system_prompt_sha or "") == ("system_prompt", "Be brief.")
    kind, text = await blobs.get(first.data.tools_sha or "") or ("", "")
    assert kind == "tools"
    assert text == json.dumps(default_registry().schemas(), sort_keys=True, separators=(",", ":"))
    assert hashlib.sha256(text.encode()).hexdigest() == first.data.tools_sha


async def test_message_ids_are_the_history_sent_in_order(database: Database) -> None:
    model = ToolCallingChatModel(replies=["one", "two"])
    chat = _Chat(database, model, None)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    messages = (await chat.runtime.values(session_id))["messages"]
    assert isinstance(messages, list)
    stored = [m.id for m in cast(list[BaseMessage], messages)]
    (second,) = await chat.send(session_id, "again")
    await chat.manager.cancel_all()

    assert first.data.system_prompt_sha is None
    assert len(first.data.message_ids) == 1
    assert second.data.message_ids[: len(stored)] == stored
    assert len(second.data.message_ids) == len(stored) + 1


async def test_a_changed_prompt_has_another_hash(database: Database) -> None:
    rules = ["Answer in French."]

    def section(_: PromptContext) -> str:
        return rules[0]

    chat = _Chat(database, ToolCallingChatModel(replies=["a", "b"]), SystemPrompt((section,)))
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    rules[0] = "Answer in German."
    (second,) = await chat.send(session_id, "again")
    await chat.manager.cancel_all()

    assert first.data.system_prompt_sha != second.data.system_prompt_sha
    rows = await database.fetch_all("SELECT 1 FROM blobs WHERE kind = 'system_prompt'")
    assert len(rows) == 2


async def test_a_profile_that_refused_tools_records_none(database: Database) -> None:
    model = _RefusesTools(replies=["one", "two"])
    chat = _Chat(database, model, None)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    (second,) = await chat.send(session_id, "again")
    await chat.manager.cancel_all()

    assert first.data.tools_sha is not None  # sent, then refused
    assert second.data.tools_sha is None


async def test_without_a_store_nothing_is_recorded(database: Database) -> None:
    model = ToolCallingChatModel(replies=["hi"])
    runtime = open_chat(
        ModelRouter(model=model), InMemorySaver(), prompt=SystemPrompt((lambda _: "x",))
    )
    records = SessionRecords(database)
    events = EventLog(database)
    runs = RunRecords(database)
    manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
    session_id = await manager.create(None)
    run_id = await manager.send(session_id, "hello")

    async def done() -> bool:
        run = await runs.get(run_id)
        return run is not None and run.status != "running"

    await _until(done)
    (started,) = [e for e in await events.for_run(run_id) if isinstance(e, ModelCallStartedEvent)]
    await manager.cancel_all()
    assert (started.data.system_prompt_sha, started.data.tools_sha) == (None, None)
    assert await database.fetch_all("SELECT 1 FROM blobs") == []


async def test_the_sections_are_recorded_with_their_lengths(database: Database) -> None:
    prompt = SystemPrompt((Section("rules", lambda _: "Be brief."), lambda _: "Use tools."))
    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), prompt)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert first.data.system_sections == [
        PromptSectionInfo(name="rules", chars=9),
        PromptSectionInfo(name="section_2", chars=10),
    ]


async def test_no_prompt_records_no_sections(database: Database) -> None:
    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), None)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert first.data.system_sections is None


async def test_the_window_is_recorded_when_it_is_known(database: Database) -> None:
    chat = _Chat(
        database,
        ToolCallingChatModel(replies=["hi"]),
        None,
        window_of=lambda _, __: ContextWindow(8192, 8192),
    )
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert (first.data.context_window, first.data.num_ctx) == (8192, 8192)
    assert first.data.window_estimated is False

    plain = _Chat(database, ToolCallingChatModel(replies=["hi"]), None)
    other = await plain.manager.create(None)
    (second,) = await plain.send(other, "hello")
    await plain.manager.cancel_all()
    assert (second.data.context_window, second.data.num_ctx) == (None, None)


async def test_an_estimated_window_is_recorded_as_estimated(database: Database) -> None:
    chat = _Chat(
        database,
        ToolCallingChatModel(replies=["hi"]),
        None,
        window_of=lambda _, __: ContextWindow(8192, None, True),
    )
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert (first.data.context_window, first.data.num_ctx) == (8192, None)
    assert first.data.window_estimated is True


async def test_a_model_call_tells_note_loaded_the_profile(database: Database) -> None:
    seen: list[str] = []

    async def note(profile: str, sent: int | None) -> int | None:
        seen.append(profile)
        return None

    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), None, note_loaded=note)
    session_id = await chat.manager.create(None)
    await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    assert len(seen) == 1


async def test_a_note_loaded_that_raises_does_not_fail_the_call(database: Database) -> None:
    async def note(profile: str, sent: int | None) -> int | None:
        raise RuntimeError("boom")

    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), None, note_loaded=note)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "hello")
    run = await chat.runs.get(str(first.run_id))
    await chat.manager.cancel_all()
    assert run is not None
    assert run.status == "completed"


async def _ran_with(
    database: Database, sent: int | None, loaded: int | None
) -> tuple[int | None, list[int | None]]:
    asked: list[int | None] = []

    async def note(profile: str, num_ctx: int | None) -> int | None:
        asked.append(num_ctx)
        return loaded

    chat = _Chat(
        database,
        ToolCallingChatModel(replies=["hi"]),
        None,
        window_of=lambda _, __: ContextWindow(sent, sent),
        note_loaded=note,
    )
    session_id = await chat.manager.create(None)
    await chat.send(session_id, "hello")
    await chat.manager.cancel_all()
    (done,) = chat.completed
    return done.data.context_window, asked


async def test_the_completed_call_has_the_window_ollama_loaded_when_nothing_was_sent(
    database: Database,
) -> None:
    assert await _ran_with(database, None, 32768) == (32768, [None])


async def test_the_completed_call_has_the_sent_num_ctx_when_one_was_sent(
    database: Database,
) -> None:
    assert await _ran_with(database, 8192, 8192) == (8192, [8192])
    assert await _ran_with(database, 8192, None) == (8192, [8192])


async def test_the_completed_call_has_no_window_when_ollama_says_nothing(
    database: Database,
) -> None:
    assert await _ran_with(database, None, None) == (None, [None])


async def test_ollamas_value_wins_over_the_sent_one_when_they_differ(
    database: Database,
) -> None:
    assert await _ran_with(database, 8192, 4096) == (4096, [8192])


async def test_the_sizes_sent_are_recorded_in_chars_and_bytes(database: Database) -> None:
    prompt = SystemPrompt((lambda _: "Be brief ✓",))
    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), prompt)
    session_id = await chat.manager.create(None)
    (first,) = await chat.send(session_id, "naïve café")
    await chat.manager.cancel_all()
    tools = json.dumps(default_registry().schemas(), sort_keys=True, separators=(",", ":"))
    data = first.data
    assert (data.system_chars, data.system_bytes) == (10, 12)
    assert (data.tools_chars, data.tools_bytes) == (len(tools), len(tools.encode()))
    assert data.message_chars == [10]
    assert data.message_bytes == [12]


async def test_no_prompt_and_no_tools_record_zero_sizes(database: Database) -> None:
    chat = _Chat(database, _RefusesTools(replies=["one", "two"]), None)
    session_id = await chat.manager.create(None)
    await chat.send(session_id, "hello")
    (second,) = await chat.send(session_id, "again")
    await chat.manager.cancel_all()
    assert (second.data.system_chars, second.data.system_bytes) == (0, 0)
    assert (second.data.tools_chars, second.data.tools_bytes) == (0, 0)
