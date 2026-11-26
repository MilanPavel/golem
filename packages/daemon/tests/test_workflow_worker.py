"""A workflow's worker works in a git copy and returns its diff (3.6.4, #1825).

No model: scripted replies. The checks run through a fake runner, so no test needs the shell
sandbox.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import json
import subprocess
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest
from test_workflow_skill import SkillWorld

from golem.coding.checks import Check
from golem.coding.worker_result import CheckOutcome
from golem.config import (
    CheckSettings,
    CodingSettings,
    GolemSettings,
    RoleSettings,
    RoutingSettings,
    SkillSettings,
)
from golem.permissions.policy import Policy
from golem.skills.registry import SkillRegistry
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem.workflows.agents import WorkflowAgents

NAMED = """
    @workflow()
    async def flow(run: Run):
        return await run.agent("worker", "add a file", worktree="upgrade/httpx")
"""
PLAIN = NAMED.replace(', worktree="upgrade/httpx"', "")
READ_ONLY = """
    @workflow()
    async def flow(run: Run):
        return await run.agent("explorer", "look", worktree="x")
"""
READ_ONLY_PLAIN = READ_ONLY.replace(', worktree="x"', "")
SKILL = """
    @workflow()
    async def flow(run: Run):
        return await run.skill("rewrite", args="now")
