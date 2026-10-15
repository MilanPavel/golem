"""Session titles: cleaning, fallback, and when the manager asks for one."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from fakes import ScriptedChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.titles import (
    TITLE_MAX_CHARS,
    ModelTitles,
    TitleGenerator,
    choose_title,
    clean_title,
)
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import SessionUpdatedEvent


class _Titles:
    """Answers each ask with the next proposal, or raises when it is an exception."""

    def __init__(self, *proposals: str | Exception) -> None:
        self._proposals = list(proposals)
        self.asked: list[tuple[str, str, str]] = []

    async def title(self, model_profile: str, prompt: str, reply: str) -> str:
        self.asked.append((model_profile, prompt, reply))
        proposal = self._proposals.pop(0)
        if isinstance(proposal, Exception):
            raise proposal
        return proposal


class _Never:
    def __init__(self) -> None:
        self.asked = asyncio.Event()

    async def title(self, model_profile: str, prompt: str, reply: str) -> str:
        del model_profile, prompt, reply
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
        _Titles(RuntimeError("no key")), model_profile="remote", prompt=prompt, reply="r"
    )
    blank = await choose_title(_Titles("  "), model_profile="remote", prompt=prompt, reply="r")
    assert failed == blank == "How do I"


async def test_a_slow_proposal_times_out_to_the_first_line() -> None:
    title = await choose_title(
        _Never(), model_profile="remote", prompt="hi", reply="r", timeout=0.01
    )
    assert title == "hi"


async def test_model_titles_ask_the_session_model() -> None:
    model = ScriptedChatModel(replies=['"Greeting."'])
    titles = ModelTitles(ModelRouter(model=model))
    title = await choose_title(titles, model_profile="remote", prompt="hello", reply="Hi there")
    assert title == "Greeting"
    assert "User: hello\n\nAssistant: Hi there" in model.seen[0][1]


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
        if isinstance(event, SessionUpdatedEvent)
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
