"""run.agent runs an agent as a helper of the run's session (3.6.2, #1810)."""

from __future__ import annotations

import asyncio
import json
import textwrap
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, ToolCallingChatModel, model_facts
from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings, GolemSettings, ModelPrice, RoleSettings, RoutingSettings
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.records import RunRecords, SessionRecords
from golem.store.workflow_runs import WorkflowRuns
from golem.tools import default_registry
from golem.workflows.agents import WorkflowAgents
from golem.workflows.service import WorkflowService
from golem_protocol.events import ChatEvent

HEADER = "from golem.workflow import workflow, Run\n"
ONE = """
    @workflow()
    async def flow(run: Run):
        return await run.agent("explorer", "look around")
"""
BASE = GolemSettings(default_model="ollama/qwen3:8b")
CALL = "wf:agent:explorer"


class GatedModel(ToolCallingChatModel):
    """Waits for ``gate`` before it answers, so a test can stop the daemon mid-helper."""

    gate: Any = None

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self.gate is not None:
            await self.gate.wait()
        return self._generate(messages, stop, None, **kwargs)


class _Router(ModelRouter):
    def __init__(self, settings: GolemSettings, model: Any) -> None:
        super().__init__(settings)
        self._model = model

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> Any:
        del overrides
        if local_only:
            self.ensure_local(profile)
        return self._model


_TIERS: dict[str, Tier] = {"anthropic/big": "frontier", "deepseek/chat": "budget"}


class World:
    """A session manager, the workflow seam and a store, over one database."""

    def __init__(
        self,
        database: Database,
        tmp_path: Path,
        replies: list[Any],
        *,
        settings: GolemSettings = BASE,
        budget_refs: Callable[[], list[str]] | None = None,
        gate: asyncio.Event | None = None,
    ) -> None:
        self.tmp_path = tmp_path
        self.model = GatedModel(replies=replies, gate=gate)
        router = _Router(settings, self.model)
        runtime = open_chat(
            router,
            InMemorySaver(),
            default_registry(),
            Policy(None, home=tmp_path),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=lambda profile: _TIERS.get(profile, "local"),
            budget_refs=budget_refs,
        )
        self.records = SessionRecords(database)
        self.bus = EventBus()
        registry = AgentRegistry(
            AgentSettings(),
            golem_agents=tmp_path / "agents",
            trusted=lambda _root: False,
            bundled=bundled_agents_dir(),
        )
        from golem.store.events import EventLog

        self.events = EventLog(database)
        self.manager = SessionManager(
            runtime,
            SessionLog(self.events, self.bus, self.records),
            self.records,
            RunRecords(database),
            agents=registry,
        )
        self.seam = WorkflowAgents(
            sessions=self.manager, agents=registry, bus=self.bus, settings=router.agent_settings
        )
        self.store = WorkflowRuns(database)
        self.sent: list[BaseModel] = []

    def service(self) -> WorkflowService:
        async def create(origin: str, cwd: str | None) -> str:
            return await self.manager.create(None, cwd=cwd, origin=origin)

        return WorkflowService(
            runs=self.store,
            user_dir=self.tmp_path / "user-workflows",
            user_file=self.tmp_path / "config.toml",
            trusted=lambda _p: True,
            broadcast=self.sent.append,
            create_session=create,
            agents=self.seam,
        )

    async def new_run(self, body: str, project: Path) -> str:
        path = self.tmp_path / "wf.py"
        path.write_text(HEADER + textwrap.dedent(body))
        return await self.store.create_run(
            f"{path}::flow",
            "flow",
            str(path),
            "2026-11-25T10:00:00Z",
            project=str(project),
        )

    async def until(self, run_id: str, status: str) -> None:
        async with asyncio.timeout(10):
            while True:
                run = await self.store.get_run(run_id)
                if run is not None and run.status == status:
                    return
                await asyncio.sleep(0.02)

    async def child_of(self, run_id: str, key: str = "agent:explorer") -> str:
        async with asyncio.timeout(10):
            while True:
                step = await self.store.get_step(run_id, key)
                if step is not None and step.child_session_id is not None:
                    return step.child_session_id
                await asyncio.sleep(0.02)

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)


@pytest.fixture
async def world(database: Database, tmp_path: Path) -> AsyncIterator[Callable[..., World]]:
    made: list[World] = []

    def make(*args: Any, **kwargs: Any) -> World:
        built = World(database, tmp_path, *args, **kwargs)
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


