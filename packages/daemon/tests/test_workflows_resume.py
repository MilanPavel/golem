"""Runs continue after a restart, and ``workflow.resume`` (3.3.2, #1783)."""

from __future__ import annotations

import asyncio
import sys
import textwrap
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.service import ResumeError, WorkflowService

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"

THREE = """
    async def a(x):
        calls.log.append("a")
        return x + 1

    async def b(x):
        calls.log.append("b")
        return x + 1

    async def c(x):
        if calls.hold:
            calls.reached.set()
            await calls.gate.wait()
        calls.log.append("c")
        return x + 1

    @workflow({policy})
    async def flow(run: Run):
        one = await run.step("a", a, 0)
        two = await run.step("b", b, one)
        return await run.step("c", c, two)
"""


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Any:
    module = types.ModuleType("calls")
    module.log = []  # type: ignore[attr-defined]
    module.hold = False  # type: ignore[attr-defined]
    module.gate = asyncio.Event()  # type: ignore[attr-defined]
    module.reached = asyncio.Event()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calls", module)
    return module


class Sent:
    def __init__(self) -> None:
        self.names: list[str] = []

    def __call__(self, message: BaseModel) -> None:
        self.names.append(type(message).__name__)


def write(tmp_path: Path, body: str, policy: str = "") -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body).replace("{policy}", policy))
    return path


def service(tmp_path: Path, store: WorkflowRuns, sent: Sent) -> WorkflowService:
    return WorkflowService(
        runs=store,
        user_dir=tmp_path / "user-workflows",
        user_file=tmp_path / "config.toml",
        trusted=lambda _p: True,
        broadcast=sent,
    )


async def new_run(store: WorkflowRuns, path: Path, status: str = "pending") -> str:
    run_id = await store.create_run(f"{path}::flow", "flow", str(path), "2026-11-25T10:00:00Z")
    if status != "pending":
        await store.set_run_status(run_id, status, "2026-11-25T10:00:00Z")
    return run_id


async def until(store: WorkflowRuns, run_id: str, status: str) -> None:
    for _ in range(200):
        run = await store.get_run(run_id)
        if run is not None and run.status == status:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"run never became {status}")


async def test_a_run_stopped_after_step_two_continues_with_step_three(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    path = write(tmp_path, THREE)
    calls.hold = True
    first = service(tmp_path, store, Sent())
    run_id = await new_run(store, path)
    first.launch(run_id)
    await asyncio.wait_for(calls.reached.wait(), 5)
    await first.aclose()
    run = await store.get_run(run_id)
    assert run is not None and run.status == "running"
    assert calls.log == ["a", "b"]

    calls.hold = False
    sent = Sent()
    second = service(tmp_path, store, sent)
    second.start()
    try:
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert calls.log == ["a", "b", "c"]
    assert "WorkflowRunDoneNotification" in sent.names


async def test_fail_policy_fails_the_run_without_running_it(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    path = write(tmp_path, THREE, 'on_restart="fail"')
    run_id = await new_run(store, path, "running")
    sent = Sent()
    svc = service(tmp_path, store, sent)
    svc.start()
    try:
        await until(store, run_id, "failed")
    finally:
        await svc.aclose()
    run = await store.get_run(run_id)
    assert run is not None and run.error == "the daemon stopped during the run"
    assert calls.log == []
    assert "WorkflowRunFailedNotification" in sent.names


async def test_ask_policy_waits_and_resume_continues_it(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    path = write(tmp_path, THREE, 'on_restart="ask"')
    run_id = await new_run(store, path, "running")
    sent = Sent()
    svc = service(tmp_path, store, sent)
    svc.start()
    try:
        await until(store, run_id, "waiting")
        assert "WorkflowRunWaitingNotification" in sent.names
        assert calls.log == []
        await svc.resume(run_id)
        await until(store, run_id, "done")
    finally:
        await svc.aclose()
    assert calls.log == ["a", "b", "c"]


async def test_waiting_runs_stay_waiting_after_a_restart(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    path = write(tmp_path, THREE)
    run_id = await new_run(store, path, "waiting")
    svc = service(tmp_path, store, Sent())
    svc.start()
    await asyncio.sleep(0.2)
    await svc.aclose()
    run = await store.get_run(run_id)
    assert run is not None and run.status == "waiting"
    assert calls.log == []


async def test_resume_reruns_a_failed_step_and_reuses_the_done_ones(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    body = """
        async def a():
            calls.log.append("a")
            return 1

        async def b():
            calls.log.append("b")
            if calls.hold:
                raise ValueError("boom")
            return 2

        @workflow()
        async def flow(run: Run):
            await run.step("a", a)
            return await run.step("b", b)
    """
    path = write(tmp_path, body)
    calls.hold = True
    svc = service(tmp_path, store, Sent())
    run_id = await new_run(store, path)
    svc.launch(run_id)
    await until(store, run_id, "failed")
    calls.hold = False
    resumed = await svc.resume(run_id)
    assert resumed.workflow_run_id == run_id
    try:
        await until(store, run_id, "done")
    finally:
        await svc.aclose()
    assert calls.log == ["a", "b", "b"]


async def test_resume_refuses_a_run_in_flight_done_or_unknown(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    path = write(tmp_path, THREE)
    calls.hold = True
    svc = service(tmp_path, store, Sent())
    run_id = await new_run(store, path)
    svc.launch(run_id)
    await asyncio.wait_for(calls.reached.wait(), 5)
    with pytest.raises(ResumeError, match="already running"):
        await svc.resume(run_id)
    calls.gate.set()
    await until(store, run_id, "done")
    with pytest.raises(ResumeError, match="is done"):
        await svc.resume(run_id)
    with pytest.raises(ResumeError, match="no workflow run"):
        await svc.resume("wr_nope")
    cancelled = await new_run(store, path, "cancelled")
    with pytest.raises(ResumeError, match="is cancelled"):
        await svc.resume(cancelled)
    await svc.aclose()


async def test_a_changed_file_still_resumes_with_a_warning(
    tmp_path: Path, store: WorkflowRuns, calls: Any, caplog: pytest.LogCaptureFixture
) -> None:
    path = write(tmp_path, THREE)
    run_id = await store.create_run(
        f"{path}::flow", "flow", str(path), "2026-11-25T10:00:00Z", source_hash="0" * 64
    )
    await store.set_run_status(run_id, "running", "2026-11-25T10:00:00Z")
    svc = service(tmp_path, store, Sent())
    with caplog.at_level("WARNING", logger="golem.server"):
        svc.start()
        try:
            await until(store, run_id, "done")
        finally:
            await svc.aclose()
    assert "changed since the run started" in caplog.text
