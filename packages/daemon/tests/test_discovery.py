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
from golem.models.catalog import CatalogEntry, HostedEntry
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

HOSTED = [
    HostedEntry(ref=ref, label=label, blurb="a blurb", categories=("general",))
    for ref, label in [
        ("anthropic/claude-test", "Claude Test"),
        ("anthropic/claude-next", "Claude Next"),
        ("deepseek/deepseek-chat", "DeepSeek Chat"),
        ("deepseek/a/b", "A B"),
        ("openai/gpt-test", "GPT Test"),
    ]
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
        "gpt-extra": {
            "litellm_provider": "openai",
            "mode": "chat",
            "supports_function_calling": True,
        },
        "gpt-notools": {
            "litellm_provider": "openai",
            "mode": "chat",
            "supports_function_calling": False,
        },
        "gpt-retired": {
            "litellm_provider": "openai",
            "mode": "chat",
            "supports_function_calling": True,
            "deprecation_date": "2026-01-01",
        },
        "gpt-retiring": {
            "litellm_provider": "openai",
            "mode": "chat",
            "supports_function_calling": True,
            "deprecation_date": "2027-01-01",
        },
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


DEEPSEEK = GolemSettings(
    providers={
        "deepseek": ProviderSettings(
            kind="openai_compat",
            base_url="https://api.deepseek.com/v1",
            api_key_env="DEEPSEEK_API_KEY",
        )
    }
)


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
        hosted=HOSTED,
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


async def test_the_largest_starter_that_fits_is_recommended_and_tags_are_listed(
    tmp_path: Path,
) -> None:
    catalog = [
        CatalogEntry(
            ref="ollama/small:1b", label="S", size_gb=1.0, tags=("starter",), min_ram_gb=8
        ),
        CatalogEntry(
            ref="ollama/qwen3:8b", label="Q", size_gb=5.2, tags=("starter", "coding"), min_ram_gb=16
        ),
        CatalogEntry(
            ref="ollama/huge:70b", label="H", size_gb=40.0, tags=("starter",), min_ram_gb=64
        ),
    ]
    network = Network(_ollama_routes())
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore())
    for ram, expected in ((36.0, "ollama/qwen3:8b"), (8.0, "ollama/small:1b"), (4.0, None)):
        discovery = ModelDiscovery(
            router,
            tmp_path / f"cache-{ram}",
            transport=httpx.MockTransport(network),
            ram_gb=ram,
            catalog=catalog,
            price_book=PRICES,
            fetch_prices=False,
            ollama_installed=lambda: True,
        )
        listing = await discovery.list()
        recommended = [model.ref for model in listing.models if model.recommended]
        assert recommended == ([] if expected is None else [expected])
        # An installed catalog model keeps the catalog's tags.
        assert _by_ref(listing.models)["ollama/qwen3:8b"].tags == ("starter", "coding")
        assert listing.disk_free_gb is not None and listing.disk_free_gb > 0
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
    # One install away, not down: the picker offers to install Ollama.
    assert _by_ref(listing.models)["ollama/qwen3:8b"].status == "not_installed"
    assert (listing.setup.ollama_installed, listing.setup.ollama_running) == (False, False)
    await discovery.aclose()


async def test_a_fresh_home_has_no_default_and_says_what_setup_needs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"anthropic": "sk-test"}))
    discovery = _discovery(router, Network({}), tmp_path)
    listing = await discovery.list()
    assert listing.default is None
    assert listing.setup.ollama_installed and not listing.setup.ollama_running
    assert listing.setup.keys == ("anthropic",)
    assert listing.setup.default_status is None
    assert _by_ref(listing.models)["ollama/qwen3:8b"].status == "server_down"
    await discovery.aclose()


async def test_setup_gives_the_default_models_status(tmp_path: Path) -> None:
    network = Network(_ollama_routes())
    for default, status in (("ollama/qwen3:8b", "ready"), ("ollama/small:1b", "not_installed")):
        router = ModelRouter(GolemSettings(default_model=default), keys=MemoryKeyStore())
        discovery = _discovery(router, network, tmp_path)
        listing = await discovery.list()
        assert listing.setup.ollama_running
        assert (listing.default, listing.setup.default_status) == (default, status)
        await discovery.aclose()
    router = ModelRouter(GolemSettings(default_model="gone"), keys=MemoryKeyStore())
    discovery = _discovery(router, network, tmp_path)
    assert (await discovery.list()).setup.default_status == "unknown"
    await discovery.aclose()


