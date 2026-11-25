"""Keyed steps: ``in_doubt``, the idempotency key, and retries (3.5.1, #1782)."""

from __future__ import annotations

import sys
import textwrap
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.engine import WorkflowEngine

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"


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


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


class Events:
    def __init__(self) -> None:
        self.names: list[str] = []

    def __call__(self, name: str, payload: dict[str, Any]) -> None:
        self.names.append(name)


KEYED = """
    from golem.workflow import idempotency_key, may_have_run

    def post(x):
        calls.log.append((idempotency_key(), may_have_run(), x))
        return x

    @workflow()
    async def flow(run: Run):
        return await run.step("post", post, 7, key=KEY)
"""


def crash_once(store: WorkflowRuns, monkeypatch: pytest.MonkeyPatch) -> None:
    real = store.finish_step
    left = {"n": 1}

    async def flaky(*args: Any, **kwargs: Any) -> None:
        if left["n"]:
            left["n"] -= 1
            raise RuntimeError("daemon died")
        await real(*args, **kwargs)

    monkeypatch.setattr(store, "finish_step", flaky)


async def test_keyed_step_crashed_before_finish_goes_in_doubt_then_done(
    store: WorkflowRuns, calls: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write(tmp_path, KEYED.replace("KEY", '"pr:1"'))
    events = Events()
    engine = WorkflowEngine(store, events)
    crash_once(store, monkeypatch)
    rid = await engine.start(path, "flow")
    step = await store.get_step(rid, "pr:1")
    assert step is not None and step.status == "running"

    await engine.execute(rid)
    assert calls.log == [("pr:1", False, 7), ("pr:1", True, 7)]
    step = await store.get_step(rid, "pr:1")
    assert step is not None and step.status == "done" and step.attempts == 2
    assert events.names.index("workflow.step.in_doubt") < events.names.index("workflow.step.done")


async def test_unkeyed_running_step_reruns_without_in_doubt(
    store: WorkflowRuns, calls: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write(tmp_path, KEYED.replace("key=KEY", "key=None"))
    events = Events()
    engine = WorkflowEngine(store, events)
    crash_once(store, monkeypatch)
    rid = await engine.start(path, "flow")
    await engine.execute(rid)
    assert calls.log == [(None, False, 7), (None, False, 7)]
    assert "workflow.step.in_doubt" not in events.names
    step = await store.get_step(rid, "post")
    assert step is not None and step.status == "done"


async def test_retries_count_attempts(store: WorkflowRuns, calls: Any, tmp_path: Path) -> None:
    path = write(
        tmp_path,
        """
        def flaky():
            calls.log.append("try")
            if len(calls.log) < 3:
                raise ValueError("flaky")
            return "ok"

        @workflow()
        async def flow(run: Run):
            return await run.step("f", flaky, retries=2, backoff=0.01)
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    step = await store.get_step(rid, "f")
    assert step is not None and step.status == "done" and step.attempts == 3


async def test_retries_exhausted_fail_the_run_naming_the_step(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        async def bad():
            raise ValueError("still broken")

        @workflow()
        async def flow(run: Run):
            await run.step("send", bad, retries=1)
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    step = await store.get_step(rid, "send")
    assert step is not None and step.status == "failed" and step.attempts == 2
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed"
    assert "send" in (run.error or "") and "still broken" in (run.error or "")
