"""The ``delegate`` tool and the explorer: a helper session the lead parks for (ADR-059)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field, PrivateAttr

from golem.config import (
    AgentSettings,
    ExplorerSettings,
    GolemSettings,
    ModelPrice,
    RoleSettings,
    RoutingSettings,
)
from golem.graphs.adapter import plain_messages
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.child import CHILD_PROMPT, EXPLORER_TOOLS, FINAL_REQUEST, ChildLimits
from golem.models.dispatcher import Dispatcher
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow
from golem.permissions.policy import Policy
from golem.sessions import manager as manager_module
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import ToolScope
from golem_protocol.events import ChatEvent

SETTINGS = GolemSettings(default_model="ollama/qwen3:8b")
USAGE = {"input_tokens": 1_000, "output_tokens": 500, "total_tokens": 1_500}


class _Recording(ToolCallingChatModel):
    """Keeps the tool names of every call that offered tools."""

    offered: list[list[str]] = Field(default_factory=list[list[str]])

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        del kwargs
        self.offered = [*self.offered, [tool["function"]["name"] for tool in tools]]
        return self


class _Hanging(ToolCallingChatModel):
    """Answers as scripted, except a call whose history holds a ``hang`` message: that waits."""

    _waiting: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _stopped: bool = PrivateAttr(default=False)

    @property
    def waiting(self) -> asyncio.Event:
        return self._waiting

    @property
    def stopped(self) -> bool:
        return self._stopped

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if any(m.text == "hang" for m in messages if isinstance(m, HumanMessage)):
            self._waiting.set()
            try:
                await asyncio.Event().wait()
            finally:
                self._stopped = True
        return self._generate(messages, stop, run_manager, **kwargs)


class _Chat:
    def __init__(
        self,
        database: Database,
        model: ToolCallingChatModel,
        *,
        settings: GolemSettings = SETTINGS,
        limits: ChildLimits | None = None,
        dispatcher: Dispatcher | None = None,
        policy: Policy | None = None,
        tier_of: Callable[[str], Tier | None] | None = None,
        paid_ok: Callable[[str | None], Awaitable[bool]] | None = None,
        window_of: Callable[[str, Any], ContextWindow] | None = None,
    ) -> None:
        self.saver = InMemorySaver()
        self.runtime: ChatRuntime = open_chat(
            ModelRouter(settings, model=model),
            self.saver,
            default_registry(),
            policy,
            dispatcher=dispatcher,
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=tier_of,
            paid_ok=paid_ok,
            window_of=window_of,
        )
        if limits is not None:
            self.runtime.child_limits = limits
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def run(self, folder: Path, text: str = "go") -> tuple[str, str, list[ChatEvent]]:
        """Send ``text`` and wait for the run to end. Returns the session, the run, its events."""
        session_id = await self.manager.create(None, cwd=str(folder))
        run_id = await self.manager.send(session_id, text)
        return session_id, run_id, await self.finished(run_id)

    async def helper_ids(self, events: list[ChatEvent]) -> list[str]:
        """The helper sessions the lead's ``events`` started, in the order of the call."""
        return [e.data.helper_id for e in events if e.type == "helper.started"]

    async def helper_events(self, helper_id: str) -> list[ChatEvent]:
        return await self.events.after(helper_id, 0)

    async def finished(self, run_id: str) -> list[ChatEvent]:
        """Wait until the run ends. The lead parks for its helpers and is woken in the same run."""

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status not in ("running", "waiting")

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    (root / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")
    return root


def _call_ids(events: list[ChatEvent], *types: str) -> list[str]:
    found: list[str] = []
    for event in events:
        value: object = getattr(event.data, "call_id", None)
        if event.type in types and isinstance(value, str):
            found.append(value)
    return sorted(found)


def _delegate_result(events: list[ChatEvent], call_id: str = "call_1") -> str:
    done = [e for e in events if e.type == "tool.completed" and e.data.call_id == call_id]
    assert len(done) == 1
    assert done[0].type == "tool.completed"
    return done[0].data.preview


def _result_of(events: list[ChatEvent], call_id: str) -> str:
    for event in events:
        if event.type == "tool.completed" and event.data.call_id == call_id:
            return event.data.preview
        if event.type == "tool.failed" and event.data.call_id == call_id:
            return event.data.message
    raise AssertionError(f"no result for {call_id}")


def _ended(events: list[ChatEvent]) -> Any:
    return next(e for e in events if e.type == "helper.ended")


def _calls(events: list[ChatEvent]) -> list[ChatEvent]:
    return [e for e in events if e.type == "model.call.started"]


async def test_the_parent_delegates_and_keeps_only_the_answer(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            [("delegate", {"brief": "what is this repo, and which files matter"})],
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            "A tiny Python repo. a.py matters.",
            "It is a tiny Python repo.",
        ],
        usage=USAGE,
    )
    chat = _Chat(database, model, dispatcher=Dispatcher(lambda _call: 2))
    session_id, run_id, events = await chat.run(project)

    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "completed"
    # The parent's history holds the brief and the short answer, not the files.
    values = await chat.runtime.values(session_id)
    messages = plain_messages(values)
    assert [m.role for m in messages] == ["user", "assistant", "tool", "assistant"]
    assert messages[2].text == "A tiny Python repo. a.py matters."
    assert "def a()" not in "".join(m.text for m in messages)
    # The helper is a session with its own thread, which starts with the brief.
    (helper_id,) = await chat.helper_ids(events)
    helper = plain_messages(await chat.runtime.values(helper_id))
    roles = [m.role for m in helper]
    assert roles == ["user", "assistant", "tool", "assistant", "tool", "assistant"]
    assert helper[0].text == "what is this repo, and which files matter"
    assert "def a()" in helper[4].text
    # It saw the helper's prompt and tools, and the parent saw the parent's.
    first_helper_call = model.seen[1]
    assert isinstance(first_helper_call[0], SystemMessage)
    assert first_helper_call[0].content == CHILD_PROMPT
    assert set(model.offered[1]) == EXPLORER_TOOLS
    assert "delegate" in model.offered[0]
    assert "delegate" not in model.offered[1]


