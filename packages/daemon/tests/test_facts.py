"""Model facts from the cached listing."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from test_discovery import CATALOG, HOSTED, PRICES, TAGS

from golem.config import GolemSettings, ModelPrice, ModelSettings, ProviderSettings
from golem.models.discovery import ListedModel, ModelDiscovery
from golem.models.facts import ListedFacts, ModelFacts, facts_of
from golem.models.keys import MemoryKeyStore
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow

FREE = ModelPrice(input=0.0, output=0.0)


@dataclass(frozen=True)
class _Speed:
    prompt_tps: float | None
    reply_tps: float | None


class _Discovery:
    def __init__(self, models: Sequence[ListedModel]) -> None:
        self.models = models
        self.listed = 0

    def cached(self) -> Sequence[ListedModel]:
        return self.models

    def price_of(self, ref: str) -> ModelPrice | None:
        return None

    async def list(self, *, refresh: bool = False, show_all: bool = False) -> object:
        self.listed += 1
        return None


def _local(**kw: Any) -> ListedModel:
    base: dict[str, Any] = {
        "ref": "ollama/qwen3:8b",
        "label": "Qwen3",
        "provider": "ollama",
        "source": "installed",
        "status": "ready",
        "ctx": 40960,
        "tools": True,
        "price": FREE,
        "tier": "local",
        "profiles": ("qwen",),
    }
    return ListedModel(**{**base, **kw})


def _hosted(**kw: Any) -> ListedModel:
    base: dict[str, Any] = {
        "ref": "anthropic/claude-test",
        "label": "Test",
        "provider": "anthropic",
        "source": "remote",
        "status": "ready",
        "ctx": 200000,
        "tools": True,
        "price": ModelPrice(input=3.0, output=15.0),
        "tier": "frontier",
    }
    return ListedModel(**{**base, **kw})


def _router(settings: GolemSettings | None = None, keys: bool = False) -> ModelRouter:
    store = MemoryKeyStore({"anthropic": "k"}) if keys else MemoryKeyStore({})
    return ModelRouter(settings or GolemSettings(), keys=store)


def _facts(models: Sequence[ListedModel], router: ModelRouter | None = None) -> ListedFacts:
    return ListedFacts(
        _Discovery(models),
        router or _router(),
        lambda profile, overrides: ContextWindow(16384, 16384),
        lambda ref: _Speed(500.0, 40.0) if ref == "ollama/qwen3:8b" else None,
    )


async def test_a_local_model_has_the_planned_window_not_the_maximum() -> None:
    [got] = await _facts([_local()]).facts(["ollama/qwen3:8b"])
    assert got.tier == "local"
    assert got.profile == "qwen"
    assert got.window == 16384
    assert got.window_exact
    assert got.price == FREE
    assert got.blended == 0.0
    assert (got.prompt_tps, got.reply_tps) == (500.0, 40.0)
    assert got.ready
    assert got.why_not_ready is None
    assert got.tool_score is None


async def test_an_estimated_window_is_not_exact() -> None:
    listed = _local()
    got = facts_of(listed, window=ContextWindow(4096, None, estimated=True), speed=None)
    assert (got.window, got.window_exact) == (4096, False)
    unknown = facts_of(listed, window=ContextWindow(), speed=None)
    assert (unknown.window, unknown.window_exact) == (None, False)
    assert (unknown.prompt_tps, unknown.reply_tps) == (None, None)


async def test_a_hosted_model_has_ctx_and_a_blended_price() -> None:
    [got] = await _facts([_hosted()]).facts(["anthropic/claude-test"])
    assert got.tier == "frontier"
    assert got.profile == "anthropic/claude-test"
    assert (got.window, got.window_exact) == (200000, True)
    assert got.blended == 6.0
    assert got.prompt_tps is None


async def test_a_provider_of_kind_ollama_is_local_whatever_its_name() -> None:
    listed = _local(ref="box/llama", provider="box", tier="budget", profiles=())
    got = facts_of(listed, window=ContextWindow(16384, 16384), speed=None, ollama=True)
    assert got.tier == "local"
    assert got.window == 16384
    # Without the kind, the name decides.
    assert facts_of(listed, window=None, speed=None).tier == "budget"


@pytest.mark.parametrize(
    ("status", "words"),
    [
        ("needs_key", "needs a key"),
        ("server_down", "server is down"),
        ("not_installed", "not installed"),
    ],
)
async def test_not_ready_says_why(status: str, words: str) -> None:
    [got] = await _facts([_hosted(status=status)]).facts(["anthropic/claude-test"])
    assert not got.ready
    assert got.why_not_ready == words


async def test_an_unknown_ref_is_not_ready() -> None:
    [got] = await _facts([_local()]).facts(["openai/nope"])
    assert not got.ready
    assert got.why_not_ready == "unknown model"
    assert got.tier == "frontier"
    assert got.window is None


async def test_vision_comes_from_categories_and_tools_may_be_unknown() -> None:
    seen = _hosted(categories=("general", "vision"), tools=None)
    plain = _hosted(ref="anthropic/other", categories=("general",))
    got = await _facts([seen, plain]).facts(["anthropic/claude-test", "anthropic/other"])
    assert [f.vision for f in got] == [True, False]
    assert got[0].tools is None
    assert got[1].tools is True


async def test_before_the_first_listing_it_starts_one_and_answers_from_the_router() -> None:
    discovery = _Discovery([])
    settings = GolemSettings(
        providers={"deepseek": ProviderSettings(kind="openai_compat", api_key_env="X_KEY")}
    )
    source = ListedFacts(
        discovery, _router(settings, keys=True), lambda profile, overrides: ContextWindow()
    )
    got = await source.facts(["anthropic/claude-test", "deepseek/chat", "ollama/qwen3:8b"])
    task = source._listing  # pyright: ignore[reportPrivateUsage]
    assert task is not None
    await task
    assert discovery.listed == 1
    assert [(f.ready, f.why_not_ready) for f in got] == [
        (True, None),
        (False, "needs a key"),
        (False, "not checked yet"),
    ]
    assert got[2].tier == "local"


async def test_facts_make_no_network_call(tmp_path: Path) -> None:
    calls: list[str] = []

    def network(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json=TAGS)
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"capabilities": ["completion"]})
        raise httpx.ConnectError("refused", request=request)

    settings = GolemSettings(
        default_model="qwen", models={"qwen": ModelSettings(model="ollama/qwen3:8b", ctx=16384)}
    )
    router = ModelRouter(settings, keys=MemoryKeyStore({}))
    discovery = ModelDiscovery(
        router,
        tmp_path / "cache",
        transport=httpx.MockTransport(network),
        ram_gb=36.0,
        catalog=CATALOG,
        hosted=HOSTED,
        price_book=PRICES,
        fetch_prices=False,
        ollama_installed=lambda: True,
    )
    await discovery.list()
    calls.clear()
    source = ListedFacts(discovery, router, lambda profile, overrides: ContextWindow(16384, 16384))
    got: list[ModelFacts] = await source.facts(["ollama/qwen3:8b", "anthropic/claude-test"])
    assert calls == []
    assert got[0].tier == "local"
    assert got[0].window == 16384
    assert got[0].profile == "qwen"
    assert got[1].ref == "anthropic/claude-test"
    await discovery.aclose()
