from collections.abc import Mapping
from pathlib import Path
from typing import cast

from fakes import ScriptedChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter


def _texts(values: Mapping[str, object]) -> list[str]:
    raw = values["messages"]
    assert isinstance(raw, list)
    texts: list[str] = []
    for message in cast(list[object], raw):
        if isinstance(message, BaseMessage):
            texts.append(message.text)
    return texts


async def _turn(runtime: ChatRuntime, session_id: str, text: str) -> None:
    async for _part in runtime.stream(
        session_id=session_id,
        text=text,
        model_profile="remote",
        schema_version=1,
    ):
        pass


async def test_second_turn_includes_the_first() -> None:
    model = ScriptedChatModel(replies=["alpha", "beta"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    await _turn(runtime, "s_test", "one")
    await _turn(runtime, "s_test", "two")
    assert model.seen[0] == ["one"]
    assert model.seen[1] == ["one", "alpha", "two"]


async def test_sqlite_checkpoint_survives_reopen(tmp_path: Path) -> None:
    database = tmp_path / "checkpoints.db"
    model = ScriptedChatModel(replies=["alpha", "beta"])
    async with AsyncSqliteSaver.from_conn_string(str(database)) as saver:
        await saver.setup()
        runtime = open_chat(ModelRouter(model=model), saver)
        await _turn(runtime, "s_test", "one")
        await _turn(runtime, "s_test", "two")
    async with AsyncSqliteSaver.from_conn_string(str(database)) as saver:
        await saver.setup()
        runtime = open_chat(ModelRouter(model=model), saver)
        values = await runtime.values("s_test")
    assert _texts(values) == ["one", "alpha", "two", "beta"]
