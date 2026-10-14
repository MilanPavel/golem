from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pytest
from fakes import ScriptedChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.graphs.chat import INTERRUPTED_KEY, ChatRuntime, open_chat
from golem.models.router import ModelRouter


def _messages(values: Mapping[str, object]) -> list[BaseMessage]:
    raw = values["messages"]
    assert isinstance(raw, list)
    return [message for message in cast(list[object], raw) if isinstance(message, BaseMessage)]


def _texts(values: Mapping[str, object]) -> list[str]:
    return [message.text for message in _messages(values)]


async def _turn(runtime: ChatRuntime, session_id: str, text: str, n: int = 1) -> None:
    async for _part in runtime.stream(
        session_id=session_id,
        text=text,
        model_profile="remote",
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
    ):
        pass


async def test_second_turn_includes_the_first() -> None:
    model = ScriptedChatModel(replies=["alpha", "beta"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    await _turn(runtime, "s_test", "one")
    await _turn(runtime, "s_test", "two", 2)
    assert model.seen[0] == ["one"]
    assert model.seen[1] == ["one", "alpha", "two"]


async def test_checkpoint_messages_carry_protocol_ids() -> None:
    model = ScriptedChatModel(replies=["alpha"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    await _turn(runtime, "s_test", "one")
    values = await runtime.values("s_test")
    assert [message.id for message in _messages(values)] == ["m_user1", "m_reply1"]
    assert await runtime.message_text("s_test", "m_reply1") == "alpha"
    assert await runtime.message_text("s_test", "m_missing") is None


async def test_sqlite_checkpoint_survives_reopen(tmp_path: Path) -> None:
    database = tmp_path / "checkpoints.db"
    model = ScriptedChatModel(replies=["alpha", "beta"])
    async with AsyncSqliteSaver.from_conn_string(str(database)) as saver:
        await saver.setup()
        runtime = open_chat(ModelRouter(model=model), saver)
        await _turn(runtime, "s_test", "one")
        await _turn(runtime, "s_test", "two", 2)
    async with AsyncSqliteSaver.from_conn_string(str(database)) as saver:
        await saver.setup()
        runtime = open_chat(ModelRouter(model=model), saver)
        values = await runtime.values("s_test")
    assert _texts(values) == ["one", "alpha", "two", "beta"]


async def test_an_interrupted_reply_joins_the_next_prompt() -> None:
    model = ScriptedChatModel(replies=[])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    with pytest.raises(RuntimeError):
        await _turn(runtime, "s_test", "one")
    wrote = await runtime.record_interrupted(
        "s_test",
        user_message_id="m_user1",
        assistant_message_id="m_reply1",
        text="half",
    )
    assert wrote
    reply = _messages(await runtime.values("s_test"))[-1]
    assert (reply.id, reply.text) == ("m_reply1", "half")
    assert reply.response_metadata[INTERRUPTED_KEY] is True

    model.replies.append("whole")
    await _turn(runtime, "s_test", "two", 2)
    assert model.seen[-1] == ["one", "half", "two"]


async def test_a_finished_reply_is_never_replaced() -> None:
    model = ScriptedChatModel(replies=["alpha"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    await _turn(runtime, "s_test", "one")
    wrote = await runtime.record_interrupted(
        "s_test",
        user_message_id="m_user1",
        assistant_message_id="m_reply1",
        text="al",
    )
    assert not wrote
    assert _texts(await runtime.values("s_test")) == ["one", "alpha"]


async def test_nothing_streamed_writes_nothing() -> None:
    runtime = open_chat(ModelRouter(model=ScriptedChatModel(replies=[])), InMemorySaver())
    with pytest.raises(RuntimeError):
        await _turn(runtime, "s_test", "one")
    wrote = await runtime.record_interrupted(
        "s_test",
        user_message_id="m_user1",
        assistant_message_id="m_reply1",
        text="",
    )
    assert not wrote
    assert _texts(await runtime.values("s_test")) == ["one"]
