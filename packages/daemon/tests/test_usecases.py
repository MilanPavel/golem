"""The four use cases of the sub-agents design, scripted, in both setups (ticket 15.11.1).

No model, no network, no shell sandbox: scripted replies and a fake check runner. A condition that
is broken on purpose must fail, and ``--live`` never starts on its own.
"""

from __future__ import annotations

import json
import tomllib
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from golem.config import AgentSettings
from golem.evals import usecases
from golem.evals.usecases import CASES, SETUPS, run_scripted


@pytest.mark.parametrize("setup", SETUPS)
@pytest.mark.parametrize("case", CASES)
async def test_a_scripted_case_passes(case: str, setup: usecases.SetupName, tmp_path: Path) -> None:
    out = await run_scripted(case, setup, tmp_path)

    assert out.error is None, out.error
    assert [(c.name, c.detail) for c in out.conditions if c.ok is False] == []
    assert out.passed and len(out.conditions) >= 6


async def test_a_condition_broken_on_purpose_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The sweep promises at most two at once. Let four run, and the condition must catch it.
    sweep = usecases.SCENARIOS["sweep"]
    loose = replace(sweep, agents=AgentSettings(at_once=4, max_per_batch=usecases.SWEEP_JOBS))
    monkeypatch.setitem(usecases.SCENARIOS, "sweep", loose)

    out = await run_scripted("sweep", "local-only", tmp_path)

    assert out.error is None and not out.passed
    failed = [c.name for c in out.conditions if c.ok is False]
    assert failed == [f"never more than {usecases.AT_ONCE} running at once"]


def test_a_local_only_trace_with_a_paid_model_fails() -> None:
    events = [{"type": "session.created", "data": {"model_provider": "anthropic"}}]
    trace = usecases.Trace(events, Path("."))

    verdicts = {c.name: c.ok for c in usecases.setup_conditions(trace, "local-only")}

    assert verdicts["nothing left the Mac: every model is local"] is False


def test_a_cloud_only_trace_with_a_local_question_fails() -> None:
    events: list[dict[str, Any]] = [
        {"type": "session.created", "data": {"model_provider": "anthropic"}},
        {"type": "route.consent.needed", "data": {}},
    ]
    trace = usecases.Trace(events, Path("."))

    verdicts = {c.name: c.ok for c in usecases.setup_conditions(trace, "cloud-only")}

    assert verdicts["no local screen or question was raised"] is False


async def test_the_report_holds_json_and_a_short_summary(tmp_path: Path) -> None:
    outcomes = await usecases.run_all(["sweep"], ["local-only"], scratch=tmp_path / "work")

    usecases.write_report(outcomes, tmp_path / "out")

    rows = json.loads((tmp_path / "out" / "usecases.json").read_text(encoding="utf-8"))
    assert rows[0]["case"] == "sweep"
    assert rows[0]["passed"] is True, rows[0]["conditions"]
    assert rows[0]["mode"] == "scripted"
    assert {"name", "result", "detail"} <= set(rows[0]["conditions"][0])
    text = (tmp_path / "out" / "usecases.md").read_text(encoding="utf-8")
    assert "| sweep | local-only | scripted | pass |" in text


def test_live_never_starts_by_itself(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    async def live(*args: object, **kwargs: object) -> usecases.Outcome:
        raise AssertionError("a live run started")

    monkeypatch.setattr(usecases, "run_live", live)
    lines: list[str] = []

    code = usecases.main(["--case", "sweep", "--out", str(tmp_path)], out=lines.append)

    assert code == 0
    assert not any("--live plays" in line for line in lines)


def test_live_prints_its_cost_note_and_needs_a_named_model() -> None:
    lines: list[str] = []

    with pytest.raises(SystemExit):
        usecases.main(["--live", "--setup", "local-only"], out=lines.append)

    assert any("--live plays" in line for line in lines)
    assert usecases.configured_model("local-only", "qwen3.5:9b", None) == "ollama/qwen3.5:9b"
    assert usecases.configured_model("cloud-only", None, "anthropic/x") == "anthropic/x"
    agents = usecases.SCENARIOS["sweep"].agents
    config = usecases.live_config("local-only", "ollama/qwen3.5:9b", agents)
    assert "parallel = 1" in config and 'model = "same"' in config
    assert "start = false" in config


async def test_live_local_only_stops_when_ollama_does_not_answer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(usecases, "ollama_answers", lambda: False)

    with pytest.raises(SystemExit, match="--live local-only needs Ollama running"):
        await usecases.run_live("sweep", "local-only", "ollama/x", tmp_path)


@pytest.mark.parametrize("case", CASES)
@pytest.mark.parametrize("setup", SETUPS)
def test_live_config_is_valid_toml(case: str, setup: Any) -> None:
    """Every case writes a config the daemon can read: an unset limit is left out."""
    config = usecases.live_config(setup, "ollama/qwen3.5:9b", usecases.SCENARIOS[case].agents)
    parsed = tomllib.loads(config)
    assert parsed["agents"]["at_once"] >= 1


def test_every_case_has_a_helper_hint() -> None:
    """``--ask-helpers`` adds each case's hint to the request, so every case needs one."""
    assert all(usecases.SCENARIOS[case].hint for case in CASES)


def test_a_profile_name_counts_as_its_model() -> None:
    """A helper on the lead's model (``same``) names the profile; the check reads its model."""
    event = {"type": "helper.started", "data": {"helper_id": "h", "model": "t"}}
    trace = usecases.Trace([event], Path("."), profiles={"t": "ollama/qwen3.5:9b"})
    assert usecases.models_used(trace) == {"ollama"}


def test_cloud_key_env_takes_the_lead_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    """The cloud setup hands the lead's key to the daemon; it has no other models."""
    from types import SimpleNamespace

    from golem.evals.helpers import key_env

    arm: Any = SimpleNamespace(lead="anthropic/x", others=())
    assert key_env(arm, lambda provider: "k") == {"ANTHROPIC_API_KEY": "k"}


def test_cloud_helpers_stay_on_the_lead_model() -> None:
    """A running Ollama is visible to the cloud daemon; pinned helpers never pick it."""
    config = usecases.live_config("cloud-only", "anthropic/x", usecases.SCENARIOS["sweep"].agents)
    parsed = tomllib.loads(config)
    assert parsed["ollama"]["start"] is False
    assert {parsed["agents"][n]["model"] for n in ("explorer", "worker", "advisor")} == {"same"}