async def test_a_remote_ollama_is_down_not_missing(tmp_path: Path) -> None:
    settings = GolemSettings(
        default_model="ollama/llama3",
        providers={"ollama": ProviderSettings(base_url="http://gpu-box:11434")},
    )
    discovery = _discovery(ModelRouter(settings), Network({}), tmp_path, ollama_installed=False)
    listing = await discovery.list()
    states = {p.provider: p.status for p in listing.providers}
    assert states["ollama"] == "server_down"
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


async def test_a_provider_list_brings_its_own_prices(tmp_path: Path) -> None:
    body = {
        "data": [
            {
                "id": "deepseek-chat",
                "name": "Qwen3 235B",
                "context_length": 131072,
                "pricing": {"prompt": "0.0000002", "completion": "0.0000006"},
                "supported_parameters": ["tools", "temperature"],
            }
        ]
    }
    network = Network({**_ollama_routes(), "api.deepseek.com/v1/models": _json(body)})
    store = MemoryKeyStore({"deepseek": "sk-ds"})
    discovery = _discovery(ModelRouter(DEEPSEEK, keys=store), network, tmp_path)
    model = _by_ref((await discovery.list()).models)["deepseek/deepseek-chat"]
    assert model.price is not None
    assert (model.price.input, model.price.output) == (pytest.approx(0.2), pytest.approx(0.6))
    assert (model.ctx, model.tools, model.label) == (131072, True, "DeepSeek Chat")
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
        {**_ollama_routes(), "api.deepseek.com/v1/models": _json({"data": [{"id": "a/b"}]})}
    )
    store = MemoryKeyStore({"deepseek": "sk-ds"})
    discovery = _discovery(
        ModelRouter(DEEPSEEK, keys=store), network, tmp_path, clock=lambda: now[0]
    )
    await discovery.list()
    await discovery.list()
    assert network.calls["api.deepseek.com/v1/models"] == 1
    await discovery.aclose()
    reopened = _discovery(
        ModelRouter(DEEPSEEK, keys=store), network, tmp_path, clock=lambda: now[0]
    )
    assert "deepseek/a/b" in _by_ref((await reopened.list()).models)
    assert network.calls["api.deepseek.com/v1/models"] == 1
    await reopened.list(refresh=True)
    assert network.calls["api.deepseek.com/v1/models"] == 2
    cached = json.loads((tmp_path / "cache" / "models-deepseek.json").read_text())
    assert cached["models"][0]["model_id"] == "a/b"
    await reopened.aclose()


async def test_a_failed_refresh_keeps_the_cache_and_says_stale(tmp_path: Path) -> None:
    now = [1000.0]
    answer = {"ok": True}

    def models(request: httpx.Request) -> httpx.Response:
        if not answer["ok"]:
            raise httpx.ConnectError("down", request=request)
        return httpx.Response(200, json={"data": [{"id": "a/b"}]})

    network = Network({**_ollama_routes(), "api.deepseek.com/v1/models": models})
    store = MemoryKeyStore({"deepseek": "sk-ds"})
    discovery = _discovery(
        ModelRouter(DEEPSEEK, keys=store), network, tmp_path, clock=lambda: now[0]
    )
    await discovery.list()
    answer["ok"] = False
    now[0] += 2 * 24 * 3600
    listing = await discovery.list()
    model = _by_ref(listing.models)["deepseek/a/b"]
    assert model.stale
    assert {p.provider: p.stale for p in listing.providers}["deepseek"]
    await discovery.aclose()


async def test_a_slow_provider_does_not_hold_the_list(tmp_path: Path) -> None:
    release = asyncio.Event()

    async def slow(request: httpx.Request) -> httpx.Response:
        await release.wait()
        return httpx.Response(200, json={"data": [{"id": "a/b"}]})

    class SlowTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == "api.deepseek.com":
                return await slow(request)
            return Network(_ollama_routes())(request)

    store = MemoryKeyStore({"deepseek": "sk-ds"})
    discovery = ModelDiscovery(
        ModelRouter(DEEPSEEK, keys=store),
        tmp_path / "cache",
        transport=SlowTransport(),
        ram_gb=36.0,
        budget=0.05,
        catalog=CATALOG,
        hosted=HOSTED,
        price_book=PRICES,
        fetch_prices=False,
    )
    first = await discovery.list()
    assert "deepseek/a/b" not in _by_ref(first.models)
    assert {p.provider: p.stale for p in first.providers}["deepseek"]
    release.set()
    await asyncio.sleep(0.05)
    second = await discovery.list()
    assert "deepseek/a/b" in _by_ref(second.models)
    await discovery.aclose()


