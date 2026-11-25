"""run.llm asks one model one question as a step and keeps its cost (3.8.1, #1811)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import textwrap
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from golem.config import GolemSettings, ModelPrice
from golem.models.dispatcher import Call, Dispatcher
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.server.workflows import _step_info
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflow import WorkflowError
from golem.workflows.engine import WorkflowEngine
from golem.workflows.llm import WorkflowLlm

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
BIG = "anthropic/big"

HEADER = "from golem.workflow import workflow, Run\nfrom pydantic import BaseModel\n"


class _Model(ScriptedChatModel):
    """Answers with fixed token counts, so the call has a cost."""

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        text = self._take(messages)
        message = AIMessage(
            content=text,
            usage_metadata={
                "input_tokens": 1_000_000,
                "output_tokens": 0,
                "total_tokens": 1_000_000,
            },
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


class _Router(ModelRouter):
    def __init__(self, default: str) -> None:
        super().__init__(GolemSettings(default_model=default))
        self._chat_profile = default
        self.models: dict[str, _Model] = {}
        self.replies: list[str] = []

    @property
    def profile_name(self) -> str:
        return self._chat_profile

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        if local_only:
            self.ensure_local(profile)
        ref = self.resolve(profile).ref
        return self.models.setdefault(ref, _Model(replies=self.replies))

    def asked(self, ref: str) -> int:
        model = self.models.get(ref)
        return 0 if model is None else len(model.seen)


def _tier(profile: str) -> Tier | None:
    tiers: dict[str, Tier] = {LOCAL: "local", CHEAP: "budget", BIG: "frontier"}
    return tiers.get(profile)


def _llm(
    router: _Router,
    *,
    local_only: bool = False,
    dispatcher: Dispatcher | None = None,
    paid_ok: Any = None,
) -> WorkflowLlm:
    return WorkflowLlm(
        router,
        dispatcher,
        local_only=lambda folder: local_only,
        tier_of_profile=_tier,
        budget_refs=lambda: [CHEAP],
        price_of=lambda profile: ModelPrice(input=2.0, output=10.0),
        paid_ok=paid_ok,
    )


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


TEXT = """
    @workflow()
    async def flow(run: Run):
        return await run.step("keep", lambda s: s, await run.llm("say hi"))
"""

SCHEMA = """
    class Facts(BaseModel):
        title: str
        count: int

    @workflow()
    async def flow(run: Run):
        a = await run.llm("facts please", schema=Facts, key="a")
        b = await run.llm("again", schema={"type": "object"}, key="b")
        await run.step("keep", lambda x, y: [x, y], a, b)
