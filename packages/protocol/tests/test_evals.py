"""``evals.*`` and ``eval.*``: the measurement of the helper rules (step 15.14)."""

from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from golem_protocol.commands import (
    AgentsDelegateNumber,
    AgentsDelegateValues,
    AgentsKeepParams,
    AgentsKeepValues,
    EvalArmUsed,
    EvalEnded,
    EvalMeasurement,
    EvalModelChoice,
    EvalNumber,
    EvalPlanArm,
    EvalProgress,
    EvalProposal,
    EvalRun,
    EvalsApplyParams,
    EvalsApplyResult,
    EvalsDeleteParams,
    EvalsDeleteResult,
    EvalsGetParams,
    EvalsGetResult,
    EvalsListParams,
    EvalsListResult,
    EvalsPlanParams,
    EvalsPlanResult,
    EvalsResumeParams,
    EvalsResumeResult,
    EvalsStartParams,
    EvalsStartResult,
    EvalsStopParams,
    EvalsStopResult,
    EvalStarted,
    EvalSummary,
)
from golem_protocol.methods import BROWSER_METHODS, DEVICE_METHODS, METHOD_ACCESS
from golem_protocol.rpc import (
    EvalEndedNotification,
    EvalProgressNotification,
    EvalStartedNotification,
)


def _round_trips(model: BaseModel) -> None:
    assert type(model).model_validate_json(model.model_dump_json()) == model


def _local(**more: Any) -> EvalPlanArm:
    fields: dict[str, Any] = {
        "name": "local-32k",
        "label": "Local, 32K window",
        "kind": "local",
        "tier": "local",
        "window": 32768,
        "model": "ollama/qwen3.8:27b",
        "choices": [EvalModelChoice(ref="ollama/qwen3.8:27b", size_gb=18.2)],
        "needed_gb": 21.1,
        "ram_gb": 36,
        "free_gb": 24.3,
        "verdict": "tight",
        "reason": "It fits, but it takes more than half of the memory.",
        "asks": 10,
        "minutes": 35,
    }
    return EvalPlanArm.model_validate({**fields, **more})


def _cloud(**more: Any) -> EvalPlanArm:
    fields: dict[str, Any] = {
        "name": "budget-cloud",
        "label": "Budget cloud",
        "kind": "cloud",
        "tier": "budget",
        "window": 200000,
        "model": "claude-haiku-5-5",
        "cost_usd": 0.4,
        "asks": 10,
    }
    return EvalPlanArm.model_validate({**fields, **more})


def _numbers(measured: bool = True) -> list[EvalNumber]:
    return [
        EvalNumber(
            key="read_share",
            current=0.3,
            proposed=0.42 if measured else None,
            measured=measured,
            note="smallest reading where a helper won",
        ),
        EvalNumber(key="fill_share", current=0.85, proposed=0.8, measured=True),
        EvalNumber(key="job_share", current=0.1, measured=False, note="not measured"),
        EvalNumber(key="price_ratio", current=3, measured=False, note="not measured"),
    ]


def _measurement(**more: Any) -> EvalMeasurement:
    fields: dict[str, Any] = {
        "id": "7f3a",
        "started_at": "2026-11-23T14:02:00Z",
        "ended_at": "2026-11-23T14:36:10Z",
        "state": "done",
        "arms": [EvalArmUsed(name="local-32k", model="ollama/qwen3.8:27b")],
        "runs": [
            EvalRun(
                arm="local-32k",
                ask="read-many-files",
                mode="off",
                end="completed",
                quality=0.5,
                seconds=262,
                window_left=0.2,
                helpers_started=0,
            ),
            EvalRun(
                arm="local-32k",
                ask="read-many-files",
                mode="on",
                end="completed",
                quality=0.9,
                seconds=191,
                window_left=0.7,
                helpers_started=3,
            ),
        ],
        "proposal": EvalProposal(numbers=_numbers(), pairs=1, wins=1),
    }
    return EvalMeasurement.model_validate({**fields, **more})


def test_the_eight_methods_are_for_a_browser_and_not_a_phone() -> None:
    for name in ("plan", "start", "stop", "resume", "list", "get", "apply", "delete"):
        assert METHOD_ACCESS[f"evals.{name}"] == "browser"
        assert f"evals.{name}" in BROWSER_METHODS
        assert f"evals.{name}" not in DEVICE_METHODS


def test_plan_arms_round_trip_for_a_local_and_a_cloud_arm() -> None:
    _round_trips(_local())
    _round_trips(_cloud())
    unread = _local(needed_gb=None, ram_gb=None, free_gb=None, verdict="unknown")
    assert unread.verdict == "unknown"
    _round_trips(EvalsPlanParams())
    _round_trips(EvalsPlanParams(arms=["local-32k"], models={"local-32k": "ollama/qwen3:8b"}))
    _round_trips(EvalsPlanResult(arms=[_local(), _cloud()], running="7f3a"))
    assert EvalsPlanResult(arms=[]).running is None


