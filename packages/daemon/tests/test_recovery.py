"""Closing runs a stopped daemon left open."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import cast

from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import INTERRUPTED_KEY, ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.sessions.log import SessionLog, discard
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
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageStartedData,
    RunFailedEvent,
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
    return SessionManager(runtime, SessionLog(events), SessionRecords(database)), events


async def test_a_lost_run_completes_its_partial_reply(database: Database) -> None:
    model = GatedChatModel(streamed="Hel", reply="lo")
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    manager, events = _manager(runtime, database)
    session_id = await manager.create(None, discard)
    run_id = await manager.send(session_id, "hi", discard)
    await model.started.wait()

    async def streamed() -> bool:
        deltas = [e for e in await events.for_run(run_id) if isinstance(e, MessageDeltaEvent)]
        return "".join(delta.data.text for delta in deltas) == "Hel"

    await _until(streamed)
    await manager.cancel_all()

    closed = await recover_runs(RunRecords(database), events, SessionLog(events), runtime)
    assert closed == [run_id]
    tail = (await events.for_run(run_id))[-2:]
    completed, failed = tail
    assert isinstance(completed, MessageCompletedEvent)
    assert (completed.data.text, completed.data.interrupted) == ("Hel", True)
    assert isinstance(failed, RunFailedEvent)
    assert failed.data.message == STOPPED_MESSAGE
    assert not any(isinstance(e, MessageDeltaEvent) for e in await events.for_run(run_id))

    reply = _last_message(await runtime.values(session_id))
    assert (reply.id, reply.text) == (completed.data.message_id, "Hel")
    assert reply.response_metadata[INTERRUPTED_KEY] is True

    run = await RunRecords(database).get(run_id)
    assert run is not None
    assert (run.status, run.error) == ("failed", STOPPED_MESSAGE)
    assert await recover_runs(RunRecords(database), events, SessionLog(events), runtime) == []


async def test_a_reply_the_checkpoint_finished_is_kept(database: Database) -> None:
    runtime = open_chat(ModelRouter(model=ScriptedChatModel(replies=["alpha"])), InMemorySaver())
    manager, events = _manager(runtime, database)
    session_id = await manager.create(None, discard)
    run_id = await manager.send(session_id, "hi", discard)

    async def finished() -> bool:
        run = await RunRecords(database).get(run_id)
        return run is not None and run.status == "completed"

    await _until(finished)
    reply_id = next(
        e.data.message_id
        for e in await events.for_run(run_id)
        if isinstance(e, MessageCompletedEvent) and e.data.role == "assistant"
    )
    log = SessionLog(events)
    await log.emit(discard, session_id, "r_lost", "run.started", EmptyEventData())
    await log.emit(
        discard,
        session_id,
        "r_lost",
        "message.started",
        MessageStartedData(message_id=reply_id, role="assistant"),
    )
    await log.emit(
        discard,
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
