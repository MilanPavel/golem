"""How many calls a local model runs at once: the resolver, the plan it reads, and the config."""

from __future__ import annotations

import pytest

from golem.config import ContextSettings, OllamaSettings
from golem.models import at_once as at_once_module
from golem.models import hardware
from golem.models.at_once import AUTO_MAX, resolve
from golem.models.engine import OLLAMA
from golem.models.hardware import fit, kv_gb
from golem.models.window_plans import WindowPlans

MODEL = "qwen3:14b"


class _Facts:
    def __init__(self, facts: tuple[int | None, float | None]) -> None:
        self.facts = facts

    def ollama_facts(self, model_id: str) -> tuple[int | None, float | None]:
        return self.facts


def _plans(
    ram_gb: float | None,
    size_gb: float | None,
    parallel: int | str = "auto",
    context: ContextSettings | None = None,
) -> WindowPlans:
    held = context or ContextSettings()
    return WindowPlans(
        settings=lambda: held,
        discovery=_Facts((131072, size_gb)),
        ram_gb=ram_gb,
        cache_dir=None,
        parallel=lambda: parallel,  # pyright: ignore[reportArgumentType]
    )


def test_auto_loads_from_config_but_one_is_the_default() -> None:
    assert OllamaSettings().parallel == 1
    assert OllamaSettings.model_validate({"parallel": "auto"}).parallel == "auto"
    assert OllamaSettings.model_validate({"parallel": 3}).parallel == 3
    assert OllamaSettings().fixed_parallel == 1
    assert OllamaSettings(parallel="auto").fixed_parallel == 1
    assert OllamaSettings(parallel=3).fixed_parallel == 3


@pytest.mark.parametrize("value", [0, 9, "most"])
def test_a_bad_parallel_is_refused(value: object) -> None:
    with pytest.raises(ValueError):
        OllamaSettings.model_validate({"parallel": value})


# Model max 131072, KV 0.06 GB per 1K tokens. The window is the plan for one slot.
@pytest.mark.parametrize(
    ("ram", "size", "window", "slots"),
    [
        (32.0, 9.3, 65536, 1),  # 9.3 + 3.84 * 2 + 1 = 18.0 > 16
        (32.0, 17.0, 32768, 1),  # 17 + 1.92 + 1 = 19.9 > 16
        (64.0, 9.3, 65536, 4),  # 9.3 + 3.84 * 4 + 1 = 25.7 <= 32
        (64.0, 17.0, 65536, 3),  # 17 + 3.84 * 3 + 1 = 29.5 <= 32; four give 33.4
    ],
)
def test_auto_is_the_most_slots_that_fit_with_the_planned_window(
    ram: float, size: float, window: int, slots: int
) -> None:
    plans = _plans(ram, size)
    got = plans.at_once(MODEL)
    assert plans.planned(MODEL) == window
    assert (got.slots, got.window) == (slots, window)  # slots never shrink the window
    assert got.memory_gb == kv_gb(window)
    assert fit(size, ram, window, got.slots) == "fits" or got.slots == 1
    if 1 < got.slots < AUTO_MAX:
        assert fit(size, ram, window, got.slots + 1) != "fits"


# The same rule with 0.16 GB per 1K tokens, the figure for a 14B model with grouped-query
# attention: 4 would be too many on a 64 GB Mac.
@pytest.mark.parametrize(
    ("ram", "size", "window", "slots"),
    [
        (32.0, 9.3, 32768, 1),
        (32.0, 17.0, 32768, 1),
        (64.0, 9.3, 65536, 2),  # 9.3 + 10.24 * 2 + 1 = 30.8 <= 32
        (64.0, 17.0, 65536, 1),
    ],
)
def test_the_kv_constant_changes_the_count(
    monkeypatch: pytest.MonkeyPatch, ram: float, size: float, window: int, slots: int
) -> None:
    monkeypatch.setattr(hardware, "KV_GB_PER_1K_TOKENS", 0.16)
    got = _plans(ram, size).at_once(MODEL)
    assert (got.slots, got.window) == (slots, window)


def test_a_number_is_used_as_it_is_up_to_the_engine_maximum(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(at_once_module, "fit", _boom)
    # 32 GB and a 17 GB model fit one slot at most, but a number does not ask fit
    assert _plans(32.0, 17.0, parallel=3).at_once(MODEL).slots == 3
    assert _plans(32.0, 17.0, parallel=1).at_once(MODEL).slots == 1
    assert _plans(32.0, 17.0, parallel=OLLAMA.max_slots).at_once(MODEL).slots == 8
    assert resolve(8, window=32768, size_gb=1.0, ram_gb=64.0, max_slots=2).slots == 2


def test_auto_stops_at_four_and_at_the_engine_maximum() -> None:
    assert resolve("auto", window=8192, size_gb=1.0, ram_gb=512.0, max_slots=8).slots == AUTO_MAX
    assert resolve("auto", window=8192, size_gb=1.0, ram_gb=512.0, max_slots=2).slots == 2


def test_a_measurement_picks_the_best_total_speed_among_the_counts_that_fit() -> None:
    # 64 GB, 17 GB model, window 65536 (0.06): 1, 2 and 3 fit, 4 does not
    got = resolve(
        "auto",
        window=65536,
        size_gb=17.0,
        ram_gb=64.0,
        max_slots=8,
        measured={1: 20.0, 2: 31.0, 3: 28.0, 4: 90.0},
    )
    assert (got.slots, got.reason) == (2, "measured")
    unmeasured = resolve("auto", window=65536, size_gb=17.0, ram_gb=64.0, max_slots=8)
    assert unmeasured.slots == 3


def test_only_the_planned_window_gives_more_than_one_slot() -> None:
    for context in (ContextSettings(window=16384), ContextSettings(window="ollama")):
        assert _plans(64.0, 9.3, context=context).at_once(MODEL).slots == 1
    plans = _plans(64.0, 9.3)
    plans.raised(MODEL, 65536)
    assert plans.at_once(MODEL).slots == 1


def test_planned_still_plans_one_slot() -> None:
    plans = _plans(64.0, 9.3)
    assert plans.planned(MODEL) == 65536
    assert plans.at_once(MODEL).slots == 4
    assert plans.planned(MODEL) == 65536


def _boom(*_: object, **__: object) -> str:
    raise AssertionError("fit was called")


def test_no_local_model_means_no_call_to_fit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(at_once_module, "fit", _boom)
    monkeypatch.setattr(hardware, "fit", _boom)
    # nothing is known about the model, so nothing is planned and fit is never asked
    for ram, size in ((None, None), (32.0, None), (None, 9.3)):
        got = _plans(ram, size).at_once(MODEL)
        assert (got.slots, got.window, got.memory_gb) == (1, None, None)
