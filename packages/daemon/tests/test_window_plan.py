from __future__ import annotations

import pytest

from golem.models.window_plan import (
    CEILING,
    next_step,
    plan_window,
    should_grow,
    spilled,
    step_down,
)


@pytest.mark.parametrize(
    ("size", "ram", "expected"),
    [(2, 8, 32768), (5, 16, 32768), (5, 36, 65536), (17, 36, 32768), (20, 24, None)],
)
def test_the_worked_examples(size: float, ram: float, expected: int | None) -> None:
    assert plan_window(model_max=None, size_gb=size, ram_gb=ram) == expected


def test_model_max_caps_the_plan() -> None:
    assert plan_window(model_max=8192, size_gb=5, ram_gb=36) == 8192
    assert plan_window(model_max=40000, size_gb=5, ram_gb=36) == 32768


def test_no_model_max_is_the_ceiling() -> None:
    assert plan_window(model_max=None, size_gb=1, ram_gb=128) == CEILING


def test_lowered_to_caps_plan_and_next_step() -> None:
    assert plan_window(model_max=None, size_gb=5, ram_gb=36, lowered_to=16384) == 16384
    assert next_step(16384, model_max=None, size_gb=5, ram_gb=36, lowered_to=16384) is None
    assert next_step(8192, model_max=None, size_gb=5, ram_gb=36, lowered_to=16384) == 16384


def test_unknown_size_or_ram_gives_none() -> None:
    assert plan_window(model_max=None, size_gb=None, ram_gb=16) is None
    assert plan_window(model_max=None, size_gb=5, ram_gb=None) is None
    assert next_step(8192, model_max=None, size_gb=None, ram_gb=16) is None


def test_next_step() -> None:
    assert next_step(32768, model_max=None, size_gb=5, ram_gb=36) == 65536
    assert next_step(65536, model_max=131072, size_gb=5, ram_gb=36) == 131072
    assert next_step(65536, model_max=65536, size_gb=5, ram_gb=36) is None
    assert next_step(32768, model_max=None, size_gb=20, ram_gb=24) is None
    assert next_step(20000, model_max=None, size_gb=5, ram_gb=36) == 32768
    assert next_step(131072, model_max=None, size_gb=1, ram_gb=128) is None


def test_step_down() -> None:
    assert step_down(65536) == 32768
    assert step_down(8192) is None
    assert step_down(20000) == 16384


def test_spilled() -> None:
    assert spilled(1000, 1000) is False
    assert spilled(1000, 900) is True
    assert spilled(None, 900) is False
    assert spilled(1000, None) is False


@pytest.mark.parametrize("ram", [8, 16, 24, 36, 64, 128])
@pytest.mark.parametrize("model_max", [None, 8192, 40000, 131072])
def test_the_plan_respects_the_limits(ram: float, model_max: int | None) -> None:
    for size in range(1, 41):
        plan = plan_window(model_max=model_max, size_gb=float(size), ram_gb=ram)
        if plan is not None:
            assert plan <= CEILING
            assert plan <= (model_max or CEILING)


def _grow(**changes: int) -> bool:
    found = {
        "used": 25000,
        "window": 32768,
        "reserve": 4096,
        "clears_this_session": 2,
        "summaries_this_session": 0,
    }
    found.update(changes)
    return should_grow(**found)


def test_should_grow_when_full_after_two_clears_or_one_summary() -> None:
    assert _grow() is True
    assert _grow(clears_this_session=0, summaries_this_session=1) is True


def test_should_not_grow_with_the_cheap_means_unused() -> None:
    assert _grow(clears_this_session=1, summaries_this_session=0) is False
    assert _grow(clears_this_session=0, summaries_this_session=0) is False


def test_should_not_grow_below_four_fifths_of_the_room() -> None:
    assert _grow(window=24576, used=16384) is True
    assert _grow(window=24576, used=16383) is False


def test_should_not_grow_with_no_room() -> None:
    assert _grow(window=4096) is False
