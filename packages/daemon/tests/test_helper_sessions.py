"""Starting a helper session: one per key, linked to its lead, scoped by its agent (ADR-059)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.config import GolemSettings, ModelPrice, RoleSettings, RoutingSettings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.tools_node import NO_ASK_REFUSAL
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.helpers import NO_DELEGATE, NO_NESTED
from golem.sessions.log import SessionLog
from golem.sessions.manager import HelperSessionError, SessionManager
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import Tool, ToolContext, ToolError, ToolRegistry, ToolResult
from golem_protocol.events import (
    AgentSnapshot,
    ChatEvent,
    EmptyEventData,
    MessageStartedData,
    ToolRequestedData,
)

SETTINGS = GolemSettings(default_model="ollama/qwen3:8b")

EXPLORER = AgentSnapshot(
    name="explorer", source="bundled", tools=["read_file", "list_dir"], wish="cheapest"
)
WORKER = AgentSnapshot(
    name="worker",
    source="bundled",
    tools=["read_file", "write_file", "shell"],
    wish="cheapest",
    asks=True,
)
SILENT_WORKER = WORKER.model_copy(update={"name": "silent", "asks": False})


class _Router(ModelRouter):
    """Gives its one test double for any profile, so a test can pick another model."""

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


_LIVE: list[_Chat] = []


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    """Stop the runs a test left going before its database closes."""
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


class _Chat:
    def __init__(
        self,
        database: Database,
        replies: list[Any],
        *,
        settings: GolemSettings = SETTINGS,
        saver: InMemorySaver | None = None,
        tier_of: Callable[[str], Tier | None] | None = None,
        budget_refs: Callable[[], list[str]] | None = None,
        home: Path | None = None,
        registry: ToolRegistry | None = None,
    ) -> None:
        self.model = ToolCallingChatModel(replies=replies)
        self.saver = saver or InMemorySaver()
        self.runtime: ChatRuntime = open_chat(
            _Router(settings, model=self.model),
            self.saver,
            registry or default_registry(),
            Policy(None, home=home),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=tier_of,
            budget_refs=budget_refs,
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime,
            SessionLog(self.events, EventBus(), self.records),
            self.records,
            self.runs,
        )
        _LIVE.append(self)

    async def helper(
        self,
        lead: str,
        folder: Path | None,
        agent: AgentSnapshot = EXPLORER,
        *,
        call_id: str = "call-1",
        index: int = 0,
        brief: str = "look around",
        profile: str = "ollama/qwen3:8b",
    ) -> str:
        ref = await self.manager.start_helper(
            lead, call_id, index, agent, brief, profile, None if folder is None else str(folder)
        )
        return ref.session_id

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def until(self, session_id: str, kind: str) -> list[ChatEvent]:
        async def seen() -> bool:
            return any(e.type == kind for e in await self.stored(session_id))

        async with asyncio.timeout(5):
            while not await seen():
                await asyncio.sleep(0.01)
        return await self.stored(session_id)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


async def test_starting_twice_with_one_key_returns_one_session(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    first = await chat.manager.start_helper(
        lead, "call-1", 0, EXPLORER, "look", "ollama/qwen3:8b", str(project), label="a"
    )
    again = await chat.manager.start_helper(
        lead, "call-1", 0, EXPLORER, "look", "ollama/qwen3:8b", str(project), label="a"
    )
    other = await chat.helper(lead, project, call_id="call-1", index=1)
    elsewhere = await chat.helper(lead, project, call_id="call-2")

    assert (first.created, again.created) == (True, False)
    assert again.session_id == first.session_id
    assert len({first.session_id, other, elsewhere}) == 3
    await chat.until(first.session_id, "session.completed")
    mine = [e for e in await chat.stored(lead) if e.type == "helper.started"]
    assert [(e.data.call_id, e.data.index) for e in mine] == [
        ("call-1", 0),
        ("call-1", 1),
        ("call-2", 0),
    ]
    messages = [e for e in await chat.stored(first.session_id) if e.type == "message.completed"]
    assert [m.data.role for m in messages] == ["user", "assistant"]


async def test_a_helper_is_titled_with_its_agent_and_its_label_or_brief(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    labelled = await chat.manager.start_helper(
        lead,
        "call-1",
        0,
        EXPLORER,
        "look at everything",
        "ollama/qwen3:8b",
        str(project),
        label="routing",
    )
    plain = await chat.manager.start_helper(
        lead, "call-1", 1, EXPLORER, "x" * 30 + " " + "y" * 80, "ollama/qwen3:8b", str(project)
    )
    first = await chat.records.get(labelled.session_id)
    second = await chat.records.get(plain.session_id)
    assert first is not None
    assert second is not None
    assert first.title == "explorer · routing"
    # The list tells a helper from a chat by these two, and groups it under its lead.
    row = await chat.records.activity(labelled.session_id)
    assert row is not None
    assert (summarize(row).parent_session_id, summarize(row).agent) == (lead, "explorer")
    own = await chat.records.activity(lead)
    assert own is not None
    assert (summarize(own).parent_session_id, summarize(own).agent) == (None, None)
    assert second.title is not None
    assert second.title.startswith("explorer · xxxx")
    assert len(second.title) <= 60
    assert "\n" not in second.title


async def test_a_helper_session_is_linked_to_its_lead_and_its_agent(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_mode(lead, "autopilot")
    live = chat.manager._sessions[lead]  # pyright: ignore[reportPrivateUsage]
    live.allowed_tools = {("write_file", None), ("shell", "git status"), ("web_fetch", None)}
    helper = await chat.helper(lead, project, WORKER, brief="change a.py", index=2)

    record = await chat.records.get(helper)
    assert record is not None
    assert (record.origin, record.route, record.cwd) == ("agent:worker", "pinned", str(project))
    assert (record.parent_session_id, record.parent_call_id, record.helper_index) == (
        lead,
        "call-1",
        2,
    )
    assert record.agent == "worker"
    assert record.title == "worker · change a.py"
    assert record.model_profile == "ollama/qwen3:8b"
    # Cut to the agent's tools, and the lead's mode because this agent may ask.
    assert set(record.allowed_tools) == {("write_file", None), ("shell", "git status")}
    assert record.permission_mode == "autopilot"
    created = (await chat.stored(helper))[0]
    assert created.type == "session.created"
    assert created.data.parent is not None
    assert (created.data.parent.session_id, created.data.parent.index) == (lead, 2)
    assert created.data.agent == WORKER

    quiet = await chat.helper(lead, project, SILENT_WORKER, call_id="call-9")
    careful = await chat.records.get(quiet)
    assert careful is not None
    assert careful.permission_mode == "careful"


async def test_the_events_are_in_the_helpers_own_log_and_the_summaries_in_the_leads(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["the answer"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project, brief="find a")
    own = await chat.until(helper, "session.completed")

    kinds = [e.type for e in own]
    assert kinds[0] == "session.created"
    assert {"run.started", "message.completed", "session.completed"} <= set(kinds)
    brief = next(e for e in own if e.type == "message.completed" and e.data.role == "user")
    assert brief.data.text == "find a"
    led = await chat.until(lead, "helper.ended")
    assert [e.type for e in led if e.type != "session.created"] == [
        "helper.started",
        "helper.ended",
    ]
    started = next(e for e in led if e.type == "helper.started")
    assert (started.data.helper_id, started.data.agent, started.data.wish) == (
        helper,
        "explorer",
        "cheapest",
    )
    assert started.data.model == "ollama/qwen3:8b"


async def test_a_helper_for_a_session_with_a_parent_is_refused(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done", "never"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project)

    with pytest.raises(ToolError, match=NO_NESTED):
        await chat.helper(helper, project, call_id="call-7")
    assert await chat.records.helper(helper, "call-7", 0) is None


async def test_an_agent_with_delegate_in_its_tools_is_refused(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    greedy = EXPLORER.model_copy(update={"tools": ["read_file", "delegate"]})

    with pytest.raises(ToolError, match=NO_DELEGATE):
        await chat.helper(lead, project, greedy)
    assert await chat.records.helper(lead, "call-1", 0) is None


async def test_nobody_sends_a_message_to_a_helper_session(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project)
    await chat.until(helper, "session.completed")

    with pytest.raises(HelperSessionError):
        await chat.manager.send(helper, "hello")


async def test_a_helper_sees_only_the_tools_of_its_agent(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project)
    await chat.until(helper, "session.completed")

    assert sorted(chat.model.bound) == ["list_dir", "read_file"]


async def test_an_agent_that_never_asks_gets_a_refusal_where_another_would_ask(
    database: Database, project: Path, tmp_path: Path
) -> None:
    write = [("write_file", {"path": "new.txt", "content": "x"})]
    chat = _Chat(database, [write, "gave up", write], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_mode(lead, "careful")

    quiet = await chat.helper(lead, project, SILENT_WORKER, call_id="call-1")
    events = await chat.until(quiet, "session.completed")
    failed = [e for e in events if e.type == "tool.failed"]
    assert [e.data.message for e in failed] == [NO_ASK_REFUSAL]
    assert not (project / "new.txt").exists()

    asking = await chat.helper(lead, project, WORKER, call_id="call-2")
    events = await chat.until(asking, "approval.needed")
    needed = next(e for e in events if e.type == "approval.needed")
    assert needed.data.name == "write_file"


async def test_the_scope_is_read_again_from_the_record_after_a_restart(
    database: Database, project: Path, tmp_path: Path
) -> None:
    saver = InMemorySaver()
    write = [("write_file", {"path": "new.txt", "content": "x"})]
    before = _Chat(database, [write], saver=saver, home=tmp_path)
    lead = await before.manager.create(None, cwd=str(project))
    await before.manager.set_mode(lead, "careful")
    helper = await before.helper(lead, project, WORKER)
    events = await before.until(helper, "approval.needed")
    call_id = next(e for e in events if e.type == "approval.needed").data.call_id

    after = _Chat(database, ["written"], saver=saver, home=tmp_path)
    live = await after.manager._resolve(helper)  # pyright: ignore[reportPrivateUsage]
    assert (live.parent is not None, live.agent == WORKER) == (True, True)
    child = after.manager._child_of(live)  # pyright: ignore[reportPrivateUsage]
    assert child is not None
    assert (child.tools, child.asks) == (frozenset({"read_file", "write_file", "shell"}), True)
    await after.manager.respond(helper, call_id, "allow")
    await after.until(helper, "session.completed")
    assert (project / "new.txt").read_text(encoding="utf-8") == "x"


async def test_closing_the_lead_cancels_and_closes_its_helpers(
    database: Database, project: Path, tmp_path: Path
) -> None:
    write = [("write_file", {"path": "new.txt", "content": "x"})]
    chat = _Chat(database, [write, write], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_mode(lead, "careful")
    one = await chat.helper(lead, project, WORKER, call_id="call-1")
    two = await chat.helper(lead, project, WORKER, call_id="call-1", index=1)
    await chat.until(one, "approval.needed")
    await chat.until(two, "approval.needed")

    await chat.manager.close(lead)

    for helper in (one, two):
        record = await chat.records.get(helper)
        assert record is not None
        assert record.closed_at is not None
        kinds = [e.type for e in await chat.stored(helper)]
        assert "run.cancelled" in kinds
        assert kinds[-1] == "session.closed"
    assert await chat.records.open_helpers(lead) == []
    assert not (project / "new.txt").exists()


_TIERS: dict[str, Tier] = {"anthropic/big": "frontier", "deepseek/chat": "budget"}


def _paid(profile: str) -> Tier | None:
    return _TIERS.get(profile, "local")


async def test_a_local_only_folder_gets_a_local_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        routing=RoutingSettings(
            roles=RoleSettings(explore="anthropic/big"), local_only=[str(project)]
        ),
    )
    chat = _Chat(database, ["done"], settings=settings, tier_of=_paid, home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, EXPLORER, "look", "ollama/qwen3:8b", str(project)
    )

    assert ref.model == "ollama/qwen3:8b"
    record = await chat.records.get(ref.session_id)
    assert record is not None
    assert record.model_profile == "ollama/qwen3:8b"


async def test_a_cloud_only_setup_gets_the_cheapest_ready_budget_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = GolemSettings(default_model="anthropic/big")
    chat = _Chat(
        database,
        ["done"],
        settings=settings,
        tier_of=_paid,
        budget_refs=lambda: ["deepseek/chat"],
        home=tmp_path,
    )
    lead = await chat.manager.create("anthropic/big", cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, EXPLORER, "look", "anthropic/big", str(project)
    )

    assert ref.model == "deepseek/chat"
    record = await chat.records.get(ref.session_id)
    assert record is not None
    assert (record.model_profile, record.route) == ("deepseek/chat", "pinned")
    started = next(e for e in await chat.stored(lead) if e.type == "helper.started")
    assert (started.data.model, started.data.pick_reason) == (
        "deepseek/chat",
        "cheapest budget model",
    )
    await chat.until(ref.session_id, "session.completed")


async def test_a_cloud_only_setup_without_a_budget_model_uses_the_leads_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = GolemSettings(default_model="anthropic/big")
    chat = _Chat(database, ["done"], settings=settings, tier_of=_paid, home=tmp_path)
    lead = await chat.manager.create("anthropic/big", cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, EXPLORER, "look", "anthropic/big", str(project)
    )
    assert ref.model == "anthropic/big"
    await chat.until(ref.session_id, "session.completed")


class _NoArgs(BaseModel):
    pass


async def test_a_helper_started_in_a_run_of_its_lead_stores_tool_started_once(
    database: Database, project: Path, tmp_path: Path
) -> None:
    started: list[str] = []
    chat: _Chat

    async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
        del args
        assert ctx.session_id is not None
        for index in (0, 1):
            ref = await chat.manager.start_helper(
                ctx.session_id, "call-1", index, EXPLORER, "look", "ollama/qwen3:8b", str(project)
            )
            started.append(ref.session_id)
        return ToolResult(output="started", summary="started")

    spawn = Tool(name="spawn", description="starts", args=_NoArgs, run=run, read_only=True)
    chat = _Chat(
        database, [[("spawn", {})], "done", "done"], registry=ToolRegistry([spawn]), home=tmp_path
    )
    lead = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(lead, "go")
    await chat.until(lead, "run.completed")

    led = await chat.stored(lead)
    assert [e.data.index for e in led if e.type == "helper.started"] == [0, 1]
    tool_started = [e for e in led if e.type == "tool.started" and e.data.call_id == "call-1"]
    assert [e.run_id for e in tool_started] == [run_id]
    for helper in started:
        await chat.until(helper, "session.completed")


async def test_trace_span_of_a_helper_call_reads_the_helpers_own_thread(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["the answer"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project, brief="find a")
    own = await chat.until(helper, "session.completed")
    reply = next(e for e in own if e.type == "message.completed" and e.data.role == "assistant")
    # The lead asked with a `delegate` call, in a run of its own.
    log = chat.manager._events  # pyright: ignore[reportPrivateUsage]
    await log.emit(lead, "r_lead", "run.started", EmptyEventData())
    await log.emit(
        lead, "r_lead", "message.started", MessageStartedData(message_id="m_lead", role="assistant")
    )
    await log.emit(
        lead,
        "r_lead",
        "tool.requested",
        ToolRequestedData(call_id="call-1", message_id="m_lead", name="delegate", args={}),
    )

    _title, runs = await chat.manager.trace(lead)
    (delegate,) = runs[0].children[0].children
    assert [m.id for m in delegate.children] == [reply.data.message_id]
    found = await chat.manager.trace_span(lead, reply.data.message_id)
    assert [m.text for m in found.messages or [] if m.role == "user"] == ["find a"]
