"""MCP over the daemon's socket: listed, scoped per session, asked about, and run."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import cast

from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))


def _server(name: str, extra: str = "") -> str:
    return (
        f"[mcp.{name}]\ncommand = {json.dumps(sys.executable)}\n"
        f"args = [{json.dumps(SERVER)}]\n{extra}"
    )


async def _servers(client: RpcClient, session_id: str | None = None) -> list[dict[str, object]]:
    params = {} if session_id is None else {"session_id": session_id}
    listed = rpc_result(await client.call("mcp.list", params))
    return cast(list[dict[str, object]], listed["servers"])


async def _settled(client: RpcClient) -> None:
    async with asyncio.timeout(10):
        while any(server["state"] == "starting" for server in await _servers(client)):
            await asyncio.sleep(0.05)


def _data(event: dict[str, object]) -> dict[str, object]:
    params = cast(dict[str, object], event["params"])
    return cast(dict[str, object], params["data"])


async def _session(client: RpcClient) -> str:
    created = rpc_result(await client.call("session.create", {}))
    session_id = str(created["session_id"])
    await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
    return session_id


async def _approve(client: RpcClient, session_id: str) -> dict[str, object]:
    needed = _data(await client.wait_for_event("approval.needed", timeout=5))
    await client.call(
        "approval.respond",
        {"session_id": session_id, "call_id": needed["call_id"], "decision": "allow"},
    )
    return needed


async def test_a_tool_from_the_server_runs_from_chat_after_an_approval(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        _server("fake") + '[mcp.off]\ncommand = "nothing"\nenabled = false\n', encoding="utf-8"
    )
    model = ToolCallingChatModel(replies=[[("mcp__fake__echo", {"text": "hi"})], "It said hi."])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _settled(client)
        fake, off = await _servers(client)
        assert (fake["name"], fake["state"], fake["error"]) == ("fake", "running", None)
        assert "mcp__fake__echo" in cast(list[str], fake["tools"])
        assert (off["name"], off["state"], off["tools"]) == ("off", "disabled", [])

        session_id = await _session(client)
        await client.call("message.send", {"session_id": session_id, "text": "say hi"})
        needed = await _approve(client, session_id)
        assert (needed["name"], needed["args"], needed["source"]) == (
            "mcp__fake__echo",
            {"text": "hi"},
            "built-in default",
        )
        assert needed["subject"] == '{"text":"hi"}'
        completed = _data(await client.wait_for_event("tool.completed", timeout=5))
        assert completed["summary"] == "echo: hi"
        await client.wait_for_event("run.completed", timeout=5)
        assert "mcp__fake__echo" in model.bound
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_only_a_session_that_turns_a_server_on_gets_its_tools(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        _server("always") + _server("lazy", 'enabled = "on_demand"\n'), encoding="utf-8"
    )
    model = ToolCallingChatModel(
        replies=[
            [("mcp__lazy__echo", {"text": "too early"})],
            "It is not on here.",
            [("mcp__lazy__echo", {"text": "now"})],
            "It said now.",
        ]
    )
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _settled(client)
        session_id = await _session(client)
        before = {str(server["name"]): server for server in await _servers(client, session_id)}
        assert (before["lazy"]["state"], before["lazy"]["enabled"]) == ("idle", False)
        assert before["always"]["enabled"] is True

        await client.call("message.send", {"session_id": session_id, "text": "use lazy"})
        failed = _data(await client.wait_for_event("tool.failed", timeout=5))
        assert "is not available in this session" in str(failed["message"])
        assert "/mcp enable lazy" in str(failed["message"])
        await client.wait_for_event("run.completed", timeout=5)
        assert "mcp__always__echo" in model.bound and "mcp__lazy__echo" not in model.bound

        turned = rpc_result(
            await client.call("mcp.enable", {"session_id": session_id, "name": "lazy"})
        )
        assert turned == {"session_id": session_id, "mcp_servers": ["lazy"]}
        updated = [
            _data(event)
            for event in await client.take_events()
            if cast(dict[str, object], event["params"])["type"] == "session.updated"
        ]
        assert updated[-1]["mcp_servers"] == ["lazy"]

        client.events.clear()
        await client.call("message.send", {"session_id": session_id, "text": "use lazy now"})
        await _approve(client, session_id)
        assert (
            _data(await client.wait_for_event("tool.completed", timeout=5))["summary"]
            == "echo: now"
        )
        await client.wait_for_event("run.completed", timeout=5)
        assert "mcp__lazy__echo" in model.bound
        listed = {str(server["name"]): server for server in await _servers(client, session_id)}
        assert (listed["lazy"]["state"], listed["lazy"]["enabled"]) == ("running", True)

        off = rpc_result(
            await client.call("mcp.disable", {"session_id": session_id, "name": "lazy"})
        )
        assert off["mcp_servers"] == []
        always = await client.call("mcp.enable", {"session_id": session_id, "name": "always"})
        assert error_code(always) == INVALID_PARAMS
        missing = await client.call("mcp.enable", {"session_id": "s_nope", "name": "lazy"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_storing_a_servers_secret_restarts_it_with_the_secret(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        _server("fake", 'env = { API_TOKEN = "keychain:mcp/fake" }\n'), encoding="utf-8"
    )
    secrets = MemorySecrets()
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ToolCallingChatModel(replies=[])), secrets=secrets
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _settled(client)
        [before] = await _servers(client)
        assert before["state"] == "failed"
        assert before["error"] == "no secret mcp/fake in the Keychain: run golem auth set mcp/fake"

        stored = await client.call("auth.set", {"provider": "mcp/fake", "key": "s3cret"})
        assert rpc_result(stored) == {"provider": "mcp/fake"}
        assert secrets.secrets == {"mcp/fake": "s3cret"}
        await _settled(client)
        assert (await _servers(client))[0]["state"] == "running"

        listed = rpc_result(await client.call("auth.list", {}))
        mine = [
            item
            for item in cast(list[dict[str, object]], listed["providers"])
            if item["provider"] == "mcp/fake"
        ]
        assert mine == [
            {
                "provider": "mcp/fake",
                "takes_key": True,
                "needs_key": True,
                "env_var": None,
                "source": "keychain",
            }
        ]

        bad = await client.call("auth.set", {"provider": "mcp/no spaces", "key": "x"})
        assert error_code(bad) == INVALID_PARAMS
        removed = rpc_result(await client.call("auth.remove", {"provider": "mcp/fake"}))
        assert removed == {"provider": "mcp/fake", "removed": True}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_manager_lists_tools_restarts_and_turns_a_server_off(short_home: Path) -> None:
    (short_home / "config.toml").write_text(_server("fake"), encoding="utf-8")
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ToolCallingChatModel(replies=[]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _settled(client)
        [fake] = await _servers(client)
        assert fake["config"] == str(short_home / "config.toml")

        tools = rpc_result(await client.call("mcp.tools", {"name": "fake"}))
        listed = cast(list[dict[str, object]], tools["tools"])
        assert listed[0] == {"name": "mcp__fake__echo", "description": "Says the text back."}

        restarted = rpc_result(await client.call("mcp.restart", {"name": "fake"}))
        assert restarted["state"] == "starting"
        await _settled(client)

        off = rpc_result(await client.call("mcp.set_enabled", {"name": "fake", "enabled": False}))
        assert off["state"] == "disabled"
        assert "enabled = false" in (short_home / "config.toml").read_text(encoding="utf-8")
        lazy = rpc_result(
            await client.call("mcp.set_enabled", {"name": "fake", "enabled": "on_demand"})
        )
        assert (lazy["state"], lazy["on_demand"]) == ("idle", True)

        missing = await client.call("mcp.tools", {"name": "nope"})
        assert error_code(missing) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
