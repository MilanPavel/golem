"""A helper survives a restart, wakes its lead, and a cancelled lead takes it along (ADR-059)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr

from golem.config import GolemSettings, ModelPrice, RoutingSettings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import recover_runs
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ChatEvent, EmptyEventData, RunFailedData


class _Model(ToolCallingChatModel):
    """Answers as scripted, except a call whose history holds a ``hang`` message: that waits,
    for ever or until :meth:`release`."""

    hangs: bool = True
    _waiting: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _released: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)

    @property
    def waiting(self) -> asyncio.Event:
        return self._waiting

    def release(self) -> None:
        """Let the waiting call answer."""
        self._released.set()

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if self.hangs and any(m.text == "hang" for m in messages if isinstance(m, HumanMessage)):
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

    def settings(self, project: Path) -> GolemSettings:
        if self.cloud:
            return GolemSettings(default_model="anthropic/big")
        return GolemSettings(
            default_model="ollama/qwen3:8b", routing=RoutingSettings(local_only=[str(project)])
        )

    @property
    def profile(self) -> str:
        return "anthropic/big" if self.cloud else "ollama/qwen3:8b"


SETUPS = [pytest.param(_Setup(False), id="local-only"), pytest.param(_Setup(True), id="cloud-only")]

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
        setup: _Setup,
        project: Path,
        home: Path,
        saver: InMemorySaver | None = None,
        log: SessionLog | None = None,
        hangs: bool = True,
    ) -> None:
        self.setup = setup
        self.model = _Model(replies=replies, hangs=hangs)
        self.saver = saver or InMemorySaver()
        self.runtime: ChatRuntime = open_chat(
            _Router(setup.settings(project), model=self.model),
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
        self.runtime.helpers = self.manager
        _LIVE.append(self)

    async def lead(self, project: Path) -> str:
        return await self.manager.create(self.setup.profile, cwd=str(project))

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

    async def restart(self, replies: list[Any]) -> _Chat:
        """A new process on the same files, after recovery ran."""
        after = _Chat(
            self.records_database,
            replies,
            self.setup,
            self.project,
            self.home,
            saver=self.saver,
            log=self.log,
            hangs=False,
        )
        after.records_database = self.records_database
        after.project, after.home = self.project, self.home
        await recover_runs(after.runs, after.events, after.log, after.runtime, after.manager)
        return after

    records_database: Database
    project: Path
    home: Path


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _chat(
    database: Database,
    replies: list[Any],
    setup: _Setup,
    project: Path,
    tmp_path: Path,
) -> _Chat:
    chat = _Chat(database, replies, setup, project, tmp_path)
    chat.records_database = database
    chat.project = project
    chat.home = tmp_path
    return chat


def _kinds(events: list[ChatEvent]) -> list[str]:
    return [e.type for e in events]


def _delegate(brief: str) -> list[tuple[str, dict[str, Any]]]:
    return [("delegate", {"agent": "explorer", "brief": brief})]


def _tool_results(model: ToolCallingChatModel) -> list[str]:
    return [m.text for seen in model.seen for m in seen if isinstance(m, ToolMessage)]


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_lead_wakes_when_its_helper_ends_and_finishes(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, [_delegate("look"), "found it", "all done"], setup, project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")

    events = await chat.until(lead, "run.completed")
    kinds = _kinds(events)
    for kind in ("helper.started", "helper.wait", "helper.ended"):
        assert kind in kinds
    waits = [e.data.state for e in events if e.type == "helper.wait"]
    assert waits == ["parked", "resumed"]
    assert kinds.index("helper.ended") < kinds.index("run.completed")
    ended = next(e for e in events if e.type == "helper.ended")
    assert (ended.data.stopped, ended.data.index, ended.data.model_calls) == ("done", 0, 1)
    assert "found it" in _tool_results(chat.model)[0]
    last = [e for e in events if e.type == "message.completed" and e.data.role == "assistant"][-1]
    assert last.data.text == "all done"
    # One helper session, and it was asked once.
    assert len(await chat.records.helpers_of(lead, ended.data.call_id)) == 1


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_restart_in_the_middle_of_a_helper_resumes_it_and_the_lead_finishes(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    before = _chat(database, [_delegate("hang")], setup, project, tmp_path)
    lead = await before.lead(project)
    await before.manager.send(lead, "go")
    await asyncio.wait_for(before.model.waiting.wait(), 5)
    await before.until(lead, "helper.wait")
    (helper,) = await before.records.open_helpers(lead)
    # The lead is parked: it asks nothing of you, so it shows as running.
    activity = await before.records.activity(lead)
    assert activity is not None
    assert summarize(activity).status == "running"
    parked = await before.runs.parked()
    assert [r.session_id for r in parked] == [lead]
    # The helper's run is still open: the daemon died here.
    assert (await before.runs.latest(helper)).status == "running"  # type: ignore[union-attr]

    after = await before.restart(["found it", "all done"])

    events = await after.until(lead, "run.completed")
    assert [e.data.state for e in events if e.type == "helper.wait"] == ["parked", "resumed"]
    assert "found it" in _tool_results(after.model)[0]
    own = await after.stored(helper)
    assert "run.completed" in _kinds(own)
    # The helper went on from its checkpoint: its brief was not sent twice.
    briefs = [e for e in own if e.type == "message.completed" and e.data.role == "user"]
    assert len(briefs) == 1


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_restart_with_the_helper_ended_wakes_the_lead(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    before = _chat(database, [_delegate("hang"), "found it"], setup, project, tmp_path)
    # The daemon dies after the helper's run ended and before it told or woke its lead.
    before.manager._helper_ended = _nothing  # type: ignore[method-assign]  # pyright: ignore
    before.manager._spawn_wake = _no_wake  # type: ignore[method-assign]  # pyright: ignore
    lead = await before.lead(project)
    await before.manager.send(lead, "go")
    # The helper answers only after the lead has parked, so the order does not depend on speed.
    await asyncio.wait_for(before.model.waiting.wait(), 5)
    await before.until(lead, "helper.wait")
    (helper,) = await _helpers(before, lead)
    before.model.release()
    await before.until(helper, "session.completed")
    assert "helper.ended" not in _kinds(await before.stored(lead))
    assert [r.session_id for r in await before.runs.parked()] == [lead]

    after = await before.restart(["all done"])

    events = await after.until(lead, "run.completed")
    kinds = _kinds(events)
    # The reconcile pass wrote the lost event, then woke the lead.
    assert kinds.count("helper.ended") == 1
    assert kinds.index("helper.ended") < kinds.index("helper.wait", kinds.index("helper.ended"))
    assert "found it" in _tool_results(after.model)[0]


async def _nothing(*args: object, **kwargs: object) -> None:
    del args, kwargs


def _no_wake(lead_id: str) -> None:
    del lead_id


async def _helpers(chat: _Chat, lead: str) -> list[str]:
    async def found() -> list[str]:
        return await chat.records.open_helpers(lead)

    async with asyncio.timeout(5):
        while not await found():
            await asyncio.sleep(0.01)
    return await found()


@pytest.mark.parametrize("setup", SETUPS)
async def test_cancelling_a_parked_lead_cancels_its_helpers_and_the_next_turn_goes_on(
    setup: _Setup, database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, [_delegate("hang"), "next answer"], setup, project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")
    await asyncio.wait_for(chat.model.waiting.wait(), 5)
    await chat.until(lead, "helper.wait")
    (helper,) = await chat.records.open_helpers(lead)
    waiting = await chat.runs.waiting(lead)
    assert waiting is not None and waiting.wait_reason == "team"

    assert await chat.manager.cancel(waiting.run_id) is True

    led = await chat.until(lead, "helper.ended")
    ended = next(e for e in led if e.type == "helper.ended")
    assert ended.data.stopped == "cancelled"
    assert "run.cancelled" in _kinds(await chat.stored(helper))
    assert (await chat.runs.latest(helper)).status == "cancelled"  # type: ignore[union-attr]
    run = await chat.runs.get(waiting.run_id)
    assert run is not None and run.status == "cancelled"
    # Nothing woke the cancelled lead, and its dangling delegate call is closed in the log.
    await asyncio.sleep(0.1)
    assert [e.data.state for e in led if e.type == "helper.wait"] == ["parked"]
    assert "tool.failed" in _kinds(await chat.stored(lead))

    await chat.manager.send(lead, "and now")
    done = await chat.until(lead, "run.completed")
    assert done[-1].type in ("run.completed", "session.completed", "message.completed")
    answered = [m for m in chat.model.seen[-1] if isinstance(m, ToolMessage)]
    assert len(answered) == 1


async def test_a_lead_whose_run_fails_cancels_its_helpers(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, [_delegate("hang")], _Setup(False), project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")
    await asyncio.wait_for(chat.model.waiting.wait(), 5)
    (helper,) = await chat.records.open_helpers(lead)

    # A run of the lead that ended in failure: the manager looks at it once the run is over.
    await chat.log.emit(lead, "r_failed", "run.started", EmptyEventData())
    await chat.log.emit(lead, "r_failed", "run.failed", RunFailedData(message="boom"))
    await chat.manager._after_run(lead, "r_failed")  # pyright: ignore[reportPrivateUsage]

    assert (await chat.runs.latest(helper)).status == "cancelled"  # type: ignore[union-attr]
    led = await chat.until(lead, "helper.ended")
    assert next(e for e in led if e.type == "helper.ended").data.stopped == "cancelled"


async def test_a_closed_helper_counts_as_ended(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, [_delegate("hang")], _Setup(False), project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")
    await asyncio.wait_for(chat.model.waiting.wait(), 5)
    (helper,) = await chat.records.open_helpers(lead)
    led = await chat.until(lead, "helper.started")
    call_id = next(e for e in led if e.type == "helper.started").data.call_id
    assert await chat.manager.helpers_ended(lead, call_id) is False

    await chat.manager.close(helper)

    assert await chat.manager.helpers_ended(lead, call_id) is True
    (outcome,) = await chat.manager.helper_results(lead, call_id)
    assert outcome.stopped == "cancelled"
