"""``run.tool`` calls a golem or MCP tool as a step, through the permission engine (#1812)."""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
import types
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from golem.mcp.client import CallResult, McpTool
from golem.mcp.tools import mcp_tools
from golem.permissions.policy import Policy
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.tools.registry import ArtifactPage, Tool, ToolContext, ToolRegistry, ToolResult
from golem.workflow import idempotency_key
from golem.workflows.service import WorkflowService
from golem.workflows.tools import WorkflowTools

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"

RULES = """
[[rule]]
tool = "mcp__gh__list_prs"
action = "allow"

[[rule]]
tool = "mcp__gh__dump"
action = "allow"

[[rule]]
tool = "mcp__gh__delete_repo"
action = "deny"
"""

ALLOW = """
    @workflow()
    async def flow(run: Run):
        got = await run.tool("mcp__gh__list_prs", repo="golem")
        calls.log.append(got)
        return got
"""

DENY = """
    @workflow()
    async def flow(run: Run):
        await run.tool("mcp__gh__delete_repo", repo="golem")
        calls.log.append("unreachable")
"""

ASK = """
    @workflow()
    async def flow(run: Run):
        got = await run.tool("mcp__gh__create_issue", title="bug")
        calls.log.append(got)
"""

KEYED = """
    @workflow()
    async def flow(run: Run):
        a = await run.tool("record", key="send-1", text="a")
        b = await run.tool("record", key="send-2", text="b")
        c = await run.tool("record", text="c")
        calls.log.append([a, b, c])
"""

BIG = """
    @workflow()
    async def flow(run: Run):
        got = await run.tool("mcp__gh__dump")
        calls.log.append(len(got))
"""

TWICE = """
    @workflow()
    async def flow(run: Run):
        await run.tool("mcp__gh__list_prs")
        await run.tool("mcp__gh__list_prs")
"""

BIG_SIZE = 10_000


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str


class Artifacts:
    def __init__(self) -> None:
        self.items: dict[str, str] = {}

    async def put(self, session_id: str, call_id: str | None, kind: str, text: str) -> str:
        del session_id, call_id, kind
        artifact_id = f"a{len(self.items) + 1}"
        self.items[artifact_id] = text
        return artifact_id

    async def read(
        self, session_id: str, artifact_id: str, offset: int, limit: int
    ) -> ArtifactPage | None:
        del session_id
        text = self.items.get(artifact_id)
        if text is None:
            return None
        return ArtifactPage(
            text=text[offset : offset + limit], offset=offset, size=len(text), kind="tool_output"
        )


class Server:
    """A fake MCP server: the calls it got."""

    def __init__(self) -> None:
        self.got: list[tuple[str, Mapping[str, object]]] = []

    async def call(self, name: str, args: Mapping[str, object]) -> CallResult:
        self.got.append((name, args))
        text = "x" * BIG_SIZE if name == "dump" else f"{name} ok"
        return CallResult(content=[{"type": "text", "text": text}], is_error=False)


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Any:
    module = types.ModuleType("calls")
    module.log = []  # type: ignore[attr-defined]
    module.keys = []  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calls", module)
    return module


@pytest.fixture
def server() -> Server:
    return Server()


@pytest.fixture
def artifacts() -> Artifacts:
    return Artifacts()


@pytest.fixture
def tools(tmp_path: Path, calls: Any, server: Server, artifacts: Artifacts) -> WorkflowTools:
    config = tmp_path / "config.toml"
    config.write_text(RULES)
    listed = [
        McpTool(name=n, description=n, input_schema={"type": "object"})
        for n in ("list_prs", "delete_repo", "create_issue", "dump")
    ]

    async def record(args: _Record, ctx: ToolContext) -> ToolResult:
        del ctx
        calls.keys.append((args.text, idempotency_key()))
        return ToolResult(output=f"recorded {args.text}", summary="recorded")

    own = Tool(name="record", description="records", args=_Record, run=record, read_only=True)
    registry = ToolRegistry([own, *mcp_tools("gh", listed, server.call)])
    return WorkflowTools(
        registry=registry, policy=Policy(config, home=tmp_path), artifacts=artifacts
    )


def service(tmp_path: Path, store: WorkflowRuns, tools: WorkflowTools) -> WorkflowService:
    return WorkflowService(
        runs=store,
        user_dir=tmp_path / "user-workflows",
        user_file=tmp_path / "config.toml",
        trusted=lambda _p: True,
        broadcast=lambda _m: None,
        tools=tools,
    )


async def new_run(store: WorkflowRuns, tmp_path: Path, body: str) -> str:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    run_id = await store.create_run(f"{path}::flow", "flow", str(path), "2026-11-25T10:00:00Z")
    await store.set_run_session(run_id, "s_wf")
    return run_id


