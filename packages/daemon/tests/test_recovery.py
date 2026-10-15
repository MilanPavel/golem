"""Closing runs a stopped daemon left open."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from contextlib import aclosing
from typing import cast

from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import INTERRUPTED_KEY, ChatRuntime, open_chat
from golem.graphs.state import SCHEMA_VERSION
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import STOPPED_MESSAGE, OpenTurn, open_turn, recover_runs
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    CHAT_EVENT,
    ChatEvent,
    EmptyEventData,
    EventType,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageStartedData,
    RunFailedEvent,
    SessionCreatedData,
)


def _event(seq: int, kind: EventType, data: dict[str, object]) -> ChatEvent:
    return CHAT_EVENT.validate_python(
        {"seq": seq, "session_id": "s_a", "run_id": "r_1", "ts": "t", "type": kind, "data": data}
    )


_USER = _event(1, "message.completed", {"message_id": "m_u", "role": "user", "text": "hi"})
_RUN = _event(2, "run.started", {})
_OPEN = _event(3, "message.started", {"message_id": "m_a", "role": "assistant"})
_DONE = _event(6, "message.completed", {"message_id": "m_a", "role": "assistant", "text": "Hey"})


def _delta(seq: int, text: str) -> ChatEvent:
    return _event(seq, "message.delta", {"message_id": "m_a", "text": text})


def test_open_turn_reads_the_unfinished_message() -> None:
    cases: list[tuple[list[ChatEvent], OpenTurn]] = [
        ([_USER, _RUN], OpenTurn("m_u", None, "")),
        ([_USER, _RUN, _OPEN], OpenTurn("m_u", "m_a", "")),
        ([_USER, _OPEN, _delta(4, "He"), _delta(5, "y")], OpenTurn("m_u", "m_a", "Hey")),
        ([_USER, _OPEN, _delta(4, "He"), _DONE], OpenTurn("m_u", None, "")),
    ]
    for events, expected in cases:
        assert open_turn(events) == expected


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 2) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not await check():
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError
        await asyncio.sleep(0.01)


def _last_message(values: Mapping[str, object]) -> BaseMessage:
    messages = values["messages"]
    assert isinstance(messages, list)
    last = cast(list[object], messages)[-1]
    assert isinstance(last, BaseMessage)
    return last


def _manager(runtime: ChatRuntime, database: Database) -> tuple[SessionManager, EventLog]:
    events = EventLog(database)
    log = SessionLog(events, EventBus())
    manager = SessionManager(runtime, log, SessionRecords(database), RunRecords(database))
    return manager, events


async def _lose_a_run(runtime: ChatRuntime, model: GatedChatModel, log: SessionLog) -> None:
    """Leave ``r_lost`` the way a daemon that died mid-answer leaves it."""
    await log.emit("s_a", None, "session.created", SessionCreatedData(model_profile="remote"))
    await log.emit(
        "s_a",
        "r_lost",
        "message.completed",
        MessageCompletedData(message_id="m_u", role="user", text="hi"),
    )
    await log.emit("s_a", "r_lost", "run.started", EmptyEventData())
    await log.emit(
        "s_a", "r_lost", "message.started", MessageStartedData(message_id="m_a", role="assistant")
    )
    stream = runtime.stream(
        session_id="s_a",
        text="hi",
        model_profile="remote",
        schema_version=SCHEMA_VERSION,
        user_message_id="m_u",
        assistant_message_id="m_a",
    )

    async def consume() -> None:
        async with aclosing(stream):
            async for _ in stream:
                pass

    graph = asyncio.create_task(consume())
    await model.started.wait()
    for char in model.streamed:
        await log.emit(
            "s_a", "r_lost", "message.delta", MessageDeltaData(message_id="m_a", text=char)
        )
    graph.cancel()
    await asyncio.wait({graph})


async def test_a_lost_run_completes_its_partial_reply(database: Database) -> None:
    model = GatedChatModel(streamed="Hel", reply="lo")
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    events = EventLog(database)
    await _lose_a_run(runtime, model, SessionLog(events, EventBus()))

    closed = await recover_runs(
        RunRecords(database), events, SessionLog(events, EventBus()), runtime
    )
    assert closed == ["r_lost"]
    completed, failed = (await events.for_run("r_lost"))[-2:]
    assert isinstance(completed, MessageCompletedEvent)
    assert (completed.data.text, completed.data.interrupted) == ("Hel", True)
    assert isinstance(failed, RunFailedEvent)
    assert failed.data.message == STOPPED_MESSAGE
    assert not any(isinstance(e, MessageDeltaEvent) for e in await events.for_run("r_lost"))

    reply = _last_message(await runtime.values("s_a"))
    assert (reply.id, reply.text) == ("m_a", "Hel")
    assert reply.response_metadata[INTERRUPTED_KEY] is True

    run = await RunRecords(database).get("r_lost")
    assert run is not None
    assert (run.status, run.error) == ("failed", STOPPED_MESSAGE)
    assert (
        await recover_runs(RunRecords(database), events, SessionLog(events, EventBus()), runtime)
        == []
    )


async def test_a_reply_the_checkpoint_finished_is_kept(database: Database) -> None:
    runtime = open_chat(ModelRouter(model=ScriptedChatModel(replies=["alpha"])), InMemorySaver())
    manager, events = _manager(runtime, database)
    session_id = await manager.create(None)
    run_id = await manager.send(session_id, "hi")

    async def finished() -> bool:
        run = await RunRecords(database).get(run_id)
        return run is not None and run.status == "completed"

    await _until(finished)
    reply_id = next(
        e.data.message_id
        for e in await events.for_run(run_id)
        if isinstance(e, MessageCompletedEvent) and e.data.role == "assistant"
    )
    log = SessionLog(events, EventBus())
    await log.emit(session_id, "r_lost", "run.started", EmptyEventData())
    await log.emit(
        session_id,
        "r_lost",
        "message.started",
        MessageStartedData(message_id=reply_id, role="assistant"),
    )
    await log.emit(
        session_id,
        "r_lost",
        "message.delta",
        MessageDeltaData(message_id=reply_id, text="al"),
    )

    assert await recover_runs(RunRecords(database), events, log, runtime) == ["r_lost"]
    completed = (await events.for_run("r_lost"))[-2]
    assert isinstance(completed, MessageCompletedEvent)
    assert (completed.data.text, completed.data.interrupted) == ("alpha", False)
    assert _last_message(await runtime.values(session_id)).text == "alpha"