async def test_the_helpers_events_are_in_its_own_log_and_the_parent_log_has_a_summary(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look"})],
            [("grep", {"pattern": "def"}), ("list_dir", {"path": "."})],
            "found it",
            "ok",
        ],
        usage=USAGE,
    )
    chat = _Chat(database, model)
    _, _, events = await chat.run(project)

    # A new helper writes no ``parent_call_id``: its calls are not in the parent's log.
    assert not [e for e in events if getattr(e.data, "parent_call_id", None) is not None]
    # The lead's two calls: one before it parked, one after it was woken.
    assert len(_calls(events)) == 2
    kinds = [e.type for e in events]
    assert kinds.index("helper.started") < kinds.index("helper.ended")
    ended = next(e for e in events if e.type == "helper.ended")
    assert (ended.data.stopped, ended.data.model_calls) == ("done", 2)
    assert ended.data.cost_usd == pytest.approx(0.004)
    # The helper's own log has what a session has.
    (helper_id,) = await chat.helper_ids(events)
    own = await chat.helper_events(helper_id)
    assert len(_calls(own)) == 2
    requested = _call_ids(own, "tool.requested")
    assert len(requested) == 2
    assert requested == _call_ids(own, "tool.completed", "tool.failed")
    assert len([e for e in own if e.type == "model.call.completed"]) == 2
    # Only the run's own replies are messages of the parent.
    replies = [e for e in events if e.type == "message.completed" and e.data.role == "assistant"]
    assert len(replies) == 2
    # Each tool call of the helper is a thin ``helper.step`` of the lead's log: started, then ended.
    steps = [(e.data.name, e.data.status, e.data.args) for e in events if e.type == "helper.step"]
    grep, listing = {"pattern": "def"}, {"path": "."}
    assert sorted(steps, key=str) == sorted(
        [
            ("grep", "running", grep),
            ("list_dir", "running", listing),
            ("grep", "done", grep),
            ("list_dir", "done", listing),
        ],
        key=str,
    )
    # The ended step carries the tool's own one-line summary; the running step carries none.
    own = await chat.helper_events(helper_id)
    summaries = {e.data.call_id: e.data.summary for e in own if e.type == "tool.completed"}
    for e in events:
        if e.type == "helper.step":
            want = summaries[e.data.step_id] if e.data.status == "done" else None
            assert e.data.summary == want
    assert all(summaries.values())


