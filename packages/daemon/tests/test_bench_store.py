"""The benchmark result store: its key, its file, and that `auto` reads it."""

from __future__ import annotations

import json
from pathlib import Path

from golem.config import ContextSettings
from golem.models.bench import Result, Row, Sample
from golem.models.bench_store import FILE, BenchStore
from golem.models.window_plans import WindowPlans

MODEL = "qwen3:8b"


def _row(at_once: int, total: float, shape: str = "tools") -> Row:
    # One call of `total` tokens in one second is `total` tokens a second.
    calls = tuple(Sample(round(total / at_once), 1.0) for _ in range(at_once))
    return Row(shape, at_once, calls, 1.0)  # pyright: ignore[reportArgumentType]


def _result(totals: dict[int, float], model: str = MODEL) -> Result:
    return Result(model, tuple(_row(k, v) for k, v in totals.items()))


def test_a_saved_table_is_read_back_by_a_new_store(tmp_path: Path) -> None:
    BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.9").save(
        _result({1: 20.0, 2: 36.0, 3: 30.0})
    )
    again = BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.9")
    assert again.measured(MODEL) == {1: 20.0, 2: 36.0, 3: 30.0}
    assert not list(tmp_path.glob("*.tmp"))


def test_the_key_is_engine_model_memory_and_version(tmp_path: Path) -> None:
    BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.9").save(_result({1: 20.0, 2: 36.0}))
    assert BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.9").measured("other:1b") is None
    assert BenchStore(tmp_path, ram_gb=16.0, version=lambda: "0.9").measured(MODEL) is None
    assert BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.10").measured(MODEL) is None
    assert (
        BenchStore(tmp_path, ram_gb=32.0, version=lambda: "0.9", engine="vllm").measured(MODEL)
        is None
    )


def test_a_new_run_replaces_the_old_table_and_keeps_other_models(tmp_path: Path) -> None:
    store = BenchStore(tmp_path, ram_gb=32.0)
    store.save(_result({1: 20.0, 2: 30.0}))
    store.save(_result({1: 5.0}, model="other:1b"))
    store.save(_result({1: 22.0, 2: 24.0}))
    again = BenchStore(tmp_path, ram_gb=32.0)
    assert again.measured(MODEL) == {1: 22.0, 2: 24.0}
    assert again.measured("other:1b") == {1: 5.0}


def test_the_total_at_a_count_is_the_mean_of_the_shapes(tmp_path: Path) -> None:
    store = BenchStore(tmp_path, ram_gb=None)
    store.save(Result(MODEL, (_row(1, 10.0, "tools"), _row(1, 30.0, "prompt"))))
    assert store.measured(MODEL) == {1: 20.0}


def test_a_missing_unreadable_or_old_file_is_no_measurement(tmp_path: Path) -> None:
    assert BenchStore(tmp_path, ram_gb=32.0).measured(MODEL) is None
    for text in ("", "{not json", "[]", '{"format": 0, "entries": []}', '{"format": 1}'):
        (tmp_path / FILE).write_text(text)
        assert BenchStore(tmp_path, ram_gb=32.0).measured(MODEL) is None
    bad = {"format": 1, "entries": [{"engine": "ollama"}, 3, {"engine": "ollama", "model": MODEL}]}
    (tmp_path / FILE).write_text(json.dumps(bad))
    assert BenchStore(tmp_path, ram_gb=32.0).measured(MODEL) is None


def test_an_unwritable_cache_does_not_raise(tmp_path: Path) -> None:
    blocked = tmp_path / "cache"
    blocked.write_text("a file, not a directory")
    store = BenchStore(blocked, ram_gb=32.0)
    store.save(_result({1: 20.0}))
    assert store.measured(MODEL) == {1: 20.0}


def test_no_cache_dir_keeps_the_table_in_memory_only() -> None:
    store = BenchStore(None, ram_gb=32.0)
    assert store.measured(MODEL) is None
    store.save(_result({1: 20.0}))
    assert store.measured(MODEL) == {1: 20.0}


class _Facts:
    def ollama_facts(self, model_id: str) -> tuple[int | None, float | None]:
        return 40960, 5.2


def _plans(store: BenchStore) -> WindowPlans:
    return WindowPlans(
        settings=lambda: ContextSettings(),
        discovery=_Facts(),
        ram_gb=64.0,
        cache_dir=None,
        parallel=lambda: "auto",
        measured=store.measured,
    )


def test_a_stored_table_changes_auto_and_no_table_keeps_the_fit_rule(tmp_path: Path) -> None:
    store = BenchStore(tmp_path, ram_gb=64.0)
    plans = _plans(store)
    fit = plans.at_once(MODEL)
    assert fit.reason == "fit"
    assert fit.slots > 2
    store.save(_result({1: 20.0, 2: 40.0, 3: 35.0, 4: 30.0}))
    got = plans.at_once(MODEL)
    assert (got.slots, got.reason) == (2, "measured")


def test_a_number_for_parallel_ignores_the_table(tmp_path: Path) -> None:
    store = BenchStore(tmp_path, ram_gb=64.0)
    store.save(_result({1: 20.0, 2: 40.0}))
    plans = WindowPlans(
        settings=lambda: ContextSettings(),
        discovery=_Facts(),
        ram_gb=64.0,
        cache_dir=None,
        parallel=lambda: 1,
        measured=store.measured,
    )
    assert plans.at_once(MODEL).slots == 1


def test_cloud_only_stores_and_reads_nothing(tmp_path: Path) -> None:
    # With no local model nothing plans a window, so nothing asks the store, and a run
    # that measured nothing saves nothing.
    store = BenchStore(tmp_path / "cache", ram_gb=64.0)
    store.save(Result("claude-sonnet", ()))
    assert not (tmp_path / "cache").exists()
    asked: list[str] = []

    def measured(model: str) -> None:
        asked.append(model)

    plans = WindowPlans(
        settings=lambda: ContextSettings(),
        discovery=None,
        ram_gb=64.0,
        cache_dir=None,
        measured=measured,
    )
    assert plans.at_once("claude-sonnet").slots == 1
    assert asked == []
    assert not (tmp_path / "cache" / FILE).exists()


def test_a_run_saved_under_its_model_id_is_read_by_that_id(tmp_path: Path) -> None:
    # A result names its model by ref; the window plan asks by model id.
    store = BenchStore(tmp_path, ram_gb=32.0)
    store.save(Result("ollama/qwen3:8b", (_row(1, 20.0), _row(2, 36.0))), model_id="qwen3:8b")
    assert store.measured("qwen3:8b") == {1: 20.0, 2: 36.0}
    assert store.measured("ollama/qwen3:8b") is None
