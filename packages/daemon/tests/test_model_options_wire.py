"""``model.options.get | set``, ``session.set_options``, and ``model.options.changed``."""

from __future__ import annotations

import json
import tomllib
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import httpx
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelSettings
from golem.models import hardware
from golem.models.discovery import ModelDiscovery
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


def _tags(models: list[dict[str, object]]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": models})
        return httpx.Response(404)

    return httpx.MockTransport(handle)


def _discovery(
    tmp_path: Path, transport: httpx.MockTransport, ram_gb: float | None
) -> Callable[[ModelRouter], ModelDiscovery]:
    def make(router: ModelRouter) -> ModelDiscovery:
        return ModelDiscovery(
            router,
            tmp_path / "cache",
            transport=transport,
            ram_gb=ram_gb,
            detect_ram=False,
            fetch_prices=False,
            ollama_installed=lambda: True,
        )

    return make


async def test_memory_is_given_for_an_installed_model_with_a_size(
    short_home: Path, tmp_path: Path
) -> None:
    transport = _tags([{"name": "qwen3:8b", "size": 5_200_000_000}])
    app, task = await start_daemon(
        short_home, router=_router(), discovery=_discovery(tmp_path, transport, 36.0)
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
        assert got["memory"] == {
            "ram_gb": 36.0,
            "size_gb": 5.2,
            "kv_gb_per_1k_tokens": hardware.KV_GB_PER_1K_TOKENS,
            "overhead_gb": hardware.OVERHEAD_GB,
            "fits_share": hardware.FITS_SHARE,
            "tight_share": hardware.TIGHT_SHARE,
        }
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_memory_is_none_without_a_size_or_without_ram(
    short_home: Path, tmp_path: Path
) -> None:
    cases = [
        (_tags([{"name": "other:1b", "size": 1_000_000_000}]), 36.0),
        (_tags([{"name": "qwen3:8b"}]), 36.0),
        (_tags([{"name": "qwen3:8b", "size": 5_200_000_000}]), None),
    ]
    for transport, ram in cases:
        app, task = await start_daemon(
            short_home, router=_router(), discovery=_discovery(tmp_path, transport, ram)
        )
        client = await RpcClient.connect(app.paths.socket_path)
        try:
            await client.call("hello", HELLO)
            got = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
            assert got["memory"] is None
        finally:
            await client.close()
            await stop_daemon(app, task)


def _ps(loaded: int, shown: dict[str, object]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/ps":
            return httpx.Response(
                200, json={"models": [{"name": "qwen3:8b", "context_length": loaded}]}
            )
        if request.url.path == "/api/show":
            return httpx.Response(200, json=shown)
        return httpx.Response(404)

    return httpx.MockTransport(handle)


async def test_num_ctx_has_no_default_until_ollama_or_the_modelfile_gives_one(
    short_home: Path, tmp_path: Path
) -> None:
    app, task = await start_daemon(
        short_home, router=_router(), discovery=_discovery(tmp_path, _ps(32768, {}), None)
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        first = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
        assert "num_ctx" not in cast(dict[str, object], first["defaults"])
        assert first["default_from"] == {}
        assert app.state.models is not None
        assert await app.state.models.note_loaded("ollama/qwen3:8b", 8192) == 32768
        again = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
        assert "num_ctx" not in cast(dict[str, object], again["defaults"])
        assert await app.state.models.note_loaded("ollama/qwen3:8b", None) == 32768
        later = rpc_result(await client.call("model.options.get", {"model": "qwen3:8b"}))
        assert cast(dict[str, object], later["defaults"])["num_ctx"] == 32768
        assert later["default_from"] == {"num_ctx": "ollama"}
    finally:
        await client.close()
        await stop_daemon(app, task)


def _thinking(models: dict[str, list[str]]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": name, "digest": name} for name in models]}
            )
        if request.url.path == "/api/show":
            name = json.loads(request.content)["model"]
            return httpx.Response(200, json={"capabilities": models[name]})
        return httpx.Response(404)

    return httpx.MockTransport(handle)


async def test_think_is_a_row_only_for_a_model_that_thinks_and_checks_its_values(
    short_home: Path, tmp_path: Path
) -> None:
    transport = _thinking(
        {
            "qwen3.5:4b": ["completion", "thinking"],
            "gpt-oss:20b": ["completion", "thinking"],
            "llama3.2:3b": ["completion"],
        }
    )
    app, task = await start_daemon(
        short_home, router=_router(), discovery=_discovery(tmp_path, transport, None)
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)

        async def think_row(model: str) -> dict[str, object] | None:
            got = rpc_result(await client.call("model.options.get", {"model": model}))
            rows = [
                row for row in cast(list[dict[str, Any]], got["options"]) if row["name"] == "think"
            ]
            return rows[0] if rows else None

        plain = await think_row("qwen3.5:4b")
        assert plain is not None
        assert plain["kind"] == "choice"
        assert plain["values"] == ["off", "on"]
        assert plain["minimum"] is None
        assert plain["step"] is None
        levels = await think_row("gpt-oss:20b")
        assert levels is not None
        assert levels["values"] == ["low", "medium", "high"]
        assert await think_row("llama3.2:3b") is None

        saved = rpc_result(
            await client.call(
                "model.options.set", {"model": "qwen3.5:4b", "options": {"think": "off"}}
            )
        )
        assert saved["saved"] == {"think": "off"}
        for model, value in (("qwen3.5:4b", "high"), ("llama3.2:3b", "on")):
            bad = await client.call(
                "model.options.set", {"model": model, "options": {"think": value}}
            )
            assert error_code(bad) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
