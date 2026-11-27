"""run.skill runs a skill as a helper of the run's session, and the PR digest example (#1813)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from test_workflow_agent import World
from test_workflow_llm import BIG, _llm, _Router
from test_workflows_tool import Server

from golem.config import GolemSettings, RoleSettings, RoutingSettings, SkillSettings
from golem.mcp.client import CallResult, McpTool
from golem.mcp.tools import mcp_tools
from golem.permissions.policy import Policy
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.tools.registry import ToolRegistry
from golem.workflows.agents import WorkflowAgents
from golem.workflows.service import WorkflowService
from golem.workflows.tools import WorkflowTools

HEADER = "from golem.workflow import workflow, Run\n"
ONE = """
    @workflow()
    async def flow(run: Run):
        return await run.skill("summarise", args="the notes")
"""
CALL = "wf:skill:summarise"
EXAMPLE = Path(__file__).parents[3] / "examples" / "workflows" / "pr_digest.py"


class SkillWorld(World):
    """The agent world with a skill folder: ``summarise`` has a body and one tool."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        folder = self.tmp_path / "skills" / "summarise"
        folder.mkdir(parents=True)
        (folder / "SKILL.md").write_text(
            "---\nname: summarise\ndescription: Sums up text.\nallowed-tools: read_file\n---\n"
            "Summarise in one line: $ARGUMENTS\n"
        )
        skills = SkillRegistry(
            SkillSettings(), golem_skills=self.tmp_path / "skills", user_home=self.tmp_path / "h"
        )
        self.seam = WorkflowAgents(
            sessions=self.manager,
            agents=self.seam._agents,
            bus=self.bus,
            settings=self.seam._settings,
            skills=skills,
        )


@pytest.fixture
async def world(database: Database, tmp_path: Path) -> AsyncIterator[Callable[..., SkillWorld]]:
    made: list[SkillWorld] = []

    def make(*args: Any, **kwargs: Any) -> SkillWorld:
        built = SkillWorld(database, tmp_path, *args, **kwargs)
        made.append(built)
        return built

    yield make
    for each in made:
        await each.manager.cancel_all()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    return root


async def test_a_skill_step_is_a_helper_turn_that_returns_its_answer(
    world: Callable[..., SkillWorld], project: Path
) -> None:
    w = world(["one line"])
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    run = await w.store.get_run(run_id)
    step = await w.store.get_step(run_id, "skill:summarise")
    assert run is not None and run.session_id is not None
    assert step is not None and step.kind == "skill" and step.status == "done"
    assert json.loads(step.result_json or "null")["answer"] == "one line"
    assert step.child_session_id is not None
    child = await w.records.get(step.child_session_id)
    assert child is not None
    assert (child.parent_session_id, child.parent_call_id) == (run.session_id, CALL)
    # The brief is the skill's body with the arguments filled in.
    seen = " ".join(str(m.content) for m in w.model.seen[-1])
    assert "Summarise in one line: the notes" in seen


async def test_an_unknown_skill_fails_the_step_and_lists_the_known_ones(
    world: Callable[..., SkillWorld], project: Path
) -> None:
    w = world([])
    run_id = await w.new_run(ONE.replace('"summarise"', '"nope"'), project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "failed")
    await service.aclose()

    step = await w.store.get_step(run_id, "skill:nope")
    assert step is not None and step.status == "failed"
    assert "unknown skill 'nope'" in (step.error or "") and "summarise" in (step.error or "")


async def test_a_restart_during_the_skill_makes_no_second_helper(
    world: Callable[..., SkillWorld], project: Path
) -> None:
    gate = asyncio.Event()
    w = world(["after the restart"], gate=gate)
    run_id = await w.new_run(ONE, project)
    first = w.service()
    first.launch(run_id)
    child = await w.child_of(run_id, "skill:summarise")
    await first.aclose()
    run = await w.store.get_run(run_id)
    assert run is not None and run.status == "running" and run.session_id is not None

    second = w.service()
    second.start()
    try:
        gate.set()
        await w.until(run_id, "done")
    finally:
        await second.aclose()

    helpers = await w.records.helpers_of(run.session_id, CALL)
    assert [h.session_id for h in helpers] == [child]


async def test_a_local_only_folder_runs_the_skill_locally(
    world: Callable[..., SkillWorld], project: Path
) -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        routing=RoutingSettings(
            roles=RoleSettings(explore="anthropic/big"), local_only=[str(project)]
        ),
    )
    w = world(["local"], settings=settings)
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    child = await w.records.get(await w.child_of(run_id, "skill:summarise"))
    assert child is not None and child.model_profile == "ollama/qwen3:8b"