async def until(store: WorkflowRuns, run_id: str, status: str) -> None:
    for _ in range(200):
        run = await store.get_run(run_id)
        if run is not None and run.status == status:
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"run never became {status}")


async def run_to(
    tmp_path: Path, store: WorkflowRuns, tools: WorkflowTools, body: str, status: str
) -> str:
    svc = service(tmp_path, store, tools)
    run_id = await new_run(store, tmp_path, body)
    svc.launch(run_id)
    try:
        await until(store, run_id, status)
    finally:
        await svc.aclose()
    return run_id


async def test_allow_runs_the_mcp_tool_and_returns_its_text(
    tmp_path: Path, store: WorkflowRuns, calls: Any, server: Server, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, ALLOW, "done")
    assert server.got == [("list_prs", {"repo": "golem"})]
    assert calls.log == ["list_prs ok"]  # no data note or wrapper tag
    step = await store.get_step(run_id, "tool:mcp__gh__list_prs")
    assert step is not None and (step.kind, step.status) == ("tool", "done")
    assert json.loads(step.result_json or "null") == "list_prs ok"


async def test_deny_fails_the_step_with_the_rules_reason(
    tmp_path: Path, store: WorkflowRuns, calls: Any, server: Server, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, DENY, "failed")
    assert server.got == [] and calls.log == []
    step = await store.get_step(run_id, "tool:mcp__gh__delete_repo")
    assert step is not None and step.status == "failed"
    assert "mcp__gh__delete_repo is denied by" in (step.error or "")
    run = await store.get_run(run_id)
    assert run is not None and "denied by" in (run.error or "")


async def test_ask_waits_and_a_new_service_answers_it(
    tmp_path: Path, store: WorkflowRuns, calls: Any, server: Server, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, ASK, "waiting")
    assert server.got == []
    step = await store.get_step(run_id, "tool:mcp__gh__create_issue")
    assert step is not None and (step.kind, step.status) == ("tool", "waiting")
    (review,) = await store.list_open_reviews(run_id)
    pending = json.loads(review.pending_json)
    assert pending["ask"] == "Run mcp__gh__create_issue?"
    assert pending["draft"]["args"] == {"title": "bug"}

    second = service(tmp_path, store, tools)
    try:
        items = await second.pending_items("s_wf")
        assert [(i.kind, i.ask) for i in items] == [("review", "Run mcp__gh__create_issue?")]
        await second.answer_review(run_id, review.step_key, "approve", None)
        await until(store, run_id, "done")
    finally:
        await second.aclose()
    assert server.got == [("create_issue", {"title": "bug"})]
    assert calls.log == ["create_issue ok"]


async def test_a_no_to_the_question_fails_the_step(
    tmp_path: Path, store: WorkflowRuns, calls: Any, server: Server, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, ASK, "waiting")
    second = service(tmp_path, store, tools)
    try:
        await second.answer_review(run_id, "tool:mcp__gh__create_issue", "reject", None)
        await until(store, run_id, "failed")
    finally:
        await second.aclose()
    assert server.got == [] and calls.log == []
    step = await store.get_step(run_id, "tool:mcp__gh__create_issue")
    assert step is not None and step.status == "failed" and "not approved" in (step.error or "")


async def test_a_keyed_tool_step_gets_its_idempotency_key(
    tmp_path: Path, store: WorkflowRuns, calls: Any, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, KEYED, "done")
    assert calls.keys == [("a", "send-1"), ("b", "send-2"), ("c", None)]
    assert calls.log == [["recorded a", "recorded b", "recorded c"]]
    step = await store.get_step(run_id, "send-1")
    assert step is not None and step.kind == "tool"


async def test_big_output_lands_in_an_artifact_and_the_step_keeps_a_summary(
    tmp_path: Path, store: WorkflowRuns, calls: Any, artifacts: Artifacts, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, BIG, "done")
    assert calls.log == [BIG_SIZE]  # the workflow got all of it
    step = await store.get_step(run_id, "tool:mcp__gh__dump")
    assert step is not None
    saved = json.loads(step.result_json or "null")
    assert set(saved) == {"summary", "artifact_id", "size"}
    assert saved["size"] == BIG_SIZE and len(saved["summary"]) < 200
    assert artifacts.items[saved["artifact_id"]] == "x" * BIG_SIZE

    # A run executed again reads the whole text back from the artifact.
    second = service(tmp_path, store, tools)
    try:
        assert await second.engine.tool_output(run_id, saved) == "x" * BIG_SIZE
    finally:
        await second.aclose()


async def test_the_default_key_is_used_once_per_run(
    tmp_path: Path, store: WorkflowRuns, tools: WorkflowTools
) -> None:
    run_id = await run_to(tmp_path, store, tools, TWICE, "failed")
    run = await store.get_run(run_id)
    assert run is not None and "used twice" in (run.error or "")
