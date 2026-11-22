"""``[chat]``: the settings, ``chat.get`` and ``chat.set``, and a new session's plan first."""

from __future__ import annotations

import tomllib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, load_settings
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords


def test_the_defaults() -> None:
    chat = GolemSettings().chat
    assert (chat.instructions, chat.plan_first) == ([], False)


def test_lines_are_trimmed_and_blank_ones_dropped() -> None:
    chat = GolemSettings.model_validate({"chat": {"instructions": ["  a ", "", "   ", "b"]}}).chat
    assert chat.instructions == ["a", "b"]


def test_a_file_with_chat_loads(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text('[chat]\ninstructions = ["a"]\n', "utf-8")
    assert load_settings(home=tmp_path, project_dir=tmp_path).chat.instructions == ["a"]


def _call(response: dict[str, Any]) -> dict[str, Any]:
    return rpc_result(response)


async def test_chat_set_then_get_round_trips(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text('# mine\n[permissions]\nmode = "careful"\n', "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _call(await client.call("chat.get", {}))
        assert got == {"instructions": [], "plan_first": False, "mode": "careful"}

        saved = _call(
            await client.call("chat.set", {"instructions": ["  Be brief. ", "", "Say it plainly."]})
        )
        assert saved["ok"] is True
        expected = {
            "instructions": ["Be brief.", "Say it plainly."],
            "plan_first": False,
            "mode": "careful",
        }
        assert saved["values"] == expected
        assert _call(await client.call("chat.get", {})) == expected
        assert "# mine" in config.read_text("utf-8")

        only_plan = _call(await client.call("chat.set", {"plan_first": True}))
        assert only_plan["values"]["instructions"] == ["Be brief.", "Say it plainly."]
        assert only_plan["values"]["plan_first"] is True
        assert tomllib.loads(config.read_text("utf-8"))["chat"] == {
            "instructions": ["Be brief.", "Say it plainly."],
            "plan_first": True,
        }
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_chat_set_refuses_a_long_line_and_a_31st_line(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text("[chat]\nplan_first = true\n", "utf-8")
    before = config.read_text("utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        long = _call(await client.call("chat.set", {"instructions": ["ok", "x" * 301]}))
        assert long["ok"] is False and long["values"] is None
        assert "line 2" in long["errors"][0]["message"]
        many = _call(await client.call("chat.set", {"instructions": ["a"] * 31}))
        assert many["ok"] is False
        assert "line 31" in many["errors"][0]["message"]
        assert config.read_text("utf-8") == before
        edge = _call(await client.call("chat.set", {"instructions": ["a" * 300] * 30}))
        assert edge["ok"] is True
    finally:
        await client.close()
        await stop_daemon(app, task)


class _Sessions:
    def __init__(self, database: Database, home: Path) -> None:
        runtime = open_chat(
            ModelRouter(GolemSettings(), model=ToolCallingChatModel(replies=[]), home=home),
            InMemorySaver(),
        )
        records = SessionRecords(database)
        self.events = EventLog(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, RunRecords(database)
        )

    async def plan_first(self, session_id: str) -> bool:
        on = False
        for event in await self.events.after(session_id):
            if event.type == "session.plan.changed":
                on = event.data.on
        live = self.manager._sessions[session_id]  # pyright: ignore[reportPrivateUsage]
        assert live.plan_first == on
        return on


@pytest.fixture
async def sessions(database: Database, tmp_path: Path) -> AsyncIterator[_Sessions]:
    yield _Sessions(database, tmp_path)


async def test_a_new_session_starts_from_the_chat_default(
    sessions: _Sessions, tmp_path: Path
) -> None:
    assert not await sessions.plan_first(await sessions.manager.create(None))
    (tmp_path / "config.toml").write_text("[chat]\nplan_first = true\n", "utf-8")
    on = await sessions.manager.create(None)
    assert await sessions.plan_first(on)
    off = await sessions.manager.create(None, plan_first=False)
    assert not await sessions.plan_first(off)
    # a session that is already open keeps its setting when the default changes
    (tmp_path / "config.toml").write_text("[chat]\nplan_first = false\n", "utf-8")
    assert await sessions.plan_first(on)


async def test_chat_prompt_shows_lines_and_plan_first(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text('default_model = "ollama/m"\n', "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        plain = _call(await client.call("chat.prompt", {}))
        names = [part["name"] for part in plain["parts"]]
        assert "instructions" not in names and "plan_first" not in names
        assert plain["tools_tokens"] > 0
        parts_total = sum(part["tokens"] for part in plain["parts"])
        assert plain["total_tokens"] == parts_total + plain["tools_tokens"]
        for part in plain["parts"]:
            assert part["tokens"] == -(-len(part["text"]) // 4)

        before = config.read_text("utf-8")
        shown = _call(await client.call("chat.prompt", {"instructions": [" Be brief. ", "", "Hi"]}))
        first = shown["parts"][0]
        assert first["name"] == "instructions"
        assert "- Be brief." in first["text"] and "- Hi" in first["text"]
        assert config.read_text("utf-8") == before
        assert _call(await client.call("chat.get", {}))["instructions"] == []

        none = _call(await client.call("chat.prompt", {"instructions": []}))
        assert "instructions" not in [part["name"] for part in none["parts"]]

        _call(await client.call("chat.set", {"plan_first": True, "instructions": ["Saved."]}))
        planned = _call(await client.call("chat.prompt", {}))
        assert "plan_first" in [part["name"] for part in planned["parts"]]
        replaced = _call(await client.call("chat.prompt", {"instructions": ["Other."]}))
        text = replaced["parts"][0]["text"]
        assert "Other." in text and "Saved." not in text
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_chat_prompt_without_a_default_model(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _call(await client.call("chat.prompt", {"instructions": ["Be brief."]}))
        assert got["model"] is None
        names = [part["name"] for part in got["parts"]]
        assert names[0] == "instructions" and "memory" not in names
        bad = await client.call("chat.prompt", {"instructions": ["x" * 301]})
        assert "error" in bad
    finally:
        await client.close()
        await stop_daemon(app, task)
