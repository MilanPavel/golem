"""``session.compact`` and ``SessionManager.compact``: clear or summarise between turns."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import cast

import pytest
from fakes import GatedChatModel
from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_context_summary import (
    _ask,
    _Chat,
    _chat,
    _replies,
    _Summing,
)
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import ContextSettings
from golem.graphs.adapter import message_text
from golem.graphs.chat import open_chat
from golem.graphs.context_view import SUMMARY_HEADER
from golem.models.router import ModelRouter
from golem.server.dispatcher import SESSION_NOT_FOUND
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionBusyError, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import ChatEvent, ContextChangedEvent

SETTINGS = ContextSettings(reply_reserve=1000, keep_results=2, keep_turns=2)
WINDOW = 65536


def _project(tmp_path: Path) -> str:
    root = tmp_path / "project"
    root.mkdir()
    (root / "f.txt").write_text("a line of the file\n" * 100, encoding="utf-8")
    return str(root)


async def _changes(chat: _Chat) -> list[ContextChangedEvent]:
    events: list[ChatEvent] = await chat.events.after(chat.session_id, 0)
    return [e for e in events if isinstance(e, ContextChangedEvent)]


async def _long_session(
    database: Database, tmp_path: Path, turns: int = 6
) -> tuple[_Chat, _Summing, str]:
    model = _Summing(replies=_replies(turns + 3))
    chat = _chat(database, model, WINDOW, SETTINGS)
    project = _project(tmp_path)
    for n in range(turns):
        await chat.turn(_ask(n), project)
    return chat, model, project


async def test_clear_changes_the_view_emits_without_a_run_and_the_next_call_is_smaller(
    database: Database, tmp_path: Path
) -> None:
    chat, model, project = await _long_session(database, tmp_path)
    before_stored = cast(
        list[BaseMessage], (await chat.runtime.values(chat.session_id))["messages"]
    )

    result = await chat.manager.compact(chat.session_id, "clear", None)

    assert result.count == 4  # six results, the newest two stay
    assert result.after_tokens < result.before_tokens
    values = await chat.runtime.values(chat.session_id)
    assert "cleared_before" in cast(dict[str, str], values["context_view"])
    assert len(cast(list[BaseMessage], values["messages"])) == len(before_stored)
    changed = await _changes(chat)
    assert len(changed) == 1
    assert changed[0].run_id is None
    assert changed[0].data.action == "cleared"
    assert changed[0].data.count == 4
    assert changed[0].data.before_tokens == result.before_tokens

    await chat.turn(_ask(6), project)
    sent = [message_text(m) for m in model.seen[-1]]
    assert sum(t.startswith("[cleared to save context") for t in sent) == 4


async def test_summarise_replaces_old_turns_and_focus_reaches_the_instruction(
    database: Database, tmp_path: Path
) -> None:
    chat, model, project = await _long_session(database, tmp_path)

    result = await chat.manager.compact(chat.session_id, "summarise", "the file names")

    assert result.count == 4  # six turns, the newest two stay
    assert result.after_tokens < result.before_tokens
    assert result.model is not None
    assert "Keep especially: the file names" in model.asked[0]
    changed = await _changes(chat)
    assert [(c.run_id, c.data.action) for c in changed] == [(None, "summarised")]
    assert (changed[0].data.count or 0) > result.count  # messages, not turns
    values = await chat.runtime.values(chat.session_id)
    stored = cast(list[BaseMessage], values["messages"])
    assert sum(isinstance(m, HumanMessage) for m in stored) == 6

    await chat.turn(_ask(6), project)
    head = model.seen[-1][0]
    assert isinstance(head, HumanMessage) and message_text(head).startswith(SUMMARY_HEADER)
    asks = [m for m in model.seen[-1] if isinstance(m, HumanMessage)][1:]
    assert len(asks) == 3  # the two kept turns and the new one


async def test_nothing_to_compact_emits_nothing(database: Database, tmp_path: Path) -> None:
    model = _Summing(replies=_replies(2))
    chat = _chat(database, model, WINDOW, SETTINGS)
    await chat.turn(_ask(0), _project(tmp_path))

    for action in ("clear", "summarise"):
        result = await chat.manager.compact(chat.session_id, action, None)  # type: ignore[arg-type]
        assert result.count == 0
        assert result.before_tokens == result.after_tokens

    assert await _changes(chat) == []
    assert "context_view" not in await chat.runtime.values(chat.session_id)


async def test_a_failed_summary_raises_and_changes_nothing(
    database: Database, tmp_path: Path
) -> None:
    chat, model, _ = await _long_session(database, tmp_path)
    model.broken = True

    with pytest.raises(Exception, match="empty summary"):
        await chat.manager.compact(chat.session_id, "summarise", None)

    assert await _changes(chat) == []
    assert "context_view" not in await chat.runtime.values(chat.session_id)
    # The session is not left busy.
    await chat.manager.compact(chat.session_id, "clear", None)


async def test_a_session_with_a_run_in_flight_is_busy(database: Database) -> None:
    model = GatedChatModel(reply="ok")
    router = ModelRouter(model=model)
    runtime = open_chat(router, InMemorySaver(), context=SETTINGS)
    events = EventLog(database)
    records = SessionRecords(database)
    manager = SessionManager(
        runtime, SessionLog(events, EventBus(), records), records, RunRecords(database)
    )
    session_id = await manager.create(None)
    await manager.send(session_id, "hello")
    await asyncio.wait_for(model.started.wait(), 5)

    with pytest.raises(SessionBusyError):
        await manager.compact(session_id, "clear", None)

    model.release.set()
    await manager.cancel_all()


async def test_a_run_cannot_start_while_a_compaction_runs(
    database: Database, tmp_path: Path
) -> None:
    chat, _, _ = await _long_session(database, tmp_path)
    live = chat.manager._sessions[chat.session_id]  # pyright: ignore[reportPrivateUsage]
    live.compacting = True
    with pytest.raises(SessionBusyError):
        await chat.manager.send(chat.session_id, "more")
    with pytest.raises(SessionBusyError):
        await chat.manager.compact(chat.session_id, "clear", None)


async def test_the_handler_summarises_and_answers_errors(short_home: Path) -> None:
    model = _Summing(replies=[f"answer {n}" for n in range(6)])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        for n in range(6):
            client.events[:] = []
            rpc_result(
                await client.call("message.send", {"session_id": session_id, "text": _ask(n)})
            )
            await client.wait_for_event("run.completed")
        client.events[:] = []

        result = rpc_result(
            await client.call(
                "session.compact", {"session_id": session_id, "action": "summarise", "focus": "x"}
            )
        )
        assert result["count"] == 2  # keep_turns defaults to 4
        assert cast(int, result["after_tokens"]) < cast(int, result["before_tokens"])
        event = await client.wait_for_event("context.changed")
        params = cast(dict[str, object], event["params"])
        assert params["run_id"] is None
        assert cast(dict[str, object], params["data"])["action"] == "summarised"

        again = rpc_result(
            await client.call("session.compact", {"session_id": session_id, "action": "clear"})
        )
        assert again["count"] == 0

        missing = await client.call("session.compact", {"session_id": "s_no", "action": "clear"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)
