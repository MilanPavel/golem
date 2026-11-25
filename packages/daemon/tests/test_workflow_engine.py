"""The workflow engine and ``run.step`` / ``run.parallel`` (3.1.1, #1758)."""

from __future__ import annotations

import sys
import textwrap
import threading
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflow import Run
from golem.workflows.engine import WorkflowEngine

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"


class Sentinel(BaseException):
    pass


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Any:
    module = types.ModuleType("calls")
    module.log = []  # type: ignore[attr-defined]
    module.Sentinel = Sentinel  # type: ignore[attr-defined]
    module.threads = []  # type: ignore[attr-defined]
    module.explode = False  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calls", module)
    return module


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


class Events:
    def __init__(self) -> None:
        self.items: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, name: str, payload: dict[str, Any]) -> None:
        self.items.append((name, payload))

    @property
    def names(self) -> list[str]:
        return [n for n, _ in self.items]


THREE = """
    async def a(x):
        calls.log.append(("a", x))
        return x + 1

    @workflow()
    async def flow(run: Run, start: int = 1):
        first = await run.step("first", a, start)
        many = await run.parallel([run.step(f"p{i}", a, i) for i in range(3)])
        return await run.step("last", a, first + sum(many))
"""


async def test_steps_and_parallel_are_recorded_with_groups(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(tmp_path, THREE)
    rid = await WorkflowEngine(store).start(path, "flow", {"start": 5})
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "done"
    assert run.source_hash
    steps = await store.list_steps(rid)
    assert [s.step_key for s in steps] == ["first", "p0", "p1", "p2", "last"]
    assert [s.group_key for s in steps] == [None, "parallel-1", "parallel-1", "parallel-1", None]
    assert all(s.status == "done" for s in steps)
    assert steps[0].result_json == "6"


async def test_execute_again_calls_nothing_twice(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    engine = WorkflowEngine(store)
    rid = await engine.start(write(tmp_path, THREE), "flow")
    count = len(calls.log)
    await engine.execute(rid)
    assert len(calls.log) == count == 5
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "done"


async def test_an_interrupted_run_runs_only_unfinished_steps(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        async def s(name):
            if name == "two" and calls.explode:
                raise calls.Sentinel()
            calls.log.append(name)
            return name

        @workflow()
        async def flow(run: Run):
            for n in ("one", "two", "three"):
                await run.step(n, s, n)
        """,
    )
    engine = WorkflowEngine(store)
    calls.explode = True
    rid = await store.create_run("w", "flow", str(path), "t")
    with pytest.raises(Sentinel):
        await engine.execute(rid)
    assert calls.log == ["one"]
    calls.explode = False
    await engine.execute(rid)
    assert calls.log == ["one", "two", "three"]
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "done"
    two = await store.get_step(rid, "two")
    assert two is not None
    assert two.attempts == 2


async def test_a_plain_function_runs_in_a_thread(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        import threading

        def plain():
            calls.threads.append(threading.get_ident())
            return "ok"

        @workflow()
        async def flow(run: Run):
            return await run.step("t", plain)
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    assert calls.threads
    assert calls.threads[0] != threading.get_ident()
    step = await store.get_step(rid, "t")
    assert step is not None
    assert step.result_json == '"ok"'


async def test_a_result_that_is_not_json_fails_the_step(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        @workflow()
        async def flow(run: Run):
            await run.step("bad", lambda: object())
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    step = await store.get_step(rid, "bad")
    assert step is not None
    assert step.status == "failed"
    assert step.error is not None
    assert "not JSON" in step.error
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "failed"
    assert run.error


async def test_a_duplicate_key_fails_the_run(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        @workflow()
        async def flow(run: Run):
            await run.step("x", lambda: 1)
            await run.step("y", lambda: 1, key="x")
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "failed"
    assert run.error is not None
    assert "step key 'x' used twice" in run.error


async def test_a_failing_parallel_member_keeps_its_siblings(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        async def ok(n):
            calls.log.append(n)
            return n

        async def boom():
            raise ValueError("nope")

        @workflow()
        async def flow(run: Run):
            await run.parallel([run.step("a", ok, 1), run.step("b", boom), run.step("c", ok, 3)])
        """,
    )
    rid = await WorkflowEngine(store).start(path, "flow")
    status = {s.step_key: s.status for s in await store.list_steps(rid)}
    assert status == {"a": "done", "b": "failed", "c": "done"}
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "failed"
    assert "nope" in (run.error or "")


async def test_events_come_in_order(store: WorkflowRuns, calls: Any, tmp_path: Path) -> None:
    events = Events()
    path = write(
        tmp_path,
        """
        @workflow()
        async def flow(run: Run):
            await run.step("one", lambda: 1)
        """,
    )
    rid = await WorkflowEngine(store, events).start(path, "flow")
    assert events.names == [
        "workflow.run.started",
        "workflow.step.started",
        "workflow.step.done",
        "workflow.run.done",
    ]
    step = events.items[1][1]
    assert step["workflow_run_id"] == rid
    assert (step["key"], step["kind"], step["status"]) == ("one", "step", "running")
    assert step["attempts"] == 1
    assert set(step) == {
        "workflow_run_id",
        "key",
        "kind",
        "title",
        "status",
        "group",
        "attempts",
        "error",
        "child_session_id",
        "model",
        "cost_usd",
        "started_at",
        "finished_at",
    }
    done = events.items[3][1]
    assert done["status"] == "done"
    assert done["finished_at"]
    assert set(done) == {
        "workflow_run_id",
        "workflow_id",
        "name",
        "status",
        "trigger",
        "session_id",
        "started_at",
        "finished_at",
        "error",
    }


@pytest.mark.parametrize(
    ("name", "ticket"),
    [
        ("skill", "#740"),
    ],
)
async def test_stubs_name_their_ticket(name: str, ticket: str) -> None:
    run = Run(None, "r")  # type: ignore[arg-type]
    with pytest.raises(NotImplementedError, match=ticket):
        await getattr(run, name)()


async def test_top_level_code_does_not_block_the_loop(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    import asyncio

    path = tmp_path / "wf.py"
    path.write_text(
        "import time\nfrom golem.workflow import workflow, Run\ntime.sleep(0.3)\n\n"
        "@workflow()\nasync def flow(run: Run):\n    return None\n"
    )
    ticks = 0

    async def ticker() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(ticker())
    await WorkflowEngine(store).start(path, "flow")
    task.cancel()
    assert ticks >= 10


async def test_cancelling_sets_cancelled_and_emits(
    store: WorkflowRuns, calls: Any, tmp_path: Path
) -> None:
    import asyncio

    events = Events()
    path = write(
        tmp_path,
        """
        import asyncio

        @workflow()
        async def flow(run: Run):
            await asyncio.sleep(10)
        """,
    )
    rid = await store.create_run("w", "flow", str(path), "t")
    task = asyncio.create_task(WorkflowEngine(store, events).execute(rid))
    await asyncio.sleep(0.3)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    run = await store.get_run(rid)
    assert run is not None
    assert run.status == "cancelled"
    assert events.names[-1] == "workflow.run.cancelled"
