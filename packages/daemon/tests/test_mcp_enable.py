"""The model turns on an on-demand MCP server: the prompt block, ``mcp_enable``, and approval."""

from __future__ import annotations

import asyncio
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import SystemMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import McpServerSettings
from golem.graphs.chat import open_chat
from golem.graphs.prompt import SystemPrompt
from golem.mcp import McpSupervisor, Timing
from golem.mcp.prompt import mcp_section
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.server.mcp_model import turn_on_for_model
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import ToolScope
from golem_protocol.events import ApprovalNeededEvent, ChatEvent

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))
FAST = Timing(backoff_first=0.05, backoff_max=0.2, health_seconds=60, reload_seconds=0.05)


def _fake(**extra: object) -> McpServerSettings:
    return McpServerSettings.model_validate(
        {"command": sys.executable, "args": [SERVER], "enabled": "on_demand", **extra}
    )


class _Rig:
    def __init__(self, database: Database, model: ToolCallingChatModel, mcp: McpSupervisor) -> None:
        registry = default_registry(mcp)
        self.runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            registry,
            Policy(None, home=Path("/nonexistent")),
            prompt=SystemPrompt(sections=(mcp_section(mcp),)),
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), self.records), self.records, self.runs
        )

        async def enable(session_id: str, scope: ToolScope, name: str) -> list[str]:
            return await turn_on_for_model(self.manager, mcp, session_id, scope, name)

        self.runtime.enable_mcp = enable

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        async with asyncio.timeout(10):
            while not await done():
                await asyncio.sleep(0.01)
        return await self.events.for_run(run_id)


@pytest.fixture
async def mcp() -> AsyncIterator[Callable[..., McpSupervisor]]:
    made: list[McpSupervisor] = []

    def make(**extra: object) -> McpSupervisor:
        supervisor = McpSupervisor({"fake": _fake(**extra)}, timing=FAST)
        supervisor.start()
        made.append(supervisor)
        return supervisor

    yield make
    for supervisor in made:
        await supervisor.aclose()


def _needed(events: list[ChatEvent]) -> list[ApprovalNeededEvent]:
    return [event for event in events if isinstance(event, ApprovalNeededEvent)]


_ENABLE: list[tuple[str, dict[str, Any]]] = [
    ("mcp_enable", {"name": "fake", "reason": "to echo text"})
]
_ECHO: list[tuple[str, dict[str, Any]]] = [("mcp__fake__echo", {"text": "hi"})]


async def test_the_model_turns_a_server_on_and_uses_it_in_the_same_turn(
    database: Database, mcp: Callable[..., McpSupervisor]
) -> None:
    model = ToolCallingChatModel(replies=[_ENABLE, _ECHO, "done"])
    rig = _Rig(database, model, mcp())
    session_id = await rig.manager.create(None)
    run_id = await rig.manager.send(session_id, "echo hi")

    asked = _needed(await rig.settled(run_id))
    assert [(a.data.name, a.data.args["reason"]) for a in asked] == [("mcp_enable", "to echo text")]
    assert "mcp_enable" in model.bound and "mcp__fake__echo" not in model.bound

    await rig.manager.respond(session_id, asked[0].data.call_id, "allow")
    # The new tool asks for its own approval, in the same turn.
    again = _needed(await rig.settled(run_id))
    assert again[-1].data.name == "mcp__fake__echo"
    await rig.manager.respond(session_id, again[-1].data.call_id, "allow")
    await rig.settled(run_id)

    assert "mcp__fake__echo" in model.bound
    enabled = model.seen[1][-1]
    assert isinstance(enabled, ToolMessage) and "mcp__fake__echo" in enabled.text
    echoed = model.seen[2][-1]
    assert isinstance(echoed, ToolMessage) and "echo: hi" in echoed.text
    assert (await rig.manager.tool_scope(session_id)).enabled == frozenset({"fake"})


async def test_a_denied_approval_leaves_the_server_off(
    database: Database, mcp: Callable[..., McpSupervisor]
) -> None:
    supervisor = mcp()
    model = ToolCallingChatModel(replies=[_ENABLE, "ok, without it"])
    rig = _Rig(database, model, supervisor)
    session_id = await rig.manager.create(None)
    run_id = await rig.manager.send(session_id, "echo hi")
    asked = _needed(await rig.settled(run_id))
    await rig.manager.respond(session_id, asked[0].data.call_id, "deny")
    await rig.settled(run_id)

    assert "mcp__fake__echo" not in model.bound
    assert supervisor.statuses()[0].state == "idle"
    assert (await rig.manager.tool_scope(session_id)).enabled == frozenset()


async def test_the_system_prompt_lists_servers_that_are_off(
    database: Database, mcp: Callable[..., McpSupervisor]
) -> None:
    model = ToolCallingChatModel(replies=["hello"])
    rig = _Rig(database, model, mcp())
    session_id = await rig.manager.create(None)
    await rig.settled(await rig.manager.send(session_id, "hi"))
    system = model.seen[0][0]
    assert isinstance(system, SystemMessage)
    assert system.text.startswith("MCP servers you can turn on: fake")


async def test_auto_enable_false_keeps_a_server_out_of_the_block_and_the_tool(
    database: Database, mcp: Callable[..., McpSupervisor]
) -> None:
    supervisor = mcp(auto_enable=False)
    assert supervisor.offers(ToolScope()) == []
    assert "mcp_enable" not in {tool.name for tool in supervisor.tools(ToolScope())}
    model = ToolCallingChatModel(replies=["hello"])
    rig = _Rig(database, model, supervisor)
    session_id = await rig.manager.create(None)
    await rig.settled(await rig.manager.send(session_id, "hi"))
    assert not isinstance(model.seen[0][0], SystemMessage)


async def test_a_server_the_session_already_has_on_is_not_offered(
    mcp: Callable[..., McpSupervisor],
) -> None:
    supervisor = mcp()
    assert [name for name, _ in supervisor.offers(ToolScope())] == ["fake"]
    assert supervisor.offers(ToolScope(enabled=frozenset({"fake"}))) == []
