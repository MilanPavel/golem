"""``workflow_runs``, ``workflow_steps`` and ``workflow_reviews``: migration and store."""

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from golem.store.database import Database
from golem.store.migrations import MIGRATIONS
from golem.store.workflow_runs import WorkflowRuns

_TABLES = {"workflow_runs", "workflow_steps", "workflow_reviews"}


@pytest.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield db


@pytest.fixture
def runs(database: Database) -> WorkflowRuns:
    return WorkflowRuns(database)


async def _new(runs: WorkflowRuns, workflow_id: str = "w1", at: str = "t1") -> str:
    return await runs.create_run(workflow_id, "Nightly", "/p/nightly.py", at)


async def _tables(database: Database) -> set[str]:
    rows = await database.fetch_all("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {row["name"] for row in rows}


async def test_migration_applies_on_a_fresh_database(database: Database) -> None:
    assert await _tables(database) >= _TABLES
    assert await database.user_version() == len(MIGRATIONS)


async def test_migration_applies_on_the_previous_schema(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    previous = len(MIGRATIONS) - 1
    with sqlite3.connect(path) as raw:
        for statements in MIGRATIONS[:previous]:
            for statement in statements:
                raw.execute(statement)
        raw.execute(f"PRAGMA user_version = {previous}")
    async with Database.open(path) as database:
        assert await database.user_version() == len(MIGRATIONS)
        assert await _tables(database) >= _TABLES


async def test_a_run_is_created_pending_and_read_back(runs: WorkflowRuns) -> None:
    run_id = await runs.create_run(
        "w1",
        "Nightly",
        "/p/n.py",
        "t1",
        project="/p",
        inputs_json="{}",
        trigger="chat",
        source_hash="abc",
    )
    run = await runs.get_run(run_id)
    assert run is not None
    assert (run.status, run.trigger, run.project) == ("pending", "chat", "/p")
    assert (run.source_hash, run.session_id) == ("abc", None)
    assert await runs.get_run("nope") is None


async def test_run_status_stamps_times_and_error(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    await runs.set_run_session(run_id, "s_1")
    await runs.set_run_status(run_id, "running", "t2")
    await runs.set_run_status(run_id, "waiting", "t3")
    await runs.set_run_status(run_id, "running", "t4")
    run = await runs.get_run(run_id)
    assert run is not None
    assert (run.session_id, run.started_at, run.finished_at) == ("s_1", "t2", None)
    await runs.set_run_status(run_id, "failed", "t5", error="boom")
    run = await runs.get_run(run_id)
    assert run is not None
    assert (run.status, run.error, run.finished_at) == ("failed", "boom", "t5")
    assert run.started_at == "t2"


async def test_list_runs_filters_and_orders_newest_first(runs: WorkflowRuns) -> None:
    a = await _new(runs, "w1", "t1")
    b = await _new(runs, "w2", "t2")
    c = await _new(runs, "w1", "t3")
    await runs.set_run_status(a, "done", "t4")
    assert [r.workflow_run_id for r in await runs.list_runs()] == [c, b, a]
    assert [r.workflow_run_id for r in await runs.list_runs(workflow_id="w1")] == [c, a]
    assert [r.workflow_run_id for r in await runs.list_runs(status="done")] == [a]
    assert [r.workflow_run_id for r in await runs.list_runs("w1", "pending")] == [c]
    assert len(await runs.list_runs(limit=2)) == 2


async def test_begin_finish_and_fail_with_attempts(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    step = await runs.begin_step(run_id, "k1", "step", "Fetch", "g1", "t1")
    assert (step.status, step.attempts, step.seq, step.group_key) == ("running", 1, 1, "g1")
    await runs.fail_step(run_id, "k1", "oops", "t2")
    failed = await runs.get_step(run_id, "k1")
    assert failed is not None
    assert (failed.status, failed.error, failed.finished_at) == ("failed", "oops", "t2")
    again = await runs.begin_step(run_id, "k1", "step", "Fetch", "g1", "t3")
    assert (again.status, again.attempts, again.error, again.seq) == ("running", 2, None, 1)
    await runs.finish_step(run_id, "k1", '{"ok": 1}', "t4", cost_usd=0.5)
    done = await runs.get_step(run_id, "k1")
    assert done is not None
    assert (done.status, done.result_json, done.cost_usd) == ("done", '{"ok": 1}', 0.5)


async def test_begin_on_a_done_step_returns_it_unchanged(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    await runs.begin_step(run_id, "k1", "llm", None, None, "t1")
    await runs.finish_step(run_id, "k1", '"x"', "t2")
    before = await runs.get_step(run_id, "k1")
    after = await runs.begin_step(run_id, "k1", "llm", None, None, "t3")
    assert after == before
    assert after.attempts == 1


async def test_in_doubt_only_marks_a_running_step(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    await runs.begin_step(run_id, "k1", "tool", None, None, "t1")
    await runs.begin_step(run_id, "k2", "tool", None, None, "t1")
    await runs.finish_step(run_id, "k2", "1", "t2")
    assert await runs.mark_in_doubt(run_id, "k1", "t3") is True
    assert await runs.mark_in_doubt(run_id, "k2", "t3") is False
    statuses = {s.step_key: s.status for s in await runs.list_steps(run_id)}
    assert statuses == {"k1": "in_doubt", "k2": "done"}


async def test_steps_come_back_in_the_order_first_seen(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    other = await _new(runs)
    for key in ("c", "a", "b"):
        await runs.begin_step(run_id, key, "step", None, None, "t")
    await runs.begin_step(other, "z", "step", None, None, "t")
    await runs.begin_step(run_id, "a", "step", None, None, "t2")
    steps = await runs.list_steps(run_id)
    assert [(s.step_key, s.seq) for s in steps] == [("c", 1), ("a", 2), ("b", 3)]


async def test_a_helper_child_session_is_saved(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    await runs.begin_step(run_id, "k1", "agent", None, None, "t1")
    await runs.set_step_child_session(run_id, "k1", "s_child")
    step = await runs.get_step(run_id, "k1")
    assert step is not None
    assert step.child_session_id == "s_child"


async def test_recovery_lists_running_and_waiting_runs_with_steps(runs: WorkflowRuns) -> None:
    a = await _new(runs, at="t1")
    b = await _new(runs, at="t2")
    c = await _new(runs, at="t3")
    await runs.set_run_status(a, "running", "t")
    await runs.set_run_status(b, "waiting", "t")
    await runs.set_run_status(c, "done", "t")
    await runs.begin_step(a, "k", "step", None, None, "t")
    found = await runs.steps_for_recovery()
    assert [(r.workflow_run_id, [s.step_key for s in steps]) for r, steps in found] == [
        (a, ["k"]),
        (b, []),
    ]


async def test_reviews_open_then_answered(runs: WorkflowRuns) -> None:
    run_id = await _new(runs)
    first = await runs.create_review(run_id, "r1", '{"kind": "approval"}', "t2")
    await runs.create_review(run_id, "r2", '{"kind": "approval"}', "t3")
    again = await runs.create_review(run_id, "r1", '{"kind": "other"}', "t4")
    assert again == first
    assert [r.step_key for r in await runs.list_open_reviews()] == ["r1", "r2"]
    assert await runs.answer_review(run_id, "r1", '{"yes": true}', "t5") is True
    assert await runs.answer_review(run_id, "r1", '{"yes": false}', "t6") is False
    assert await runs.answer_review(run_id, "nope", "{}", "t6") is False
    assert [r.step_key for r in await runs.list_open_reviews(run_id)] == ["r2"]
    answered = await runs.get_review(run_id, "r1")
    assert answered is not None
    assert (answered.answer_json, answered.answered_at) == ('{"yes": true}', "t5")
