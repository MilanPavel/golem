"""An MCP server's tool, over the daemon's socket: listed, asked about, approved, and run."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import cast

from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))


def _config(home: Path) -> None:
    (home / "config.toml").write_text(
        f"[mcp.fake]\ncommand = {json.dumps(sys.executable)}\nargs = [{json.dumps(SERVER)}]\n"
        '[mcp.off]\ncommand = "nothing"\nenabled = false\n',
        encoding="utf-8",
    )


async def _servers(client: RpcClient) -> list[dict[str, object]]:
    listed = rpc_result(await client.call("mcp.list", {}))
    return cast(list[dict[str, object]], listed["servers"])


def _data(event: dict[str, object]) -> dict[str, object]:
    params = cast(dict[str, object], event["params"])
    return cast(dict[str, object], params["data"])


async def test_a_tool_from_the_server_runs_from_chat_after_an_approval(short_home: Path) -> None:
    _config(short_home)
    model = ToolCallingChatModel(replies=[[("mcp__fake__echo", {"text": "hi"})], "It said hi."])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        async with asyncio.timeout(10):
            while (await _servers(client))[0]["state"] == "starting":
                await asyncio.sleep(0.05)
        fake, off = await _servers(client)
        assert (fake["name"], fake["state"], fake["error"]) == ("fake", "running", None)
        assert "mcp__fake__echo" in cast(list[str], fake["tools"])
        assert (off["name"], off["state"], off["tools"]) == ("off", "disabled", [])

        created = rpc_result(await client.call("session.create", {}))
        session_id = str(created["session_id"])
        await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
        await client.call("message.send", {"session_id": session_id, "text": "say hi"})
        needed = _data(await client.wait_for_event("approval.needed", timeout=5))
        assert (needed["name"], needed["args"], needed["source"]) == (
            "mcp__fake__echo",
            {"text": "hi"},
            "built-in default",
        )
        assert needed["subject"] == '{"text":"hi"}'
        await client.call(
            "approval.respond",
            {"session_id": session_id, "call_id": needed["call_id"], "decision": "allow"},
        )
        completed = _data(await client.wait_for_event("tool.completed", timeout=5))
        assert completed["summary"] == "echo: hi"
        await client.wait_for_event("run.completed", timeout=5)
        assert "mcp__fake__echo" in model.bound
    finally:
        await client.close()
        await stop_daemon(app, task)
