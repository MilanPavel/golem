"""``ollama.library`` over the daemon's socket, with a fake Ollama and registry."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import httpx
from test_pulls import FakeOllama
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.discovery import ModelDiscovery
from golem.models.ollama_library import DOWN
from golem.models.pulls import PullManager
from golem.models.router import ModelRouter
from golem.server.dispatcher import MODEL_PULL_FAILED


async def test_ollama_library_over_the_socket(short_home: Path) -> None:
    fake = FakeOllama()
    transport = httpx.MockTransport(fake)
    app, task = await start_daemon(
        short_home,
        router=ModelRouter(GolemSettings()),
        discovery=lambda routed: ModelDiscovery(
            routed, None, transport=transport, ram_gb=36.0, catalog=[], fetch_prices=False
        ),
        pulls=lambda routed, ram: PullManager(
            routed, transport=transport, ram_gb=ram, models_dir=short_home, clock=lambda: 0.0
        ),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        # The fake Ollama has qwen3:8b installed; a listing makes the daemon know it.
        await client.call("model.list", {})
        found = rpc_result(await client.call("ollama.library", {"query": "qwen3"}))
        models = {m["name"]: m for m in cast(list[dict[str, object]], found["models"])}
        assert "qwen3" in models and "qwen3-coder" in models
        sizes = {s["tag"]: s for s in cast(list[dict[str, object]], models["qwen3"]["sizes"])}
        assert sizes["8b"]["installed"] is True
        assert sizes["14b"]["installed"] is False
        assert models["qwen3"]["blurb"]
        everything = rpc_result(await client.call("ollama.library", {}))
        assert len(cast(list[object], everything["models"])) >= 40
        fake.manifest_status = 503
        failed = await client.call("ollama.library", {"query": "fresh-model"})
        assert error_code(failed) == MODEL_PULL_FAILED
        assert cast(dict[str, object], failed["error"])["message"] == DOWN
    finally:
        await client.close()
        await stop_daemon(app, task)
