"""``run.review`` waits for your answer, in the Inbox (3.4.1, #1785)."""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from golem.server.routines import _workflow_row, run_info  # pyright: ignore[reportPrivateUsage]
from golem.sessions.log import SessionLog
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.records import SessionActivity, SessionRecord
from golem.store.routine_runs import HeadlessRun
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.service import ReviewError, WorkflowService

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"

ONE = """
    @workflow()
    async def flow(run: Run):
        calls.log.append("start")
        got = await run.review("Dear Ann, hello", ask="Send this?")
        calls.log.append(got)
        return got
"""

TWO = """
    @workflow()
    async def flow(run: Run):
        got = await run.parallel([
            run.review("first draft", ask="First?", key="one"),
            run.review("second draft", ask="Second?", key="two"),
        ])
        calls.log.append(got)
"""

MIXED = """
    async def work():
        calls.log.append("work")
        return 1

    @workflow()
    async def flow(run: Run):
        await run.parallel([
            run.step("work", work),
            run.review("a draft", ask="Ok?", key="one"),
        ])
"""

REJECT = """
    @workflow()
    async def flow(run: Run):
        got = await run.review({"to": "ann"}, ask="Send?")
        calls.log.append("sent" if got["verdict"] != "reject" else "dropped")
"""


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Any:
    module = types.ModuleType("calls")
    module.log = []  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calls", module)
    return module


class Sent:
    def __init__(self) -> None:
        self.names: list[str] = []

    def __call__(self, message: BaseModel) -> None:
        self.names.append(type(message).__name__)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


def service(tmp_path: Path, store: WorkflowRuns, sent: Sent | None = None) -> WorkflowService:
    return WorkflowService(
        runs=store,
        user_dir=tmp_path / "user-workflows",
        user_file=tmp_path / "config.toml",
        trusted=lambda _p: True,
        broadcast=sent or Sent(),
    )


async def new_run(store: WorkflowRuns, path: Path) -> str:
    run_id = await store.create_run(f"{path}::flow", "flow", str(path), "2026-11-25T10:00:00Z")
    await store.set_run_session(run_id, "s_wf")
    return run_id


async def until(store: WorkflowRuns, run_id: str, status: str) -> None:
    for _ in range(200):
        run = await store.get_run(run_id)
        if run is not None and run.status == status:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"run never became {status}")


async def waiting_run(tmp_path: Path, store: WorkflowRuns, body: str, sent: Sent) -> str:
    path = write(tmp_path, body)
    first = service(tmp_path, store, sent)
    run_id = await new_run(store, path)
    first.launch(run_id)
    await until(store, run_id, "waiting")
    await first.aclose()
    return run_id