async def test_a_long_or_multi_line_step_summary_is_cut_to_one_line_of_200_characters(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look"})],
            [("list_dir", {"path": "."})],
            "found it",
            "ok",
        ],
        usage=USAGE,
    )
    chat = _Chat(database, model)
    relay = chat.manager._events.after_emit  # pyright: ignore[reportPrivateUsage]
    assert relay is not None

    async def long_summary(event: ChatEvent) -> None:
        if event.type == "tool.completed":
            event = event.model_copy(
                update={"data": event.data.model_copy(update={"summary": "a\n  b\t" + "c" * 400})}
            )
        await relay(event)

    chat.manager._events.after_emit = long_summary  # pyright: ignore[reportPrivateUsage]
    _, _, events = await chat.run(project)

    steps = [e for e in events if e.type == "helper.step" and e.data.status == "done"]
    assert len(steps) == 1
    summary = steps[0].data.summary
    assert summary is not None
    assert len(summary) == 200
    assert summary.startswith("a b ccc")
    assert "\n" not in summary


async def test_helper_calls_carry_cost_and_are_usage_rows_of_the_helper_role(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[[("delegate", {"brief": "look"})], "found it", "ok"], usage=USAGE
    )
    chat = _Chat(database, model)
    _, _, events = await chat.run(project)

    (helper_id,) = await chat.helper_ids(events)
    inside = [e for e in await chat.helper_events(helper_id) if e.type == "model.call.completed"]
    assert len(inside) == 1
    assert inside[0].data.cost_usd == pytest.approx(0.002)
    rows = await database.fetch_all("SELECT role FROM model_calls ORDER BY started_at")
    assert sorted(row["role"] for row in rows) == ["chat", "chat", "helper"]


async def test_the_helper_cannot_call_delegate_shell_or_write(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            [("delegate", {"brief": "look"})],
            [
                ("delegate", {"brief": "again"}),
                ("shell", {"command": "ls"}),
                ("write_file", {"path": "x.py", "content": "x = 1\n"}),
                ("read_file", {"path": "b.py"}),
            ],
            "I could only read",
            "ok",
        ],
    )
    # The user's rules ask about b.py. A helper cannot be asked, so the call is refused.
    config = project.parent / "config.toml"
    config.write_text(
        '[[rule]]\ntool = "read_file"\npath = "b.py"\naction = "ask"\n', encoding="utf-8"
    )
    chat = _Chat(database, model, policy=Policy(config, home=project.parent))
    session_id, _, events = await chat.run(project)

    seen = model.seen[2]
    results = [m for m in seen if isinstance(m, ToolMessage)]
    assert [m.name for m in results] == ["delegate", "shell", "write_file", "read_file"]
    assert all(m.status == "error" for m in results)
    assert all(m.text.startswith("error: ") for m in results)
    assert "unknown tool" in results[0].text
    assert "cannot ask for approval" in results[3].text
    (helper_id,) = await chat.helper_ids(events)
    failed = [e for e in await chat.helper_events(helper_id) if e.type == "tool.failed"]
    assert len(failed) == 4
    assert not (project / "x.py").exists()
    # The helper went on and answered.
    assert _delegate_result(events) == "I could only read"
    assert (await chat.runtime.values(session_id)).get("messages")


async def test_past_the_call_limit_the_last_call_has_no_tools(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            [("delegate", {"brief": "look"})],
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            # The last call has no tools. A tool call in its reply is dropped, not run.
            "what I know so far",
            "ok",
        ],
    )
    chat = _Chat(database, model, limits=ChildLimits(max_calls=2))
    _, _, events = await chat.run(project)

    # parent, helper, helper, last helper call, parent: the last helper call offered no tools.
    assert len(model.seen) == 5
    assert len(model.offered) == 4
    last = model.seen[3]
    assert isinstance(last[-1], HumanMessage)
    assert last[-1].content == FINAL_REQUEST
    assert _delegate_result(events) == "explorer finished: calls\n\nwhat I know so far"
    assert _ended(events).data.stopped == "calls"
    # The request to answer is sent, never stored.
    (helper_id,) = await chat.helper_ids(events)
    thread = await chat.runtime.values(helper_id)
    assert FINAL_REQUEST not in "".join(m.text for m in plain_messages(thread))
    # The helper's calls do not count against the parent's.
    assert len(_calls(events)) == 2


async def test_a_reply_with_tool_calls_at_the_last_call_is_cut_to_its_text(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look"})],
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            "ok",
        ],
    )
    chat = _Chat(database, model, limits=ChildLimits(max_calls=1))
    _, _, events = await chat.run(project)

    assert _delegate_result(events) == "explorer finished: calls\n\n(the helper gave no answer)"
    assert _ended(events).data.stopped == "calls"
    (helper_id,) = await chat.helper_ids(events)
    thread = plain_messages(await chat.runtime.values(helper_id))
    assert thread[-1].role == "assistant"
    assert "→" not in thread[-1].text


