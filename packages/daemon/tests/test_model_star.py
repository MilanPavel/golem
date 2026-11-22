"""Stars decide the model menu: ``[model_menu] starred`` and ``model.star``."""

from __future__ import annotations

from functools import partial
from pathlib import Path
from typing import cast

import httpx
from test_discovery import (
    CATALOG,
    HOSTED,
    OPENAI_LIVE,
    PRICES,
    SEPTEMBER_2026,
    Network,
    _json,  # pyright: ignore[reportPrivateUsage]
    _ollama_routes,  # pyright: ignore[reportPrivateUsage]
)
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelMenuSettings, OllamaSettings, load_settings
from golem.models.discovery import ModelDiscovery
from golem.models.keys import MemoryKeyStore
from golem.models.ollama import LocalServer, LocalServers
from golem.models.router import ModelRouter


def _discovery(router: ModelRouter, network: Network) -> ModelDiscovery:
    return ModelDiscovery(
        router,
        None,
        transport=httpx.MockTransport(network),
        ram_gb=36.0,
        clock=lambda: SEPTEMBER_2026,
        catalog=CATALOG,
        hosted=HOSTED,
        price_book=PRICES,
        fetch_prices=False,
        ollama_installed=lambda: True,
        # A busy CI runner can take longer than the 2 s default to answer from the fakes.
        budget=30.0,
    )


def _servers(home: Path) -> LocalServers:
    """Local servers that see an ollama binary, so a runner without one still lists the fakes."""
    return LocalServers(
        OllamaSettings(start=False),
        log_file=home / "ollama.log",
        run_dir=home,
        make=partial(LocalServer, find_binary=lambda: "/opt/homebrew/bin/ollama"),
    )


def _network() -> Network:
    return Network({**_ollama_routes(), "api.openai.com/v1/models": _json(OPENAI_LIVE)})


async def test_unset_stars_what_the_menu_shows_today() -> None:
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"openai": "sk-test"}))
    discovery = _discovery(router, _network())
    try:
        today = {m.ref for m in (await discovery.list()).models if m.source != "catalog"}
        everything = await discovery.list(show_all=True)
    finally:
        await discovery.aclose()
    stars = {m.ref: m.starred for m in everything.models}
    assert {ref for ref, starred in stars.items() if starred} == today
    assert {"ollama/qwen3:8b", "ollama/old:7b", "openai/gpt-test"} <= today
    assert not stars["openai/gpt-extra"]
    assert not stars["ollama/small:1b"]


async def test_a_written_list_decides_the_stars() -> None:
    settings = GolemSettings(model_menu=ModelMenuSettings(starred=["ollama/small:1b"]))
    discovery = _discovery(ModelRouter(settings), _network())
    try:
        listing = await discovery.list()
    finally:
        await discovery.aclose()
    assert [m.ref for m in listing.models if m.starred] == ["ollama/small:1b"]


async def test_model_star_writes_the_list_and_it_survives_a_restart(short_home: Path) -> None:
    keys = MemoryKeyStore({"openai": "sk-test"})
    network = _network()

    def make() -> ModelRouter:
        settings = load_settings(home=short_home, project_dir=short_home)
        return ModelRouter(settings, home=short_home, keys=keys)

    app, task = await start_daemon(
        short_home,
        router=make(),
        discovery=lambda routed: _discovery(routed, network),
        local_servers=_servers(short_home),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        first = rpc_result(
            await client.call("model.star", {"ref": "ollama/small:1b", "starred": True})
        )
        assert set(cast(list[str], first["starred"])) == {
            "ollama/old:7b",
            "ollama/qwen3:8b",
            "openai/gpt-test",
            "ollama/small:1b",
        }
        second = rpc_result(
            await client.call("model.star", {"ref": "ollama/old:7b", "starred": False})
        )
        assert "ollama/old:7b" not in cast(list[str], second["starred"])
    finally:
        await client.close()
        await stop_daemon(app, task)
    saved = load_settings(home=short_home, project_dir=short_home).model_menu.starred
    assert saved is not None
    assert "ollama/small:1b" in saved and "ollama/old:7b" not in saved

    app, task = await start_daemon(
        short_home,
        router=make(),
        discovery=lambda routed: _discovery(routed, network),
        local_servers=_servers(short_home),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("model.list", {}))
        models = cast(list[dict[str, object]], listed["models"])
        assert {cast(str, m["ref"]) for m in models if m["starred"]} == set(saved)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_model_no_provider_lists_can_be_starred(short_home: Path) -> None:
    network = _network()
    router = ModelRouter(GolemSettings(), home=short_home)
    app, task = await start_daemon(
        short_home, router=router, discovery=lambda routed: _discovery(routed, network)
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("model.star", {"ref": "nowhere/ghost-1", "starred": True}))
        listed = rpc_result(await client.call("model.list", {}))
        models = {cast(str, m["ref"]): m for m in cast(list[dict[str, object]], listed["models"])}
        ghost = models["nowhere/ghost-1"]
        assert ghost["starred"] is True
        assert ghost["status"] != "ready"
    finally:
        await client.close()
        await stop_daemon(app, task)