async def test_a_new_service_answers_a_waiting_review_and_the_run_finishes(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    sent = Sent()
    run_id = await waiting_run(tmp_path, store, ONE, sent)

    steps = await store.list_steps(run_id)
    assert [(s.kind, s.status, s.step_key) for s in steps] == [
        ("review", "waiting", "review:Send this?")
    ]
    open_reviews = await store.list_open_reviews(run_id)
    assert len(open_reviews) == 1
    assert json.loads(open_reviews[0].pending_json) == {
        "ask": "Send this?",
        "draft": "Dear Ann, hello",
    }
    assert {"WorkflowStepWaitingNotification", "WorkflowRunWaitingNotification"} <= set(sent.names)
    assert calls.log == ["start"]

    second = service(tmp_path, store, Sent())
    try:
        await second.answer_review(run_id, "review:Send this?", "edit", "Dear Anna, hi")
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert calls.log[-1] == {"verdict": "edit", "text": "Dear Anna, hi"}
    step = await store.get_step(run_id, "review:Send this?")
    assert step is not None and step.status == "done"
    assert json.loads(step.result_json or "null") == {"verdict": "edit", "text": "Dear Anna, hi"}


async def test_approve_without_text_answers_with_the_draft(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, ONE, Sent())
    second = service(tmp_path, store)
    try:
        await second.answer_review(run_id, "review:Send this?", "approve", None)
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert calls.log[-1] == {"verdict": "approve", "text": "Dear Ann, hello"}


async def test_an_unanswered_review_waits_again_without_a_second_row(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, ONE, Sent())
    again = service(tmp_path, store)
    try:
        await again.resume(run_id)
        for _ in range(100):
            if calls.log.count("start") == 2:
                break
            await asyncio.sleep(0.02)
        await until(store, run_id, "waiting")
        await asyncio.sleep(0.05)
    finally:
        await again.aclose()
    assert len(await store.list_open_reviews(run_id)) == 1


async def test_two_reviews_in_a_parallel_group_both_wait(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, TWO, Sent())
    assert sorted(r.step_key for r in await store.list_open_reviews(run_id)) == ["one", "two"]
    second = service(tmp_path, store)
    try:
        await second.answer_review(run_id, "one", "approve", None)
        await asyncio.sleep(0.1)
        run = await store.get_run(run_id)
        assert run is not None and run.status == "waiting"  # one review is still out
        await second.answer_review(run_id, "two", "reject", None)
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert calls.log[-1] == [
        {"verdict": "approve", "text": "first draft"},
        {"verdict": "reject", "text": ""},
    ]


async def test_other_members_of_a_group_finish_before_the_run_waits(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, MIXED, Sent())
    work = await store.get_step(run_id, "work")
    assert work is not None and work.status == "done"
    assert calls.log == ["work"]


async def test_reject_goes_back_to_the_code_and_does_not_fail_the_run(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, REJECT, Sent())
    second = service(tmp_path, store)
    try:
        await second.answer_review(run_id, "review:Send?", "reject", "no thanks")
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert calls.log == ["dropped"]


async def test_a_review_is_answered_once_and_unknown_ones_are_refused(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, ONE, Sent())
    svc = service(tmp_path, store)
    try:
        with pytest.raises(ReviewError, match="no workflow run"):
            await svc.answer_review("nope", "k", "approve", None)
        with pytest.raises(ReviewError, match="no review"):
            await svc.answer_review(run_id, "other", "approve", None)
        with pytest.raises(ReviewError, match="needs text"):
            await svc.answer_review(run_id, "review:Send this?", "edit", None)
        await svc.answer_review(run_id, "review:Send this?", "approve", None)
        with pytest.raises(ReviewError, match="answered already"):
            await svc.answer_review(run_id, "review:Send this?", "reject", None)
        await until(store, run_id, "done")
    finally:
        await svc.aclose()


async def test_the_session_summary_lists_the_review_but_not_in_pending(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, ONE, Sent())
    svc = service(tmp_path, store)
    log = SessionLog(MagicMock(), MagicMock(), MagicMock())
    log.reviews = svc.pending_items
    record = SessionRecord("s_wf", "local", None, "t0", "t0", None, origin="workflow:flow")
    activity = SessionActivity(record, running=False, last_seq=0, waiting=False)
    items = await log.pending_items(activity, None, None)
    assert [(i.kind, i.ask, i.workflow_run_id, i.key) for i in items] == [
        ("review", "Send this?", run_id, "review:Send this?")
    ]
    assert items[0].preview == "Dear Ann, hello"
    summary = summarize(activity, items=items)
    assert summary.pending is None
    assert [i.kind for i in summary.pending_items] == ["review"]

    other = SessionRecord("s_u", "local", None, "t0", "t0", None)
    plain = await log.pending_items(SessionActivity(other, False, 0, False), None, None)
    assert plain == []

    await svc.answer_review(run_id, "review:Send this?", "approve", None)
    try:
        await until(store, run_id, "done")
    finally:
        await svc.aclose()
    assert await log.pending_items(activity, None, None) == []


async def test_run_list_shows_the_waiting_run_with_its_ask(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await waiting_run(tmp_path, store, TWO, Sent())
    row = HeadlessRun(
        "s_wf", "workflow:flow", None, None, None, None, "waiting", None, None, None, None, None
    )
    info = await _workflow_row(store, row, run_info(row, None))
    assert info.kind == "workflow"
    assert info.status == "waiting"
    assert info.summary == "First?"
    assert info.approvals == 2
    assert info.workflow_run_id == run_id
    run = await store.get_run(run_id)
    assert run is not None and cast(str, run.session_id) == "s_wf"


async def test_workflow_status_carries_the_whole_draft_of_an_open_review(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    from types import SimpleNamespace

    from golem.server.workflows import workflow_status
    from golem_protocol.commands import WorkflowStatusParams

    long_draft = "word " * 100
    body = ONE.replace('"Dear Ann, hello"', repr(long_draft))
    run_id = await waiting_run(tmp_path, store, body, Sent())
    svc = service(tmp_path, store)
    ctx = SimpleNamespace(state=SimpleNamespace(workflows=svc))
    result = await workflow_status(cast(Any, ctx), WorkflowStatusParams(workflow_run_id=run_id))
    assert len(long_draft) > 200
    assert [(r.key, r.ask, r.draft, r.answered) for r in result.reviews] == [
        ("review:Send this?", "Send this?", long_draft, False)
    ]
    items = await svc.pending_items("s_wf")
    assert len(items[0].preview or "") <= 200
    await svc.answer_review(run_id, "review:Send this?", "approve", None)
    await until(store, run_id, "done")
    await svc.aclose()
    done = await workflow_status(cast(Any, ctx), WorkflowStatusParams(workflow_run_id=run_id))
    assert done.reviews == []
