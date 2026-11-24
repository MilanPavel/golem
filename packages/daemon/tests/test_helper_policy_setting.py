"""The setting "Use helpers" (``[agents] use_helpers``): when needed, ask me first, never (ADR-059).

No model is involved: the doubles answer from a script, or hang until a test lets them go.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, ToolCallingChatModel, model_facts
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field, PrivateAttr

from golem.config import (
    AgentSettings,
    GolemSettings,
    ModelPrice,
    RoleSettings,
    RoutingSettings,
)
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.paths import resolve_paths
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import ApprovalNotFoundError, SessionManager
from golem.sessions.recovery import recover_runs
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.commands import SessionSummary
from golem_protocol.events import ChatEvent

DELEGATE = ("delegate", {"agent": "explorer", "brief": "look"})
DECLINED = "The user chose to do this in the chat. Do the work here, without helpers."


class _Model(ToolCallingChatModel):
    """Answers as scripted, except a call whose history holds a ``hang`` message: that waits
    until :meth:`release`. Keeps the tool names of every call that offered tools."""

    offered: list[list[str]] = Field(default_factory=list[list[str]])
    _waiting: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _released: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)

    @property
    def waiting(self) -> asyncio.Event:
        return self._waiting

    def release(self) -> None:
        self._released.set()

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        del kwargs
        self.offered = [*self.offered, [tool["function"]["name"] for tool in tools]]
        return self

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if any(m.text == "hang" for m in messages if isinstance(m, HumanMessage)):
            self._waiting.set()
            await self._released.wait()
        return self._generate(messages, stop, run_manager, **kwargs)


class _Router(ModelRouter):
    """Gives its one test double for any profile."""

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


def _tier(profile: str) -> Tier | None:
    return _TIERS.get(profile, "local")


@dataclass(frozen=True, slots=True)
class _Setup:
    """A setup with local models only, or with cloud models only."""

    cloud: bool

    def settings(self, project: Path, agents: AgentSettings) -> GolemSettings:
        if self.cloud:
            return GolemSettings(default_model="anthropic/big", agents=agents)
        return GolemSettings(
            default_model="ollama/qwen3:8b",
            routing=RoutingSettings(
                local_only=[str(project)], roles=RoleSettings(explore="anthropic/big")
            ),
            agents=agents,
        )

    @property
    def profile(self) -> str:
        return "anthropic/big" if self.cloud else "ollama/qwen3:8b"

    @property
    def helper_profile(self) -> str:
        return "deepseek/chat" if self.cloud else "ollama/qwen3:8b"


LOCAL = _Setup(False)
SETUPS = [pytest.param(LOCAL, id="local-only"), pytest.param(_Setup(True), id="cloud-only")]

_LIVE: list[_Chat] = []


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    """Stop the runs a test left going before its database closes."""
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


class _Chat:
    """One daemon process: a runtime and a manager over the shared database and checkpoints."""

    def __init__(
        self,
        database: Database,
        replies: list[Any],
        project: Path,
        home: Path,
        *,
        use_helpers: str = "when_needed",
        at_once: int = 3,
        setup: _Setup = LOCAL,
        saver: InMemorySaver | None = None,
        log: SessionLog | None = None,
        with_home: bool = False,
    ) -> None:
        self.setup = setup
        self.database, self.project, self.home = database, project, home
        agents = AgentSettings(use_helpers=use_helpers, at_once=at_once)  # type: ignore[arg-type]
        self.model = _Model(replies=replies)
        self.saver = saver or InMemorySaver()
        self.router = _Router(
            setup.settings(project, agents), model=self.model, home=home if with_home else None
        )
        self.runtime: ChatRuntime = open_chat(
            self.router,
            self.saver,
            default_registry(),
            Policy(None, home=home),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=_tier,
            budget_refs=lambda: ["deepseek/chat"] if setup.cloud else [],
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        # A restart keeps the log: two logs on one database would count the same seq twice.
        self.log = log or SessionLog(self.events, EventBus(), self.records)
        self.manager = SessionManager(self.runtime, self.log, self.records, self.runs)
        if setup.cloud:
            self.manager.facts = FixedFacts(
                model_facts("anthropic/big", "frontier", price=5.0),
                model_facts("deepseek/chat", "budget", price=0.5),
            )
        _LIVE.append(self)

    async def start(self) -> tuple[str, str]:
        lead = await self.manager.create(self.setup.profile, cwd=str(self.project))
        return lead, await self.manager.send(lead, "go")

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def until(self, session_id: str, kind: str, count: int = 1) -> list[ChatEvent]:
        async def seen() -> bool:
            return sum(e.type == kind for e in await self.stored(session_id)) >= count

        try:
            async with asyncio.timeout(5):
                while not await seen():
                    await asyncio.sleep(0.01)
        except TimeoutError:
            kinds = [e.type for e in await self.stored(session_id)]
            raise AssertionError(f"no {kind} in {kinds}") from None
        return await self.stored(session_id)

    async def finished(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status not in ("running", "waiting")

        await _until(done)
        return await self.events.for_run(run_id)

    async def summary(self, session_id: str) -> SessionSummary:
        """The row ``session.list`` gives for the session now."""
        activity = await self.records.activity(session_id)
        assert activity is not None
        own = await self.log.pending(activity)
        items = await self.log.pending_items(activity, own, await self.log.helpers(activity))
        return summarize(activity, pending=own, items=items)

    async def restart(self, replies: list[Any], **kwargs: Any) -> _Chat:
        """A new process on the same files, after recovery ran."""
        after = _Chat(
            self.database,
            replies,
            self.project,
            self.home,
            setup=self.setup,
            saver=self.saver,
            log=self.log,
            **kwargs,
        )
        await recover_runs(after.runs, after.events, after.log, after.runtime, after.manager)
        return after


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _types(events: list[ChatEvent]) -> list[str]:
    return [e.type for e in events]


def _helper_ids(events: list[ChatEvent]) -> list[str]:
    return [e.data.helper_id for e in events if e.type == "helper.started"]


def _result(events: list[ChatEvent], call_id: str = "call_1") -> str:
    for event in events:
        if event.type == "tool.completed" and event.data.call_id == call_id:
            return event.data.preview
        if event.type == "tool.failed" and event.data.call_id == call_id:
            return event.data.message
    raise AssertionError(f"no result for {call_id} in {_types(events)}")


async def _asked(chat: _Chat, lead: str) -> str:
    """Wait for the lead to park on "start these helpers?" and return the call id."""
    events = await chat.until(lead, "approval.needed")
    needed = next(e for e in events if e.type == "approval.needed")
    assert needed.data.source == "use_helpers"
    assert needed.data.name == "delegate"

    # approval.needed is logged before the run is marked waiting; a cancel in between would stop it.
    async def parked() -> bool:
        return await chat.runs.waiting(lead) is not None

    await _until(parked)
    return needed.data.call_id


# --- the three positions ------------------------------------------------------------------------


async def test_when_needed_starts_the_helper_and_asks_nothing(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "found", "done"], project, tmp_path)
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert "approval.needed" not in _types(events)
    assert len(_helper_ids(await chat.stored(lead))) == 1
    assert "delegate" in chat.model.offered[0]
    assert _result(events) == "found"


async def test_never_leaves_delegate_out_and_a_broad_question_is_answered_in_one_window(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["The answer, in this window."], project, tmp_path, use_helpers="never")
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert chat.model.offered and all("delegate" not in names for names in chat.model.offered)
    assert "read_file" in chat.model.offered[0]
    assert _helper_ids(await chat.stored(lead)) == []
    assert "run.completed" in _types(events)


async def test_never_refuses_a_delegate_call_the_model_makes_anyway(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "ok"], project, tmp_path, use_helpers="never")
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert "unknown tool" in _result(events)
    assert _helper_ids(await chat.stored(lead)) == []
    assert "run.completed" in _types(events)


async def test_a_change_of_the_setting_applies_to_the_next_message_without_a_restart(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["one", "two", "three"], project, tmp_path, with_home=True)
    config = resolve_paths(tmp_path).config_file
    lead, first = await chat.start()
    await chat.finished(first)
    assert "delegate" in chat.model.offered[-1]

    config.write_text('default_model = "ollama/qwen3:8b"\n[agents]\nuse_helpers = "never"\n')
    second = await chat.manager.send(lead, "again")
    await chat.finished(second)
    assert "delegate" not in chat.model.offered[-1]

    config.write_text('default_model = "ollama/qwen3:8b"\n[agents]\nuse_helpers = "ask"\n')
    third = await chat.manager.send(lead, "once more")
    await chat.finished(third)
    assert "delegate" in chat.model.offered[-1]


# --- ask me first -------------------------------------------------------------------------------


async def test_ask_parks_the_lead_on_a_batch_item_and_run_starts_the_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "found", "done"], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    stored = await chat.stored(lead)
    assert _helper_ids(stored) == []  # nothing started before the answer
    run = await chat.runs.get(run_id)
    assert run is not None and run.status == "waiting"
    row = await chat.summary(lead)
    assert row.status == "waiting"
    assert row.pending is None  # an older client reads this field and never sees the batch
    assert len(row.pending_items) == 1
    item = row.pending_items[0]
    assert (item.kind, item.call_id, item.helper_count, item.agents) == (
        "batch",
        call_id,
        1,
        ["explorer"],
    )

    assert await chat.manager.respond_helpers(lead, call_id, True) == run_id
    events = await chat.finished(run_id)
    resolved = next(e for e in events if e.type == "approval.resolved")
    assert (resolved.data.name, resolved.data.decision) == ("delegate", "allow")
    assert len(_helper_ids(await chat.stored(lead))) == 1
    assert _result(events) == "found"
    assert "run.completed" in _types(events)
    assert (await chat.summary(lead)).pending_items == []


async def test_ask_then_decline_tells_the_model_to_work_in_the_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "I read it myself."], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    await chat.manager.respond_helpers(lead, call_id, False)
    events = await chat.finished(run_id)

    assert _helper_ids(await chat.stored(lead)) == []
    assert DECLINED in _result(events)
    told = [m for m in chat.model.seen[-1] if isinstance(m, ToolMessage)]
    assert told and DECLINED in str(told[-1].content)
    assert "run.completed" in _types(events)
    resolved = next(e for e in events if e.type == "approval.resolved")
    assert resolved.data.decision == "deny"


async def test_a_yes_of_any_kind_runs_the_helper_and_writes_no_rule_or_allowance(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "found", "done"], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    # An older client answers with approval.respond and may offer "always".
    await chat.manager.respond(lead, call_id, "allow_always")
    events = await chat.finished(run_id)

    resolved = next(e for e in events if e.type == "approval.resolved")
    assert (resolved.data.decision, resolved.data.rule) == ("allow", None)
    assert await chat.manager.allowances(lead) == []
    assert not resolve_paths(tmp_path).config_file.exists()
    assert len(_helper_ids(await chat.stored(lead))) == 1


async def test_only_the_question_can_be_answered_with_helpers_respond(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "found", "done"], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    with pytest.raises(ApprovalNotFoundError):
        await chat.manager.respond_helpers(lead, "another-call", True)
    await chat.manager.respond_helpers(lead, call_id, True)
    await chat.finished(run_id)
    with pytest.raises(ApprovalNotFoundError):
        await chat.manager.respond_helpers(lead, call_id, True)


async def test_a_bad_delegate_call_is_refused_without_a_question(
    database: Database, project: Path, tmp_path: Path
) -> None:
    bad = ("delegate", {"agent": "explorer", "brief": "look", "model": "two words"})
    chat = _Chat(database, [[bad], "ok"], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert "approval.needed" not in _types(events)
    assert "invalid arguments for delegate" in _result(events)
    assert _helper_ids(await chat.stored(lead)) == []


async def test_cancelling_the_lead_while_it_waits_ends_the_question_and_starts_nothing(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE], "never read"], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    assert await chat.manager.cancel(run_id) is True
    stored = await chat.stored(lead)

    run = await chat.runs.get(run_id)
    assert run is not None and run.status == "cancelled"
    assert _helper_ids(stored) == []
    assert any(e.type == "tool.failed" and e.data.call_id == call_id for e in stored)
    assert (await chat.summary(lead)).pending_items == []
    with pytest.raises(ApprovalNotFoundError):
        await chat.manager.respond_helpers(lead, call_id, True)


async def test_the_question_survives_a_restart_and_the_answer_goes_on(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE]], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)
    await chat.manager.cancel_all()

    after = await chat.restart(["found", "done"], use_helpers="ask")
    run = await after.runs.get(run_id)
    assert run is not None and run.status == "waiting"
    row = await after.summary(lead)
    assert [i.call_id for i in row.pending_items] == [call_id]

    await after.manager.respond_helpers(lead, call_id, True)
    events = await after.finished(run_id)
    assert len(_helper_ids(await after.stored(lead))) == 1
    assert _result(events) == "found"


async def test_the_question_is_still_asked_when_the_setting_changed_while_it_waited(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[DELEGATE]], project, tmp_path, use_helpers="ask")
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)
    await chat.manager.cancel_all()

    # After the restart the setting says when needed: the stored answer still belongs to the call.
    after = await chat.restart(["found", "done"], use_helpers="when_needed")
    await after.manager.respond_helpers(lead, call_id, True)
    events = await after.finished(run_id)
    assert _result(events) == "found"
    assert "run.completed" in _types(events)


# --- the two setups ------------------------------------------------------------------------------


@pytest.mark.parametrize("setup", SETUPS)
async def test_ask_run_and_decline_work_with_local_models_only_and_with_cloud_models_only(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database, [[DELEGATE], "found", "done"], project, tmp_path, use_helpers="ask", setup=setup
    )
    lead, run_id = await chat.start()
    await chat.manager.respond_helpers(lead, await _asked(chat, lead), True)
    events = await chat.finished(run_id)
    started = next(e for e in await chat.stored(lead) if e.type == "helper.started")
    # No paid question and no hosted model for a local-only folder; a cheaper one in the cloud.
    assert started.data.model == setup.helper_profile
    assert _result(events) == "found"
    assert "route.consent.needed" not in _types(await chat.stored(_helper_ids(events)[0]))

    declined = _Chat(
        database, [[DELEGATE], "mine"], project, tmp_path, use_helpers="ask", setup=setup
    )
    other, other_run = await declined.start()
    await declined.manager.respond_helpers(other, await _asked(declined, other), False)
    ended = await declined.finished(other_run)
    assert DECLINED in _result(ended)
    assert _helper_ids(await declined.stored(other)) == []


@pytest.mark.parametrize("setup", SETUPS)
async def test_never_answers_in_one_window_with_local_models_only_and_with_cloud_models_only(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["in one window"], project, tmp_path, use_helpers="never", setup=setup)
    lead, run_id = await chat.start()
    await chat.finished(run_id)

    assert all("delegate" not in names for names in chat.model.offered)
    assert _helper_ids(await chat.stored(lead)) == []


# --- one after the other --------------------------------------------------------------------------


def _state(events: list[ChatEvent], call_id: str) -> list[tuple[str, str | None]]:
    return [
        (e.data.state, e.data.reason)
        for e in events
        if e.type == "helper.state" and e.data.call_id == call_id
    ]


async def test_when_one_helper_runs_at_a_time_the_next_waits_queued_for_its_turn(
    database: Database, project: Path, tmp_path: Path
) -> None:
    hang = ("delegate", {"agent": "explorer", "brief": "hang"})
    quick = ("delegate", {"agent": "explorer", "brief": "quick"})
    chat = _Chat(database, [[hang, quick], "first", "second", "done"], project, tmp_path, at_once=1)
    lead, run_id = await chat.start()
    await chat.until(lead, "helper.state")
    _first, second = _helper_ids(await chat.stored(lead))

    # The second helper has no run while the first one holds the only turn.
    assert await chat.runs.latest(second) is None
    stored = await chat.stored(lead)
    assert _state(stored, "call_2") == [("queued", "team")]
    assert _state(stored, "call_1") == []

    chat.model.release()
    events = await chat.finished(run_id)
    stored = await chat.stored(lead)
    assert _state(stored, "call_2") == [("queued", "team"), ("running", None)]
    ended = [e.data.call_id for e in stored if e.type == "helper.ended"]
    assert ended == ["call_1", "call_2"]  # one after the other
    assert "run.completed" in _types(events)
    assert (await chat.runs.latest(second)) is not None


async def test_room_for_every_helper_queues_none(
    database: Database, project: Path, tmp_path: Path
) -> None:
    one = ("delegate", {"agent": "explorer", "brief": "a"})
    two = ("delegate", {"agent": "explorer", "brief": "b"})
    chat = _Chat(database, [[one, two], "first", "second", "done"], project, tmp_path, at_once=2)
    lead, run_id = await chat.start()
    await chat.finished(run_id)

    assert "helper.state" not in _types(await chat.stored(lead))
    assert len(_helper_ids(await chat.stored(lead))) == 2


async def test_cancelling_the_lead_ends_a_helper_that_never_got_its_turn(
    database: Database, project: Path, tmp_path: Path
) -> None:
    hang = ("delegate", {"agent": "explorer", "brief": "hang"})
    quick = ("delegate", {"agent": "explorer", "brief": "quick"})
    chat = _Chat(database, [[hang, quick], "never read"], project, tmp_path, at_once=1)
    lead, run_id = await chat.start()
    await chat.until(lead, "helper.state")
    _first, second = _helper_ids(await chat.stored(lead))

    await chat.manager.cancel(run_id)
    chat.model.release()

    stored = await chat.stored(lead)
    ended = [e for e in stored if e.type == "helper.ended" and e.data.call_id == "call_2"]
    assert len(ended) == 1 and ended[0].data.stopped == "cancelled"
    assert await chat.runs.latest(second) is None  # it never ran
    assert "session.closed" in _types(await chat.stored(second))


async def test_stopping_a_queued_helper_ends_it_and_the_lead_goes_on(
    database: Database, project: Path, tmp_path: Path
) -> None:
    hang = ("delegate", {"agent": "explorer", "brief": "hang"})
    quick = ("delegate", {"agent": "explorer", "brief": "quick"})
    chat = _Chat(database, [[hang, quick], "first", "done"], project, tmp_path, at_once=1)
    lead, run_id = await chat.start()
    await chat.until(lead, "helper.state")
    _first, second = _helper_ids(await chat.stored(lead))

    assert await chat.manager.stop_helper(second) is True
    chat.model.release()
    events = await chat.finished(run_id)

    stored = await chat.stored(lead)
    stopped = {e.data.call_id: e.data.stopped for e in stored if e.type == "helper.ended"}
    assert stopped["call_2"] == "cancelled"
    assert "run.completed" in _types(events)