async def test_the_answer_is_cut_to_answer_chars(database: Database, project: Path) -> None:
    model = ToolCallingChatModel(
        replies=[[("delegate", {"brief": "look"})], "x" * 50, "ok"],
    )
    chat = _Chat(database, model, limits=ChildLimits(answer_chars=10))
    session_id, _, events = await chat.run(project)

    assert _delegate_result(events) == "x" * 10
    messages = plain_messages(await chat.runtime.values(session_id))
    assert messages[2].text == "x" * 10


async def test_cancelling_the_parent_cancels_the_helper(database: Database, project: Path) -> None:
    model = _Hanging(replies=[[("delegate", {"brief": "hang"})]])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "go")
    async with asyncio.timeout(5):
        await model.waiting.wait()
        # The helper may reach its model before the lead's run is stored as parked.
        while (parked := await chat.runs.waiting(session_id)) is None:
            await asyncio.sleep(0.01)
    assert parked.run_id == run_id

    assert await chat.manager.cancel(run_id) is True
    events = await chat.finished(run_id)

    assert model.stopped
    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "cancelled"
    ended = next(e for e in events if e.type == "helper.ended")
    assert ended.data.stopped == "cancelled"
    (helper_id,) = await chat.helper_ids(events)
    helper_run = await chat.runs.latest(helper_id)
    assert helper_run is not None and helper_run.status == "cancelled"


async def test_the_default_registry_has_delegate_and_a_scope_can_leave_it_out() -> None:
    registry = default_registry()
    tool = registry.get("delegate")
    assert tool is not None
    assert tool.read_only
    assert "delegate" in registry.default_allowed()
    assert registry.plan_allows("delegate")
    helper = registry.scoped(ToolScope(only=EXPLORER_TOOLS))
    assert set(helper.names) == EXPLORER_TOOLS
    assert {s["function"]["name"] for s in helper.schemas()} == EXPLORER_TOOLS  # type: ignore[index]
    assert helper.get("shell") is None


async def test_without_a_helper_host_delegate_is_refused_with_a_message(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look"})], "ok"])
    chat = _Chat(database, model)
    chat.runtime.helpers = None
    _, _, events = await chat.run(project)

    assert "a helper cannot be started here" in _result_of(events, "call_1")


def _tiers(profile: str) -> Tier:
    return "frontier" if profile == "anthropic/big" else "local"


def test_the_explore_role_stays_local_for_a_local_only_session() -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        routing=RoutingSettings(roles=RoleSettings(explore="anthropic/big")),
    )
    runtime = open_chat(
        ModelRouter(settings, model=ToolCallingChatModel(replies=[])),
        InMemorySaver(),
        tier_of=_tiers,
    )
    assert runtime.explore_role("ollama/qwen3:8b").profile == "anthropic/big"
    kept = runtime.explore_role("ollama/qwen3:8b", local_only=True)
    assert (kept.profile, kept.same_as_session) == ("ollama/qwen3:8b", True)


def test_the_explore_role_on_a_local_session_is_the_same_model() -> None:
    runtime = open_chat(
        ModelRouter(SETTINGS, model=ToolCallingChatModel(replies=[])),
        InMemorySaver(),
        tier_of=_tiers,
    )
    role = runtime.explore_role("ollama/qwen3:8b")
    assert (role.profile, role.same_as_session) == ("ollama/qwen3:8b", True)


def test_the_explorer_settings_have_limits() -> None:
    explorer = ExplorerSettings()
    assert (explorer.max_calls, explorer.timeout_seconds) == (15, 300)
    assert (explorer.answer_chars, explorer.max_per_turn) == (6_000, 3)
    assert GolemSettings().agents == AgentSettings()
    for bad in ({"max_calls": 0}, {"max_calls": 51}, {"timeout_seconds": 0}, {"max_per_turn": 0}):
        with pytest.raises(ValueError):
            ExplorerSettings(**bad)
    with pytest.raises(ValueError):
        ExplorerSettings(unknown=1)  # type: ignore[call-arg]


