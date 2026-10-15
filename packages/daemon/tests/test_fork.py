"""Forking a session at a message: the new thread, the copied log, and the source."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.adapter import plain_messages
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.state import SCHEMA_VERSION
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import MessageNotFoundError, SessionManager
from golem.sessions.titles import TITLE_MAX_CHARS, fork_title
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    MessageCompletedEvent,
    SessionCreatedEvent,
    SessionUpdatedEvent,
)


class _Chat:
    def __init__(self, database: Database, model: BaseChatModel) -> None:
        self.runtime: ChatRuntime = open_chat(ModelRouter(model=model), InMemorySaver())
        self.events = EventLog(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime,
            SessionLog(self.events, EventBus(), records),
            records,
            RunRecords(database),
        )

    async def turn(self, session_id: str, text: str) -> None:
        run_id = await self.manager.send(session_id, text)

        async def ended() -> bool:
            return any(event.type == "run.completed" for event in await self.events.for_run(run_id))

        await _until(ended)

    async def completed(self, session_id: str) -> list[MessageCompletedEvent]:
        return [
            event
            for event in await self.events.after(session_id, 0)
            if isinstance(event, MessageCompletedEvent)
        ]

    async def thread(self, session_id: str) -> list[tuple[str, str]]:
        values = await self.runtime.values(session_id)
        return [(message.role, message.text) for message in plain_messages(values)]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 2) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def _two_turns(database: Database) -> tuple[_Chat, ScriptedChatModel, str]:
    model = ScriptedChatModel(replies=["A1", "A2", "B"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None)
    await chat.turn(session_id, "one")
    await chat.turn(session_id, "two")
    return chat, model, session_id


async def test_fork_at_an_assistant_message_keeps_history_up_to_it(database: Database) -> None:
    chat, model, source = await _two_turns(database)
    first_reply = (await chat.completed(source))[1]

    fork = await chat.manager.fork(source, first_reply.data.message_id)

    assert await chat.thread(fork) == [("user", "one"), ("assistant", "A1")]
    assert await chat.thread(source) == [
        ("user", "one"),
        ("assistant", "A1"),
        ("user", "two"),
        ("assistant", "A2"),
    ]
    logged = await chat.events.after(fork, 0)
    created = logged[0]
    assert isinstance(created, SessionCreatedEvent)
    assert created.data.forked_from is not None
    assert (created.data.forked_from.session_id, created.data.forked_from.message_id) == (
        source,
        first_reply.data.message_id,
    )
    source_completed = (await chat.completed(source))[:2]
    copied = await chat.completed(fork)
    assert [(e.run_id, e.data) for e in copied] == [(e.run_id, e.data) for e in source_completed]
    assert [event.seq for event in logged] == [1, 2, 3]

    await chat.turn(fork, "three")
    assert model.seen[-1] == ["one", "A1", "three"]
    values = await chat.runtime.values(fork)
    assert (values["session_id"], values["schema_version"]) == (fork, SCHEMA_VERSION)


async def test_fork_at_a_user_message_drops_its_reply(database: Database) -> None:
    chat, _, source = await _two_turns(database)
    second_prompt = (await chat.completed(source))[2]

    fork = await chat.manager.fork(source, second_prompt.data.message_id)

    assert await chat.thread(fork) == [("user", "one"), ("assistant", "A1"), ("user", "two")]
    assert [e.data.text for e in await chat.completed(fork)] == ["one", "A1", "two"]


async def test_a_running_session_can_be_forked_at_a_finished_message(database: Database) -> None:
    model = GatedChatModel(reply="done")
    chat = _Chat(database, model)
    source = await chat.manager.create(None)
    model.release.set()
    await chat.turn(source, "one")
    model.release.clear()
    model.started.clear()
    await chat.manager.send(source, "two")
    await asyncio.wait_for(model.started.wait(), timeout=2)
    reply = (await chat.completed(source))[1]

    fork = await chat.manager.fork(source, reply.data.message_id)

    assert await chat.thread(fork) == [("user", "one"), ("assistant", "done")]
    model.release.set()
    await chat.manager.cancel_all()


async def test_a_fork_of_a_titled_session_is_titled_too(database: Database) -> None:
    chat, _, source = await _two_turns(database)
    await chat.manager.rename(source, "Trip plans")
    reply = (await chat.completed(source))[1]

    fork = await chat.manager.fork(source, reply.data.message_id)

    titled = [e for e in await chat.events.after(fork, 0) if isinstance(e, SessionUpdatedEvent)]
    assert [event.data.title for event in titled] == ["Trip plans (fork)"]


async def test_an_unknown_message_is_not_found(database: Database) -> None:
    chat, _, source = await _two_turns(database)
    with pytest.raises(MessageNotFoundError):
        await chat.manager.fork(source, "m_missing")


async def test_a_session_from_before_the_event_log_cannot_be_forked(database: Database) -> None:
    model = ScriptedChatModel(replies=["old"])
    chat = _Chat(database, model)
    stream = chat.runtime.stream(
        session_id="s_old",
        text="hi",
        model_profile="remote",
        schema_version=SCHEMA_VERSION,
        user_message_id="m_u",
        assistant_message_id="m_a",
    )
    async for _ in stream:
        pass
    with pytest.raises(MessageNotFoundError):
        await chat.manager.fork("s_old", "m_a")


def test_fork_title_fits_the_limit() -> None:
    assert fork_title("Trip") == "Trip (fork)"
    long = fork_title("x" * 80)
    assert len(long) == TITLE_MAX_CHARS
    assert long.endswith("… (fork)")
