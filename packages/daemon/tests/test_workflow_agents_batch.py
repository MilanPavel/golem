"""run.parallel of run.agent runs as one batch, with gets= and budget= (3.6.3, #1824)."""

# ruff: noqa: F811, F401
# pyright: reportPrivateUsage=false, reportUnusedImport=false
from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from pathlib import Path

import pytest
from fakes import FixedFacts, model_facts
from test_workflow_agent import World, project, world

from golem.config import AgentSettings, GolemSettings
from golem.sessions.manager import TEAM_WAIT
from golem.workflow import WorkflowError

FIVE = """
    @workflow()
    async def flow(run: Run):
        found = await run.parallel(
            [run.agent("explorer", f"look at {n}", key=f"look-{n}") for n in range(5)]
        )
        return [f["answer"] for f in found]
"""
CALL = "wf:parallel-1"
USAGE = {"input_tokens": 1_000, "output_tokens": 500, "total_tokens": 1_500}


async def _run(w: World, body: str, project: Path, status: str = "done") -> str:
    run_id = await w.new_run(body, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, status)
    await service.aclose()
    return run_id


async def test_five_agents_in_one_parallel_are_one_batch(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["a", "b", "c", "d", "e"])
    run_id = await _run(w, FIVE, project)

    run = await w.store.get_run(run_id)
    assert run is not None and run.session_id is not None
    helpers = await w.records.helpers_of(run.session_id, CALL)
    assert [h.helper_index for h in helpers] == [0, 1, 2, 3, 4]
    lead = await w.stored(run.session_id)
    started = [e.data for e in lead if e.type == "helper.started"]
    assert sorted((d.call_id, d.index) for d in started) == [(CALL, n) for n in range(5)]  # type: ignore[union-attr]
    for n in range(5):
        step = await w.store.get_step(run_id, f"look-{n}")
        assert step is not None and step.status == "done"
        assert step.child_session_id == helpers[n].session_id
        assert json.loads(step.result_json or "null")["status"] == "done"


async def test_a_helper_cap_of_two_runs_the_batch_two_at_a_time(
    world: Callable[..., World], project: Path
) -> None:
    settings = GolemSettings(default_model="ollama/qwen3:8b", agents=AgentSettings(at_once=2))
    gate = asyncio.Event()
    w = world(["a", "b", "c", "d", "e"], settings=settings, gate=gate)
    run_id = await w.new_run(FIVE, project)
    service = w.service()
    service.launch(run_id)
    try:
        async with asyncio.timeout(10):
            while len(await _helpers(w, run_id)) < 5:
                await asyncio.sleep(0.02)
        run = await w.store.get_run(run_id)
        assert run is not None and run.session_id is not None
        lead = await w.stored(run.session_id)
        waits = [
            e.data
            for e in lead
            if e.type == "helper.state" and e.data.state == "queued"  # type: ignore[union-attr]
        ]
        assert len(waits) == 3
        assert {d.reason for d in waits} == {TEAM_WAIT}  # type: ignore[union-attr]
        gate.set()
        await w.until(run_id, "done")
    finally:
        gate.set()
        await service.aclose()


async def _helpers(w: World, run_id: str) -> list[str]:
    run = await w.store.get_run(run_id)
    if run is None or run.session_id is None:
        return []
    return [h.session_id for h in await w.records.helpers_of(run.session_id, CALL)]


async def test_a_restart_mid_batch_starts_no_second_helper(
    world: Callable[..., World], project: Path
) -> None:
    gate = asyncio.Event()
    w = world(["a", "b", "c", "d", "e"], gate=gate)
    run_id = await w.new_run(FIVE, project)
    first = w.service()
    first.launch(run_id)
    async with asyncio.timeout(10):
        while len(await _helpers(w, run_id)) < 5:
            await asyncio.sleep(0.02)
    before = await _helpers(w, run_id)
    await first.aclose()

    second = w.service()
    second.start()
    try:
        gate.set()
        await w.until(run_id, "done")
    finally:
        await second.aclose()
    assert await _helpers(w, run_id) == before


