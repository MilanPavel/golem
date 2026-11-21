"""The three scopes of a helper's question and what a helper may hold (ADR-059, 8; #1327).

Scripted models, no real one. A helper's approval is answered once, for that helper, or with
``scope: "batch"`` for every helper of its ``delegate`` call; what a helper holds is its own.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ConfigDict, Field
from test_helper_model import (  # pyright: ignore
    BIG,
    CHEAP,
    LOCAL,
    _cloud_setup,
    _local_setup,
    _settings,
)
from test_helper_sessions import SETTINGS, WORKER  # pyright: ignore
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.models.dispatcher import Dispatcher
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.server.dispatcher import INVALID_PARAMS
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import NotAHelperBatchError, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import ApprovalNeededEvent, ChatEvent

WRITE = {"path": "new.txt", "content": "x"}


class _Model(BaseChatModel):
    """Answers by the brief a helper was given, so the order of the runs does not matter.

    A brief in ``calls`` makes a tool call first and answers "done" after its result. A brief in
    ``gates`` waits for that event before it calls.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    calls: dict[str, tuple[str, dict[str, Any]]] = Field(default_factory=dict)
    gates: dict[str, threading.Event] = Field(default_factory=dict)
    served: list[str] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "by-brief"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        del tools, kwargs
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        brief = next((m.text for m in reversed(messages) if isinstance(m, HumanMessage)), "")
        self.served.append(brief)
        message = AIMessage(content="done")
        if not isinstance(messages[-1], ToolMessage) and brief in self.calls:
            gate = self.gates.get(brief)
            if gate is not None:
                gate.wait(5)
            name, args = self.calls[brief]
            message = AIMessage(
                content="", tool_calls=[ToolCall(name=name, args=args, id=f"call_{brief}")]
            )
        return ChatResult(generations=[ChatGeneration(message=message)])


class _Rig:
    """A manager over the model above, with a policy file and, for a slot test, a dispatcher."""

    def __init__(
        self,
        database: Database,
        model: _Model,
        home: Path,
        *,
        settings: GolemSettings = SETTINGS,
        rules: str = "",
        slots: int | None = None,
    ) -> None:
        config = home / "config.toml"
        config.write_text(rules, encoding="utf-8")
        self.model = model
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.dispatcher = None if slots is None else Dispatcher(lambda call: 2, local_slots=slots)
        self.runtime = open_chat(
            ModelRouter(settings, model=model),
            InMemorySaver(),
            policy=Policy(config, home=home),
            dispatcher=self.dispatcher,
        )
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), self.records), self.records, self.runs
        )
        _RIGS.append(self)

    async def lead(self, project: Path, model: str = LOCAL) -> str:
        lead = await self.manager.create(model, cwd=str(project))
        await self.manager.set_mode(lead, "careful")
        return lead

    async def worker(
        self,
        lead: str,
        project: Path,
        brief: str,
        *,
        index: int = 0,
        call: str = "call-1",
        profile: str = LOCAL,
    ) -> str:
        ref = await self.manager.start_helper(
            lead, call, index, WORKER, brief, profile, str(project), label=brief
        )
        return ref.session_id

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def until(self, session_id: str, kind: str) -> list[ChatEvent]:
        async def seen() -> bool:
            return any(e.type == kind for e in await self.stored(session_id))

        await _until(seen)
        return await self.stored(session_id)

    async def asked(self, session_id: str) -> str:
        """The call id of the helper's open question, once its run waits for you."""
        events = await self.until(session_id, "approval.needed")

        async def waiting() -> bool:
            run = await self.runs.latest(session_id)
            return run is not None and run.status == "waiting"

        await _until(waiting)
        return [e for e in events if isinstance(e, ApprovalNeededEvent)][-1].data.call_id

    async def asks(self, session_id: str) -> int:
        return sum(isinstance(e, ApprovalNeededEvent) for e in await self.stored(session_id))

    async def allowed(self, session_id: str) -> list[tuple[str, str | None]]:
        return list(await self.manager.allowances(session_id))


