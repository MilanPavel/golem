"""The delegate policy: the three reasons, the four arms, the use-case-5 cases."""

from __future__ import annotations

import pytest

from golem.config import AgentSettings, DelegateSettings
from golem.graphs.delegate_policy import Decision, JobEstimate, Prices, Setting, should_delegate
from golem.models.tiers import Tier

Arm = tuple[int, Tier, Prices]

LOCAL_32K: Arm = (32_768, "local", Prices())
LOCAL_128K: Arm = (131_072, "local", Prices())
BUDGET: Arm = (200_000, "budget", Prices(lead=0.4, cheaper=0.1, stronger=9.0))
FRONTIER: Arm = (1_000_000, "frontier", Prices(lead=9.0, cheaper=0.4))
ARMS = [LOCAL_32K, LOCAL_128K, BUDGET, FRONTIER]
IDS = ["32k", "128k", "budget", "frontier"]


def run(
    arm: Arm,
    estimate: JobEstimate,
    *,
    used: int = 2_000,
    slots: int = 3,
    setting: Setting = "when_needed",
) -> Decision:
    window, tier, prices = arm
    return should_delegate(window, used, estimate, prices, tier, slots, setting)


def test_defaults_are_shares_and_a_ratio() -> None:
    cfg = AgentSettings().delegate
    assert cfg == DelegateSettings()
    assert 0 < cfg.read_share < cfg.fill_share <= 1
    assert cfg.price_ratio > 1


@pytest.mark.parametrize(
    "estimate",
    [
        JobEstimate(read_tokens=4_800, jobs=6),  # rename over six files
        JobEstimate(read_tokens=1_500),  # a single-file question
        JobEstimate(read_tokens=3_000),  # find, fix, check: a chain is one job
    ],
    ids=["rename-six-files", "single-file-question", "find-fix-check"],
)
@pytest.mark.parametrize("arm", ARMS, ids=IDS)
def test_use_case_5_starts_no_helper(arm: Arm, estimate: JobEstimate) -> None:
    assert run(arm, estimate) == Decision(None, "fold")


@pytest.mark.parametrize("arm", ARMS, ids=IDS)
def test_a_reading_that_does_not_fit_is_reason_window(arm: Arm) -> None:
    got = run(arm, JobEstimate(read_tokens=arm[0] // 2))
    assert got == Decision("window", "single")


def test_a_full_window_is_reason_window() -> None:
    got = run(LOCAL_32K, JobEstimate(read_tokens=5_000), used=24_000)
    assert got.reason == "window"


@pytest.mark.parametrize("arm", [LOCAL_32K, LOCAL_128K], ids=["32k", "128k"])
def test_local_only_has_reason_window_only(arm: Arm) -> None:
    window = arm[0]
    assert run(arm, JobEstimate(read_tokens=window // 5, jobs=3, hard=True)).reason is None
    assert run(arm, JobEstimate(read_tokens=window // 2, jobs=3, hard=True)).reason == "window"


def test_a_local_lead_asks_a_stronger_model_only_when_one_is_ready() -> None:
    mixed: Arm = (32_768, "local", Prices(stronger=9.0))
    assert run(mixed, JobEstimate(read_tokens=0, hard=True)).reason == "model"
    assert run(mixed, JobEstimate(read_tokens=6_000, jobs=3)).reason is None  # never at once
    assert run(LOCAL_32K, JobEstimate(read_tokens=0, hard=True)).reason is None


@pytest.mark.parametrize("arm", [BUDGET, FRONTIER], ids=["budget", "frontier"])
def test_cloud_only_independent_jobs_run_at_once(arm: Arm) -> None:
    got = run(arm, JobEstimate(read_tokens=arm[0] * 24 // 100, jobs=2))  # 12% each
    assert got == Decision("at_once", "batch")


def test_cloud_only_model_reason_goes_by_price() -> None:
    big = JobEstimate(read_tokens=FRONTIER[0] // 5)
    assert run(FRONTIER, big).reason == "model"  # 9.0 against 0.4
    close: Arm = (FRONTIER[0], "frontier", Prices(lead=9.0, cheaper=5.0))
    assert run(close, big).reason is None
    # Budget: 0.4 against 0.1 is 4x, so a large read moves to the cheaper model too.
    assert run(BUDGET, JobEstimate(read_tokens=BUDGET[0] // 5)).reason == "model"
    thin: Arm = (BUDGET[0], "budget", Prices(lead=0.4, cheaper=0.3))
    assert run(thin, JobEstimate(read_tokens=BUDGET[0] // 5)).reason is None


def test_a_hard_question_goes_to_a_stronger_model_unless_frontier() -> None:
    hard = JobEstimate(read_tokens=1_000, hard=True)
    assert run(BUDGET, hard).reason == "model"
    assert run(FRONTIER, hard).reason is None
    assert run(LOCAL_128K, hard).reason is None


@pytest.mark.parametrize("arm", ARMS, ids=IDS)
def test_never_always_folds(arm: Arm) -> None:
    huge = JobEstimate(read_tokens=arm[0] * 2, jobs=4, hard=True)
    assert run(arm, huge, setting="never") == Decision(None, "fold")


def test_ask_gives_the_same_answer_with_ask_set() -> None:
    est = JobEstimate(read_tokens=FRONTIER[0] // 2)
    plain, ask = run(FRONTIER, est), run(FRONTIER, est, setting="ask")
    assert ask.ask
    assert not plain.ask
    assert (ask.reason, ask.shape) == (plain.reason, plain.shape)


@pytest.mark.parametrize("arm", ARMS, ids=IDS)
def test_no_free_slot_means_one_after_the_other(arm: Arm) -> None:
    got = run(arm, JobEstimate(read_tokens=arm[0] // 2, jobs=3), slots=0)
    assert got == Decision("window", "one after the other")


def test_one_slot_cannot_run_a_batch_at_once() -> None:
    est = JobEstimate(read_tokens=BUDGET[0] // 2, jobs=3)
    assert run(BUDGET, est, slots=1).shape == "one after the other"
    assert run(BUDGET, JobEstimate(read_tokens=BUDGET[0] // 2), slots=1).shape == "single"
