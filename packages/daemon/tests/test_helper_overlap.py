"""Helpers really run at once, and a helper the dispatcher holds back says why (#1352, #1356).

A fake model records when each call starts and ends, and holds every call until a test lets it
go. The dispatcher runs on a fake clock, so a one second notice takes a few milliseconds.

Local only: two explorers on a line of two slots overlap; on a line of one the second waits for
the first (``slot``, position 1). Cloud only: three explorers run at once, and a refusal shows
as a ``provider`` wait. Mixed: a helper on a paid model runs after the question, and the local
slot is free while it was parked.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field, PrivateAttr
from test_helper_model import BIG, LOCAL, _agent, _mixed_setup, _settings  # pyright: ignore
from test_helper_sessions import _Router  # pyright: ignore

from golem.config import AgentSettings, GolemSettings, ModelPrice
from golem.graphs.chat import open_chat
from golem.models.dispatcher import Call, Dispatcher, LineKey
from golem.models.tiers import Tier
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import ChatEvent, HelperStateData

LEAD = "go"


@dataclass
class _Span:
    start: float
    end: float | None = None


class _Model(ToolCallingChatModel):
    """Answers as scripted, after a test lets it go. Keeps when each call began and ended, by
    the brief it answers (the last human message)."""

    spans: dict[str, _Span] = Field(default_factory=dict[str, _Span])
    _open: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)

    def release(self) -> None:
        self._open.set()

    def running(self) -> int:
        return sum(1 for s in self.spans.values() if s.end is None)

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        brief = next(m.text for m in reversed(messages) if isinstance(m, HumanMessage))
        if brief == LEAD:  # a lead's own call is not under test
            return self._generate(messages, stop, run_manager, **kwargs)
        span = self.spans[brief] = _Span(time.monotonic())
        await self._open.wait()
        await asyncio.sleep(0.02)  # so two calls that ran at once cannot end before the other began
        span.end = time.monotonic()
        return self._generate(messages, stop, run_manager, **kwargs)


class _Clock:
    """A clock a sleep moves: the dispatcher's notices need no real seconds."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds / 100)
        self.now += seconds


def _rank(call: Call) -> int:
    return {"chat": 2, "helper": 2, "job": 4}[call.role]


_LIVE: list[_Rig] = []


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for rig in _LIVE:
        rig.model.release()
        await rig.manager.cancel_all()
    _LIVE.clear()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _tier(profile: str) -> Tier | None:
    return "frontier" if profile == BIG else "local"


class _Rig:
    def __init__(
        self,
        database: Database,
        replies: list[Any],
        home: Path,
        *,
        local_slots: int = 1,
        settings: GolemSettings | None = None,
        facts: FixedFacts | None = None,
    ) -> None:
        self.model = _Model(replies=replies)
        self.clock = _Clock()
        self.dispatcher = Dispatcher(
            _rank, clock=self.clock, sleep=self.clock.sleep, local_slots=local_slots
        )
        base = settings or GolemSettings(default_model=LOCAL)
        self.router = _Router(
            base.model_copy(update={"agents": AgentSettings(at_once=5)}), model=self.model
        )
        runtime = open_chat(
            self.router,
            InMemorySaver(),
            policy=Policy(None, home=home),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=_tier,
            dispatcher=self.dispatcher,
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), self.records), self.records, self.runs
        )
        if facts is not None:
            self.manager.facts = facts
        _LIVE.append(self)

    async def helper(
        self, lead: str, project: Path, brief: str, index: int, wish: str = "same"
    ) -> str:
        record = await self.records.get(lead)
        assert record is not None
        ref = await self.manager.start_helper(
            lead,
            "call-1",
            index,
            _agent(wish),
            brief,
            record.model_profile,
            str(project),
            label=brief,
        )
        return ref.session_id

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def until(self, check: Callable[[], Awaitable[bool] | bool]) -> None:
        async with asyncio.timeout(5):
            while True:
                found = check()
                if (await found) if isinstance(found, Awaitable) else found:
                    return
                await asyncio.sleep(0.01)

    async def done(self, helper: str) -> None:
        async def completed() -> bool:
            return any(e.type == "session.completed" for e in await self.stored(helper))

        await self.until(completed)

    async def states(self, lead: str, index: int) -> list[HelperStateData]:
        return [
            e.data
            for e in await self.stored(lead)
            if e.type == "helper.state" and e.data.index == index
        ]

    async def waiting(self, lead: str, index: int, reason: str) -> HelperStateData:
        async def seen() -> bool:
            return any(
                s.state == "waiting" and s.reason == reason for s in await self.states(lead, index)
            )

        await self.until(seen)
        return next(
            s for s in await self.states(lead, index) if s.state == "waiting" and s.reason == reason
        )

    def holders(self) -> dict[str, list[str | None]]:
        return {s.line: [h.session_id for h in s.holders] for s in self.dispatcher.snapshot()}


def _overlap(a: _Span, b: _Span) -> bool:
    assert a.end is not None and b.end is not None
    return a.start < b.end and b.start < a.end


# --- local models only --------------------------------------------------------------------------


