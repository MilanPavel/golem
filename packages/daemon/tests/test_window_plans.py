"""The planned window of a local model: settings, facts, a lowered window, and the memo."""

from __future__ import annotations

import json
from pathlib import Path

from golem.config import ContextSettings
from golem.models.window_plan import plan_window
from golem.models.window_plans import WindowPlans


class _Facts:
    def __init__(self, facts: dict[str, tuple[int | None, float | None]]) -> None:
        self.facts = facts

    def ollama_facts(self, model_id: str) -> tuple[int | None, float | None]:
        return self.facts.get(model_id, (None, None))


MODEL = "qwen3:8b"
FACTS: dict[str, tuple[int | None, float | None]] = {MODEL: (40960, 5.2)}


def _plans(
    settings: ContextSettings | None = None,
    facts: dict[str, tuple[int | None, float | None]] | None = None,
    cache: Path | None = None,
    ram_gb: float | None = 16.0,
) -> WindowPlans:
    held = settings or ContextSettings()
    return WindowPlans(
        settings=lambda: held,
        discovery=_Facts(FACTS if facts is None else facts),
        ram_gb=ram_gb,
        cache_dir=cache,
    )


def test_auto_plans_from_what_discovery_knows() -> None:
    expected = plan_window(model_max=40960, size_gb=5.2, ram_gb=16.0)
    assert expected is not None
    assert _plans().planned(MODEL) == expected


def test_ollama_means_golem_sends_nothing() -> None:
    assert _plans(ContextSettings(window="ollama")).planned(MODEL) is None


def test_a_number_is_used_and_capped_at_the_model_maximum() -> None:
    assert _plans(ContextSettings(window=16384)).planned(MODEL) == 16384
    assert _plans(ContextSettings(window=131072)).planned(MODEL) == 40960
    assert _plans(ContextSettings(window=4096), facts={}).planned(MODEL) == 4096


def test_an_unknown_model_or_unknown_memory_has_no_plan() -> None:
    assert _plans().planned("other:1b") is None
    assert _plans(ram_gb=None).planned(MODEL) is None


def test_lower_steps_down_persists_and_survives_a_new_instance(tmp_path: Path) -> None:
    plans = _plans(cache=tmp_path)
    first = plans.planned(MODEL)
    assert first is not None
    second = plans.lower(MODEL)
    assert second is not None and second < first
    assert plans.planned(MODEL) == second
    saved = json.loads((tmp_path / "windows.json").read_text())
    assert saved == {MODEL: {"lowered_to": second}}
    assert _plans(cache=tmp_path).planned(MODEL) == second


def test_a_window_set_as_a_number_is_never_lowered(tmp_path: Path) -> None:
    plans = _plans(ContextSettings(window=32768), cache=tmp_path)
    before = plans.planned(MODEL)
    assert plans.lower(MODEL) is None
    assert plans.planned(MODEL) == before
    assert not (tmp_path / "windows.json").exists()


def test_lower_at_the_smallest_step_or_with_no_plan_does_nothing(tmp_path: Path) -> None:
    assert _plans(cache=tmp_path).lower("other:1b") is None
    assert _plans(ContextSettings(window=8192), cache=tmp_path).lower(MODEL) is None
    assert not (tmp_path / "windows.json").exists()


def test_raised_becomes_the_plan(tmp_path: Path) -> None:
    plans = _plans(cache=tmp_path)
    plans.raised(MODEL, 32768)
    assert plans.planned(MODEL) == 32768
    assert _plans(cache=tmp_path).planned(MODEL) == 32768


def test_a_broken_file_is_ignored(tmp_path: Path) -> None:
    (tmp_path / "windows.json").write_text("{not json")
    assert _plans(cache=tmp_path).planned(MODEL) == _plans().planned(MODEL)
    (tmp_path / "windows.json").write_text(json.dumps({MODEL: {"lowered_to": "big"}, "x": 3}))
    assert _plans(cache=tmp_path).planned(MODEL) == _plans().planned(MODEL)


def test_the_plan_is_the_same_number_on_every_call() -> None:
    plans = _plans()
    assert len({plans.planned(MODEL) for _ in range(5)}) == 1


def test_the_plan_follows_the_settings() -> None:
    held = {"now": ContextSettings(window=16384)}
    plans = WindowPlans(
        settings=lambda: held["now"], discovery=_Facts(FACTS), ram_gb=16.0, cache_dir=None
    )
    assert plans.planned(MODEL) == 16384
    held["now"] = ContextSettings(window=8192)
    assert plans.planned(MODEL) == 8192
    held["now"] = ContextSettings(window="ollama")
    assert plans.planned(MODEL) is None
