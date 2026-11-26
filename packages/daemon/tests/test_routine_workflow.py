"""A routine starts a workflow with its inputs (4.8.1, #1837)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel, ValidationError

from golem.config import RoutineSettings
from golem.routine_scheduler import Planned, RoutineScheduler, routine_problem
from golem.store.database import Database
from golem.store.routine_runs import RoutineRuns
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.service import WorkflowService

ZONE = ZoneInfo("Europe/Prague")
START = datetime(2026, 2, 6, 9, 0, tzinfo=ZONE)

DIGEST = """
from golem.workflow import workflow, Run

@workflow(inputs={"repo": str, "limit": int, "path": str})
async def pr_digest(run: Run):
    got = await run.review(f"digest of {run.inputs.get('repo')}", ask="Send this?")
    return got["verdict"]
"""


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


class Rig:
    def __init__(self, database: Database, home: Path) -> None:
        self.home = home
        self.clock = Clock()
        self.sent: list[BaseModel] = []
        self.runs = RoutineRuns(database)
        self.store = WorkflowRuns(database)
        folder = home / "workflows"
        folder.mkdir()
        (folder / "pr_digest.py").write_text(DIGEST, encoding="utf-8")
        self.sessions = 0

        async def create_session(origin: str, cwd: str | None) -> str:
            self.sessions += 1
            return f"s_wf{self.sessions}"

        self.service = WorkflowService(
            runs=self.store,
            user_dir=folder,
            user_file=home / "config.toml",
            trusted=lambda _p: True,
            broadcast=self.sent.append,
            create_session=create_session,
        )
        self.scheduler = RoutineScheduler(
            runs=self.runs,
            launcher=_NoLauncher(),  # pyright: ignore[reportArgumentType]
            user_file=home / "config.toml",
            broadcast=self.sent.append,
            now=self.clock,
            zone=ZONE,
            workflows=self.service,
        )
        self.service.on_ended = self.scheduler.on_workflow_ended

    def config(self, *tables: str) -> None:
        (self.home / "config.toml").write_text("\n".join(tables), encoding="utf-8")

    async def until(self, check: Callable[[], Awaitable[bool]]) -> None:
        for _ in range(300):
            if await check():
                return
            await asyncio.sleep(0.02)
        raise AssertionError("never happened")

    async def close(self) -> None:
        await self.scheduler.drain()
        await self.service.aclose()


class _NoLauncher:
    """A workflow routine never asks for a prompt session."""

    async def create(self, routine: Planned) -> str:
        raise AssertionError("a workflow routine made a prompt session")


@pytest.fixture
async def rig(database: Database, tmp_path: Path) -> AsyncIterator[Rig]:
    made = Rig(database, tmp_path)
    yield made
    await made.close()


SCHEDULED = (
    '[[routine]]\nname = "digest"\nschedule = "daily 09:30"\nworkflow = "pr_digest"\n'
    'inputs = { repo = "acme/api", limit = 5 }\n'
)


async def test_a_schedule_routine_starts_its_workflow_and_an_answer_finishes_it(rig: Rig) -> None:
    rig.config(SCHEDULED)
    await rig.scheduler.tick()
    assert await rig.runs.recent("digest", "user") == []

    rig.clock.now = rig.clock.now.replace(hour=9, minute=30, second=5)
    await rig.scheduler.tick()
    [row] = await rig.runs.recent("digest", "user")
    assert (row.trigger, row.session_id) == ("schedule", "s_wf1")
    assert row.workflow_run_id is not None

    run = await rig.store.get_run(row.workflow_run_id)
    assert run is not None
    assert run.trigger == "routine:digest"
    assert run.session_id == "s_wf1"
    assert json.loads(run.inputs_json or "{}") == {"repo": "acme/api", "limit": 5}

    async def waiting() -> bool:
        got = await rig.runs.get(row.routine_run_id)
        return got is not None and got.status == "waiting"

    await rig.until(waiting)  # the run stops at its review, and the firing reads as waiting
    [review] = await rig.store.list_open_reviews(row.workflow_run_id)
    await rig.service.answer_review(row.workflow_run_id, review.step_key, "approve", None)

    async def done() -> bool:
        got = await rig.runs.get(row.routine_run_id)
        return got is not None and got.status == "succeeded"

    await rig.until(done)
    finished = [n for n in rig.sent if type(n).__name__ == "RoutineFinishedNotification"]
    assert len(finished) == 1


async def test_a_watch_routine_passes_the_path_as_an_input(rig: Rig) -> None:
    inbox = rig.home / "in"
    inbox.mkdir()
    pdf = inbox / "a.pdf"
    pdf.write_text("x", encoding="utf-8")
    rig.config(
        '[[routine]]\nname = "files"\nworkflow = "pr_digest"\n'
        f'on = {{ watch = "{inbox}", glob = "*.pdf" }}\n'
    )
    [routine] = await rig.scheduler.watched()
    info = pdf.stat()
    assert await rig.scheduler.fire_watch(routine, pdf, info.st_size, info.st_mtime_ns)
    [row] = await rig.runs.recent("files", "user")
    assert (row.trigger, row.watch_path) == ("watch", str(pdf))
    assert row.workflow_run_id is not None
    run = await rig.store.get_run(row.workflow_run_id)
    assert run is not None and run.trigger == "routine:files"
    assert json.loads(run.inputs_json or "{}") == {"path": str(pdf)}


async def test_a_firing_with_a_bad_input_fails_and_says_why(rig: Rig) -> None:
    rig.config(SCHEDULED.replace("limit = 5", 'limit = "many"'))
    await rig.scheduler.tick()
    rig.clock.now = rig.clock.now.replace(hour=9, minute=30, second=5)
    await rig.scheduler.tick()  # not loaded as a problem: the firing is the history
    [row] = await rig.runs.recent("digest", "user")
    assert row.status == "failed"
    assert row.reason is not None and "limit" in row.reason and "int" in row.reason
    assert row.workflow_run_id is None


async def test_a_missing_workflow_is_a_routine_problem_and_a_failed_firing(rig: Rig) -> None:
    rig.config(SCHEDULED.replace("pr_digest", "nope"))
    await rig.scheduler.tick()
    rig.clock.now = rig.clock.now.replace(hour=9, minute=30, second=5)
    await rig.scheduler.tick()
    [row] = await rig.runs.recent("digest", "user")
    assert row.status == "failed" and "no workflow called nope" in (row.reason or "")


async def test_the_inputs_are_checked_against_the_workflow(rig: Rig) -> None:
    await rig.service.refresh([])

    def check(extra: str, **table: str) -> str | None:
        text = (
            f'name = "x"\nschedule = "daily 09:30"\nworkflow = "{table.get("w", "pr_digest")}"\n'
            + extra
        )
        import tomllib

        return routine_problem(
            RoutineSettings.model_validate(tomllib.loads(text)), None, rig.service
        )

    assert check("inputs = { repo = 'a', limit = 3 }") is None
    assert "no input 'colour'" in (check("inputs = { colour = 'red' }") or "")
    assert "limit" in (check("inputs = { limit = 'x' }") or "")
    assert "limit" in (check("inputs = { limit = true }") or "")  # a bool is not an int
    assert "no workflow called ghost" in (check("", w="ghost") or "")
    # A watch routine passes path, so the workflow must declare it.
    watch = RoutineSettings.model_validate(
        {"name": "w", "workflow": "pr_digest", "on": {"watch": "/tmp", "glob": "*"}}
    )
    assert routine_problem(watch, None, rig.service) is None


def test_a_routine_has_exactly_one_of_prompt_and_workflow() -> None:
    base = {"name": "r", "schedule": "daily 09:30"}
    with pytest.raises(ValidationError, match="exactly one of prompt and workflow"):
        RoutineSettings.model_validate(base)
    with pytest.raises(ValidationError, match="exactly one of prompt and workflow"):
        RoutineSettings.model_validate({**base, "prompt": "x", "workflow": "w"})
    with pytest.raises(ValidationError, match="inputs belong to a routine that starts"):
        RoutineSettings.model_validate({**base, "prompt": "x", "inputs": {"a": 1}})
    with pytest.raises(ValidationError, match="folder is for a prompt routine"):
        RoutineSettings.model_validate({**base, "workflow": "w", "folder": "/x"})
    ok = RoutineSettings.model_validate({**base, "workflow": "w", "inputs": {"a": 1, "b": "x"}})
    assert ok.workflow == "w" and ok.inputs == {"a": 1, "b": "x"}


async def test_the_migration_keeps_runs_and_steps(tmp_path: Path) -> None:
    """A routine trigger is stored in ``workflow_runs`` (the CHECK on it is gone)."""
    async with Database.open(tmp_path / "golem.db") as db:
        store = WorkflowRuns(db)
        run_id = await store.create_run(
            "id", "n", "/p.py", "2026-01-01T00:00:00Z", trigger="routine:a"
        )
        run = await store.get_run(run_id)
        assert run is not None and run.trigger == "routine:a"
