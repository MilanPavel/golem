"""The helper eval (ticket 15.4.5): four arms, helpers on and off, against scripted models.

The real chat graph, tools, ``delegate`` and session manager run. Only the model is scripted, so
no network or model is touched. A local-only arm and a cloud-only arm each have a test; the
threshold proposal is checked on constructed runs.
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel

from golem.config import DelegateSettings
from golem.evals.helpers import (
    ARMS,
    Arm,
    ArmResult,
    Ask,
    LiveDriver,
    Run,
    ScriptedDriver,
    arm_table,
    command,
    full_report,
    load_asks,
    materialise,
    measure,
    open_question,
    pairs_of,
    propose,
    run_eval,
    score,
    with_models,
)

USAGE = {"input_tokens": 1_000, "output_tokens": 500, "total_tokens": 1_500}
HITS = "mod03 orbit, mod05 ember"


def _asks() -> list[Ask]:
    """The three plain asks and one sweep, big enough to crowd the smallest window."""
    by_name = {ask.name: ask for ask in load_asks()}
    sweep = replace(
        by_name["sweep-handlers-24"],
        sweep_files=8,
        sweep_lines=700,
        sweep_hits=("mod03:orbit", "mod05:ember"),
        facts=("mod03", "orbit", "mod05", "ember"),
    )
    return [
        by_name["rename-six-files"],
        by_name["one-file-question"],
        by_name["find-fix-check"],
        sweep,
    ]


def _models(arm: Arm, ask: Ask, mode: str) -> Any:
    """The script of one run: the lead's calls and, with helpers on, the helper's, in turn."""
    check = {"command": f"'{sys.executable}' -B check.py"}
    fix = {"path": "calc.py", "old_string": "return a - b", "new_string": "return a + b"}
    sweep = ask.name.startswith("sweep")
    if ask.name == "rename-six-files":
        edits = [
            (
                "edit_file",
                {
                    "path": f"mod{n}.py",
                    "old_string": "old_name",
                    "new_string": "new_name",
                    "replace_all": True,
                },
            )
            for n in range(6)
        ]
        replies: list[Any] = [
            [("grep", {"pattern": "old_name"})],
            [("read_file", {"path": f"mod{n}.py"}) for n in range(6)],
            edits,
            "Renamed old_name to new_name in six files.",
        ]
    elif ask.name == "one-file-question":
        replies = [[("read_file", {"path": "util.py"})], "double(x) returns x * 2."]
    elif ask.name == "find-fix-check":
        replies = [
            [("shell_unsandboxed", check)],
            [("read_file", {"path": "calc.py"})],
            [("edit_file", fix)],
            [("shell_unsandboxed", check)],
            "add subtracted; it adds now and check.py passes.",
        ]
    elif mode == "on":
        replies = [
            [("delegate", {"agent": "explorer", "brief": "find the handle_ functions"})],
            [("grep", {"pattern": "def handle_"})],
            HITS,
            HITS,
        ]
    else:
        # Folding: the lead reads every module itself. On the smallest window it loses a fact.
        answer = "mod03 orbit" if arm.name == "local-32k" else HITS
        replies = [
            [("read_file", {"path": f"mod{n:02d}.py"}) for n in range(ask.sweep_files)],
            answer,
        ]
    assert sweep == ask.name.startswith("sweep")
    return ToolCallingChatModel(replies=replies, usage=USAGE)


@pytest.fixture(scope="module")
def asks() -> list[Ask]:
    return _asks()


async def _run(tmp_path: Path, asks: list[Ask], arms: list[Arm] | None = None) -> list[ArmResult]:
    driver = ScriptedDriver(_models)
    return await run_eval(
        driver, asks, arms or list(ARMS), project=tmp_path, scratch=tmp_path / "s"
    )


def _get(result: ArmResult, ask: str, mode: str) -> Run:
    return next(r for r in result.runs if r.ask == ask and r.mode == mode)


# --- the asks and the score -----------------------------------------------------------------------


def test_the_bundled_asks_hold_the_plain_cases_and_broad_ones() -> None:
    asks = {ask.name: ask for ask in load_asks()}
    for plain in ("rename-six-files", "one-file-question", "find-fix-check"):
        assert asks[plain].reason == "none"
        assert asks[plain].size == "little"
    assert {a.reason for a in asks.values()} == {"none", "window", "at_once", "model"}
    assert {"repo-overview", "repo-config-read", "repo-fit-together"} <= set(asks)
    assert all(a.facts and a.read_tokens > 0 for a in asks.values())


def test_a_score_is_the_share_of_facts_held_and_a_fact_may_have_alternatives() -> None:
    assert score("Renamed to NEW_NAME in 6 files", ("new_name", "six|6")) == 1.0
    assert score("only new_name", ("new_name", "six|6")) == 0.5
    assert score("nothing", ("a", "b")) == 0.0
    assert score("anything", ()) == 1.0


def test_a_sweep_is_written_with_its_hits(tmp_path: Path) -> None:
    ask = _asks()[3]
    folder = materialise(ask, tmp_path / "p", tmp_path)
    assert len(list(folder.glob("mod*.py"))) == 8
    assert 'return "orbit"' in (folder / "mod03.py").read_text()
    assert "handle_" not in (folder / "mod00.py").read_text()


def test_an_ask_about_the_project_runs_in_the_project(tmp_path: Path) -> None:
    ask = next(a for a in load_asks() if a.needs_project)
    assert materialise(ask, tmp_path / "x", tmp_path) == tmp_path
    assert not (tmp_path / "x").exists()


# --- four arms, on and off ------------------------------------------------------------------------


async def test_four_arms_run_on_and_off_and_plain_asks_start_no_helper(
    tmp_path: Path, asks: list[Ask]
) -> None:
    results = await _run(tmp_path, asks)

    assert [r.arm.name for r in results] == [
        "local-32k",
        "local-128k",
        "budget-cloud",
        "frontier-cloud",
    ]
    for result in results:
        assert result.skipped is None
        assert len(result.runs) == len(asks) * 2
        assert {r.mode for r in result.runs} == {"on", "off"}
        assert all(r.ok for r in result.runs)
        for plain in ("rename-six-files", "one-file-question", "find-fix-check"):
            for mode in ("on", "off"):
                run = _get(result, plain, mode)
                assert (run.delegate_calls, run.helpers_started) == (0, 0)
                assert run.quality == 1.0
                assert run.helper_cost == 0
        # off removes delegate: no run with helpers off has a call or a helper.
        assert all(r.delegate_calls == 0 for r in result.runs if r.mode == "off")


async def test_a_local_only_arm_costs_nothing_and_helps_on_a_local_model(
    tmp_path: Path, asks: list[Ask]
) -> None:
    (result,) = await _run(tmp_path, asks, [a for a in ARMS if a.name == "local-32k"])

    on, off = _get(result, "sweep-handlers-24", "on"), _get(result, "sweep-handlers-24", "off")
    assert (on.delegate_calls, on.helpers_started, on.helper_stops) == (1, 1, ("done",))
    assert all(model.startswith("ollama/") for model in on.helper_models)
    assert (on.lead_cost, on.helper_cost, off.lead_cost) == (0, 0, 0)
    # The lead that read everything crowded its window and lost a fact; the helper's lead did not.
    assert off.peak_share > 0.3 > on.peak_share
    assert off.window_left < on.window_left
    assert (off.quality, on.quality) == (0.5, 1.0)
    assert on.seconds > 0 and off.seconds > 0


async def test_a_cloud_only_arm_splits_the_cost_of_the_lead_and_its_helper(
    tmp_path: Path, asks: list[Ask]
) -> None:
    (result,) = await _run(tmp_path, asks, [a for a in ARMS if a.name == "budget-cloud"])

    on, off = _get(result, "sweep-handlers-24", "on"), _get(result, "sweep-handlers-24", "off")
    assert (on.delegate_calls, on.helpers_started, on.helper_stops) == (1, 1, ("done",))
    assert not any(model.startswith("ollama/") for model in on.helper_models)
    assert off.helper_cost == 0 and off.lead_cost > 0
    assert on.lead_cost > 0 and on.helper_cost > 0
    assert on.cost == pytest.approx(on.lead_cost + on.helper_cost)
    assert on.lead_tokens == 2 * 1_500 and on.helper_tokens > 0
    assert off.peak_share > on.peak_share
    # The cost per token seen in the events gives the price ratio of lead to helper.
    assert on.lead_price is not None and on.helper_price is not None


async def test_a_skipped_arm_is_reported_as_skipped_and_the_others_still_run(
    tmp_path: Path, asks: list[Ask]
) -> None:
    driver = ScriptedDriver(_models, unavailable={"local-128k": "Ollama is not reachable"})
    results = await run_eval(driver, asks[:1], list(ARMS), project=tmp_path)

    skipped = next(r for r in results if r.arm.name == "local-128k")
    assert skipped.skipped == "Ollama is not reachable"
    assert skipped.runs == ()
    assert "skipped: Ollama is not reachable" in arm_table(skipped)
    assert all(r.runs and r.skipped is None for r in results if r is not skipped)
    assert "skipped: Ollama is not reachable" in full_report(results)


# --- the report -----------------------------------------------------------------------------------


async def test_the_report_has_a_table_for_each_arm_a_proposal_and_the_open_question(
    tmp_path: Path, asks: list[Ask]
) -> None:
    text = full_report(await _run(tmp_path, asks))

    for name in ("local-32k", "local-128k", "budget-cloud", "frontier-cloud"):
        assert f"== {name}:" in text
    for column in ("quality", "seconds", "peak window", "left", "lead $", "helper $", "stopped"):
        assert column in text
    assert "helpers on:" in text and "helpers off:" in text
    assert "== proposed thresholds for [agents.delegate]  (a PROPOSAL" in text
    assert "read_share =" in text and "price_ratio =" in text
    assert "== open question of ADR-059" in text
    assert "budget-cloud: 1 large sweeps, 1 handed to a helper" in text


def _run_of(**changes: Any) -> Run:
    base = Run(
        arm="a",
        tier="budget",
        window=100_000,
        ask="x",
        size="much",
        reason="window",
        read_tokens=20_000,
        jobs=1,
        mode="off",
        end="completed",
        quality=1.0,
        seconds=1.0,
        peak_share=0.3,
        window_left=70_000,
        lead_cost=1.0,
        helper_cost=0.0,
        lead_tokens=1_000_000,
        helper_tokens=0,
        delegate_calls=0,
        helpers_started=0,
    )
    return replace(base, **changes)


def _pair(
    ask: str,
    read_tokens: int,
    *,
    on_quality: float = 1.0,
    on_cost: float = 0.5,
    off_peak: float = 0.5,
    jobs: int = 1,
    tier: str = "budget",
    helper_tokens: int = 1_000_000,
    helper_cost: float = 0.1,
) -> list[Run]:
    common = {"ask": ask, "read_tokens": read_tokens, "jobs": jobs, "tier": tier}
    off = _run_of(**common, mode="off", quality=1.0, peak_share=off_peak, lead_cost=1.0)
    on = _run_of(
        **common,
        mode="on",
        quality=on_quality,
        peak_share=0.1,
        window_left=90_000,
        lead_cost=on_cost - helper_cost,
        helper_cost=helper_cost,
        helper_tokens=helper_tokens,
        delegate_calls=1,
        helpers_started=1,
        helper_stops=("done",),
    )
    return [off, on]


def test_thresholds_are_proposed_from_the_shares_where_helpers_won() -> None:
    runs: list[Run] = []
    # Small reads: folding was enough (equal quality, nothing left over to win).
    for ask, tokens in (("s1", 2_000), ("s2", 8_000)):
        off, on = _pair(ask, tokens, off_peak=0.08)
        runs += [off, replace(on, window_left=off.window_left, helpers_started=1)]
    # Large reads: helpers cost half as much, left more window, and answered better.
    runs += _pair("b1", 22_000, on_quality=1.0, off_peak=0.55)
    runs += _pair("b2", 40_000, on_quality=1.0, off_peak=0.75)
    # One at once, per-job reading of 0.12 of the window, on a cloud lead.
    runs += _pair("j1", 24_000, jobs=2, off_peak=0.6)
    # One that cost too much: helpers on cost five times folding.
    runs += _pair("dear", 30_000, on_cost=5.0, helper_cost=4.0)

    proposal = propose(runs)
    pairs = pairs_of(runs)
    assert len(pairs) == proposal.pairs == 6
    # b1, b2, j1 won on window left; "dear" won on room but cost 5x, so it did not win.
    assert proposal.wins == 3
    values = {s.key: s for s in proposal.suggestions}
    # The smallest reading share of a win is 22,000 / 100,000 = 0.22, rounded down to 0.20.
    assert values["read_share"].proposed == pytest.approx(0.20)
    assert "0.220" in values["read_share"].why and "b1" in values["read_share"].why
    # Folding never lost (quality equal in every pair): no proposal for fill_share.
    assert values["fill_share"].proposed is None
    # Per-job reading of the won j1 pair: 24,000 / 2 / 100,000 = 0.12, rounded down to 0.10.
    assert values["job_share"].proposed == pytest.approx(0.10)
    # Lead $1 per 1M tokens, helper $0.1 per 1M: ratio 10, and helpers cost less.
    assert values["price_ratio"].proposed == pytest.approx(10.0)
    assert proposal.settings().read_share == pytest.approx(0.20)
    assert proposal.settings(DelegateSettings(fill_share=0.9)).fill_share == 0.9
    text = proposal.render()
    assert "a PROPOSAL" in text and "3 of 6 pairs won" in text
    assert "read_share = 0.2  (now 0.3)" in text


def test_fill_share_is_proposed_when_folding_lost_on_quality() -> None:
    off, on = _pair("lost", 30_000, on_quality=1.0, off_peak=0.83)
    off = replace(off, quality=0.5)
    proposal = propose([off, on])
    fill = next(s for s in proposal.suggestions if s.key == "fill_share")
    assert fill.proposed == pytest.approx(0.80)
    assert "83%" in fill.why
    read = next(s for s in proposal.suggestions if s.key == "read_share")
    assert read.proposed == pytest.approx(0.30)


def test_no_proposal_when_helpers_never_won() -> None:
    off, on = _pair("same", 20_000, on_cost=3.0, helper_cost=2.0)
    proposal = propose([off, on])
    assert proposal.wins == 0
    assert all(s.proposed is None for s in proposal.suggestions)
    assert "never beat folding" in proposal.render()


def test_a_run_that_failed_is_left_out_of_the_pairs() -> None:
    off, on = _pair("x", 20_000)
    assert pairs_of([off, replace(on, end="failed", quality=0.0)]) == []


def test_the_open_question_compares_large_sweeps_on_the_lead_and_on_a_helper() -> None:
    small = [replace(r, size="little") for r in _pair("small", 800, on_cost=2.0)]
    text = open_question(_pair("big", 30_000) + small)
    assert "a: 1 large sweeps, 1 handed to a helper" in text
    assert "on the lead (helpers off): quality 1.00, cost $1.0000" in text
    assert "helpers on: quality 1.00, cost $0.5000 (lead $0.4000 + helpers $0.1000)" in text
    assert "price ratio 10.0x" in text
    assert "no large sweep ran in a cloud arm" in open_question([])


# --- events and the command -----------------------------------------------------------------------


def test_measure_reads_the_events_of_a_run() -> None:
    arm = ARMS[0]
    ask = _asks()[3]
    events: list[dict[str, Any]] = [
        {
            "type": "model.call.started",
            "data": {"estimated_tokens": 8_192, "context_window": 32768},
        },
        {
            "type": "model.call.completed",
            "data": {"cost_usd": 0.5, "usage": {"input": 9, "output": 1}},
        },
        {"type": "tool.requested", "data": {"name": "delegate"}},
        {"type": "helper.started", "data": {"model": "ollama/llama3.2:3b"}},
        {"type": "helper.ended", "data": {"stopped": "time", "cost_usd": 0.25, "tokens": 40}},
        {
            "type": "model.call.started",
            "data": {"estimated_tokens": 16_384, "context_window": 32768},
        },
        {"type": "message.completed", "data": {"role": "assistant", "text": "Mod03 and ORBIT"}},
        {"type": "run.completed", "data": {}},
    ]
    run = measure(events, arm, ask, "on", 2.5)
    assert (run.end, run.quality, run.seconds) == ("completed", 0.5, 2.5)
    assert run.peak_share == 0.5 and run.window_left == 16_384
    assert (run.lead_cost, run.helper_cost) == (0.5, 0.25)
    assert (run.lead_tokens, run.helper_tokens) == (10, 40)
    assert (run.delegate_calls, run.helpers_started) == (1, 1)
    assert (run.helper_stops, run.helper_models) == (("time",), ("ollama/llama3.2:3b",))
    assert measure([], arm, ask, "off", 1.0).end == "timeout"


def test_without_live_the_command_prints_the_plan_and_runs_no_model(capsys: Any) -> None:
    lines: list[str] = []
    assert command(live=False, out=lines.append) == 0
    assert "nothing ran" in lines[0] and "80 runs" in lines[0]
    assert command(live=False, arm_names=["nope"], out=lines.append) == 1
    assert command(live=False, ask_names=["nope"], out=lines.append) == 1
    assert command(live=False, models=["nope=x"], out=lines.append) == 1
    assert capsys.readouterr().out == ""


def test_models_can_be_swapped_per_arm() -> None:
    swapped = with_models(ARMS, {"local-32k": "ollama/other:1b"})
    assert swapped[0].lead == "ollama/other:1b" and swapped[1].lead == ARMS[1].lead


def test_a_live_arm_without_its_model_is_skipped_with_a_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from golem.evals import helpers

    def no_key(provider: str) -> bool:
        del provider
        return False

    monkeypatch.setattr(helpers, "provider_key_found", no_key)
    down = LiveDriver(tags=lambda: None)
    assert "not reachable" in (down.unavailable(ARMS[0]) or "")
    empty = LiveDriver(tags=lambda: {"llama3.2:3b"})
    assert "does not have qwen3.5:9b" in (empty.unavailable(ARMS[1]) or "")
    assert "no key for anthropic" in (empty.unavailable(ARMS[2]) or "")
    ready = LiveDriver(tags=lambda: {"qwen3.5:9b"})
    assert ready.unavailable(ARMS[0]) is None
