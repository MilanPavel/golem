"""Cancelling a run: the log, the checkpoint, and the reason."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import cast

import pytest
from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.adapter import plain_messages
from golem.graphs.chat import INTERRUPTED_KEY, ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import RunNotFoundError, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    RunCancelledEvent,
)


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.manager = SessionManager(
            runtime,
            SessionLog(self.events, EventBus()),
            SessionRecords(database),
            self.runs,
        )

    async def streamed(self, run_id: str, text: str) -> None:
        async def check() -> bool:
            deltas = [
                e for e in await self.events.for_run(run_id) if isinstance(e, MessageDeltaEvent)
            ]
            return "".join(delta.data.text for delta in deltas) == text

        await _until(check)

    async def tail(self, run_id: str) -> list[ChatEvent]:
        return (await self.events.for_run(run_id))[-2:]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 2) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _gated(database: Database, streamed: str) -> tuple[_Chat, GatedChatModel]:
    model = GatedChatModel(streamed=streamed, reply="lo")
    return _Chat(database, open_chat(ModelRouter(model=model), InMemorySaver())), model


async def test_cancel_mid_stream_keeps_the_partial_reply(database: Database) -> None:
    chat, _ = _gated(database, "Hel")
    session_id = await chat.manager.create(None)
    run_id = await chat.manager.send(session_id, "hi")
    await chat.streamed(run_id, "Hel")

    assert await chat.manager.cancel(run_id) is True

    completed, cancelled = await chat.tail(run_id)
    assert isinstance(completed, MessageCompletedEvent)
    assert (completed.data.text, completed.data.interrupted) == ("Hel", True)
    assert isinstance(cancelled, RunCancelledEvent)
    assert cancelled.data.reason == "user"
    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "cancelled"
    values = await chat.runtime.values(session_id)
    assert [(m.role, m.text) for m in plain_messages(values)] == [
        ("user", "hi"),
        ("assistant", "Hel"),
    ]


async def test_the_next_turn_sees_the_partial_reply(database: Database) -> None:
    chat, model = _gated(database, "Hel")
    session_id = await chat.manager.create(None)
    first = await chat.manager.send(session_id, "hi")
    await chat.streamed(first, "Hel")
    await chat.manager.cancel(first)

    model.release.set()
    second = await chat.manager.send(session_id, "go on")

    async def done() -> bool:
        run = await chat.runs.get(second)
        return run is not None and run.status == "completed"

    await _until(done)
    assert model.seen[1] == ["hi", "Hel", "go on"]


async def test_cancel_before_the_first_token(database: Database) -> None:
    chat, model = _gated(database, "")
    session_id = await chat.manager.create(None)
    run_id = await chat.manager.send(session_id, "hi")
    await model.started.wait()

    assert await chat.manager.cancel(run_id) is True

    completed, cancelled = await chat.tail(run_id)
    assert isinstance(completed, MessageCompletedEvent)
    assert (completed.data.text, completed.data.interrupted) == ("", True)
    assert isinstance(cancelled, RunCancelledEvent)
    messages = plain_messages(await chat.runtime.values(session_id))
    assert [m.role for m in messages] == ["user"]


async def test_cancel_right_after_send_still_ends_the_run(database: Database) -> None:
    chat, _ = _gated(database, "Hel")
    session_id = await chat.manager.create(None)
    run_id = await chat.manager.send(session_id, "hi")

    assert await chat.manager.cancel(run_id) is True

    types = [event.type for event in await chat.events.for_run(run_id)]
    assert types[0] == "message.completed"
    assert "run.started" in types
    assert types[-1] == "run.cancelled"


async def test_an_unknown_run_and_a_finished_run(database: Database) -> None:
    chat = _Chat(
        database, open_chat(ModelRouter(model=ScriptedChatModel(replies=["Hi"])), InMemorySaver())
    )
    with pytest.raises(RunNotFoundError):
        await chat.manager.cancel("r_missing")
    session_id = await chat.manager.create(None)
    run_id = await chat.manager.send(session_id, "hi")

    async def done() -> bool:
        run = await chat.runs.get(run_id)
        return run is not None and run.status == "completed"

    await _until(done)
    assert await chat.manager.cancel(run_id) is False


async def test_cancel_all_gives_the_shutdown_reason(database: Database) -> None:
    chat, _ = _gated(database, "Hel")
    session_id = await chat.manager.create(None)
    run_id = await chat.manager.send(session_id, "hi")
    await chat.streamed(run_id, "Hel")

    await chat.manager.cancel_all()

    _, cancelled = await chat.tail(run_id)
    assert isinstance(cancelled, RunCancelledEvent)
    assert cancelled.data.reason == "shutdown"
    messages = (await chat.runtime.values(session_id))["messages"]
    assert isinstance(messages, list)
    reply = cast(list[object], messages)[-1]
    assert isinstance(reply, BaseMessage)
    assert reply.response_metadata[INTERRUPTED_KEY] is True