_RIGS: list[_Rig] = []


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for rig in _RIGS:
        await rig.manager.cancel_all()
    _RIGS.clear()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


async def _until(check: Callable[[], Awaitable[bool]]) -> None:
    async with asyncio.timeout(5):
        while not await check():
            await asyncio.sleep(0.01)


def _model(*briefs: str, call: tuple[str, dict[str, Any]] = ("write_file", WRITE)) -> _Model:
    return _Model(calls={brief: call for brief in briefs})


async def _done(rig: _Rig, session_id: str) -> None:
    await rig.until(session_id, "session.completed")


# --- batch --------------------------------------------------------------------------------------


async def test_a_batch_answer_for_one_workers_call_answers_all_five(
    database: Database, project: Path, tmp_path: Path
) -> None:
    briefs = [f"w{i}" for i in range(5)]
    rig = _Rig(database, _model(*briefs), tmp_path)
    lead = await rig.lead(project)
    helpers = [await rig.worker(lead, project, b, index=i) for i, b in enumerate(briefs)]
    calls = [await rig.asked(h) for h in helpers]

    run_id = await rig.manager.respond(helpers[2], calls[2], "allow", scope="batch")
    assert run_id == (await rig.runs.latest(helpers[2])).run_id  # type: ignore[union-attr]

    for helper in helpers:
        await _done(rig, helper)
        assert await rig.asks(helper) == 1
    assert (project / "new.txt").read_text(encoding="utf-8") == "x"
    # The lead holds nothing a helper was given.
    assert await rig.allowed(lead) == []
    record = await rig.records.get(lead)
    assert record is not None and record.allowed_tools == ()


async def test_a_helper_that_asks_later_is_not_asked(
    database: Database, project: Path, tmp_path: Path
) -> None:
    model = _model("now", "later")
    gate = threading.Event()
    model.gates["later"] = gate
    rig = _Rig(database, model, tmp_path)
    lead = await rig.lead(project)
    now = await rig.worker(lead, project, "now", index=0)
    later = await rig.worker(lead, project, "later", index=1)
    call = await rig.asked(now)
    assert await rig.asks(later) == 0

    await rig.manager.respond(now, call, "allow", scope="batch")
    await _done(rig, now)
    gate.set()
    await _done(rig, later)

    assert await rig.asks(later) == 0
    assert (project / "new.txt").exists()
    # It is held in the helper's session, in its log too, so a restart keeps it.
    (pair,) = await rig.allowed(later)
    assert pair[0] == "write_file"
    record = await rig.records.get(later)
    assert record is not None and record.allowed_tools == (pair,)


async def test_a_batch_answer_reaches_only_the_helpers_of_its_call(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, _model("a", "b"), tmp_path)
    lead = await rig.lead(project)
    one = await rig.worker(lead, project, "a", call="call-1")
    other = await rig.worker(lead, project, "b", call="call-2")
    call = await rig.asked(one)
    await rig.asked(other)

    await rig.manager.respond(one, call, "allow", scope="batch")
    await _done(rig, one)

    assert await rig.allowed(other) == []
    run = await rig.runs.latest(other)
    assert run is not None and run.status == "waiting"


async def test_batch_deny_denies_those_waiting_and_not_the_ones_who_have_not_asked(
    database: Database, project: Path, tmp_path: Path
) -> None:
    model = _model("one", "two", "later")
    gate = threading.Event()
    model.gates["later"] = gate
    rig = _Rig(database, model, tmp_path)
    lead = await rig.lead(project)
    one = await rig.worker(lead, project, "one", index=0)
    two = await rig.worker(lead, project, "two", index=1)
    later = await rig.worker(lead, project, "later", index=2)
    call = await rig.asked(one)
    await rig.asked(two)

    await rig.manager.respond(one, call, "deny", scope="batch")
    for helper in (one, two):
        events = await _done_events(rig, helper)
        assert [e.data.message for e in events if e.type == "tool.failed"]
    assert not (project / "new.txt").exists()
    assert await rig.allowed(later) == []

    # A deny answers a question that was asked: the helper that had not asked is still asked.
    gate.set()
    await rig.asked(later)