async def test_the_settings_bound_the_helper(database: Database, project: Path) -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        agents=AgentSettings(explorer=ExplorerSettings(max_calls=2, answer_chars=7)),
    )
    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look"})], "x" * 50, "ok"])
    chat = _Chat(database, model, settings=settings)
    assert chat.runtime.child_limits.max_calls == 2
    _, _, events = await chat.run(project)
    assert _delegate_result(events) == "x" * 7


async def test_the_fourth_delegate_of_a_run_gets_an_error_result(
    database: Database, project: Path
) -> None:
    calls = [("delegate", {"brief": f"look {n}"}) for n in range(4)]
    model = ToolCallingChatModel(replies=[calls, "one", "two", "three", "ok"])
    chat = _Chat(database, model)
    session_id, run_id, events = await chat.run(project)

    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "completed"
    # Three helpers ran beside each other: which answered first does not matter.
    answers = sorted(_result_of(events, f"call_{n}") for n in (1, 2, 3))
    assert answers == ["one", "three", "two"]
    assert "no more helpers in this turn; continue with what you have" in _result_of(
        events, "call_4"
    )
    assert len(await chat.helper_ids(events)) == 3
    tools = [m for m in plain_messages(await chat.runtime.values(session_id)) if m.role == "tool"]
    assert len(tools) == 4


async def test_a_new_turn_has_its_own_helpers(database: Database, project: Path) -> None:
    replies: list[str | list[tuple[str, dict[str, str]]]] = [
        [("delegate", {"brief": "a"}), ("delegate", {"brief": "b"})],
        "one",
        "two",
        "first turn",
        [("delegate", {"brief": "c"})],
        "three",
        "second turn",
    ]
    chat = _Chat(
        database,
        ToolCallingChatModel(replies=replies),  # type: ignore[arg-type]
        settings=GolemSettings(
            default_model="ollama/qwen3:8b",
            agents=AgentSettings(explorer=ExplorerSettings(max_per_turn=2)),
        ),
    )
    session_id, _, _ = await chat.run(project)
    run_id = await chat.manager.send(session_id, "again")
    events = await chat.finished(run_id)
    assert _result_of(events, "call_3") == "three"


async def test_two_delegates_in_one_reply_start_two_helpers_that_run_beside_each_other(
    database: Database, project: Path
) -> None:
    calls = [("delegate", {"brief": "first"}), ("delegate", {"brief": "second"})]
    model = ToolCallingChatModel(replies=[calls, "one", "two", "ok"])
    chat = _Chat(database, model)
    session_id, _, events = await chat.run(project)

    started = [e for e in events if e.type == "helper.started"]
    assert [e.data.call_id for e in started] == ["call_1", "call_2"]
    assert len({e.data.helper_id for e in started}) == 2
    assert sorted(_result_of(events, c) for c in ("call_1", "call_2")) == ["one", "two"]
    # The lead parked once for both, and went on once.
    states = [
        e.data.state for e in events if e.type == "helper.wait" and e.data.call_id == "call_1"
    ]
    assert states == ["parked", "resumed"]
    messages = plain_messages(await chat.runtime.values(session_id))
    assert len([m for m in messages if m.role == "tool"]) == 2


async def test_usage_rows_of_a_helper_are_grouped_as_helper_by_cost_get(
    database: Database, project: Path
) -> None:
    from golem.sessions.usage import EVER, Usage

    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look"})], "found", "ok"])
    chat = _Chat(database, model)
    await chat.run(project)

    summary = await Usage(database).summary(since_day=EVER)
    by_role = {row.role: row.calls for row in summary.by_role}
    assert by_role == {"chat": 2, "helper": 1}


