"""Plan first: a switch on the session, a read-only tool list, and a run that ends in a plan."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import cast

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.graphs.prompt import PLAN, PLAN_TEXT, PromptContext, SystemPrompt
from golem.graphs.tools_node import PLAN_REFUSAL
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import (
    ChatEvent,
    PlanProposedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
)

PLAN_TOOLS = [
    "read_file",
    "list_dir",
    "glob",
    "grep",
    "git_status",
    "git_diff",
    "git_log",
    "read_artifact",
    "todo_write",
    "propose_plan",
    "load_skill",
]


class _Chat:
    def __init__(self, database: Database, model: ToolCallingChatModel) -> None:
        runtime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            default_registry(),
            prompt=SystemPrompt(sections=(PLAN,)),
        )
        records = SessionRecords(database)
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def finished(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]]) -> None:
    async with asyncio.timeout(3):
        while not await check():
            await asyncio.sleep(0.01)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "fetcher.py").write_text("def fetch():\n    pass\n", encoding="utf-8")
    return root


def _untouched(project: Path) -> bool:
    return (project / "fetcher.py").read_text(encoding="utf-8") == "def fetch():\n    pass\n"


async def test_plan_first_offers_the_read_tools_and_propose_plan(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(replies=["ok", "ok"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.finished(await chat.manager.send(session_id, "hi"))
    assert "propose_plan" not in model.bound
    assert "edit_file" in model.bound

    await chat.manager.set_plan(session_id, True)
    await chat.finished(await chat.manager.send(session_id, "plan it"))
    assert model.bound == PLAN_TOOLS
    assert PLAN_TEXT in str(model.seen[-1][0].content)


def test_the_prompt_section_is_there_only_while_plan_first_is_on() -> None:
    prompt = SystemPrompt(sections=(PLAN,))
    assert prompt.text(PromptContext(state={})) == ""
    assert prompt.text(PromptContext(state={}, plan_first=True)) == PLAN_TEXT


async def test_a_write_is_refused_without_asking_and_nothing_is_written(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("edit_file", {"path": "fetcher.py", "old_text": "pass", "new_text": "retry()"})],
            [("write_file", {"path": "new.py", "content": "x\n"})],
            "I only read.",
        ]
    )
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_plan(session_id, True)
    events = await chat.finished(await chat.manager.send(session_id, "add retry"))

    types = [event.type for event in events]
    assert "approval.needed" not in types
    assert types[-1] == "run.completed"
    # Nothing was edited, so the checks do not run or ask.
    assert not {"check.offered", "check.started", "check.completed"} & set(types)
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert [event.data.message for event in failed] == [PLAN_REFUSAL, PLAN_REFUSAL]
    assert _untouched(project)
    assert not (project / "new.py").exists()
    result = model.seen[1][-1]
    assert isinstance(result, ToolMessage)
    assert result.text == f"error: {PLAN_REFUSAL}"


async def test_a_shell_command_is_refused_too(database: Database, project: Path) -> None:
    model = ToolCallingChatModel(replies=[[("shell", {"command": "ls"})], "ok"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_plan(session_id, True)
    events = await chat.finished(await chat.manager.send(session_id, "list"))
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert [event.data.message for event in failed] == [PLAN_REFUSAL]


async def test_propose_plan_sends_the_plan(database: Database, project: Path) -> None:
    plan = {
        "title": "Retry in the fetcher",
        "steps": [
            {"text": "Wrap fetch in a retry loop", "files": ["fetcher.py"]},
            {"text": "Add a test"},
        ],
    }
    model = ToolCallingChatModel(
        replies=[[("read_file", {"path": "fetcher.py"})], [("propose_plan", plan)], "Done."]
    )
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_plan(session_id, True)
    events = await chat.finished(await chat.manager.send(session_id, "add retry to the fetcher"))

    proposed = [event for event in events if isinstance(event, PlanProposedEvent)]
    assert len(proposed) == 1
    data = proposed[0].data
    assert data.title == "Retry in the fetcher"
    assert [(step.text, step.files) for step in data.steps] == [
        ("Wrap fetch in a retry loop", ["fetcher.py"]),
        ("Add a test", []),
    ]
    assert data.plan_id and data.call_id
    assert len([event for event in events if isinstance(event, ToolCompletedEvent)]) == 2
    reply = model.seen[2][-1]
    assert isinstance(reply, ToolMessage)
    assert reply.text == "The plan is shown to the user. Stop here and wait for their answer."
    types = [event.type for event in events]
    assert types.index("plan.proposed") < types.index("run.completed")
    assert "check.offered" not in types
    assert _untouched(project)


async def test_bad_plan_arguments_are_a_tool_error(database: Database, project: Path) -> None:
    model = ToolCallingChatModel(
        replies=[[("propose_plan", {"title": "No steps", "steps": []})], "ok"]
    )
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_plan(session_id, True)
    events = await chat.finished(await chat.manager.send(session_id, "plan"))
    assert not [event for event in events if isinstance(event, PlanProposedEvent)]
    failed = [event for event in events if isinstance(event, ToolFailedEvent)]
    assert len(failed) == 1
    assert failed[0].data.message.startswith("invalid arguments for propose_plan")


async def test_propose_plan_is_refused_when_plan_first_is_off(
    database: Database, project: Path
) -> None:
    plan = {"title": "T", "steps": [{"text": "one"}]}
    model = ToolCallingChatModel(replies=[[("propose_plan", plan)], "ok"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    events = await chat.finished(await chat.manager.send(session_id, "plan"))
    assert not [event for event in events if isinstance(event, PlanProposedEvent)]
    assert [event.type for event in events].count("tool.failed") == 1


async def test_the_switch_is_set_announced_once_and_survives_a_restart(short_home: Path) -> None:
    router = ModelRouter(GolemSettings())
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        result = rpc_result(
            await client.call("session.set_plan", {"session_id": session_id, "on": True})
        )
        assert result == {"session_id": session_id, "on": True}
        event = await client.wait_for_event("session.plan.changed")
        assert cast(dict[str, object], event["params"])["data"] == {"on": True}
        rpc_result(await client.call("session.set_plan", {"session_id": session_id, "on": True}))
        types = [cast(dict[str, object], e["params"])["type"] for e in client.events]
        assert types.count("session.plan.changed") == 1
        listed = rpc_result(await client.call("session.list", {}))
        sessions = cast(list[dict[str, object]], listed["sessions"])
        assert [s["plan_first"] for s in sessions] == [True]
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        before = len(await client.take_events())
        rpc_result(await client.call("session.set_plan", {"session_id": session_id, "on": True}))
        events = await client.take_events()
        later = [cast(dict[str, object], e["params"])["type"] for e in events[before:]]
        assert "session.plan.changed" not in later
        listed = rpc_result(await client.call("session.list", {}))
        sessions = cast(list[dict[str, object]], listed["sessions"])
        assert [s["plan_first"] for s in sessions] == [True]
        rpc_result(await client.call("session.set_plan", {"session_id": session_id, "on": False}))
        answers = [
            cast(dict[str, object], e["params"])["data"]
            for e in await client.take_events()
            if cast(dict[str, object], e["params"])["type"] == "session.plan.changed"
        ]
        assert answers[-1] == {"on": False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_bad_switch_or_session_is_refused(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings()))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        bad = await client.call(
            "session.set_plan", {"session_id": created["session_id"], "on": "maybe"}
        )
        assert error_code(bad) == INVALID_PARAMS
        missing = await client.call("session.set_plan", {"session_id": "s_nope", "on": True})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)
