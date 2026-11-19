"""The benchmark: the table from a fake engine, and the run against a local model."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncGenerator, Mapping
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from langchain_core.language_models.chat_models import BaseChatModel

from golem.config import GolemSettings, ModelSettings, OllamaSettings, ProviderSettings
from golem.models.bench import NoLocalModel, Result, Row, Sample, Shape, bench, run_levels
from golem.models.ollama import LocalServers
from golem.models.router import ModelRouter


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _engine(clock: FakeClock, slots: int) -> Any:
    """A fake engine: a call writes 100 tokens, and slows down once calls outnumber its slots."""
    running = 0

    async def call(shape: Shape) -> Sample:
        nonlocal running
        running += 1
        await asyncio.sleep(0)  # let the other calls of the level start
        seconds = (2.0 if shape == "tools" else 10.0) * max(1.0, running / slots)
        await asyncio.sleep(0)  # all calls have read the count before any leaves
        running -= 1
        clock.now = max(clock.now, seconds)
        return Sample(100, seconds)

    return call


async def test_a_fake_engine_gives_the_table() -> None:
    clock = FakeClock()
    rows: list[Row] = []
    for level in (1, 2):
        clock.now = 0.0
        rows += await run_levels(_engine(clock, 1), [level], ["tools"], clock=clock)
    one, two = rows
    assert (one.shape, one.at_once, one.window) == ("tools", 1, 2.0)
    assert one.each == (50.0,)
    assert one.total == 50.0
    # Two calls on one slot: each takes twice as long, so the total does not grow.
    assert (two.at_once, two.window) == (2, 4.0)
    assert two.each == (25.0, 25.0)
    assert two.total == 50.0
    text = Result("ollama/qwen3:14b", tuple(rows)).table()
    assert "ollama/qwen3:14b" in text
    assert "tools" in text
    assert "25.0 25.0" in text


async def test_each_shape_runs_at_each_count_in_order() -> None:
    seen: list[Shape] = []

    async def call(shape: Shape) -> Sample:
        seen.append(shape)
        return Sample(10, 1.0)

    rows = await run_levels(call, [1, 2])
    assert [(row.shape, row.at_once) for row in rows] == [
        ("tools", 1),
        ("tools", 2),
        ("prompt", 1),
        ("prompt", 2),
    ]
    assert seen == ["tools", "tools", "tools", "prompt", "prompt", "prompt"]


class FakeServer:
    def __init__(self, local: FakeLocal, owner: str) -> None:
        self.owner = owner
        self._local = local

    @contextlib.asynccontextmanager
    async def hold(self) -> AsyncGenerator[None]:
        self._local.held.append(self._local.settings.parallel)
        yield


class FakeLocal:
    def __init__(self, owner: str = "golem") -> None:
        self.settings = OllamaSettings(parallel=2)
        self.held: list[int] = []
        self.gets = 0
        self._owner = owner

    def get(self, provider: str, base_url: str) -> FakeServer:
        del provider, base_url
        self.gets += 1
        return FakeServer(self, self._owner)


def _router(models: Mapping[str, str], model: BaseChatModel | None = None) -> ModelRouter:
    router = ModelRouter(
        GolemSettings(
            providers={
                "ollama": ProviderSettings(kind="ollama"),
                "anthropic": ProviderSettings(kind="anthropic"),
            },
            models={
                name: ModelSettings(model=f"{provider}/{name}") for name, provider in models.items()
            },
            default_model=next(iter(models), None),
        )
    )
    if model is not None:

        def chat_model(
            profile: str, overrides: Mapping[str, float | str] | None = None, **_: object
        ) -> BaseChatModel:
            del profile, overrides
            return model

        router.chat_model = chat_model  # type: ignore[method-assign]
    return router


def _fake_model() -> ToolCallingChatModel:
    usage = {"input_tokens": 5, "output_tokens": 40, "total_tokens": 45}
    return ToolCallingChatModel(replies=["ok"] * 200, usage=usage)


async def test_local_only_runs_a_local_model_up_to_four_at_once() -> None:
    router = _router({"qwen": "ollama"}, _fake_model())
    local = FakeLocal("golem")
    result = await bench(router, cast("LocalServers", local))
    assert result.model == router.resolve("qwen").ref
    assert [(row.shape, row.at_once) for row in result.rows] == [
        (shape, n) for shape in ("tools", "prompt") for n in (1, 2, 3, 4)
    ]
    assert all(call.tokens == 40 for row in result.rows for call in row.calls)
    # The server was held with 4 slots, and the setting is back after.
    assert local.held == [4]
    assert local.settings.parallel == 2


async def test_the_long_prompt_is_about_twenty_thousand_tokens() -> None:
    model = _fake_model()
    router = _router({"qwen": "ollama"}, model)
    await bench(router, cast("LocalServers", FakeLocal()), shapes=["prompt"])
    longest = max(len(str(history[0].content)) for history in model.seen)
    assert 70_000 < longest < 90_000


async def test_an_external_server_runs_up_to_what_the_probe_allows() -> None:
    router = _router({"qwen": "ollama"}, _fake_model())
    local = FakeLocal("external")
    result = await bench(router, cast("LocalServers", local), limit=2, shapes=["tools"])
    assert [row.at_once for row in result.rows] == [1, 2]
    assert local.settings.parallel == 2


async def test_the_setting_is_restored_when_the_run_fails() -> None:
    model = ToolCallingChatModel(replies=[])  # the first call fails
    router = _router({"qwen": "ollama"}, model)
    local = FakeLocal()
    with pytest.raises(RuntimeError):
        await bench(router, cast("LocalServers", local))
    assert local.settings.parallel == 2


async def test_cloud_only_says_there_is_no_local_model_and_does_nothing_else() -> None:
    model = _fake_model()
    router = _router({"sonnet": "anthropic"}, model)
    local = FakeLocal()
    with pytest.raises(NoLocalModel, match="no local model"):
        await bench(router, cast("LocalServers", local))
    assert local.gets == 0
    assert local.held == []
    assert model.seen == []


async def test_mixed_picks_the_local_model_even_when_the_default_is_hosted() -> None:
    router = _router({"sonnet": "anthropic", "qwen": "ollama"}, _fake_model())
    result = await bench(router, cast("LocalServers", FakeLocal()), shapes=["tools"])
    assert result.model == router.resolve("qwen").ref


async def test_a_hosted_model_named_is_refused() -> None:
    router = _router({"sonnet": "anthropic", "qwen": "ollama"}, _fake_model())
    with pytest.raises(NoLocalModel, match="sonnet is not a local model"):
        await bench(router, cast("LocalServers", FakeLocal()), "sonnet")
