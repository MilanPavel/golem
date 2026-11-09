"""``model.options.get | set``, ``session.set_options``, and ``model.options.changed``."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelSettings
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND

SETTINGS = GolemSettings(
    default_model="local", models={"local": ModelSettings(model="ollama/qwen3:8b")}
)


def _router() -> ModelRouter:
    return ModelRouter(SETTINGS)


def _record(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _type(event: dict[str, object]) -> object:
    params: object = event.get("params")
    return _record(params).get("type") if params is not None else None


async def _open(client: RpcClient) -> str:
    created = rpc_result(await client.call("session.create", {}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    return session_id


async def test_saved_options_are_stored_in_config_and_read_back(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        stored = rpc_result(
            await client.call(
                "model.options.set",
                {"model": "ollama/qwen3:8b", "options": {"temperature": 0.3, "num_ctx": 16384}},
            )
        )
        assert stored == {"model": "qwen3:8b", "saved": {"temperature": 0.3, "num_ctx": 16384}}
        text = app.paths.config_file.read_text("utf-8")
        assert tomllib.loads(text)["ollama"]["models"]["qwen3:8b"]["temperature"] == 0.3
        got = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
        assert got["saved"] == {"temperature": 0.3, "num_ctx": 16384}
        assert got["session"] is None
        table = cast(list[dict[str, object]], got["options"])
        assert len(table) == 9
        assert cast(dict[str, object], got["defaults"])["top_p"] == 0.9
        cleared = rpc_result(
            await client.call(
                "model.options.set", {"model": "qwen3:8b", "options": {"temperature": None}}
            )
        )
        assert cleared["saved"] == {"num_ctx": 16384}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_save_is_sent_to_every_connection(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router())
    client = await RpcClient.connect(app.paths.socket_path)
    other = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await other.call("hello", HELLO)
        rpc_result(
            await client.call(
                "model.options.set", {"model": "ollama/qwen3:8b", "options": {"temperature": 0.3}}
            )
        )
        for watcher in (client, other):
            await watcher.take_events()
            assert [(n["method"], n["params"]) for n in watcher.notices] == [
                ("model.options.saved", {"model": "qwen3:8b", "saved": {"temperature": 0.3}})
            ]
        failed = await client.call(
            "model.options.set", {"model": "qwen3:8b", "options": {"temperature": 9}}
        )
        assert error_code(failed) == INVALID_PARAMS
        await other.take_events()
        assert len(other.notices) == 1
    finally:
        await client.close()
        await other.close()
        await stop_daemon(app, task)


async def test_a_bad_option_is_refused_and_nothing_is_written(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        failed = await client.call(
            "model.options.set", {"model": "qwen3:8b", "options": {"temperature": 9}}
        )
        assert error_code(failed) == INVALID_PARAMS
        failed = await client.call(
            "session.set_options",
            {"session_id": await _open(client), "options": {"colour": 1}},
        )
        assert error_code(failed) == INVALID_PARAMS
        assert not app.paths.config_file.exists()
        missing = await client.call(
            "session.set_options", {"session_id": "s_missing", "options": {"top_k": 5}}
        )
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_session_override_is_that_sessions_and_survives_a_restart(
    short_home: Path,
) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        first = await _open(client)
        second = await _open(client)
        set_ = rpc_result(
            await client.call(
                "session.set_options", {"session_id": first, "options": {"top_k": 5, "seed": 7}}
            )
        )
        assert set_ == {"session_id": first, "options": {"top_k": 5, "seed": 7}}
        changed = await client.wait_for_event("model.options.changed")
        assert _record(_record(changed["params"])["data"]) == {"options": {"top_k": 5, "seed": 7}}
        again = rpc_result(
            await client.call("session.set_options", {"session_id": first, "options": {"top_k": 5}})
        )
        assert again["options"] == {"top_k": 5, "seed": 7}
        assert [_type(e) for e in client.events].count("model.options.changed") == 1
        rpc_result(
            await client.call(
                "session.set_options", {"session_id": first, "options": {"seed": None}}
            )
        )
        mine = rpc_result(
            await client.call("model.options.get", {"model": "qwen3:8b", "session_id": first})
        )
        other = rpc_result(
            await client.call("model.options.get", {"model": "qwen3:8b", "session_id": second})
        )
        assert mine["session"] == {"top_k": 5}
        assert other["session"] == {}
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": first, "after_seq": 0}))
        back = rpc_result(
            await client.call("model.options.get", {"model": "qwen3:8b", "session_id": first})
        )
        assert back["session"] == {"top_k": 5}
    finally:
        await client.close()
        await stop_daemon(app, task)
