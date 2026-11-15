"""Tool results are sized to the window of the model that reads them."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.graphs.result_budget import DEFAULT_BUDGET, ResultBudget, result_budget
from golem.graphs.tools_node import _for_model  # pyright: ignore[reportPrivateUsage]
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.artifacts import READ_ARTIFACT
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import ToolCompletedEvent


@pytest.mark.parametrize(
    ("window", "artifact", "head", "tail"),
    [
        (None, 20_000, 12_000, 4_000),
        (1024, 5_000, 3_000, 1_000),
        (8192, 5_000, 3_000, 1_000),
        (16384, 10_000, 6_000, 2_000),
        (32768, 20_000, 12_000, 4_000),
        (65536, 40_000, 24_000, 8_000),
        (131072, 60_000, 36_000, 12_000),
        (1_000_000, 60_000, 36_000, 12_000),
    ],
)
def test_the_budget_follows_the_window(
    window: int | None, artifact: int, head: int, tail: int
) -> None:
    assert result_budget(window) == ResultBudget(artifact, head, tail)


def test_an_unknown_window_gets_the_default() -> None:
    assert result_budget(None) is DEFAULT_BUDGET


async def _store(database: Database) -> ArtifactStore:
    async with database.transaction() as tx:
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
            " VALUES ('s_one', 'p', 't', 't')"
        )
    return ArtifactStore(database)


async def test_a_small_window_cuts_a_short_output(database: Database) -> None:
    store = await _store(database)
    output = "a" * 3_000 + "b" * 2_000 + "c" * 1_000
    small = result_budget(8192)
    model, artifact = await _for_model(store, "s_one", "c1", output, "tool_output", small)
    assert artifact is not None
    assert model.startswith("a" * 3_000 + "\n[2000 characters cut;")
    assert model.endswith("]\n" + "c" * 1_000)
    assert f"artifact {artifact}" in model
    big = result_budget(32768)
    assert await _for_model(store, "s_one", "c2", output, "tool_output", big) == (output, None)


async def test_without_a_store_the_cut_scales() -> None:
    output = "x" * 30_000
    model, artifact = await _for_model(None, None, "c1", output, "tool_output", result_budget(8192))
    assert artifact is None
    assert model.startswith("x" * 25_000 + "\n[output cut at 25000")


class _NoArgs(BaseModel):
    pass


async def _big(args: _NoArgs, ctx: ToolContext) -> ToolResult:
    del args, ctx
    return ToolResult(output="h" * 3_000 + "m" * 2_000 + "t" * 1_000, summary="big")


async def test_a_graph_on_an_8k_window_hands_the_model_the_short_form(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("big", {})], "seen"])
    tool = Tool(name="big", description="", args=_NoArgs, run=_big, read_only=True)
    runtime = open_chat(
        ModelRouter(model=model),
        InMemorySaver(),
        ToolRegistry([tool, READ_ARTIFACT]),
        None,
        ArtifactStore(database),
        window_of=lambda _, __: ContextWindow(8192, None),
    )
    runs = RunRecords(database)
    records = SessionRecords(database)
    events = EventLog(database)
    manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
    session_id = await manager.create(None, cwd=str(tmp_path))
    run_id = await manager.send(session_id, "go")
    async with asyncio.timeout(10):
        while (run := await runs.get(run_id)) is None or run.status == "running":
            await asyncio.sleep(0.01)
    done = [e for e in await events.for_run(run_id) if isinstance(e, ToolCompletedEvent)]
    assert done[0].data.artifact_id is not None
    assert done[0].data.preview == ("h" * 3_000 + "m" * 2_000 + "t" * 1_000)[:4_000]
    result = model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.text.startswith("h" * 3_000 + "\n[2000 characters cut;")
    assert result.text.endswith("t" * 1_000)


async def test_read_artifact_pages_by_the_budget(database: Database) -> None:
    store = await _store(database)
    artifact_id = await store.put("s_one", "c1", "tool_output", "z" * 10_000)
    registry = ToolRegistry([READ_ARTIFACT])
    ctx = ToolContext(root=None, session_id="s_one", artifacts=store, page_chars=4_000)
    page = await registry.call("read_artifact", {"artifact_id": artifact_id}, ctx)
    assert page.summary == "0-4000 of 10000"