async def _done_events(rig: _Rig, session_id: str) -> list[ChatEvent]:
    return await rig.until(session_id, "session.completed")


async def test_batch_on_a_session_that_is_not_a_helper_is_refused(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, _model("x"), tmp_path)
    lead = await rig.lead(project)
    with pytest.raises(NotAHelperBatchError, match="not a helper"):
        await rig.manager.respond(lead, "call_1", "allow", scope="batch")


async def test_batch_on_a_session_that_is_not_a_helper_is_invalid_params_over_the_socket(
    short_home: Path,
) -> None:
    model = _model("x")
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        assert isinstance(created, dict)
        found = await client.call(
            "approval.respond",
            {
                "session_id": str(created["session_id"]),
                "call_id": "call_1",
                "decision": "allow",
                "scope": "batch",
            },
        )
        assert error_code(found) == INVALID_PARAMS
        assert "not a helper" in str(found["error"])
        # The model refuses a batch with edited args, before the daemon sees it.
        edited = await client.call(
            "approval.respond",
            {
                "session_id": str(created["session_id"]),
                "call_id": "call_1",
                "decision": "allow",
                "args": {"path": "x"},
                "scope": "batch",
            },
        )
        assert error_code(edited) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


# --- this helper --------------------------------------------------------------------------------


async def test_allow_session_in_a_helper_is_that_helpers_and_ends_with_it(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, _model("one", "two"), tmp_path)
    lead = await rig.lead(project)
    one = await rig.worker(lead, project, "one", index=0)
    two = await rig.worker(lead, project, "two", index=1)
    call = await rig.asked(one)
    await rig.asked(two)

    await rig.manager.respond(one, call, "allow_session")
    await _done(rig, one)

    (pair,) = await rig.allowed(one)
    assert pair[0] == "write_file"
    # The other helper still waits for its own answer, and the lead holds nothing.
    assert await rig.allowed(two) == []
    assert await rig.allowed(lead) == []
    run = await rig.runs.latest(two)
    assert run is not None and run.status == "waiting"

    # It is the helper's session that holds it: closing the lead ends the helper, and a helper
    # of a later call starts without it.
    await rig.manager.respond(two, await rig.asked(two), "allow")
    await _done(rig, two)
    assert await rig.allowed(lead) == []
    await rig.manager.close(lead)
    assert one not in rig.manager._sessions
    gone = await rig.records.get(one)
    assert gone is not None and gone.closed_at is not None
    held = await rig.records.get(lead)
    assert held is not None and held.allowed_tools == ()


async def test_a_helper_of_the_next_call_does_not_inherit_what_the_last_one_was_given(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, _model("one", "again"), tmp_path)
    lead = await rig.lead(project)
    one = await rig.worker(lead, project, "one", call="call-1")
    await rig.manager.respond(one, await rig.asked(one), "allow", scope="batch")
    await _done(rig, one)

    again = await rig.worker(lead, project, "again", call="call-2")
    await rig.asked(again)
    assert await rig.allowed(again) == []


# --- what a helper starts with ------------------------------------------------------------------