async def test_local_two_explorers_on_two_slots_overlap_in_time(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, ["found", "found"], tmp_path, local_slots=2)
    lead = await rig.manager.create(LOCAL, cwd=str(project))
    one = await rig.helper(lead, project, "a", 0)
    two = await rig.helper(lead, project, "b", 1)

    await rig.until(lambda: rig.model.running() == 2)
    rig.model.release()
    await rig.done(one)
    await rig.done(two)

    assert _overlap(rig.model.spans["a"], rig.model.spans["b"])
    # Nothing waited, so the lead heard of no wait.
    assert await rig.states(lead, 0) == [] and await rig.states(lead, 1) == []


async def test_local_one_slot_the_second_waits_in_line_and_does_not_overlap(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, ["found", "found"], tmp_path, local_slots=1)
    lead = await rig.manager.create(LOCAL, cwd=str(project))
    one = await rig.helper(lead, project, "a", 0)
    await rig.until(lambda: rig.model.running() == 1)
    two = await rig.helper(lead, project, "b", 1)

    held = await rig.waiting(lead, 1, "slot")
    assert held.position == 1
    assert held.holder
    assert held.line is not None and "qwen3" in held.line
    assert held.retry_in_ms is None
    assert "b" not in rig.model.spans  # it has not reached the model
    assert await rig.states(lead, 0) == []

    rig.model.release()
    await rig.done(one)
    await rig.done(two)
    first, second = rig.model.spans["a"], rig.model.spans["b"]
    assert first.end is not None and first.end <= second.start
    # The slot comes, and the lead is told the helper runs again.
    assert (await rig.states(lead, 1))[-1] == HelperStateData(
        call_id="call-1", index=1, state="running"
    )


async def test_a_parked_lead_holds_no_slot_while_its_helpers_hold_and_wait(
    database: Database, project: Path, tmp_path: Path
) -> None:
    items = [{"agent": "explorer", "brief": b, "label": b} for b in ("a", "b")]
    rig = _Rig(database, [[("delegate", {"batch": items})], "found", "found", "all done"], tmp_path)
    lead = await rig.manager.create(LOCAL, cwd=str(project))
    run_id = await rig.manager.send(lead, LEAD)

    await rig.until(lambda: rig.model.running() == 1)
    (state,) = [s for s in rig.dispatcher.snapshot() if s.holders]
    (holder,) = state.holders
    assert holder.role == "helper" and holder.session_id != lead
    await rig.waiting(lead, 1, "slot")
    assert [w.role for w in state.waiting] in (["helper"], [])  # the other helper, never the lead
    parked = await rig.runs.latest(lead)
    assert parked is not None and parked.status == "waiting"

    rig.model.release()

    async def finished() -> bool:
        run = await rig.runs.get(run_id)
        return run is not None and run.status == "completed"

    await rig.until(finished)
    assert all(h == [] for h in rig.holders().values())


# --- cloud models only --------------------------------------------------------------------------


async def test_cloud_three_explorers_run_at_once_and_a_refusal_shows_as_a_provider_wait(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, ["found"] * 4, tmp_path, settings=_settings(BIG))
    lead = await rig.manager.create(BIG, cwd=str(project))
    ones = [await rig.helper(lead, project, b, i) for i, b in enumerate("abc")]

    await rig.until(lambda: rig.model.running() == 3)  # three at once on one provider line
    for i in range(3):
        assert await rig.states(lead, i) == []

    # The provider answers 429 with a wait of 20 s: the next call waits on the line.
    rig.dispatcher.refused(LineKey.provider("anthropic"), 20)
    fourth = await rig.helper(lead, project, "d", 3)
    held = await rig.waiting(lead, 3, "provider")
    assert held.line == "anthropic"
    assert held.retry_in_ms is not None and 0 < held.retry_in_ms <= 20_000

    rig.model.release()
    for helper in (*ones, fourth):
        await rig.done(helper)
    spans = rig.model.spans
    assert all(_overlap(spans["a"], spans[other]) for other in "bc")
    assert (await rig.states(lead, 3))[-1].state == "running"


# --- mixed --------------------------------------------------------------------------------------


async def test_mixed_a_paid_helper_runs_after_the_question_and_the_local_slot_is_free(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = _settings(LOCAL)
    settings = settings.model_copy(
        update={"routing": settings.routing.model_copy(update={"paid": "ask"})}
    )
    rig = _Rig(database, ["found"], tmp_path, settings=settings, facts=_mixed_setup())
    lead = await rig.manager.create(LOCAL, cwd=str(project))
    helper = await rig.helper(lead, project, "a", 0, wish="frontier")

    async def asked() -> bool:
        return any(e.type == "route.consent.needed" for e in await rig.stored(helper))

    await rig.until(asked)
    # Parked on the question: no line holds anything, local or hosted.
    assert all(h == [] for h in rig.holders().values())
    run = await rig.runs.latest(helper)
    assert run is not None
    await rig.manager.answer_consent(helper, run.run_id, "session")

    await rig.until(lambda: rig.model.running() == 1)
    held = rig.holders()
    assert held["provider:anthropic"] == [helper]
    assert all(not who for line, who in held.items() if line.startswith("local"))
    rig.model.release()
    await rig.done(helper)
