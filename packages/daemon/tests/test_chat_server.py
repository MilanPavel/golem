"""Socket-level chat: create, stream, busy, missing, and checkpoint resume."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from fakes import GatedChatModel, ScriptedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.server.dispatcher import MODEL_NOT_CONFIGURED, SESSION_BUSY, SESSION_NOT_FOUND


def _record(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return cast(dict[str, object], value)
    return None


def _event_types(events: list[dict[str, object]]) -> list[str]:
    types: list[str] = []
    for event in events:
        params = _record(event.get("params"))
        if params is None:
            continue
        kind = params.get("type")
        if isinstance(kind, str):
            types.append(kind)
    return types


def _delta_text(event: dict[str, object]) -> str:
    params = _record(event.get("params"))
    if params is None or params.get("type") != "message.delta":
        return ""
    data = _record(params.get("data"))
    if data is None:
        return ""
    text = data.get("text")
    if isinstance(text, str):
        return text
    return ""


def _completed_text(events: list[dict[str, object]], role: str) -> list[str]:
    texts: list[str] = []
    for event in events:
        params = _record(event.get("params"))
        if params is None or params.get("type") != "message.completed":
            continue
        data = _record(params.get("data"))
        if data is None or data.get("role") != role:
            continue
        text = data.get("text")
        if isinstance(text, str):
            texts.append(text)
    return texts


async def test_send_streams_deltas_then_completes(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        assert "result" in await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        await client.wait_for_event("session.created")
        sent = rpc_result(
            await client.call("message.send", {"session_id": session_id, "text": "hello"}),
        )
        assert isinstance(sent["run_id"], str)
        await client.wait_for_event("run.completed")
        types = _event_types(client.events)
        assert types[0] == "session.created"
        assert "message.delta" in types
        assert "message.completed" in types
        assert types[-1] == "run.completed"
        assert _completed_text(client.events, "user") == ["hello"]
        assert _completed_text(client.events, "assistant") == ["Hi"]
        assert "".join(_delta_text(event) for event in client.events) == "Hi"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_missing_and_busy_sessions(short_home: Path) -> None:
    model = GatedChatModel()
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("message.send", {"session_id": "s_missing", "text": "hi"})
        assert error_code(missing) == SESSION_NOT_FOUND
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        sent = rpc_result(
            await client.call("message.send", {"session_id": session_id, "text": "hi"}),
        )
        assert isinstance(sent["run_id"], str)
        await model.started.wait()
        busy = await client.call("message.send", {"session_id": session_id, "text": "again"})
        assert error_code(busy) == SESSION_BUSY
        model.release.set()
        await client.wait_for_event("run.completed")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_unconfigured_model_is_an_rpc_error(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        failed = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(failed) == MODEL_NOT_CONFIGURED
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_restart_continues_the_same_thread(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["alpha", "beta"])
    router = ModelRouter(model=model)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        await client.call("message.send", {"session_id": session_id, "text": "one"})
        await client.wait_for_event("run.completed")
    finally:
        await client.close()
        await stop_daemon(app, task)

    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("message.send", {"session_id": session_id, "text": "two"})
        await client.wait_for_event("run.completed")
        assert model.seen[1] == ["one", "alpha", "two"]
    finally:
        await client.close()
        await stop_daemon(app, task)
