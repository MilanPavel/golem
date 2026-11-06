"""``auth.set``, ``auth.remove``, and ``auth.list`` over a real socket."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import httpx
import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.discovery import ModelDiscovery
from golem.models.keys import MemoryKeyStore
from golem.models.router import ModelRouter
from golem.server.dispatcher import (
    INVALID_PARAMS,
    KEY_REJECTED,
    KEY_UNCHECKED,
    KEYCHAIN_UNAVAILABLE,
)


def _statuses(result: dict[str, object]) -> dict[str, dict[str, object]]:
    providers = cast(list[dict[str, object]], result["providers"])
    return {cast(str, item["provider"]): item for item in providers}


async def test_a_key_is_stored_listed_and_removed(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    store = MemoryKeyStore()
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings(), keys=store))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        stored = rpc_result(
            await client.call(
                "auth.set", {"provider": "anthropic", "key": "  sk-test\n", "check": False}
            )
        )
        assert stored == {"provider": "anthropic", "models": None}
        assert store.keys == {"anthropic": "sk-test"}
        listed = _statuses(rpc_result(await client.call("auth.list")))
        assert listed["anthropic"]["source"] == "keychain"
        assert listed["anthropic"]["env_var"] == "ANTHROPIC_API_KEY"
        assert "key" not in listed["anthropic"]
        removed = rpc_result(await client.call("auth.remove", {"provider": "anthropic"}))
        assert removed == {"provider": "anthropic", "removed": True}
        again = rpc_result(await client.call("auth.remove", {"provider": "anthropic"}))
        assert again["removed"] is False
        assert store.keys == {}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_bad_key_requests_are_invalid_params(short_home: Path) -> None:
    store = MemoryKeyStore()
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings(), keys=store))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        for params in (
            {"provider": "nowhere", "key": "sk"},
            {"provider": "ollama", "key": "sk"},
            {"provider": "anthropic", "key": "   "},
            {"provider": "anthropic", "key": "sk one"},
            {"provider": "anthropic", "key": ""},
        ):
            failed = await client.call("auth.set", params)
            assert error_code(failed) == INVALID_PARAMS
        assert store.keys == {}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_daemon_without_a_store_says_so(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings()))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        failed = await client.call("auth.set", {"provider": "anthropic", "key": "sk"})
        assert error_code(failed) == KEYCHAIN_UNAVAILABLE
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_stored_key_reaches_the_model(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    store = MemoryKeyStore()
    router = ModelRouter(GolemSettings(default_model="anthropic/claude-test"), keys=store)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        with pytest.raises(Exception, match="needs key"):
            router.chat_model("anthropic/claude-test")
        rpc_result(
            await client.call(
                "auth.set", {"provider": "anthropic", "key": "sk-test", "check": False}
            )
        )
        assert router.chat_model("anthropic/claude-test") is not None
    finally:
        await client.close()
        await stop_daemon(app, task)


def _anthropic(request: httpx.Request) -> httpx.Response:
    """Anthropic's model list, which opens for ``sk-good`` only."""
    assert request.url.path == "/v1/models"
    if request.headers.get("x-api-key") != "sk-good":
        body = {
            "type": "error",
            "error": {"type": "authentication_error", "message": "invalid x-api-key"},
        }
        return httpx.Response(401, json=body)
    return httpx.Response(200, json={"data": [{"id": "claude-a"}, {"id": "claude-b"}]})


def _offline(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("no network", request=request)


async def test_a_key_is_checked_before_it_is_stored(short_home: Path) -> None:
    store = MemoryKeyStore()
    transport = httpx.MockTransport(_anthropic)
    app, task = await start_daemon(
        short_home,
        router=ModelRouter(GolemSettings(), keys=store),
        discovery=lambda router: ModelDiscovery(
            router, None, transport=transport, detect_ram=False, fetch_prices=False
        ),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        bad = await client.call("auth.set", {"provider": "anthropic", "key": "sk-bad"})
        assert error_code(bad) == KEY_REJECTED
        message = cast(dict[str, object], bad["error"])["message"]
        assert message == "anthropic rejected the key (401 · invalid x-api-key)"
        assert store.keys == {}
        good = rpc_result(
            await client.call("auth.set", {"provider": "anthropic", "key": "sk-good"})
        )
        assert good == {"provider": "anthropic", "models": 2}
        assert store.keys == {"anthropic": "sk-good"}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_key_that_cannot_be_checked_is_not_stored(short_home: Path) -> None:
    store = MemoryKeyStore()
    transport = httpx.MockTransport(_offline)
    app, task = await start_daemon(
        short_home,
        router=ModelRouter(GolemSettings(), keys=store),
        discovery=lambda router: ModelDiscovery(
            router, None, transport=transport, detect_ram=False, fetch_prices=False
        ),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        reply = await client.call("auth.set", {"provider": "anthropic", "key": "sk-good"})
        assert error_code(reply) == KEY_UNCHECKED
        message = cast(dict[str, object], reply["error"])["message"]
        assert message == "could not reach anthropic: no network"
        assert store.keys == {}
    finally:
        await client.close()
        await stop_daemon(app, task)