async def test_profiles_alias_and_override_a_listed_model(tmp_path: Path) -> None:
    settings = GolemSettings(
        default_model="qwen",
        models={
            "qwen": ModelSettings(model="ollama/qwen3:8b", ctx=16384),
            "fast": ModelSettings(model="ollama/qwen3:8b"),
            "paid": ModelSettings(
                model="deepseek/model-x", price=ModelPrice(input=1.0, output=2.0)
            ),
        },
        providers=DEEPSEEK.providers,
    )
    network = Network(_ollama_routes())
    discovery = _discovery(ModelRouter(settings), network, tmp_path)
    listing = await discovery.list()
    models = _by_ref(listing.models)
    assert listing.default == "qwen"
    assert models["ollama/qwen3:8b"].profiles == ("fast", "qwen")
    assert models["ollama/qwen3:8b"].ctx == 16384
    paid = models["deepseek/model-x"]
    assert (paid.source, paid.status) == ("profile", "needs_key")
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


OPENAI_LIVE = {
    "data": [
        {"id": "gpt-test"},
        {"id": "gpt-test-2026-02-03"},
        {"id": "gpt-extra"},
        {"id": "gpt-notools"},
        {"id": "gpt-retired"},
        {"id": "gpt-retiring"},
        {"id": "gpt-unknown"},
        {"id": "gpt-image-test"},
    ]
}
SEPTEMBER_2026 = 1_790_000_000.0


async def _openai_refs(*, show_all: bool, hosted: list[HostedEntry] | None = None) -> list[str]:
    network = Network({**_ollama_routes(), "api.openai.com/v1/models": _json(OPENAI_LIVE)})
    discovery = ModelDiscovery(
        ModelRouter(GolemSettings(), keys=MemoryKeyStore({"openai": "sk-test"})),
        None,
        transport=httpx.MockTransport(network),
        detect_ram=False,
        clock=lambda: SEPTEMBER_2026,
        catalog=CATALOG,
        hosted=HOSTED if hosted is None else hosted,
        price_book=PRICES,
        fetch_prices=False,
    )
    try:
        listing = await discovery.list(show_all=show_all)
    finally:
        await discovery.aclose()
    return sorted(model.ref for model in listing.models if model.provider == "openai")


async def test_a_key_lists_only_the_catalog_models_it_can_call() -> None:
    assert await _openai_refs(show_all=False) == ["openai/gpt-test"]


async def test_a_dated_snapshot_stands_for_its_catalog_model() -> None:
    live = {"data": [{"id": "claude-test-20260101", "display_name": "Snapshot"}]}
    network = Network({**_ollama_routes(), "api.anthropic.com/v1/models": _json(live)})
    discovery = ModelDiscovery(
        ModelRouter(GolemSettings(), keys=MemoryKeyStore({"anthropic": "sk-ant"})),
        None,
        transport=httpx.MockTransport(network),
        detect_ram=False,
        catalog=CATALOG,
        hosted=HOSTED,
        price_book=PRICES,
        fetch_prices=False,
    )
    try:
        found = _by_ref((await discovery.list()).models)
    finally:
        await discovery.aclose()
    assert [ref for ref in found if ref.startswith("anthropic/")] == ["anthropic/claude-test"]
    assert found["anthropic/claude-test"].label == "Claude Test"
    assert found["anthropic/claude-test"].ctx == 200000


async def test_show_all_adds_live_chat_models_that_call_tools() -> None:
    assert await _openai_refs(show_all=True) == [
        "openai/gpt-extra",
        "openai/gpt-retiring",
        "openai/gpt-test",
    ]


async def test_a_retired_model_is_not_offered_even_when_the_catalog_names_it() -> None:
    hosted = [
        *HOSTED,
        HostedEntry("openai/gpt-retired", "Retired", "gone", ("general",)),
        HostedEntry("openai/gpt-retiring", "Retiring", "soon", ("general",)),
    ]
    assert await _openai_refs(show_all=False, hosted=hosted) == [
        "openai/gpt-retiring",
        "openai/gpt-test",
    ]
    assert "openai/gpt-retired" not in await _openai_refs(show_all=True, hosted=hosted)


async def test_a_model_you_name_is_listed_though_the_catalog_does_not() -> None:
    network = Network({**_ollama_routes(), "api.openai.com/v1/models": _json(OPENAI_LIVE)})
    settings = GolemSettings(default_model="openai/gpt-unknown")
    discovery = ModelDiscovery(
        ModelRouter(settings, keys=MemoryKeyStore({"openai": "sk-test"})),
        None,
        transport=httpx.MockTransport(network),
        detect_ram=False,
        catalog=CATALOG,
        hosted=HOSTED,
        price_book=PRICES,
        fetch_prices=False,
    )
    try:
        found = _by_ref((await discovery.list()).models)
    finally:
        await discovery.aclose()
    assert found["openai/gpt-unknown"].source == "profile"