def test_a_plan_arm_refuses_an_impossible_mix() -> None:
    with pytest.raises(ValidationError, match="verdict"):
        _local(verdict=None)
    with pytest.raises(ValidationError, match="costs nothing"):
        _local(cost_usd=1.0)
    with pytest.raises(ValidationError, match="no memory"):
        _cloud(verdict="fits")
    with pytest.raises(ValidationError, match="no memory"):
        _cloud(free_gb=3.0)
    with pytest.raises(ValidationError):
        _local(verdict="maybe")
    with pytest.raises(ValidationError):
        _local(asks=0)


def test_start_stop_resume_and_the_rest_round_trip() -> None:
    _round_trips(EvalsStartParams(arms=["local-32k"], allow_tight=True))
    assert EvalsStartParams(arms=["a"]).allow_tight is False
    _round_trips(EvalsStartResult(id="7f3a"))
    _round_trips(EvalsStopParams(id="7f3a"))
    _round_trips(EvalsStopResult(stopped=True))
    _round_trips(EvalsResumeParams(id="7f3a", allow_tight=True))
    _round_trips(EvalsResumeResult(id="7f3a"))
    _round_trips(EvalsListParams())
    _round_trips(EvalsGetParams(id="7f3a"))
    _round_trips(EvalsApplyParams(id="7f3a"))
    _round_trips(EvalsDeleteParams(id="7f3a"))
    _round_trips(EvalsDeleteResult(deleted=False))
    assert EvalsListResult().measurements == []


def test_start_needs_arms_named_once() -> None:
    with pytest.raises(ValidationError):
        EvalsStartParams(arms=[])
    with pytest.raises(ValidationError, match="once"):
        EvalsStartParams(arms=["a", "a"])
    with pytest.raises(ValidationError):
        EvalsStartParams.model_validate({"arms": ["a"], "live": True})
    with pytest.raises(ValidationError):
        EvalsStopParams(id="")


def test_a_finished_measurement_round_trips_with_its_proposal() -> None:
    done = _measurement(in_use=True, cost_usd=0.38)
    _round_trips(done)
    _round_trips(EvalsGetResult(measurement=done))
    proposal = done.proposal
    assert proposal is not None
    assert [n.key for n in proposal.numbers if n.measured] == ["read_share", "fill_share"]


def test_a_running_measurement_has_runs_that_wait_and_one_that_plays() -> None:
    running = _measurement(
        state="running",
        ended_at=None,
        proposal=None,
        runs=[
            EvalRun(arm="a", ask="x", mode="off", end="completed", quality=1, seconds=3),
            EvalRun(arm="a", ask="x", mode="on", end="running"),
            EvalRun(arm="a", ask="y", mode="off", end="pending"),
        ],
    )
    _round_trips(running)


def test_a_stopped_measurement_keeps_its_reason_and_the_runs_not_played() -> None:
    stopped = _measurement(
        state="stopped",
        stop_reason="Ollama stopped answering at run 6.",
        proposal=None,
        runs=[
            EvalRun(arm="a", ask="x", mode="off", end="completed", quality=1, seconds=3),
            EvalRun(arm="a", ask="x", mode="on", end="not_run"),
        ],
    )
    _round_trips(stopped)
    assert stopped.stop_reason is not None


def test_a_measurement_refuses_a_state_that_does_not_fit() -> None:
    with pytest.raises(ValidationError, match="has not ended"):
        _measurement(state="running")
    with pytest.raises(ValidationError, match="has ended"):
        _measurement(ended_at=None)
    with pytest.raises(ValidationError, match="stop reason"):
        _measurement(stop_reason="why")
    with pytest.raises(ValidationError, match="in use"):
        _measurement(in_use=True, proposal=None)
    with pytest.raises(ValidationError):
        _measurement(state="paused")


def test_a_run_that_did_not_play_has_no_numbers() -> None:
    with pytest.raises(ValidationError, match="no numbers"):
        EvalRun(arm="a", ask="x", mode="on", end="not_run", seconds=1)
    with pytest.raises(ValidationError, match="no numbers"):
        EvalRun(arm="a", ask="x", mode="on", end="pending", helpers_started=0)
    with pytest.raises(ValidationError):
        EvalRun(arm="a", ask="x", mode="on", end="completed", quality=1.5)
    with pytest.raises(ValidationError):
        EvalRun(arm="a", ask="x", mode="both", end="completed")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        EvalRun(arm="a", ask="x", mode="on", end="not run")  # type: ignore[arg-type]
    failed = EvalRun(arm="a", ask="x", mode="on", end="timeout", seconds=600)
    assert failed.quality is None


def test_a_number_is_measured_exactly_when_it_has_a_proposed_value() -> None:
    with pytest.raises(ValidationError, match="measured"):
        EvalNumber(key="read_share", current=0.3, measured=True)
    with pytest.raises(ValidationError, match="measured"):
        EvalNumber(key="read_share", current=0.3, proposed=0.4, measured=False)
    with pytest.raises(ValidationError):
        EvalNumber(key="other", current=1, measured=False)  # type: ignore[arg-type]