async def test_a_cloud_only_setup_runs_the_skill_on_a_hosted_model(
    world: Callable[..., SkillWorld], project: Path
) -> None:
    w = world(["cloud"], settings=GolemSettings(default_model="anthropic/big"))
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    step = await w.store.get_step(run_id, "skill:summarise")
    assert step is not None and step.status == "done"
    child = await w.records.get(await w.child_of(run_id, "skill:summarise"))
    assert child is not None and child.model_profile.startswith(("anthropic/", "deepseek/"))


# The PR digest example, against a fake MCP tool and a fake model.

PRS = json.dumps([{"number": 1, "title": "Fix a"}, {"number": 2, "title": "Add b"}])
RULES = '[[rule]]\ntool = "mcp__gh__list_prs"\naction = "allow"\n'
DENY_RULES = '[[rule]]\ntool = "mcp__gh__list_prs"\naction = "deny"\n'


class _Prs(Server):
    async def call(self, name: str, args: Mapping[str, object]) -> CallResult:
        self.got.append((name, args))
        return CallResult(content=[{"type": "text", "text": PRS}], is_error=False)


def _digest_service(
    tmp_path: Path, store: WorkflowRuns, rules: str, server: Server, told: list[str]
) -> WorkflowService:
    config = tmp_path / "config.toml"
    config.write_text(rules)
    listed = [McpTool(name="list_prs", description="x", input_schema={"type": "object"})]
    registry = ToolRegistry(mcp_tools("gh", listed, server.call))
    router = _Router(BIG)
    router.replies = ["Fixes a.", "Adds b."]

    async def tell(
        title: str, text: str, session_id: str | None, workflow_run_id: str | None
    ) -> None:
        told.append(text)

    return WorkflowService(
        runs=store,
        user_dir=tmp_path / "user-workflows",
        user_file=config,
        trusted=lambda _p: True,
        broadcast=lambda _m: None,
        notify=tell,
        tools=WorkflowTools(registry=registry, policy=Policy(config, home=tmp_path)),
        llm=_llm(router),
    )


async def _digest_run(store: WorkflowRuns) -> str:
    run_id = await store.create_run(
        f"{EXAMPLE}::pr_digest",
        "pr_digest",
        str(EXAMPLE),
        "2026-11-25T10:00:00Z",
        inputs_json=json.dumps({"tool": "mcp__gh__list_prs", "repo": "golem"}),
    )
    await store.set_run_session(run_id, "s_wf")
    return run_id


async def _until(store: WorkflowRuns, run_id: str, status: str) -> None:
    for _ in range(300):
        run = await store.get_run(run_id)
        if run is not None and run.status == status:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"run never became {status}")


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


async def test_the_pr_digest_lists_summarises_reviews_and_notifies(
    tmp_path: Path, store: WorkflowRuns
) -> None:
    server, told = _Prs(), list[str]()
    service = _digest_service(tmp_path, store, RULES, server, told)
    run_id = await _digest_run(store)
    service.launch(run_id)
    try:
        await _until(store, run_id, "waiting")
        steps = {s.step_key: s for s in await store.list_steps(run_id)}
        assert steps["tool:mcp__gh__list_prs"].kind == "tool"
        assert [s.status for s in steps.values() if s.kind == "llm"] == ["done", "done"]
        assert {"summarise #1", "summarise #2"} <= set(steps)
        (review,) = await store.list_open_reviews(run_id)
        draft = json.loads(review.pending_json)["draft"]
        assert "#1: Fixes a." in draft and "#2: Adds b." in draft
        await service.answer_review(run_id, review.step_key, "approve", None)
        await _until(store, run_id, "done")
    finally:
        await service.aclose()
    assert server.got == [("list_prs", {"repo": "golem"})]
    assert len(told) == 1 and "#2: Adds b." in told[0]


async def test_a_deny_rule_on_the_digests_tool_fails_the_step_with_the_reason(
    tmp_path: Path, store: WorkflowRuns
) -> None:
    server, told = _Prs(), list[str]()
    service = _digest_service(tmp_path, store, DENY_RULES, server, told)
    run_id = await _digest_run(store)
    service.launch(run_id)
    try:
        await _until(store, run_id, "failed")
    finally:
        await service.aclose()
    step = await store.get_step(run_id, "tool:mcp__gh__list_prs")
    assert step is not None and step.status == "failed"
    assert "mcp__gh__list_prs is denied by" in (step.error or "")
    assert server.got == [] and told == []
