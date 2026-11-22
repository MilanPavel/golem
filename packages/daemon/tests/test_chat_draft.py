"""``chat.draft``: instruction lines drafted from a person's words."""

from __future__ import annotations

from pathlib import Path

import pytest
from fakes import ScriptedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.errors import BudgetSpent
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS
from golem.sessions.drafts import UNUSABLE, ModelDrafts, parse_lines


def test_lines_lose_bullets_numbers_blanks_and_repeats() -> None:
    assert parse_lines("1. Keep it short\n- Be warm\n\n- Be warm") == ["Keep it short", "Be warm"]


def test_a_line_is_cut_to_300_characters_and_ten_lines_become_eight() -> None:
    assert len(parse_lines("x" * 500)[0]) == 300
    assert parse_lines("\n".join(f"line {n}" for n in range(10))) == [f"line {n}" for n in range(8)]


async def test_the_model_reply_becomes_lines() -> None:
    model = ScriptedChatModel(replies=["1. Keep it short\n- Be warm\n\n- Be warm"])
    lines, _name = await ModelDrafts(ModelRouter(model=model)).draft("short and warm")
    assert lines == ["Keep it short", "Be warm"]
    assert "short and warm" in model.seen[0][1]


async def test_a_spent_budget_on_a_paid_model_is_the_budget_error() -> None:
    async def spent(_session: str | None) -> bool:
        return False

    router = ModelRouter(GolemSettings.model_validate({"default_model": "openai/gpt-5"}))
    drafts = ModelDrafts(router)
    drafts.bind(lambda _ref: "frontier", list)
    drafts.limit(spent)
    with pytest.raises(BudgetSpent):
        await drafts.draft("short")


async def test_an_empty_reply_is_an_error_not_an_empty_list(short_home: Path) -> None:
    router = ModelRouter(model=ScriptedChatModel(replies=[" \n ", "- Be warm"]))
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        empty = await client.call("chat.draft", {"description": "warm"})
        assert error_code(empty) == INVALID_PARAMS
        assert UNUSABLE in str(empty["error"])
        got = rpc_result(await client.call("chat.draft", {"description": "warm"}))
        assert got["lines"] == ["Be warm"]
    finally:
        await client.close()
        await stop_daemon(app, task)