async def test_a_local_helper_is_not_stopped_by_a_spent_cap(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look"})], "found it", "ok"])

    async def spent(session_id: str | None) -> bool:
        del session_id
        return False

    chat = _Chat(database, model, tier_of=lambda _profile: "local", paid_ok=spent)
    _, _, events = await chat.run(project)
    assert _delegate_result(events) == "found it"


def test_a_note_of_golem_does_not_start_a_new_count_of_helpers() -> None:
    from langchain_core.messages import HumanMessage, ToolMessage

    from golem.graphs.notes import note
    from golem.graphs.tools_node import _delegated_this_turn  # pyright: ignore

    done = ToolMessage(content="x", tool_call_id="c1", name="delegate")
    history = [HumanMessage(content="hi"), done, note("checks failed"), done]
    assert _delegated_this_turn(history) == 2
    assert _delegated_this_turn([*history, HumanMessage(content="next")]) == 0


async def test_the_trace_nests_the_helper_and_trace_span_reads_its_thread(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look at a.py"})],
            [("read_file", {"path": "a.py"})],
            "a.py has a().",
            "ok",
        ],
        usage=USAGE,
    )
    chat = _Chat(database, model)
    session_id, _, _ = await chat.run(project)

    _, runs = await chat.manager.trace(session_id)
    (run,) = runs
    delegate = run.children[0].children[0]
    assert (delegate.name, delegate.id) == ("delegate", "call_1")
    helper_calls = delegate.children
    assert len(helper_calls) == 2
    assert [t.name for t in helper_calls[0].children] == ["read_file"]
    # The run's own calls are two; the helper's are under delegate.
    assert len(run.children) == 2
    own = sum(m.tokens.input or 0 for m in run.children if m.tokens is not None)
    inside = sum(m.tokens.input or 0 for m in helper_calls if m.tokens is not None)
    assert inside == 2 * USAGE["input_tokens"] and own == 2 * USAGE["input_tokens"]

    # A helper's model call is read from the helper's thread: its context starts at the brief.
    read = await chat.manager.trace_span(session_id, helper_calls[0].id)
    assert read.span.id == helper_calls[0].id
    assert [m.role for m in read.messages][:1] == ["user"]
    assert read.messages[0].text == "look at a.py"
    assert read.reply is not None and read.reply.id == helper_calls[0].id
    # A helper's tool call has its result from the same thread.
    step = helper_calls[0].children[0]
    result = await chat.manager.trace_span(session_id, step.id)
    assert result.args == {"path": "a.py"}
    assert result.result is not None and "def a()" in result.result
    # The parent's own call still reads the parent's thread.
    top = await chat.manager.trace_span(session_id, run.children[1].id)
    assert top.messages[0].text == "go"


async def test_a_helper_that_never_answers_stops_at_the_time_limit(
    database: Database, project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate = asyncio.Event()

    async def pause(seconds: float) -> None:
        del seconds
        await gate.wait()

    monkeypatch.setattr(manager_module, "_pause", pause)
    model = _Hanging(replies=[[("delegate", {"brief": "hang"})], "after the limit"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "go")
    async with asyncio.timeout(5):
        await model.waiting.wait()
    gate.set()
    events = await chat.finished(run_id)

    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "completed"
    assert model.stopped
    assert _ended(events).data.stopped == "time"
    assert _delegate_result(events).startswith("explorer finished: time\n\n")
    assert plain_messages(await chat.runtime.values(session_id))[-1].text == "after the limit"


async def test_a_helper_that_reads_past_eight_windows_stops_with_tokens(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look"})],
            [("read_file", {"path": "a.py"})],
            [("read_file", {"path": "b.py"})],
            "never reached",
            "ok",
        ],
        usage=USAGE,
    )
    # Each call takes in 1,000 tokens: the window is 100, so the ceiling is 800.
    chat = _Chat(database, model, window_of=lambda _profile, _options: ContextWindow(window=100))
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "tokens"
    assert _delegate_result(events).startswith("explorer finished: tokens\n\n")


def _paid(profile: str) -> Tier:
    del profile
    return "budget"


def _answers(*oks: bool) -> Callable[[str | None], Awaitable[bool]]:
    left = list(oks)

    async def paid_ok(session_id: str | None) -> bool:
        del session_id
        return left.pop(0) if left else True

    return paid_ok


async def test_a_spent_cap_stops_a_paid_helper_with_budget_cloud_only(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            [("delegate", {"brief": "look"})],
            [("list_dir", {"path": "."})],
            "after the helper",
        ],
    )
    # The parent's call, the helper's first call, then the cap is spent, then the parent again.
    chat = _Chat(
        database,
        model,
        settings=GolemSettings(default_model="anthropic/big"),
        tier_of=_paid,
        paid_ok=_answers(True, True, False, True),
    )
    _, run_id, events = await chat.run(project)

    run = await chat.runs.get(run_id)
    assert run is not None
    assert run.status == "completed"
    assert _ended(events).data.stopped == "budget"
    assert _delegate_result(events).startswith("explorer finished: budget\n\n")


async def test_the_calls_of_a_lead_go_on_counting_after_it_was_woken(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(replies=[[("delegate", {"brief": "look"})], "found", "ok"])
    chat = _Chat(database, model)
    _, _, events = await chat.run(project)

    assert [cast(Any, e.data).index for e in _calls(events)] == [1, 2]