def test_a_proposal_has_the_four_numbers_once() -> None:
    with pytest.raises(ValidationError, match="four numbers"):
        EvalProposal(numbers=_numbers()[:3], pairs=0, wins=0)
    with pytest.raises(ValidationError, match="four numbers"):
        EvalProposal(numbers=[*_numbers()[:3], _numbers()[0]], pairs=0, wins=0)
    with pytest.raises(ValidationError, match="wins"):
        EvalProposal(numbers=_numbers(), pairs=1, wins=2)


def test_apply_answers_with_the_values_in_force() -> None:
    values = _delegate()
    ok = EvalsApplyResult(
        ok=True, values=AgentsKeepValues(keep_days=7, keep_problem_days=30, delegate=values)
    )
    _round_trips(ok)
    _round_trips(EvalsApplyResult(ok=False))


def test_summaries_are_one_line_per_measurement() -> None:
    summary = EvalSummary(
        id="7f3a",
        started_at="2026-11-23T14:02:00Z",
        state="stopped",
        ended_at="2026-11-23T14:07:00Z",
        stop_reason="you stopped it",
        arms=[EvalArmUsed(name="local-32k", model="ollama/qwen3.8:27b")],
        runs_played=5,
        runs_total=20,
    )
    _round_trips(summary)
    assert summary.proposes == 0
    _round_trips(EvalsListResult(measurements=[summary]))
    with pytest.raises(ValidationError, match="runs_played"):
        EvalSummary(
            id="a", started_at="t", ended_at="t", state="done", arms=[], runs_played=3, runs_total=2
        )
    with pytest.raises(ValidationError):
        EvalSummary(
            id="a",
            started_at="t",
            ended_at="t",
            state="done",
            arms=[],
            runs_played=1,
            runs_total=2,
            proposes=5,
        )


def test_the_three_events_are_notifications_for_every_connection() -> None:
    started = EvalStartedNotification(
        params=EvalStarted(
            id="7f3a",
            started_at="2026-11-23T14:02:00Z",
            arms=[EvalArmUsed(name="local-32k", model="ollama/qwen3.8:27b")],
            total=20,
        )
    )
    assert started.method == "eval.started"
    _round_trips(started)
    progress = EvalProgressNotification(
        params=EvalProgress(
            id="7f3a",
            index=9,
            total=20,
            arm="local-32k",
            mode="on",
            ask="read-many-files",
            state="running",
            elapsed=760,
            memory_used_gb=33.0,
            memory_total_gb=36,
        )
    )
    assert progress.method == "eval.progress"
    _round_trips(progress)
    ended = EvalEndedNotification(
        params=EvalEnded(id="7f3a", state="stopped", stop_reason="Ollama stopped answering")
    )
    assert ended.method == "eval.ended"
    _round_trips(ended)
    _round_trips(EvalEndedNotification(params=EvalEnded(id="7f3a", state="done")))


def test_the_events_refuse_a_wrong_shape() -> None:
    with pytest.raises(ValidationError, match="index"):
        EvalProgress(
            id="a", index=3, total=2, arm="x", mode="on", ask="y", state="running", elapsed=0
        )
    with pytest.raises(ValidationError):
        EvalProgress(
            id="a", index=0, total=2, arm="x", mode="on", ask="y", state="running", elapsed=0
        )
    with pytest.raises(ValidationError):
        EvalProgress.model_validate(
            {
                "id": "a",
                "index": 1,
                "total": 2,
                "arm": "x",
                "mode": "on",
                "ask": "y",
                "state": "pending",
                "elapsed": 0,
            }
        )
    with pytest.raises(ValidationError, match="stop reason"):
        EvalEnded(id="a", state="done", stop_reason="why")
    with pytest.raises(ValidationError):
        EvalStarted(id="a", started_at="t", arms=[], total=0)


def _delegate() -> AgentsDelegateValues:
    return AgentsDelegateValues(
        read_share=AgentsDelegateNumber(value=0.42, default=0.3, is_default=False),
        fill_share=AgentsDelegateNumber(value=0.85, default=0.85, is_default=True),
        job_share=AgentsDelegateNumber(value=0.1, default=0.1, is_default=True),
        price_ratio=AgentsDelegateNumber(value=3, default=3, is_default=True),
    )


def test_agents_keep_values_carry_the_delegate_numbers_read_only() -> None:
    values = AgentsKeepValues(keep_days=7, keep_problem_days=30, delegate=_delegate())
    _round_trips(values)
    assert values.delegate is not None
    assert values.delegate.read_share.is_default is False
    # An older daemon leaves them out.
    assert AgentsKeepValues(keep_days=7, keep_problem_days=30).delegate is None
    # A write cannot send them.
    with pytest.raises(ValidationError):
        AgentsKeepParams.model_validate({"delegate": {"read_share": 0.5}})
    with pytest.raises(ValidationError):
        AgentsDelegateNumber.model_validate({"value": 1, "default": 1})
