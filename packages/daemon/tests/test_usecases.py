"""The four use cases of the sub-agents design, scripted, in both setups (ticket 15.11.1).

No model, no network, no shell sandbox: scripted replies and a fake check runner. A condition that
is broken on purpose must fail, and ``--live`` never starts on its own.
"""

from __future__ import annotations

import json
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
    assert rows[0]["case"] == "sweep" and rows[0]["passed"] is True
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