async def test_a_helper_starts_with_its_leads_allowances_cut_to_its_tools(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rig = _Rig(database, _model("one"), tmp_path)
    lead = await rig.lead(project)
    live = await rig.manager._resolve(lead)
    live.allowed_tools.update(
        {("write_file", "new.txt"), ("edit_file", "a.py"), ("web_fetch", None), ("delegate", None)}
    )
    helper = await rig.worker(lead, project, "one")

    # The worker has read_file, write_file and shell: the rest is cut, and delegate never is.
    assert await rig.allowed(helper) == [("write_file", "new.txt")]
    assert len(await rig.allowed(lead)) == 4
    # The allowance the lead gave covers the call: the helper does not ask for it.
    await _done(rig, helper)
    assert await rig.asks(helper) == 0


async def test_the_leads_deny_rule_wins_inside_a_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    rules = '[[rule]]\ntool = "write_file"\naction = "deny"\n'
    rig = _Rig(database, _model("one", "two"), tmp_path, rules=rules)
    lead = await rig.lead(project)
    live = await rig.manager._resolve(lead)
    live.allowed_tools.add(("write_file", "new.txt"))
    one = await rig.worker(lead, project, "one", index=0)
    events = await _done_events(rig, one)
    failed = [e for e in events if e.type == "tool.failed"]
    assert len(failed) == 1 and await rig.asks(one) == 0
    assert not (project / "new.txt").exists()

    # A batch yes does not get past it either: the helper that has not asked is denied too.
    gate = threading.Event()
    rig.model.gates["two"] = gate
    two = await rig.worker(lead, project, "two", index=1, call="call-2")
    other = await rig.worker(lead, project, "one", index=2, call="call-2")
    gate.set()
    for helper in (two, other):
        await _done(rig, helper)
        assert await rig.asks(helper) == 0
    assert not (project / "new.txt").exists()


# --- local models only, cloud models only -------------------------------------------------------


async def test_local_models_only_a_batch_answer_runs_all_helpers_on_local_models(
    database: Database, project: Path, tmp_path: Path
) -> None:
    briefs = ["a", "b", "c"]
    settings = _settings(LOCAL)
    rig = _Rig(database, _model(*briefs), tmp_path, settings=settings)
    rig.manager.facts = _local_setup()
    lead = await rig.lead(project, LOCAL)
    helpers = [await rig.worker(lead, project, b, index=i) for i, b in enumerate(briefs)]
    calls = [await rig.asked(h) for h in helpers]

    await rig.manager.respond(helpers[0], calls[0], "allow", scope="batch")
    for helper in helpers:
        await _done(rig, helper)
        record = await rig.records.get(helper)
        assert record is not None and record.model_profile == LOCAL
        assert not any(e.type == "route.consent.needed" for e in await rig.stored(helper))


async def test_cloud_models_only_a_batch_answer_runs_all_helpers_on_hosted_models(
    database: Database, project: Path, tmp_path: Path
) -> None:
    briefs = ["a", "b", "c"]
    base = _settings(CHEAP)
    routing = base.routing.model_copy(update={"paid": "always"})
    settings = base.model_copy(update={"routing": routing})
    rig = _Rig(database, _model(*briefs), tmp_path, settings=settings)
    rig.manager.facts = _cloud_setup()
    lead = await rig.lead(project, CHEAP)
    helpers = [
        await rig.worker(lead, project, b, index=i, profile=CHEAP) for i, b in enumerate(briefs)
    ]
    calls = [await rig.asked(h) for h in helpers]

    await rig.manager.respond(helpers[1], calls[1], "allow", scope="batch")
    for helper in helpers:
        await _done(rig, helper)
        assert await rig.asks(helper) == 1
        record = await rig.records.get(helper)
        assert record is not None and record.model_profile in (CHEAP, BIG)
    assert await rig.allowed(lead) == []


# --- no slot while it waits ---------------------------------------------------------------------


async def test_a_helper_waiting_for_you_holds_no_model_slot(
    database: Database, project: Path, tmp_path: Path
) -> None:
    # One slot on the local line: a second helper can only run if the first gave its slot back
    # when it parked on its question.
    rig = _Rig(database, _model("first"), tmp_path, slots=1)
    lead = await rig.lead(project)
    first = await rig.worker(lead, project, "first", index=0)
    await rig.asked(first)
    second = await rig.worker(lead, project, "second", index=1)

    await _done(rig, second)
    run = await rig.runs.latest(first)
    assert run is not None and run.status == "waiting"
    assert rig.dispatcher is not None
    assert all(state.holders == () for state in rig.dispatcher.snapshot())