async def test_a_lone_agent_keeps_its_own_call_id_and_index_zero(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["x"])
    body = """
        @workflow()
        async def flow(run: Run):
            return await run.agent("explorer", "look", key="solo")
    """
    run_id = await _run(w, body, project)
    run = await w.store.get_run(run_id)
    assert run is not None and run.session_id is not None
    helpers = await w.records.helpers_of(run.session_id, "wf:solo")
    assert [h.helper_index for h in helpers] == [0]


async def test_gets_diff_is_passed_and_other_values_are_refused(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["x"])
    ok = """
        @workflow()
        async def flow(run: Run):
            return await run.agent("explorer", "look", key="solo", gets=["diff"])
    """
    run_id = await _run(w, ok, project)
    child = await w.records.get(await w.child_of(run_id, "solo"))
    assert child is not None
    brief = next(
        e.data.text  # type: ignore[union-attr]
        for e in await w.stored(child.session_id)
        if e.type == "message.completed" and e.data.role == "user"  # type: ignore[union-attr]
    )
    assert "diff" in brief.lower()

    bad = ok.replace('["diff"]', '["secrets"]')
    run_id = await _run(w, bad, project, status="failed")
    run = await w.store.get_run(run_id)
    assert run is not None and "gets=" in (run.error or "")


async def test_budget_stops_a_helper_and_fails_the_step_cloud_only(
    world: Callable[..., World], project: Path
) -> None:
    settings = GolemSettings(default_model="anthropic/big")
    w = world(
        [[("list_dir", {"path": "."})], "from what I know"],
        settings=settings,
        budget_refs=lambda: ["deepseek/chat"],
    )
    w.model.usage = USAGE
    w.manager.facts = FixedFacts(
        model_facts("anthropic/big", "frontier", price=5.0),
        model_facts("deepseek/chat", "budget", price=0.5),
    )
    body = """
        @workflow()
        async def flow(run: Run):
            return await run.agent("explorer", "look", key="dear", budget="$0.001")
    """
    run_id = await _run(w, body, project, status="failed")
    run = await w.store.get_run(run_id)
    step = await w.store.get_step(run_id, "dear")
    assert run is not None and "agent explorer stopped (cost)" in (run.error or "")
    assert step is not None and step.status == "failed" and step.child_session_id is not None
    child = await w.stored(step.child_session_id)
    created = next(e.data for e in child if e.type == "session.created")
    assert created.agent.limits.max_cost_usd == 0.001  # type: ignore[union-attr]


@pytest.mark.parametrize("bad", ['"cheap"', "0", "-1", "True"])
async def test_a_budget_that_is_not_dollars_fails_the_step(
    world: Callable[..., World], project: Path, bad: str
) -> None:
    w = world(["x"])
    body = f"""
        @workflow()
        async def flow(run: Run):
            return await run.agent("explorer", "look", key="b", budget={bad})
    """
    run_id = await _run(w, body, project, status="failed")
    run = await w.store.get_run(run_id)
    assert run is not None and "budget=" in (run.error or "")


def test_budget_text_forms() -> None:
    from golem.workflow import _budget_of

    assert _budget_of("$0.50") == 0.5
    assert _budget_of(" 2 ") == 2.0
    assert _budget_of(0.25) == 0.25
    assert _budget_of(None) is None
    with pytest.raises(WorkflowError):
        _budget_of("$")


TWO_IN_A_MEMBER = """
    @workflow()
    async def flow(run: Run):
        async def both(n):
            first = await run.agent("explorer", f"look at {n}", key=f"look-{n}")
            again = await run.agent("explorer", f"look again at {n}", key=f"again-{n}")
            return [first["session_id"], again["session_id"]]
        return await run.parallel([both(n) for n in range(2)])
"""


async def test_a_second_agent_in_one_parallel_member_gets_its_own_helper(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["a", "b", "c", "d"])
    run_id = await _run(w, TWO_IN_A_MEMBER, project)

    run = await w.store.get_run(run_id)
    assert run is not None and run.session_id is not None
    children = set()
    for key in ("look-0", "look-1", "again-0", "again-1"):
        step = await w.store.get_step(run_id, key)
        assert step is not None and step.status == "done"
        children.add(step.child_session_id)
    assert len(children) == 4
    assert [h.helper_index for h in await w.records.helpers_of(run.session_id, CALL)] == [0, 1]
