"""Model discovery against a fake network."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import cast

import httpx
import pytest
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelPrice, ModelSettings, ProviderSettings
from golem.models.catalog import CatalogEntry
from golem.models.discovery import ListedModel, ModelDiscovery, openai_chat_model
from golem.models.keys import MemoryKeyStore
from golem.models.prices import PriceBook
from golem.models.router import ModelRouter

Handler = Callable[[httpx.Request], httpx.Response]

CATALOG = [
    CatalogEntry(ref="ollama/small:1b", label="Small 1B", size_gb=1.0, tags=("small",)),
    CatalogEntry(ref="ollama/qwen3:8b", label="Qwen3 8B", size_gb=5.2, tags=()),
    CatalogEntry(ref="ollama/huge:70b", label="Huge 70B", size_gb=40.0, tags=()),
]

PRICES = PriceBook(
    {
        "claude-test": {
            "litellm_provider": "anthropic",
            "mode": "chat",
            "input_cost_per_token": 3e-06,
            "output_cost_per_token": 1.5e-05,
            "cache_read_input_token_cost": 3e-07,
            "max_input_tokens": 200000,
            "supports_function_calling": True,
        },
        "gpt-test": {
            "litellm_provider": "openai",
            "mode": "chat",
            "input_cost_per_token": 1e-06,
            "output_cost_per_token": 2e-06,
        },
        "gpt-image-test": {"litellm_provider": "openai", "mode": "image_generation"},
    }
)

TAGS: dict[str, list[dict[str, object]]] = {
    "models": [
        {
            "name": "qwen3:8b",
            "size": 5_200_000_000,
            "digest": "d1",
            "details": {"context_length": 40960},
            "capabilities": ["completion", "tools"],
        },
        {"name": "old:7b", "size": 4_000_000_000, "digest": "d2", "details": {}},
    ]
}


class Network:
    """Answers by URL. Counts requests per path."""

    def __init__(self, routes: dict[str, Handler]) -> None:
        self.routes = routes
        self.calls: dict[str, int] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        key = f"{request.url.host}{request.url.path}"
        self.calls[key] = self.calls.get(key, 0) + 1
        handler = self.routes.get(key)
        if handler is None:
            raise httpx.ConnectError("refused", request=request)
        return handler(request)


def _json(body: object) -> Handler:
    return lambda _request: httpx.Response(200, json=body)


def _ollama_routes() -> dict[str, Handler]:
    return {
        "127.0.0.1/api/tags": _json(TAGS),
        "127.0.0.1/api/show": _json(
            {"model_info": {"llama.context_length": 8192}, "capabilities": ["completion"]}
        ),
    }


def _discovery(
    router: ModelRouter,
    network: Network,
    tmp_path: Path,
    *,
    clock: Callable[[], float] = lambda: 1000.0,
    budget: float = 2.0,
    ollama_installed: bool = True,
) -> ModelDiscovery:
    return ModelDiscovery(
        router,
        tmp_path / "cache",
        transport=httpx.MockTransport(network),
        ram_gb=36.0,
        budget=budget,
        clock=clock,
        catalog=CATALOG,
        price_book=PRICES,
        fetch_prices=False,
        ollama_installed=lambda: ollama_installed,
    )


def _by_ref(models: list[ListedModel]) -> dict[str, ListedModel]:
    return {model.ref: model for model in models}


async def test_installed_and_catalog_models_are_merged(tmp_path: Path) -> None:
    network = Network(_ollama_routes())
    discovery = _discovery(ModelRouter(GolemSettings(), keys=MemoryKeyStore()), network, tmp_path)
    listing = await discovery.list()
    models = _by_ref(listing.models)
    qwen = models["ollama/qwen3:8b"]
    assert (qwen.source, qwen.status, qwen.label) == ("installed", "ready", "Qwen3 8B")
    assert (qwen.ctx, qwen.tools, qwen.size_gb, qwen.fit) == (40960, True, 5.2, "fits")
    assert qwen.price == ModelPrice(input=0.0, output=0.0)
    old = models["ollama/old:7b"]
    assert (old.ctx, old.tools) == (8192, False)
    assert models["ollama/small:1b"].status == "not_installed"
    assert models["ollama/huge:70b"].fit == "too_big"
    assert listing.ram_gb == 36.0
    assert [model.ref for model in listing.models][:2] == ["ollama/old:7b", "ollama/qwen3:8b"]
    await discovery.aclose()


async def test_a_new_pull_shows_up_on_the_next_list(tmp_path: Path) -> None:
    tags = {"models": [dict(TAGS["models"][0])]}
    network = Network({"127.0.0.1/api/tags": lambda _r: httpx.Response(200, json=tags)})
    discovery = _discovery(ModelRouter(GolemSettings()), network, tmp_path)
    assert "ollama/fresh:3b" not in _by_ref((await discovery.list()).models)
    tags["models"].append(
        {
            "name": "fresh:3b",
            "size": 3_000_000_000,
            "details": {"context_length": 4096},
            "capabilities": [],
        }
    )
    assert _by_ref((await discovery.list()).models)["ollama/fresh:3b"].status == "ready"
    await discovery.aclose()


async def test_a_stopped_ollama_marks_its_models(tmp_path: Path) -> None:
    discovery = _discovery(ModelRouter(GolemSettings()), Network({}), tmp_path)
    listing = await discovery.list()
    assert _by_ref(listing.models)["ollama/qwen3:8b"].status == "server_down"
    assert {p.provider: p.status for p in listing.providers}["ollama"] == "server_down"
    await discovery.aclose()


async def test_an_ollama_that_is_not_installed_says_so(tmp_path: Path) -> None:
    discovery = _discovery(
        ModelRouter(GolemSettings()), Network({}), tmp_path, ollama_installed=False
    )
    listing = await discovery.list()
    assert {p.provider: p.status for p in listing.providers}["ollama"] == "not_installed"
    assert _by_ref(listing.models)["ollama/qwen3:8b"].status == "server_down"
    await discovery.aclose()


async def test_a_remote_ollama_is_down_not_missing(tmp_path: Path) -> None:
    settings = GolemSettings(
        default_model="far/llama3",
        providers={"far": ProviderSettings(kind="ollama", base_url="http://gpu-box:11434")},
    )
    discovery = _discovery(ModelRouter(settings), Network({}), tmp_path, ollama_installed=False)
    listing = await discovery.list()
    states = {p.provider: p.status for p in listing.providers}
    assert (states["far"], states["ollama"]) == ("server_down", "not_installed")
    await discovery.aclose()


async def test_a_provider_without_a_key_is_not_listed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = GolemSettings(models={"sonnet": ModelSettings(model="anthropic/claude-test")})
    network = Network(_ollama_routes())
    discovery = _discovery(ModelRouter(settings, keys=MemoryKeyStore()), network, tmp_path)
    listing = await discovery.list()
    sonnet = _by_ref(listing.models)["anthropic/claude-test"]
    assert (sonnet.source, sonnet.status, sonnet.profiles) == ("profile", "needs_key", ("sonnet",))
    assert sonnet.price is not None and sonnet.price.input == pytest.approx(3.0)
    providers = {p.provider: p.status for p in listing.providers}
    assert providers["anthropic"] == "needs_key"
    assert providers["lmstudio"] == "unlisted"
    assert not any("anthropic" in call for call in network.calls)
    await discovery.aclose()


async def test_anthropic_models_are_listed_with_litellm_prices(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    seen: list[str] = []

    def models(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["x-api-key"])
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "claude-test", "display_name": "Claude Test"},
                    {"id": "claude-next", "display_name": "Claude Next"},
                ]
            },
        )

    network = Network({**_ollama_routes(), "api.anthropic.com/v1/models": models})
    store = MemoryKeyStore({"anthropic": "sk-ant"})
    discovery = _discovery(ModelRouter(GolemSettings(), keys=store), network, tmp_path)
    found = _by_ref((await discovery.list()).models)
    test_model = found["anthropic/claude-test"]
    assert (test_model.source, test_model.status, test_model.label) == (
        "remote",
        "ready",
        "Claude Test",
    )
    assert test_model.price == ModelPrice(input=3.0, output=15.0, cached_input=0.3)
    assert test_model.ctx == 200000
    assert found["anthropic/claude-next"].price is None
    assert seen == ["sk-ant"]
    await discovery.aclose()


async def test_openrouter_brings_its_own_prices(tmp_path: Path) -> None:
    body = {
        "data": [
            {
                "id": "qwen/qwen3-235b-a22b",
                "name": "Qwen3 235B",
                "context_length": 131072,
                "pricing": {"prompt": "0.0000002", "completion": "0.0000006"},
                "supported_parameters": ["tools", "temperature"],
            }
        ]
    }
    network = Network({**_ollama_routes(), "openrouter.ai/api/v1/models": _json(body)})
    store = MemoryKeyStore({"openrouter": "sk-or"})
    discovery = _discovery(ModelRouter(GolemSettings(), keys=store), network, tmp_path)
    model = _by_ref((await discovery.list()).models)["openrouter/qwen/qwen3-235b-a22b"]
    assert model.price is not None
    assert (model.price.input, model.price.output) == (pytest.approx(0.2), pytest.approx(0.6))
    assert (model.ctx, model.tools, model.label) == (131072, True, "Qwen3 235B")
    await discovery.aclose()


def test_openai_chat_filter_uses_litellm_then_the_name() -> None:
    assert openai_chat_model("gpt-test", PRICES)
    assert not openai_chat_model("gpt-image-test", PRICES)
    assert openai_chat_model("gpt-9-mini", PRICES)
    assert not openai_chat_model("gpt-9-realtime", PRICES)
    assert not openai_chat_model("text-embedding-3-small", PRICES)
    assert not openai_chat_model("whisper-1", PRICES)


async def test_a_hosted_list_is_cached_for_a_day(tmp_path: Path) -> None:
    now = [1000.0]
    network = Network(
        {**_ollama_routes(), "openrouter.ai/api/v1/models": _json({"data": [{"id": "a/b"}]})}
    )
    store = MemoryKeyStore({"openrouter": "sk-or"})
    discovery = _discovery(
        ModelRouter(GolemSettings(), keys=store), network, tmp_path, clock=lambda: now[0]
    )
    await discovery.list()
    await discovery.list()
    assert network.calls["openrouter.ai/api/v1/models"] == 1
    await discovery.aclose()
    reopened = _discovery(
        ModelRouter(GolemSettings(), keys=store), network, tmp_path, clock=lambda: now[0]
    )
    assert "openrouter/a/b" in _by_ref((await reopened.list()).models)
    assert network.calls["openrouter.ai/api/v1/models"] == 1
    await reopened.list(refresh=True)
    assert network.calls["openrouter.ai/api/v1/models"] == 2
    cached = json.loads((tmp_path / "cache" / "models-openrouter.json").read_text())
    assert cached["models"][0]["model_id"] == "a/b"
    await reopened.aclose()


async def test_a_failed_refresh_keeps_the_cache_and_says_stale(tmp_path: Path) -> None:
    now = [1000.0]
    answer = {"ok": True}

    def models(request: httpx.Request) -> httpx.Response:
        if not answer["ok"]:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"data": [{"id": "a/b"}]})

    network = Network({**_ollama_routes(), "openrouter.ai/api/v1/models": models})
    store = MemoryKeyStore({"openrouter": "sk-or"})
    discovery = _discovery(
        ModelRouter(GolemSettings(), keys=store), network, tmp_path, clock=lambda: now[0]
    )
    await discovery.list()
    answer["ok"] = False
    now[0] += 2 * 24 * 3600
    listing = await discovery.list()
    model = _by_ref(listing.models)["openrouter/a/b"]
    assert model.stale
    assert {p.provider: p.stale for p in listing.providers}["openrouter"]
    await discovery.aclose()


async def test_a_slow_provider_does_not_hold_the_list(tmp_path: Path) -> None:
    release = asyncio.Event()

    async def slow(request: httpx.Request) -> httpx.Response:
        await release.wait()
        return httpx.Response(200, json={"data": [{"id": "a/b"}]})

    class SlowTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == "openrouter.ai":
                return await slow(request)
            return Network(_ollama_routes())(request)

    store = MemoryKeyStore({"openrouter": "sk-or"})
    discovery = ModelDiscovery(
        ModelRouter(GolemSettings(), keys=store),
        tmp_path / "cache",
        transport=SlowTransport(),
        ram_gb=36.0,
        budget=0.05,
        catalog=CATALOG,
        price_book=PRICES,
        fetch_prices=False,
    )
    first = await discovery.list()
    assert "openrouter/a/b" not in _by_ref(first.models)
    assert {p.provider: p.stale for p in first.providers}["openrouter"]
    release.set()
    await asyncio.sleep(0.05)
    second = await discovery.list()
    assert "openrouter/a/b" in _by_ref(second.models)
    await discovery.aclose()


async def test_profiles_alias_and_override_a_listed_model(tmp_path: Path) -> None:
    settings = GolemSettings(
        default_model="qwen",
        models={
            "qwen": ModelSettings(model="ollama/qwen3:8b", ctx=16384),
            "fast": ModelSettings(model="ollama/qwen3:8b"),
            "paid": ModelSettings(
                model="lmstudio/local-x", price=ModelPrice(input=1.0, output=2.0)
            ),
        },
    )
    network = Network(_ollama_routes())
    discovery = _discovery(ModelRouter(settings), network, tmp_path)
    listing = await discovery.list()
    models = _by_ref(listing.models)
    assert listing.default == "qwen"
    assert models["ollama/qwen3:8b"].profiles == ("fast", "qwen")
    assert models["ollama/qwen3:8b"].ctx == 16384
    paid = models["lmstudio/local-x"]
    assert (paid.source, paid.status) == ("profile", "server_down")
    assert paid.price == ModelPrice(input=1.0, output=2.0)
    await discovery.aclose()


async def test_model_list_over_the_socket(short_home: Path) -> None:
    network = Network(_ollama_routes())
    router = ModelRouter(
        GolemSettings(models={"qwen": ModelSettings(model="ollama/qwen3:8b")}, default_model="qwen")
    )
    app, task = await start_daemon(
        short_home,
        router=router,
        discovery=lambda routed: _discovery(routed, network, short_home),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("model.list", {}))
        assert listed["default"] == "qwen"
        assert listed["ram_gb"] == 36.0
        models = {
            cast(str, item["ref"]): item for item in cast(list[dict[str, object]], listed["models"])
        }
        qwen = models["ollama/qwen3:8b"]
        assert qwen["profiles"] == ["qwen"]
        assert qwen["price"] == {"input": 0.0, "output": 0.0, "cached_input": None}
        assert models["ollama/small:1b"]["status"] == "not_installed"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_ref_as_default_is_listed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings = GolemSettings(default_model="anthropic/claude-test")
    discovery = _discovery(
        ModelRouter(settings, keys=MemoryKeyStore()), Network(_ollama_routes()), tmp_path
    )
    listing = await discovery.list()
    assert listing.default == "anthropic/claude-test"
    assert _by_ref(listing.models)["anthropic/claude-test"].status == "needs_key"
    await discovery.aclose()