"""


async def test_a_text_answer_is_the_step_result_with_its_model_and_cost(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(BIG)
    router.replies = ["hi there"]
    engine = WorkflowEngine(store, llm=_llm(router))
    rid = await engine.start(write(tmp_path, TEXT), "flow")

    run = await store.get_run(rid)
    assert run is not None and run.status == "done"
    [step] = [s for s in await store.list_steps(rid) if s.kind == "llm"]
    assert step.step_key.startswith("llm:") and len(step.step_key) == len("llm:") + 8
    assert step.result_json == '"hi there"'
    assert step.model == "deepseek/cheap"
    assert step.cost_usd == 2.0
    info = _step_info(step)
    assert (info.model, info.cost_usd) == ("deepseek/cheap", 2.0)


async def test_a_schema_answer_is_a_dict_and_a_wrong_one_fails_the_step(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(BIG)
    router.replies = ['```json\n{"title": "T", "count": 3}\n```', 'Sure: {"x": 1}']
    engine = WorkflowEngine(store, llm=_llm(router))
    rid = await engine.start(write(tmp_path, SCHEMA), "flow")
    step = await store.get_step(rid, "keep")
    assert step is not None and step.result_json == '[{"title": "T", "count": 3}, {"x": 1}]'
    assert "JSON schema" in router.models[CHEAP].seen[0][0]

    router.models[CHEAP].replies[:] = ['{"title": "T", "count": "many"}']
    rid = await engine.start(write(tmp_path, SCHEMA), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed"
    assert run.error is not None and "does not fit the schema" in run.error
    failed = await store.get_step(rid, "a")
    assert failed is not None and failed.status == "failed"


async def test_executing_again_does_not_call_the_model_again(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(BIG)
    router.replies = ["once"]
    engine = WorkflowEngine(store, llm=_llm(router))
    rid = await engine.start(write(tmp_path, TEXT), "flow")
    await engine.execute(rid)
    assert router.asked(CHEAP) == 1
    [step] = [s for s in await store.list_steps(rid) if s.kind == "llm"]
    assert step.cost_usd == 2.0


async def test_the_same_prompt_twice_needs_a_key(store: WorkflowRuns, tmp_path: Path) -> None:
    body = """
        @workflow()
        async def flow(run: Run):
            await run.llm("same")
            await run.llm("same")
    """
    router = _Router(BIG)
    router.replies = ["a", "b"]
    engine = WorkflowEngine(store, llm=_llm(router))
    rid = await engine.start(write(tmp_path, body), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed"
    assert run.error is not None and "used twice" in run.error


async def test_without_a_model_the_step_fails_with_a_clear_error(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    engine = WorkflowEngine(store)
    rid = await engine.start(write(tmp_path, TEXT), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed"
    assert run.error is not None and "run.llm needs a model" in run.error


async def test_step_events_carry_the_model_and_cost(store: WorkflowRuns, tmp_path: Path) -> None:
    router = _Router(BIG)
    router.replies = ["hi"]
    seen: list[tuple[str, dict[str, Any]]] = []
    engine = WorkflowEngine(store, lambda n, p: seen.append((n, p)), llm=_llm(router))
    await engine.start(write(tmp_path, TEXT), "flow")
    done = [p for n, p in seen if n == "workflow.step.done" and p["kind"] == "llm"]
    assert done[0]["model"] == "deepseek/cheap" and done[0]["cost_usd"] == 2.0


async def test_cloud_only_a_wish_picks_by_tier_and_never_needs_a_local_model(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(BIG)
    router.replies = ["a", "b", "c"]
    llm = _llm(router)
    assert (await llm("p", None, None, None)).model == "deepseek/cheap"
    assert (await llm("p", None, "stronger", None)).model == "anthropic/big"
    assert router.asked(LOCAL) == 0
    with pytest.raises(WorkflowError, match="is a wish"):
        await llm("p", None, "deepseek/cheap", None)


async def test_local_only_forces_a_local_model_whatever_the_wish(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(LOCAL)
    router.replies = ["a", "b", "c"]
    llm = _llm(router, local_only=True)
    for wish in (None, "stronger", "frontier"):
        assert (await llm("p", None, wish, "/work")).model == "ollama/small"
    assert router.asked(BIG) == 0 and router.asked(CHEAP) == 0


async def test_local_only_with_only_a_hosted_model_fails_the_step_and_asks_nothing(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(BIG)
    router.replies = ["never"]
    engine = WorkflowEngine(store, llm=_llm(router, local_only=True))
    rid = await engine.start(write(tmp_path, TEXT), "flow")
    run = await store.get_run(rid)
    assert run is not None and run.status == "failed"
    assert run.error is not None and "stays on this Mac" in run.error
    assert router.asked(BIG) == 0 and router.asked(CHEAP) == 0


async def test_the_folder_of_the_run_is_what_decides_local_only(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    router = _Router(LOCAL)
    router.replies = ["x"]
    folders: list[str | None] = []

    def local_only(folder: str | None) -> bool:
        folders.append(folder)
        return True

    llm = WorkflowLlm(router, None, local_only=local_only, tier_of_profile=_tier)
    engine = WorkflowEngine(store, llm=llm)
    rid = await store.create_run("wf", "flow", str(write(tmp_path, TEXT)), "t", project="/private")
    await engine.execute(rid)
    assert folders == ["/private"]
    assert router.asked(LOCAL) == 1


async def test_a_local_call_waits_for_the_job_slot_behind_a_chat() -> None:
    router = _Router(LOCAL)
    router.replies = ["done"]
    dispatcher = Dispatcher(
        lambda call: {"chat": 2, "helper": 2, "job": 4}[call.role], local_slots=1
    )
    line = router.local_line(LOCAL)
    assert line is not None
    held, leave = asyncio.Event(), asyncio.Event()

    async def chat() -> None:
        async with dispatcher.hold(Call(line, "s1", "chat", "a chat")):
            held.set()
            await leave.wait()

    holder = asyncio.create_task(chat())
    await held.wait()
    call = asyncio.create_task(_llm(router, dispatcher=dispatcher)("p", None, None, None))
    await asyncio.sleep(0.05)
    assert router.asked(LOCAL) == 0
    leave.set()
    assert (await call).text == "done"
    await holder
    assert router.asked(LOCAL) == 1
