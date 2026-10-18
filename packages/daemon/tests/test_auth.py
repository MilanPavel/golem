"""``auth.set``, ``auth.remove``, and ``auth.list`` over a real socket."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.keys import MemoryKeyStore
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, KEYCHAIN_UNAVAILABLE


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
            await client.call("auth.set", {"provider": "anthropic", "key": "  sk-test\n"})
        )
        assert stored == {"provider": "anthropic"}
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
        rpc_result(await client.call("auth.set", {"provider": "anthropic", "key": "sk-test"}))
        assert router.chat_model("anthropic/claude-test") is not None
    finally:
        await client.close()
        await stop_daemon(app, task)