"""
WRITE = [("write_file", {"path": "new.txt", "content": "hello\n"})]


def _git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=folder,
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


async def _passed(check: Check, root: Path) -> CheckOutcome:
    return "passed"


class WorkerWorld(SkillWorld):
    """The skill world with a write skill ``rewrite``, an artifact store and a fake check runner."""

    def __init__(self, database: Database, tmp_path: Path, *args: Any, **kwargs: Any) -> None:
        super().__init__(database, tmp_path, *args, **kwargs)
        folder = tmp_path / "skills" / "rewrite"
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(
            "---\nname: rewrite\ndescription: Adds a file.\nallowed-tools: write_file\n---\n"
            "Add a file: $ARGUMENTS\n"
        )
        skills = SkillRegistry(
            SkillSettings(), golem_skills=tmp_path / "skills", user_home=tmp_path / "h"
        )
        self.seam = WorkflowAgents(
            sessions=self.manager,
            agents=self.seam._agents,
            bus=self.bus,
            settings=self.seam._settings,
            skills=skills,
        )
        self.manager._runtime.artifacts = ArtifactStore(database)
        self.manager.check_runner = _passed


@pytest.fixture(autouse=True)
def _home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "golem-home"))

    def coding(self: Policy) -> CodingSettings:
        return CodingSettings(checks="auto", check=[CheckSettings(name="tests", command="true")])

    monkeypatch.setattr(Policy, "coding", coding)


@pytest.fixture
async def world(database: Database, tmp_path: Path) -> AsyncIterator[Callable[..., WorkerWorld]]:
    made: list[WorkerWorld] = []

    def make(*args: Any, **kwargs: Any) -> WorkerWorld:
        built = WorkerWorld(database, tmp_path, *args, **kwargs)
        made.append(built)
        return built

    yield make
    for each in made:
        await each.manager.cancel_all()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    folder = tmp_path / "project"
    folder.mkdir()
    _git(folder, "init", "-q", "-b", "main")
    (folder / "a.py").write_text("x = 1\n", encoding="utf-8")
    _git(folder, "add", "-A")
    _git(folder, "commit", "-q", "-m", "first")
    return folder


async def _run(w: WorkerWorld, body: str, project: Path, status: str = "done") -> str:
    run_id = await w.new_run(body, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, status)
    await service.aclose()
    return run_id


async def test_a_worker_edits_its_copy_and_the_step_has_the_diff(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world([WRITE, "added it"])
    run_id = await _run(w, NAMED, project)

    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None and step.status == "done" and step.child_session_id is not None
    result = json.loads(step.result_json or "null")
    assert result["status"] == "done" and result["answer"] == "added it"
    assert result["worktree"] == "upgrade/httpx"
    assert result["diff"] is not None
    assert [f["path"] for f in result["files"]] == ["new.txt"]
    assert (result["added"], result["removed"]) == (1, 0)
    assert result["checks"] == "passed"
    page = await w.manager._runtime.artifacts.read(  # pyright: ignore
        step.child_session_id, result["diff"], 0, 10_000
    )
    assert page is not None and "new.txt" in page.text
    # The project is unchanged; the copy has the file.
    assert _git(project, "status", "--porcelain") == ""
    assert not (project / "new.txt").exists()
    found = await w.records.copy_of(step.child_session_id)
    assert found is not None and (Path(found[0]) / "new.txt").exists()


async def test_a_writing_agent_without_worktree_still_works_in_a_copy(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world([WRITE, "added it"])
    run_id = await _run(w, PLAIN, project)

    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None
    result = json.loads(step.result_json or "null")
    assert result["worktree"] == "agent:worker" and result["files"][0]["path"] == "new.txt"
    assert not (project / "new.txt").exists()


async def test_a_read_only_agent_keeps_its_result_shape(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world(["found it"])
    run_id = await _run(w, READ_ONLY_PLAIN, project)

    step = await w.store.get_step(run_id, "agent:explorer")
    assert step is not None
    assert set(json.loads(step.result_json or "null")) == {"status", "answer", "session_id"}


async def test_worktree_on_a_read_only_agent_is_refused(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world([])
    run_id = await _run(w, READ_ONLY, project, "failed")

    step = await w.store.get_step(run_id, "agent:explorer")
    assert step is not None and step.status == "failed"
    assert "worktree=" in (step.error or "") and "only reads" in (step.error or "")
    assert step.child_session_id is None


async def test_a_folder_that_is_not_a_git_checkout_fails_a_writing_agent(
    world: Callable[..., WorkerWorld], tmp_path: Path
) -> None:
    folder = tmp_path / "plain"
    folder.mkdir()
    w = world([])
    run_id = await _run(w, NAMED, folder, "failed")

    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None and step.status == "failed"
    assert "git" in (step.error or "")


async def test_a_write_skill_runs_in_a_copy(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world([WRITE, "done"])
    run_id = await _run(w, SKILL, project)

    step = await w.store.get_step(run_id, "skill:rewrite")
    assert step is not None and step.status == "done" and step.child_session_id is not None
    result = json.loads(step.result_json or "null")
    assert [f["path"] for f in result["files"]] == ["new.txt"] and result["diff"] is not None
    assert not (project / "new.txt").exists()
    found = await w.records.copy_of(step.child_session_id)
    assert found is not None and (Path(found[0]) / "new.txt").exists()


async def test_a_restart_while_the_worker_runs_leaves_one_helper_and_one_copy(
    world: Callable[..., WorkerWorld], project: Path, tmp_path: Path
) -> None:
    gate = asyncio.Event()
    w = world([WRITE, "added it"], gate=gate)
    run_id = await w.new_run(NAMED, project)
    first = w.service()
    first.launch(run_id)
    child = await w.child_of(run_id, "agent:worker")
    await first.aclose()
    run = await w.store.get_run(run_id)
    assert run is not None and run.session_id is not None

    second = w.service()
    second.start()
    try:
        gate.set()
        await w.until(run_id, "done")
    finally:
        await second.aclose()

    helpers = await w.records.helpers_of(run.session_id, "wf:agent:worker")
    assert [h.session_id for h in helpers] == [child]
    kept = [p for p in (tmp_path / "golem-home" / "copies").iterdir() if p.is_dir()]
    assert len(kept) == 1
    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None and json.loads(step.result_json or "null")["files"]


async def test_a_local_only_folder_runs_the_worker_locally(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        routing=RoutingSettings(
            roles=RoleSettings(explore="anthropic/big"), local_only=[str(project)]
        ),
    )
    w = world([WRITE, "local"], settings=settings)
    run_id = await _run(w, NAMED, project)

    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None and step.child_session_id is not None
    child = await w.records.get(step.child_session_id)
    assert child is not None and child.model_profile == "ollama/qwen3:8b"
    assert json.loads(step.result_json or "null")["files"]


async def test_a_cloud_only_setup_runs_the_worker_on_a_hosted_model(
    world: Callable[..., WorkerWorld], project: Path
) -> None:
    w = world([WRITE, "cloud"], settings=GolemSettings(default_model="anthropic/big"))
    run_id = await _run(w, NAMED, project)

    step = await w.store.get_step(run_id, "agent:worker")
    assert step is not None and step.child_session_id is not None
    child = await w.records.get(step.child_session_id)
    assert child is not None and child.model_profile.startswith(("anthropic/", "deepseek/"))
    assert json.loads(step.result_json or "null")["files"]