async def test_an_agent_step_runs_a_helper_of_the_runs_session(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["found it"])
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    run = await w.store.get_run(run_id)
    step = await w.store.get_step(run_id, "agent:explorer")
    assert run is not None and run.session_id is not None
    assert step is not None and step.kind == "agent" and step.status == "done"
    assert step.child_session_id is not None
    assert json.loads(step.result_json or "null") == {
        "status": "done",
        "answer": "found it",
        "session_id": step.child_session_id,
    }
    child = await w.records.get(step.child_session_id)
    assert child is not None
    assert (child.parent_session_id, child.parent_call_id, child.origin) == (
        run.session_id,
        CALL,
        "agent:explorer",
    )
    assert child.cwd == str(project)
    # The step events carry the child's session id, so a client can open it.
    steps = [m for m in w.sent if type(m).__name__.startswith("WorkflowStep")]
    assert any(
        getattr(m.params, "child_session_id", None) == step.child_session_id  # type: ignore[attr-defined]
        for m in steps
    )


async def test_a_local_only_folder_runs_the_agent_locally(
    world: Callable[..., World], project: Path
) -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        routing=RoutingSettings(
            roles=RoleSettings(explore="anthropic/big"), local_only=[str(project)]
        ),
    )
    w = world(["local answer"], settings=settings)
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    child = await w.records.get(await w.child_of(run_id))
    assert child is not None and child.model_profile == "ollama/qwen3:8b"


async def test_a_cloud_only_setup_runs_the_agent_on_the_cheapest_budget_model(
    world: Callable[..., World], project: Path
) -> None:
    settings = GolemSettings(default_model="anthropic/big")
    w = world(["cloud answer"], settings=settings, budget_refs=lambda: ["deepseek/chat"])
    w.manager.facts = FixedFacts(
        model_facts("anthropic/big", "frontier", price=5.0),
        model_facts("deepseek/chat", "budget", price=0.5),
    )
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "done")
    await service.aclose()

    step = await w.store.get_step(run_id, "agent:explorer")
    assert step is not None and json.loads(step.result_json or "null")["answer"] == "cloud answer"
    child = await w.records.get(await w.child_of(run_id))
    assert child is not None and child.model_profile == "deepseek/chat"


async def test_a_restart_during_the_agent_makes_no_second_helper(
    world: Callable[..., World], project: Path
) -> None:
    gate = asyncio.Event()
    w = world(["after the restart"], gate=gate)
    run_id = await w.new_run(ONE, project)
    first = w.service()
    first.launch(run_id)
    child = await w.child_of(run_id)
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
    step = await w.store.get_step(run_id, "agent:explorer")
    assert step is not None
    assert json.loads(step.result_json or "null")["answer"] == "after the restart"


async def test_an_unknown_agent_type_fails_the_step_with_the_known_ones(
    world: Callable[..., World], project: Path
) -> None:
    w = world([])
    body = ONE.replace('"explorer"', '"nobody"')
    run_id = await w.new_run(body, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "failed")
    await service.aclose()

    run = await w.store.get_run(run_id)
    step = await w.store.get_step(run_id, "agent:nobody")
    assert run is not None and "unknown agent type 'nobody'" in (run.error or "")
    assert "explorer" in (run.error or "")
    assert step is not None and step.status == "failed"


async def test_a_model_name_is_refused_and_a_wish_is_passed(
    world: Callable[..., World], project: Path
) -> None:
    w = world(["ok"])
    named = ONE.replace('"look around"', '"look around", model="anthropic/big"')
    run_id = await w.new_run(named, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "failed")
    run = await w.store.get_run(run_id)
    assert run is not None and "is a wish" in (run.error or "")

    wished = ONE.replace('"look around"', '"look around", model="cheapest", key="one"')
    second = await w.new_run(wished, project)
    service.launch(second)
    await w.until(second, "done")
    await service.aclose()
    child = await w.records.get(await w.child_of(second, "one"))
    assert child is not None
    lead = await w.stored(child.parent_session_id or "")
    started = next(e for e in lead if e.type == "helper.started")
    assert started.data.wish == "cheapest"  # type: ignore[union-attr]


async def test_a_failed_helper_fails_the_step_with_its_reason(
    world: Callable[..., World], project: Path
) -> None:
    w = world([])  # no scripted reply: the model raises, the helper's run fails
    run_id = await w.new_run(ONE, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "failed")
    await service.aclose()

    run = await w.store.get_run(run_id)
    assert run is not None and "agent explorer stopped (failed)" in (run.error or "")
    step = await w.store.get_step(run_id, "agent:explorer")
    assert step is not None and step.status == "failed" and step.child_session_id is not None


async def test_the_same_agent_twice_needs_a_key(world: Callable[..., World], project: Path) -> None:
    w = world(["x"])
    body = """
        @workflow()
        async def flow(run: Run):
            await run.agent("explorer", "a")
            await run.agent("explorer", "b")
    """
    run_id = await w.new_run(body, project)
    service = w.service()
    service.launch(run_id)
    await w.until(run_id, "failed")
    await service.aclose()
    run = await w.store.get_run(run_id)
    assert run is not None and "used twice" in (run.error or "")
