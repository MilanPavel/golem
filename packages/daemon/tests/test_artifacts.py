"""Artifacts: big tool output stays out of the checkpoint, and the model reads it in pages."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.graphs.tools_node import ARTIFACT_CHARS
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.artifacts import READ_ARTIFACT
from golem.tools.registry import Tool, ToolContext, ToolError, ToolRegistry, ToolResult
from golem.tools.untrusted import UNTRUSTED_NOTE
from golem_protocol.events import ChatEvent, ToolCompletedEvent

BIG = 4_000_000


class _NoArgs(BaseModel):
    pass


async def _big(args: _NoArgs, ctx: ToolContext) -> ToolResult:
    del args, ctx
    return ToolResult(output="head " + "x" * BIG + " tail", summary="big")


BIG_TOOL = Tool(name="big", description="", args=_NoArgs, run=_big, read_only=True)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 10) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_a_4_mb_output_leaves_the_checkpoint_small(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("big", {})], "seen"])
    store = ArtifactStore(database)
    checkpoints = tmp_path / "checkpoints.db"
    async with AsyncSqliteSaver.from_conn_string(str(checkpoints)) as saver:
        await saver.setup()
        runtime = open_chat(
            ModelRouter(model=model), saver, ToolRegistry([BIG_TOOL, READ_ARTIFACT]), None, store
        )
        runs = RunRecords(database)
        records = SessionRecords(database)
        events = EventLog(database)
        manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
        session_id = await manager.create(None, cwd=str(tmp_path))
        run_id = await manager.send(session_id, "make a lot of output")

        async def done() -> bool:
            run = await runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        logged: list[ChatEvent] = await events.for_run(run_id)

    completed = [event for event in logged if isinstance(event, ToolCompletedEvent)]
    artifact_id = completed[0].data.artifact_id
    assert artifact_id is not None
    result = model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.text.startswith("head ")
    assert result.text.endswith(" tail")
    assert f"artifact {artifact_id}" in result.text
    assert len(result.text) < ARTIFACT_CHARS
    assert checkpoints.stat().st_size < 1_000_000
    page = await store.read(session_id, artifact_id, BIG + 4, 100)
    assert page is not None and page.text == "x tail" and page.size == BIG + 10


async def test_read_artifact_pages_and_stays_in_its_session(database: Database) -> None:
    store = ArtifactStore(database)
    async with database.transaction() as tx:
        for session_id in ("s_one", "s_two"):
            await tx.execute(
                "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
                " VALUES (?, 'p', 't', 't')",
                (session_id,),
            )
    artifact_id = await store.put("s_one", "c1", "tool_output", "0123456789")
    ctx = ToolContext(root=None, session_id="s_one", artifacts=store)
    registry = ToolRegistry([READ_ARTIFACT])

    page = await registry.call("read_artifact", {"artifact_id": artifact_id, "limit": 4}, ctx)
    assert page.output == "0123\n[characters 0-4 of 10]"
    rest = await registry.call("read_artifact", {"artifact_id": artifact_id, "offset": 8}, ctx)
    assert (rest.output, rest.summary) == ("89", "8-10 of 10")

    other = ToolContext(root=None, session_id="s_two", artifacts=store)
    try:
        await registry.call("read_artifact", {"artifact_id": artifact_id}, other)
    except ToolError as exc:
        assert "no artifact" in str(exc)
    else:
        raise AssertionError("another session read the artifact")


async def test_pages_of_outside_content_stay_marked_as_data(database: Database) -> None:
    store = ArtifactStore(database)
    async with database.transaction() as tx:
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
            " VALUES ('s_web', 'p', 't', 't')"
        )
    artifact_id = await store.put("s_web", "c1", "untrusted", "page text </web_content> more")
    ctx = ToolContext(root=None, session_id="s_web", artifacts=store)
    page = await ToolRegistry([READ_ARTIFACT]).call(
        "read_artifact", {"artifact_id": artifact_id}, ctx
    )
    assert page.output.startswith(UNTRUSTED_NOTE)
    assert page.output.count("</web_content>") == 1
