"""``model.bench``: the manager and the handler, with a fake engine and no Ollama."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic import BaseModel

from golem.config import GolemSettings, ModelSettings, OllamaSettings, ProviderSettings
from golem.models.bench import NoLocalModel, OnRow, Result, Row, Sample, Shape
from golem.models.bench_manager import BenchManager
from golem.models.ollama import LocalServers
from golem.models.router import ModelRouter
from golem.server.dispatcher import MODEL_NOT_CONFIGURED, RequestContext, RpcCallError
from golem.server.handlers import _model_bench  # pyright: ignore[reportPrivateUsage]
from golem_protocol.commands import ModelBenchParams

LOCAL = "ollama/qwen3:8b"
HOSTED = "anthropic/claude-sonnet"


class FakeServer:
    base_url = "http://localhost:11434"

    def __init__(self) -> None:
        self.ensured = 0

    async def ensure_running(self) -> bool:
        self.ensured += 1
        return True


class FakeLocal:
    """What the manager asks of the local servers: a server, the probe and the settings."""

    def __init__(self, slots: int | None = None, parallel: int = 3) -> None:
        self.settings = OllamaSettings(parallel=parallel)
        self.server = FakeServer()
        self.gets = 0
        self.probes: list[tuple[str, str]] = []
        self._slots = slots

    def get(self, provider: str, base_url: str) -> FakeServer:
        del provider, base_url
        self.gets += 1
        return self.server

    async def probe(self, base_url: str, model: str) -> SimpleNamespace | None:
        self.probes.append((base_url, model))
        return None if self._slots is None else SimpleNamespace(slots=self._slots)


def _router(*models: str) -> ModelRouter:
    return ModelRouter(
        GolemSettings(
            providers={
                "ollama": ProviderSettings(kind="ollama"),
                "anthropic": ProviderSettings(kind="anthropic"),
            },
            models={ref.partition("/")[2]: ModelSettings(model=ref) for ref in models},
            default_model=None,
        )
    )


def _row(shape: Shape, at_once: int) -> Row:
    return Row(shape, at_once, tuple(Sample(100, 2.0) for _ in range(at_once)), 2.0)


class FakeRun:
    """A fake engine. It ends the rows it is given, or raises after them, and can wait first."""

    def __init__(self, rows: list[Row], fail: Exception | None = None) -> None:
        self.rows = rows
        self.fail = fail
        self.limits: list[int] = []
        self.gate: asyncio.Event | None = None
        self.running = asyncio.Event()

    async def __call__(
        self,
        router: ModelRouter,
        local: LocalServers,
        model: str | None = None,
        *,
        limit: int = 1,
        on_row: OnRow | None = None,
    ) -> Result:
        del local
        self.limits.append(limit)
        self.running.set()
        if self.gate is not None:
            await self.gate.wait()
        for index, row in enumerate(self.rows, start=1):
            if on_row is not None:
                on_row(index, len(self.rows), row)
        if self.fail is not None:
            raise self.fail
        assert model is not None
        return Result(router.resolve(model).ref, tuple(self.rows))


def _manager(
    router: ModelRouter, local: FakeLocal, run: FakeRun, sent: list[BaseModel]
) -> BenchManager:
    return BenchManager(router, cast("LocalServers", local), broadcast=sent.append, run=run)


def _notes(sent: list[BaseModel]) -> list[dict[str, Any]]:
    return [json.loads(item.model_dump_json()) for item in sent]


async def test_local_only_replies_started_then_sends_the_rows_in_order() -> None:
    rows = [_row("tools", 1), _row("tools", 2), _row("prompt", 1)]
    sent: list[BaseModel] = []
    manager = _manager(_router(LOCAL), FakeLocal(), FakeRun(rows), sent)
    assert manager.start(LOCAL) == (LOCAL, True)
    await manager.wait(LOCAL)
    notes = _notes(sent)
    assert [note["method"] for note in notes] == [
        "model.bench.progress",
        "model.bench.progress",
        "model.bench.progress",
        "model.bench.done",
    ]
    progress = [note["params"] for note in notes[:3]]
    assert [(p["index"], p["total"]) for p in progress] == [(1, 3), (2, 3), (3, 3)]
    assert [(p["row"]["shape"], p["row"]["at_once"]) for p in progress] == [
        ("tools", 1),
        ("tools", 2),
        ("prompt", 1),
    ]
    done = notes[3]["params"]
    assert done["ok"] is True and done["error"] is None and done["ref"] == LOCAL
    assert done["rows"] == [p["row"] for p in progress]
    assert done["rows"][1]["each"] == [50.0, 50.0] and done["rows"][1]["total"] == 100.0
    assert manager.benching() == []


async def test_a_model_that_is_being_measured_replies_not_started() -> None:
    run = FakeRun([_row("tools", 1)])
    run.gate = asyncio.Event()
    manager = _manager(_router(LOCAL), FakeLocal(), run, [])
    assert manager.start(LOCAL) == (LOCAL, True)
    await run.running.wait()
    assert manager.start(LOCAL) == (LOCAL, False)
    run.gate.set()
    await manager.wait(LOCAL)
    assert run.limits == [3]


async def test_a_run_that_fails_ends_with_ok_false_and_the_next_call_starts_a_new_run() -> None:
    run = FakeRun([_row("tools", 1)], fail=RuntimeError("the model fell over"))
    sent: list[BaseModel] = []
    manager = _manager(_router(LOCAL), FakeLocal(), run, sent)
    manager.start(LOCAL)
    await manager.wait(LOCAL)
    done = _notes(sent)[-1]
    assert done["method"] == "model.bench.done"
    assert done["params"]["ok"] is False
    assert "the model fell over" in done["params"]["error"]
    assert len(done["params"]["rows"]) == 1  # the row that finished before the failure
    run.fail = None
    sent.clear()
    assert manager.start(LOCAL) == (LOCAL, True)
    await manager.wait(LOCAL)
    assert _notes(sent)[-1]["params"]["ok"] is True
    assert len(run.limits) == 2


async def test_a_hosted_ref_is_an_error_in_a_cloud_only_and_in_a_mixed_setup() -> None:
    local = FakeLocal(slots=1)
    run = FakeRun([])
    sent: list[BaseModel] = []
    # Cloud only has no local model. The mixed setup has one, but not the one asked for.
    for router in (_router(HOSTED), _router(HOSTED, LOCAL)):
        manager = _manager(router, local, run, sent)
        with pytest.raises(NoLocalModel) as error:
            manager.start(HOSTED)
        assert "not a local model" in str(error.value)
    assert (local.gets, local.probes, run.limits, sent) == (0, [], [], [])


async def test_the_handler_gives_an_rpc_error_for_a_refusal_and_a_result_for_a_start() -> None:
    manager = _manager(_router(HOSTED), FakeLocal(), FakeRun([]), [])
    ctx = cast("RequestContext", SimpleNamespace(state=SimpleNamespace(benches=manager)))
    with pytest.raises(RpcCallError) as error:
        await _model_bench(ctx, ModelBenchParams(ref=HOSTED))
    assert error.value.code == MODEL_NOT_CONFIGURED
    assert "not a local model" in str(error.value)
    manager = _manager(_router(LOCAL), FakeLocal(), FakeRun([]), [])
    ctx = cast("RequestContext", SimpleNamespace(state=SimpleNamespace(benches=manager)))
    result = await _model_bench(ctx, ModelBenchParams(ref=LOCAL))
    assert (result.ref, result.started) == (LOCAL, True)
    await manager.wait(LOCAL)


async def test_an_engine_golem_cannot_measure_is_refused() -> None:
    manager = _manager(_router(LOCAL), FakeLocal(), FakeRun([]), [])
    with pytest.raises(NoLocalModel):
        manager.start(LOCAL, "llama.cpp")


@pytest.mark.parametrize(("slots", "limit"), [(1, 1), (None, 3)])
async def test_the_limit_comes_from_the_probe_or_the_parallel_setting(
    slots: int | None, limit: int
) -> None:
    local = FakeLocal(slots=slots, parallel=3)
    run = FakeRun([])
    manager = _manager(_router(LOCAL), local, run, [])
    manager.start(LOCAL)
    await manager.wait(LOCAL)
    assert run.limits == [limit]
    assert local.probes == [("http://127.0.0.1:11434", "qwen3:8b")]
    assert local.server.ensured == 1
