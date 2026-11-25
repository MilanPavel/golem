"""helper.stop, the helper counts on a lead's summary, and a helper's newest step (ADR-059).

No model is involved: the doubles hang, answer from a script, or wait for a gate.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel, make_checkout
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelPrice
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND
from golem.sessions.bus import EventBus
from golem.sessions.log import STEP_EVERY, SessionLog
from golem.sessions.manager import NotAHelperError, SessionManager, SessionNotFoundError
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.commands import SessionSummary
from golem_protocol.events import AgentSnapshot, ChatEvent

SETTINGS = GolemSettings(default_model="ollama/qwen3:8b")
PROFILE = "ollama/qwen3:8b"
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
WRITE = [("shell", {"command": "printf x > new.txt"})]


class _Model(ToolCallingChatModel):
    """Scripted, except where the history says otherwise.

    A history with a ``hang`` message waits forever. One with a ``later`` message waits for
    :attr:`go`. With :attr:`hang_after_tool` set, a call after two tool results waits for it too.
    """

    hang_after_tool: bool = False
    _go: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _hanging: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)

    @property
    def go(self) -> asyncio.Event:
        return self._go

    @property
    def hanging(self) -> asyncio.Event:
        return self._hanging

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        texts = [m.text for m in messages if isinstance(m, HumanMessage)]
        results = len([m for m in messages if isinstance(m, ToolMessage)])
        if "hang" in texts:
            self._hanging.set()
            await asyncio.Event().wait()
        if "later" in texts or (self.hang_after_tool and results >= 2):
            self._hanging.set()
            await self._go.wait()
        return self._generate(messages, stop, run_manager, **kwargs)


class _Router(ModelRouter):
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


class _Watch:
    def __init__(self) -> None:
        self.summaries: list[SessionSummary] = []

    def deliver_summary(self, summary: SessionSummary) -> None:
        self.summaries.append(summary)


class _Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


_LIVE: list[_Chat] = []


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


class _Chat:
    def __init__(self, database: Database, model: _Model, home: Path) -> None:
        self.model = model
        self.runtime: ChatRuntime = open_chat(
            _Router(SETTINGS, model=model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.watch = _Watch()
        bus = EventBus()
        bus.watch(self.watch)
        self.log = SessionLog(self.events, bus, self.records)
        self.clock = _Clock()
        self.log.clock = self.clock
        self.manager = SessionManager(self.runtime, self.log, self.records, self.runs)
        _LIVE.append(self)

    async def lead(self, folder: Path) -> str:
        lead = await self.manager.create(None, cwd=str(folder))
        await self.manager.set_mode(lead, "careful")
        return lead

    async def helper(
        self,
        lead: str,
        folder: Path,
        brief: str,
        agent: AgentSnapshot = EXPLORER,
        *,
        index: int = 0,
    ) -> str:
        ref = await self.manager.start_helper(
            lead, "call-1", index, agent, brief, PROFILE, str(folder)
        )
        return ref.session_id

    def pushed(self, session_id: str) -> list[SessionSummary]:
        return [s for s in self.watch.summaries if s.session_id == session_id]

    async def counts(self, lead: str) -> tuple[int | None, int | None]:
        """What a list of the lead reads now."""
        activity = await self.records.activity(lead)
        assert activity is not None
        found = await self.log.helpers(activity)
        return (None, None) if found is None else found

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)


async def _until(check: Callable[[], bool | Awaitable[bool]], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while True:
            found = check()
            if (await found) if isinstance(found, Awaitable) else found:
                return
            await asyncio.sleep(0.01)


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "golem-home"))
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    (root / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")
    return make_checkout(root)


def _last(chat: _Chat, session_id: str) -> SessionSummary:
    return chat.pushed(session_id)[-1]


def _helper_ids(events: list[ChatEvent]) -> list[str]:
    return [e.data.helper_id for e in events if e.type == "helper.started"]


# --- helper.stop ------------------------------------------------------------------------------


async def test_stopping_one_of_two_helpers_ends_it_cancelled_and_the_lead_goes_on(
    database: Database, project: Path, tmp_path: Path
) -> None:
    calls = [
        ("delegate", {"agent": "explorer", "brief": "hang"}),
        ("delegate", {"agent": "explorer", "brief": "quick"}),
    ]
    model = _Model(replies=[calls, "quick answer", "lead done"])
    chat = _Chat(database, model, tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(lead, "go")
    async with asyncio.timeout(5):
        await model.hanging.wait()

    async def both_started() -> bool:
        return len(_helper_ids(await chat.stored(lead))) == 2

    await _until(both_started)
    hung, quick = _helper_ids(await chat.stored(lead))

    async def quick_ended() -> bool:
        run = await chat.runs.latest(quick)
        return run is not None and run.status == "completed"

    await _until(quick_ended)
    # The other helper's end does not wake the lead: one helper still works.
    run = await chat.runs.get(run_id)
    assert run is not None and run.status == "waiting"

    assert await chat.manager.stop_helper(hung) is True

    async def lead_done() -> bool:
        found = await chat.runs.get(run_id)
        return found is not None and found.status == "completed"

    await _until(lead_done)
    ended = [e for e in await chat.stored(lead) if e.type == "helper.ended"]
    assert sorted(e.data.stopped for e in ended) == ["cancelled", "done"]
    hung_run = await chat.runs.latest(hung)
    assert hung_run is not None and hung_run.status == "cancelled"
    assert [e.type for e in await chat.stored(hung)].count("run.cancelled") == 1
    done = [e for e in await chat.stored(lead) if e.type == "message.completed"]
    assert done[-1].data.text == "lead done"


async def test_stopping_a_helper_with_no_run_says_false_and_a_non_helper_is_refused(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, _Model(replies=["found it"]), tmp_path)
    lead = await chat.lead(project)
    helper = await chat.helper(lead, project, "look")

    async def completed() -> bool:
        run = await chat.runs.latest(helper)
        return run is not None and run.status == "completed"

    await _until(completed)

    assert await chat.manager.stop_helper(helper) is False
    with pytest.raises(NotAHelperError):
        await chat.manager.stop_helper(lead)
    with pytest.raises(SessionNotFoundError):
        await chat.manager.stop_helper("nobody")


async def test_a_helper_parked_on_an_approval_is_stopped_too(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, _Model(replies=[WRITE]), tmp_path)
    lead = await chat.lead(project)
    helper = await chat.helper(lead, project, "write", WORKER)

    async def parked() -> bool:
        run = await chat.runs.latest(helper)
        return run is not None and run.status == "waiting"

    await _until(parked)

    assert await chat.manager.stop_helper(helper) is True

    run = await chat.runs.latest(helper)
    assert run is not None and run.status == "cancelled"
    ended = [e for e in await chat.stored(lead) if e.type == "helper.ended"]
    assert [e.data.stopped for e in ended] == ["cancelled"]


# --- the counts on a lead ---------------------------------------------------------------------


async def test_a_leads_summary_counts_its_running_and_waiting_helpers_and_then_none(
    database: Database, project: Path, tmp_path: Path
) -> None:
    model = _Model(replies=[WRITE])
    chat = _Chat(database, model, tmp_path)
    lead = await chat.lead(project)
    assert await chat.counts(lead) == (None, None)

    steady = await chat.helper(lead, project, "hang", index=0)
    later = await chat.helper(lead, project, "later", WORKER, index=1)

    await _until(lambda: _last(chat, lead).helpers_running == 2)
    assert (_last(chat, lead).helpers_running, _last(chat, lead).helpers_waiting) == (2, 0)
    assert await chat.counts(lead) == (2, 0)

    model.go.set()
    await _until(lambda: _last(chat, lead).helpers_waiting == 1)
    assert (_last(chat, lead).helpers_running, _last(chat, lead).helpers_waiting) == (1, 1)
    assert await chat.counts(lead) == (1, 1)

    assert await chat.manager.stop_helper(steady) is True
    assert await chat.manager.stop_helper(later) is True

    await _until(lambda: _last(chat, lead).helpers_running is None)
    assert (_last(chat, lead).helpers_running, _last(chat, lead).helpers_waiting) == (None, None)
    assert await chat.counts(lead) == (None, None)


# --- a helper's newest step -------------------------------------------------------------------


async def test_a_helpers_summary_shows_its_newest_step_and_none_once_it_ended(
    database: Database, project: Path, tmp_path: Path
) -> None:
    read_a = [("read_file", {"path": "a.py"})]
    read_b = [("read_file", {"path": "b.py"})]
    model = _Model(replies=[read_a, read_b, "done"], hang_after_tool=True)
    chat = _Chat(database, model, tmp_path)
    lead = await chat.lead(project)
    helper = await chat.helper(lead, project, "look")

    async def two_steps() -> bool:
        steps = [e for e in await chat.stored(lead) if e.type == "helper.step"]
        return len([s for s in steps if s.data.summary is not None]) == 2

    await _until(two_steps)
    steps = [e for e in await chat.stored(lead) if e.type == "helper.step" and e.data.summary]
    newest = steps[-1].data.summary
    assert newest is not None
    # The helper's last call is still to come: its summary reads the newest step.
    live = [s for s in chat.pushed(helper) if s.step is not None]
    assert live and live[-1].step == newest
    assert all(s.step is None or len(s.step) <= 200 for s in chat.pushed(helper))

    model.go.set()

    async def ended() -> bool:
        run = await chat.runs.latest(helper)
        return run is not None and run.status == "completed"

    await _until(ended)
    await _until(lambda: _last(chat, helper).status == "idle")
    assert _last(chat, helper).step is None
    # The step is forgotten when the helper's end is stored, a moment after the idle summary.
    await _until(lambda: chat.log.step(helper) is None)


async def test_a_new_step_pushes_the_helpers_summary_at_most_once_a_second(
    database: Database, project: Path, tmp_path: Path
) -> None:
    model = _Model(replies=[])
    chat = _Chat(database, model, tmp_path)
    lead = await chat.lead(project)
    helper = await chat.helper(lead, project, "hang")
    async with asyncio.timeout(5):
        await model.hanging.wait()
    await asyncio.sleep(0.2)  # the helper's own events settle
    before = len(chat.pushed(helper))

    await chat.log.note_step(helper, "read a.py")
    assert [s.step for s in chat.pushed(helper)[before:]] == ["read a.py"]

    chat.clock.now += STEP_EVERY / 2
    await chat.log.note_step(helper, "read b.py")
    assert len(chat.pushed(helper)) == before + 1
    # The step is kept: a summary read at any time shows the newest.
    assert chat.log.step(helper) == "read b.py"

    chat.clock.now += STEP_EVERY
    await chat.log.note_step(helper, "read c.py")
    assert [s.step for s in chat.pushed(helper)[before:]] == ["read a.py", "read c.py"]


# --- over the socket --------------------------------------------------------------------------


async def test_helper_stop_over_the_socket(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        folder = short_home / "work"
        folder.mkdir()
        lead = cast(
            str, rpc_result(await client.call("session.create", {"cwd": str(folder)}))["session_id"]
        )
        other = cast(
            str, rpc_result(await client.call("session.create", {"cwd": str(folder)}))["session_id"]
        )
        connection = sqlite3.connect(app.paths.database_file)
        try:
            connection.execute(
                "UPDATE sessions SET parent_session_id = ?, parent_call_id = 'c', helper_index = 0"
                " WHERE session_id = ?",
                (lead, other),
            )
            connection.commit()
        finally:
            connection.close()

        quiet = rpc_result(await client.call("helper.stop", {"session_id": other}))
        assert quiet == {"stopped": False}
        assert error_code(await client.call("helper.stop", {"session_id": lead})) == INVALID_PARAMS
        missing = await client.call("helper.stop", {"session_id": "nobody"})
        assert error_code(missing) == SESSION_NOT_FOUND
        assert error_code(await client.call("helper.stop", {})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
