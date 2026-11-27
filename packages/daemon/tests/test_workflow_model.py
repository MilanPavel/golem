"""The model is written in the workflow (3.13.7, #1930): the order, the edit and the notes."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import textwrap
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from golem.server.workflows import _outline_all
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.check import CheckEnv
from golem.workflows.edit import EditError, set_argument
from golem.workflows.engine import WorkflowEngine
from golem.workflows.registry import _spec

HEADER = "from golem.workflow import workflow, Run\n"


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


BODY = """
    @workflow(model="wf/model")
    async def flow(run: Run):
        await run.agent("explorer", "a", key="plain")
        await run.agent("explorer", "b", model="step/model", key="own")
        await run.skill("sk", "x", key="skill")
        await run.skill("sk", "y", model="step/model", key="skill-own")
"""


class Seen:
    def __init__(self) -> None:
        self.agents: dict[str, str | None] = {}
        self.skills: dict[str, str | None] = {}

    async def agent(
        self,
        run_id: str,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        batch: Any,
        gets: Any,
        budget: Any,
        worktree: Any,
        started: Any,
    ) -> dict[str, Any]:
        self.agents[key] = model
        return {"status": "done", "answer": "ok", "session_id": "s"}

    async def skill(
        self, run_id: str, key: str, name: str, args: str, model: str | None, started: Any
    ) -> dict[str, Any]:
        self.skills[key] = model
        return {"status": "done", "answer": "ok", "session_id": "s"}


async def test_the_workflows_model_is_the_default_and_the_steps_own_wins(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    seen = Seen()
    engine = WorkflowEngine(store, agent=seen.agent, skill=seen.skill)
    await engine.start(write(tmp_path, BODY), "flow")
    assert seen.agents == {"plain": "wf/model", "own": "step/model"}
    assert seen.skills == {"skill": "wf/model", "skill-own": "step/model"}


async def test_the_runs_choice_beats_the_step_and_the_workflow(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    seen = Seen()
    engine = WorkflowEngine(store, agent=seen.agent, skill=seen.skill)
    rid = await engine.start(write(tmp_path, BODY), "flow", model="run/model")
    assert set(seen.agents.values()) == {"run/model"}
    assert set(seen.skills.values()) == {"run/model"}
    run = await store.get_run(rid)
    assert run is not None and run.model == "run/model"


async def test_a_file_with_no_model_passes_none_on(store: WorkflowRuns, tmp_path: Path) -> None:
    body = """
        @workflow()
        async def flow(run: Run):
            await run.agent("explorer", "a", key="plain")
    """
    seen = Seen()
    engine = WorkflowEngine(store, agent=seen.agent, skill=seen.skill)
    await engine.start(write(tmp_path, body), "flow")
    assert seen.agents == {"plain": None}


async def test_a_resume_can_change_the_runs_model(store: WorkflowRuns) -> None:
    rid = await store.create_run("w", "w", "/x.py", "t")
    assert (await store.get_run(rid)).model is None  # type: ignore[union-attr]
    await store.set_run_model(rid, "other/model")
    assert (await store.get_run(rid)).model == "other/model"  # type: ignore[union-attr]


def test_the_registry_reads_the_workflows_model() -> None:
    assert _spec({"name": "a", "model": "wf/model"}).model == "wf/model"
    assert _spec({"name": "a"}).model is None


SRC = """\
from golem.workflow import Run, workflow


@workflow(trigger=manual())
async def a(run: Run) -> None:
    await run.llm("x", key="k")
"""


def test_the_decorator_model_is_set_added_and_replaced() -> None:
    added = set_argument(SRC, "@workflow", "model", "ollama/small")
    assert '@workflow(trigger=manual(), model="ollama/small")' in added
    again = set_argument(added, "@workflow", "model", "anthropic/big")
    assert '@workflow(trigger=manual(), model="anthropic/big")' in again
    bare = set_argument(SRC.replace("(trigger=manual())", ""), "@workflow", "model", "m/x")
    assert '@workflow(model="m/x")' in bare
    empty = set_argument(SRC.replace("trigger=manual()", ""), "@workflow", "model", "m/x")
    assert '@workflow(model="m/x")' in empty
    with pytest.raises(EditError, match="only the model"):
        set_argument(SRC, "@workflow", "title", "x")


def test_a_step_model_can_be_set_and_a_computed_one_is_left_to_the_code() -> None:
    new = set_argument(SRC, "k", "model", "ollama/small")
    assert 'run.llm("x", key="k", model="ollama/small")' in new
    skill = SRC.replace('run.llm("x", key="k")', 'run.skill("s", key="k")')
    assert 'model="m/x"' in set_argument(skill, "k", "model", "m/x")
    computed = SRC.replace('"x", key="k"', '"x", model=pick(), key="k"')
    with pytest.raises(EditError, match="set in code"):
        set_argument(computed, "k", "model", "m/x")


def test_the_outline_says_which_model_a_step_would_use_and_whether_it_is_ready() -> None:
    code = HEADER + textwrap.dedent(
        """
            @workflow(model="wf/model")
            async def flow(run: Run):
                await run.llm("a", key="plain")
                await run.llm("b", model="gone/model", key="gone")
                await run.llm("c", model="cheapest", key="wish")
                await run.step("keep", lambda: 1)
            """
    )
    env = CheckEnv(
        model_problem=lambda name: f"{name} is not set up" if name.startswith("gone") else None,
        default_model=lambda: "default/model",
    )
    steps, problem, mine = _outline_all(code, "flow", env)
    assert problem is None
    by = {s.id: s for s in steps}
    assert (by["plain"].model, by["plain"].model_now, by["plain"].model_ready) == (
        None,
        "wf/model",
        True,
    )
    assert (by["gone"].model, by["gone"].model_now, by["gone"].model_ready) == (
        "gone/model",
        "gone/model",
        False,
    )
    assert by["wish"].model_now == "cheapest" and by["wish"].model_ready is True
    plain_step = next(s for s in steps if s.kind == "step")
    assert plain_step.model_now is None and plain_step.model_ready is None
    assert mine is not None and (mine.model, mine.now, mine.ready) == ("wf/model", "wf/model", True)

    bare = code.replace('(model="wf/model")', "()")
    _, _, mine = _outline_all(bare, "flow", env)
    assert mine is not None and (mine.model, mine.now) == (None, "default/model")
