"""Session titles: cleaning, fallback, and when the manager asks for one."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any

import pytest
from fakes import ScriptedChatModel, ToolCallingChatModel
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import GolemSettings, ModelPrice
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import BlankTitleError, SessionManager, SessionNotFoundError
from golem.sessions.titles import (
    TITLE_MAX_CHARS,
    ModelTitles,
    TitleGenerator,
    choose_title,
    clean_title,
)
from golem.sessions.usage import Usage
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import SessionUpdatedEvent


class _Titles:
    """Answers each ask with the next proposal, or raises when it is an exception."""

    def __init__(self, *proposals: str | Exception) -> None:
        self._proposals = list(proposals)
        self.asked: list[tuple[str, str, str]] = []

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
        session_id: str | None = None,
    ) -> str:
        self.asked.append((model_profile, prompt, reply))
        proposal = self._proposals.pop(0)
        if isinstance(proposal, Exception):
            raise proposal
        return proposal


class _Gated:
    def __init__(self, proposal: str) -> None:
        self.proposal = proposal
        self.asked = asyncio.Event()
        self.release = asyncio.Event()

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
        session_id: str | None = None,
    ) -> str:
        del model_profile, prompt, reply, options, session_id
        self.asked.set()
        await self.release.wait()
        return self.proposal


class _Never:
    def __init__(self) -> None:
        self.asked = asyncio.Event()

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
        session_id: str | None = None,
    ) -> str:
        del model_profile, prompt, reply, options, session_id
        self.asked.set()
        await asyncio.Event().wait()
        return ""


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Rust borrow checker", "Rust borrow checker"),
        ('"Planning a trip."', "Planning a trip"),
        ("Title: Tax questions", "Tax questions"),
        ("\n\n  two   spaces \nsecond line", "two spaces"),
        ("**Bold name**", "Bold name"),
        ("   ", ""),
        ("x" * 80, "x" * (TITLE_MAX_CHARS - 1) + "…"),
    ],
)
def test_clean_title(raw: str, expected: str) -> None:
    assert clean_title(raw) == expected


async def test_a_failed_or_blank_proposal_falls_back_to_the_first_line() -> None:
    prompt = "How do I\nsplit a string?"
    failed = await choose_title(
        _Titles(RuntimeError("no key")),
        model_profile="remote",
        prompt=prompt,
        reply="r",
        session_id="s_1",
    )
    blank = await choose_title(
        _Titles("  "), model_profile="remote", prompt=prompt, reply="r", session_id="s_1"
    )
    assert failed == blank == "How do I"


async def test_a_slow_proposal_times_out_to_the_first_line() -> None:
    title = await choose_title(
        _Never(), model_profile="remote", prompt="hi", reply="r", session_id="s_1", timeout=0.01
    )
    assert title == "hi"


async def test_model_titles_ask_the_session_model() -> None:
    model = ScriptedChatModel(replies=['"Greeting."'])
    titles = ModelTitles(ModelRouter(model=model))
    title = await choose_title(
        titles, model_profile="remote", prompt="hello", reply="Hi there", session_id="s_1"
    )
    assert title == "Greeting"
    assert "User: hello\n\nAssistant: Hi there" in model.seen[0][1]


async def test_a_title_call_writes_a_titles_row(database: Database) -> None:
    model = ToolCallingChatModel(
        replies=['"Greeting."'],
        usage={"input_tokens": 1_000, "output_tokens": 10, "total_tokens": 1_010},
    )
    titles = ModelTitles(ModelRouter(model=model))
    usage = Usage(database)
    titles.record_to(
        usage, lambda _profile: ModelPrice(input=2.0, output=4.0), lambda _profile: "budget"
    )
    await choose_title(titles, model_profile="remote", prompt="hello", reply="Hi", session_id="s_1")
    (row,) = await database.fetch_all(
        "SELECT session_id, role, tier, input, output, cost_usd, failed FROM model_calls"
    )
    assert tuple(row) == ("s_1", "titles", "budget", 1_000, 10, pytest.approx(0.00204), 0)
    assert await usage.spent(session_id="s_1") == pytest.approx(0.00204)


def _manager(
    database: Database, model: ScriptedChatModel, titles: TitleGenerator | None
) -> tuple[SessionManager, EventLog]:
    events = EventLog(database)
    records = SessionRecords(database)
    manager = SessionManager(
        open_chat(ModelRouter(model=model), InMemorySaver()),
        SessionLog(events, EventBus(), records),
        records,
        RunRecords(database),
        titles=titles,
    )
    return manager, events


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 2) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def _titled(events: EventLog, session_id: str) -> list[str]:
    return [
        event.data.title
        for event in await events.after(session_id, 0)
        if isinstance(event, SessionUpdatedEvent) and event.data.title is not None
    ]


async def test_the_first_completed_run_names_the_session_once(database: Database) -> None:
    titles = _Titles("Greeting")
    manager, events = _manager(database, ScriptedChatModel(replies=["Hi", "Again"]), titles)
    session_id = await manager.create(None)

    await manager.send(session_id, "hello")

    async def named() -> bool:
        return await _titled(events, session_id) == ["Greeting"]

    await _until(named)
    record = await SessionRecords(database).get(session_id)
    assert record is not None
    assert record.title == "Greeting"
    assert titles.asked == [("remote", "hello", "Hi")]

    second = await manager.send(session_id, "more")

    async def ended() -> bool:
        return any(event.type == "run.completed" for event in await events.for_run(second))

    await _until(ended)
    await manager.cancel_all()
    assert await _titled(events, session_id) == ["Greeting"]
    assert len(titles.asked) == 1


async def test_a_failed_run_does_not_name_the_session(database: Database) -> None:
    titles = _Titles("Never")
    manager, events = _manager(database, ScriptedChatModel(replies=[]), titles)
    session_id = await manager.create(None)
    run_id = await manager.send(session_id, "hello")

    async def failed() -> bool:
        return any(event.type == "run.failed" for event in await events.for_run(run_id))

    await _until(failed)
    await manager.cancel_all()
    assert titles.asked == []
    assert await _titled(events, session_id) == []


async def test_shutdown_cancels_a_title_still_being_chosen(database: Database) -> None:
    titles = _Never()
    manager, events = _manager(database, ScriptedChatModel(replies=["Hi"]), titles)
    session_id = await manager.create(None)
    await manager.send(session_id, "hello")
    await asyncio.wait_for(titles.asked.wait(), timeout=2)

    await manager.cancel_all()

    assert await _titled(events, session_id) == []


async def test_rename_stores_the_cleaned_title(database: Database) -> None:
    manager, events = _manager(database, ScriptedChatModel(replies=[]), None)
    session_id = await manager.create(None)

    assert await manager.rename(session_id, '  "Trip plans."\nsecond line') == "Trip plans"

    assert await _titled(events, session_id) == ["Trip plans"]
    record = await SessionRecords(database).get(session_id)
    assert record is not None
    assert record.title == "Trip plans"


async def test_rename_rejects_a_blank_title_and_a_missing_session(database: Database) -> None:
    manager, _ = _manager(database, ScriptedChatModel(replies=[]), None)
    session_id = await manager.create(None)
    with pytest.raises(BlankTitleError):
        await manager.rename(session_id, " \n ")
    with pytest.raises(SessionNotFoundError):
        await manager.rename("s_missing", "Name")


async def test_a_title_set_by_hand_wins_over_one_being_chosen(database: Database) -> None:
    titles = _Gated("Automatic")
    manager, events = _manager(database, ScriptedChatModel(replies=["Hi", "Again"]), titles)
    session_id = await manager.create(None)
    await manager.send(session_id, "hello")
    await asyncio.wait_for(titles.asked.wait(), timeout=2)

    await manager.rename(session_id, "Mine")
    titles.release.set()
    second = await manager.send(session_id, "more")

    async def ended() -> bool:
        return any(event.type == "run.completed" for event in await events.for_run(second))

    await _until(ended)
    await manager.cancel_all()
    assert await _titled(events, session_id) == ["Mine"]


class _RecordingRouter(ModelRouter):
    """Real name resolution; records what ``chat_model`` is asked for."""

    def __init__(self, settings: GolemSettings) -> None:
        super().__init__(settings)
        self.asked: list[tuple[str, dict[str, float | str]]] = []
        self.model = ScriptedChatModel(replies=["A title"])

    def chat_model(
        self, profile: str, overrides: Mapping[str, float | str] | None = None
    ) -> BaseChatModel:
        self.asked.append((profile, dict(overrides or {})))
        return self.model


def _settings(**roles: str) -> GolemSettings:
    return GolemSettings.model_validate(
        {"default_model": "ollama/qwen3:8b", "routing": {"roles": roles}}
    )


def _tiers(ref: str) -> Tier | None:
    return "local" if ref.startswith("ollama/") else "frontier"


async def test_a_local_title_is_asked_with_the_session_options() -> None:
    router = _RecordingRouter(_settings())
    titles = ModelTitles(router)
    titles.bind(_tiers, list)
    options: dict[str, float | str] = {"num_ctx": 16384, "temperature": 0.2}
    await titles.title("ollama/qwen3:8b", "hi", "hello", options)
    assert router.asked == [("ollama/qwen3:8b", {**options, "num_predict": 64})]


async def test_a_title_on_ollama_turns_thinking_off_when_the_model_takes_it() -> None:
    router = _RecordingRouter(_settings())
    router.note_think_values("qwen3:8b", ["off", "on"])
    titles = ModelTitles(router)
    titles.bind(_tiers, list)
    await titles.title("ollama/qwen3:8b", "hi", "hello", {"num_ctx": 8192})
    assert router.asked[0][1] == {"num_ctx": 8192, "num_predict": 64, "think": "off"}


async def test_a_hosted_session_asks_the_budget_model_with_no_session_options() -> None:
    router = _RecordingRouter(_settings())
    titles = ModelTitles(router)
    titles.bind(_tiers, lambda: ["ollama/qwen3:8b"])
    await titles.title("anthropic/claude-opus", "hi", "hello", {"num_ctx": 16384})
    assert router.asked == [("ollama/qwen3:8b", {"num_predict": 64})]


async def test_a_hosted_title_model_gets_no_num_predict() -> None:
    router = _RecordingRouter(_settings())
    titles = ModelTitles(router)
    titles.bind(_tiers, lambda: ["deepseek/deepseek-chat"])
    await titles.title("anthropic/claude-opus", "hi", "hello", {"num_ctx": 16384})
    assert router.asked == [("deepseek/deepseek-chat", {})]


async def test_a_configured_role_model_wins() -> None:
    router = _RecordingRouter(_settings(titles="openai/gpt-mini"))
    titles = ModelTitles(router)
    titles.bind(_tiers, lambda: ["deepseek/deepseek-chat"])
    await titles.title("ollama/qwen3:8b", "hi", "hello", {"num_ctx": 16384})
    assert router.asked == [("openai/gpt-mini", {})]


async def test_the_title_request_carries_the_session_num_ctx() -> None:
    sent: list[dict[str, Any]] = []

    class _Client:
        async def chat(self, **params: Any) -> AsyncIterator[dict[str, Any]]:
            sent.append(params)

            async def stream() -> AsyncIterator[dict[str, Any]]:
                yield {"message": {"role": "assistant", "content": "Greeting"}}
                yield {"message": {"role": "assistant", "content": ""}, "done": True}

            return stream()

    class _Router(ModelRouter):
        def chat_model(
            self, profile: str, overrides: Mapping[str, float | str] | None = None
        ) -> BaseChatModel:
            model = super().chat_model(profile, overrides)
            object.__setattr__(model, "_async_client", _Client())
            return model

    titles = ModelTitles(_Router(_settings()))
    titles.bind(_tiers, list)
    title = await titles.title("ollama/qwen3:8b", "hi", "hello", {"num_ctx": 16384})
    assert title == "Greeting"
    assert sent[0]["options"]["num_ctx"] == 16384
    assert sent[0]["options"]["num_predict"] == 64
