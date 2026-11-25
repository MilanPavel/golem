"""run.notify tells you through the Notifier, once per run (3.4.2, #1784)."""

from __future__ import annotations

import textwrap
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.engine import WorkflowEngine

HEADER = "from golem.workflow import workflow, Run\n"


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


class FakeNotifier:
    def __init__(self) -> None:
        self.sent: list[tuple[str | None, str, str]] = []

    async def __call__(self, title: str | None, text: str, run_id: str) -> None:
        self.sent.append((title, text, run_id))


TWO = """
    @workflow()
    async def flow(run: Run):
        await run.notify("first", title="T")
        await run.notify("second")
"""


async def test_two_notifies_send_two_and_execute_again_sends_none(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    fake = FakeNotifier()
    engine = WorkflowEngine(store, notify=fake)
    rid = await engine.start(write(tmp_path, TWO), "flow")
    assert fake.sent == [("T", "first", rid), (None, "second", rid)]
    step = await store.get_step(rid, "notify:first")
    assert step is not None and step.kind == "notify" and step.status == "done"

    await engine.execute(rid)
    assert len(fake.sent) == 2


async def test_without_a_notifier_the_step_still_completes(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    engine = WorkflowEngine(store)
    rid = await engine.start(write(tmp_path, TWO), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "done"


async def test_same_text_twice_needs_a_key(store: WorkflowRuns, tmp_path: Path) -> None:
    body = """
        @workflow()
        async def flow(run: Run):
            await run.notify("hi")
            await run.notify("hi")
    """
    rid = await WorkflowEngine(store).start(write(tmp_path, body), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed" and "used twice" in (run.error or "")

    keyed = body.replace(
        'run.notify("hi")\n            await', 'run.notify("hi", key="a")\n            await'
    )
    fake = FakeNotifier()
    await WorkflowEngine(store, notify=fake).start(write(tmp_path, keyed), "flow")
    assert len(fake.sent) == 2
