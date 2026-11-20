"""Memory in a live run: the tools reach it, and a hosted call gets stubs for local notes."""
# pyright: reportPrivateUsage=false

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel
from test_helper_restart import (
    SETUPS,
    _Chat,
    _chat,
    _delegate,
    _Setup,
)
from test_paid_consent import (
    _answer,
    _Facts,
    _facts,
    _last_input,
    _turn_ends,
)
from test_server import RpcClient, rpc_result, start_daemon, stop_daemon
from test_step_up import (
    BAD_TWICE,
    _send,
    _start,
)
from test_step_up import (
    _router as _scripted_router,
)

from golem.config import ContextSettings, GolemSettings, MemorySettings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.memory_stub import STUB, stub_local_notes
from golem.graphs.step_up import StepRequest, StepUp
from golem.graphs.summarise import Summariser
from golem.graphs.tools_node import MEMORY_IDS_KEY
from golem.memory.privacy import ChatPrivacy
from golem.memory.service import MemoryAccess, MemoryService
from golem.memory.store import MemoryStore
from golem.models.pick import Choice
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import recover_runs
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import ApprovalNeededEvent, ChatEvent

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
TIERS: dict[str, Tier] = {LOCAL: "local", CHEAP: "budget"}

PRIVATE = "The user keeps the tax papers in a blue box."
OPEN = "The user prefers pnpm."
RECALL: Calls = [("recall", {"query": "user"})]


class _Models(ModelRouter):
    def __init__(self, models: dict[str, ToolCallingChatModel]) -> None:
        super().__init__(GolemSettings())
        self.models = models

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        return self.models[self.resolve(profile).ref]


@pytest.fixture
async def service(tmp_path: Path) -> AsyncIterator[MemoryService]:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        made = MemoryService(store, lambda: MemorySettings())
        await made.write_by_you(PRIVATE, "you", privacy="local")
        await made.write_by_you(OPEN, "you")
        yield made


def _runtime(models: dict[str, ToolCallingChatModel], *, to: str | None = None) -> ChatRuntime:
    async def next_model(session_id: str, profile: str, ask: StepRequest) -> StepUp | None:
        del session_id, profile, ask
        return None if to is None else StepUp(to, "budget", Choice(None, "fit", "", ()))

    return open_chat(
        _Models(models),
        InMemorySaver(),
        tools=default_registry(),
        tier_of=TIERS.get,
        next_model=next_model,
    )


async def _run(
    runtime: ChatRuntime,
    access: MemoryAccess | None,
    profile: str,
    n: int = 0,
    step_up: bool = True,
) -> None:
    async for _ in runtime.stream(
        session_id="s_live",
        text=f"look {n}",
        model_profile=profile,
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        step_up=step_up,
        memory=access,
    ):
        pass


def _recalls(request: list[BaseMessage]) -> list[str]:
    return [str(m.content) for m in request if isinstance(m, ToolMessage) and m.name == "recall"]


def _access(service: MemoryService, chat: ChatPrivacy | None = None) -> MemoryAccess:
    return MemoryAccess(service, None, chat or ChatPrivacy(route="auto"), "")


async def test_a_local_model_reads_a_local_note_and_its_next_call_sees_the_full_line(
    service: MemoryService,
) -> None:
    models = {LOCAL: ToolCallingChatModel(replies=[RECALL, "done"])}
    await _run(_runtime(models), _access(service), LOCAL)
    (second,) = [_recalls(r) for r in models[LOCAL].seen[1:]]
    assert PRIVATE in second[0] and OPEN in second[0]
    assert STUB not in second[0]


async def test_a_step_up_sends_a_stub_for_the_local_note_and_the_chat_note_in_full(
    service: MemoryService,
) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, ""]),
        CHEAP: ToolCallingChatModel(replies=["done"]),
    }
    runtime = _runtime(models, to=CHEAP)
    await _run(runtime, _access(service), LOCAL)
    (sent,) = _recalls(models[CHEAP].seen[0])
    assert PRIVATE not in sent
    assert STUB in sent
    assert OPEN in sent
    # The checkpoint keeps the whole result, so a later local call still reads it.
    stored = await runtime.values("s_live")
    kept = _recalls(cast(list[BaseMessage], stored["messages"]))
    assert PRIVATE in kept[0] and STUB not in kept[0]


async def test_a_local_call_after_the_step_up_turn_reads_the_full_result_again(
    service: MemoryService,
) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, "", "again"]),
        CHEAP: ToolCallingChatModel(replies=["done"]),
    }
    runtime = _runtime(models, to=CHEAP)
    await _run(runtime, _access(service), LOCAL)
    await _run(runtime, _access(service), LOCAL, n=1, step_up=False)
    (full,) = _recalls(models[LOCAL].seen[-1])
    assert PRIVATE in full


async def test_a_hosted_model_never_gets_a_local_note_by_recall_or_by_history(
    service: MemoryService,
) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, "done"]),
        CHEAP: ToolCallingChatModel(replies=[RECALL, "done", "later"]),
    }
    runtime = _runtime(models)
    await _run(runtime, _access(service), CHEAP)
    (recalled,) = _recalls(models[CHEAP].seen[1])
    assert PRIVATE not in recalled and OPEN in recalled
    # A turn on the local model reads the note, then the next turn goes to the hosted one.
    models[LOCAL].seen.clear()
    await _run(runtime, _access(service), LOCAL, n=1)
    assert any(PRIVATE in text for r in models[LOCAL].seen for text in _recalls(r))
    await _run(runtime, _access(service), CHEAP, n=2)
    for text in _recalls(models[CHEAP].seen[-1]):
        assert PRIVATE not in text


async def test_a_local_chat_sends_the_whole_result_as_a_stub(service: MemoryService) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, ""]),
        CHEAP: ToolCallingChatModel(replies=["done"]),
    }
    chat = ChatPrivacy(route="auto", local_only=True)
    await _run(_runtime(models, to=CHEAP), _access(service, chat), LOCAL)
    (sent,) = _recalls(models[CHEAP].seen[0])
    assert PRIVATE not in sent and OPEN not in sent


async def test_a_result_with_no_ids_is_stubbed_whole_and_one_nobody_can_check_loses_its_line(
    service: MemoryService,
) -> None:
    line = f"m_1 | you | 2026-11-01 | t | {PRIVATE}"
    bare = ToolMessage(content=f"note\n{line}", tool_call_id="c1", name="recall", id="t_c1")
    ided = bare.model_copy(update={"additional_kwargs": {MEMORY_IDS_KEY: ["m_1"]}})
    gone = _access(service)
    # The memory is not in the store: it cannot be checked, so it is not sent.
    assert (await stub_local_notes([bare], gone))[0].content == STUB
    assert (await stub_local_notes([ided], gone))[0].content == f"note\n{STUB}"
    assert (await stub_local_notes([ided], None))[0].content == f"note\n{STUB}"
    assert bare.content != STUB


async def test_lines_that_do_not_match_the_ids_are_stubbed_whole(service: MemoryService) -> None:
    (private,) = await service.search("tax", "you", None, 1)
    odd = ToolMessage(
        content=f"note\nnot the id | {PRIVATE}",
        tool_call_id="c1",
        name="recall",
        id="t_c1",
        additional_kwargs={MEMORY_IDS_KEY: [private.id]},
    )
    assert (await stub_local_notes([odd], _access(service)))[0].content == STUB


async def test_messages_without_a_recall_result_are_the_same_objects(
    service: MemoryService,
) -> None:
    other = ToolMessage(content="x", tool_call_id="c1", name="read_file", id="t_c1")
    empty = ToolMessage(
        content="no memories found",
        tool_call_id="c2",
        name="recall",
        id="t_c2",
        additional_kwargs={MEMORY_IDS_KEY: []},
    )
    sent = await stub_local_notes([other, empty], _access(service))
    assert sent[0] is other and sent[1] is empty


async def test_with_memory_off_the_request_has_no_recall_and_no_memory_tools() -> None:
    models = {CHEAP: ToolCallingChatModel(replies=["hello"])}
    await _run(_runtime(models), None, CHEAP)
    (request,) = models[CHEAP].seen
    assert [type(m).__name__ for m in request] == ["HumanMessage"]
    assert "recall" not in models[CHEAP].bound and "remember" not in models[CHEAP].bound


class _Summing:
    """A summariser that keeps the text it was asked to summarise."""

    def __init__(self) -> None:
        self.asked: list[str] = []

    def model_name(self, profile: str, local_only: bool) -> str:
        del profile, local_only
        return "summary-model"

    async def make(self, *, messages: list[BaseMessage], **_: object) -> str:
        self.asked.append("\n".join(str(m.content) for m in messages))
        return "The user asked to look up notes."


def _summarising(
    models: dict[str, ToolCallingChatModel], summing: _Summing, *, early: bool = True
) -> ChatRuntime:
    return open_chat(
        _Models(models),
        InMemorySaver(),
        tools=default_registry(),
        tier_of=TIERS.get,
        window_of=lambda _profile, _o: ContextWindow(window=12000),
        context=ContextSettings(
            reply_reserve=500, clear_to=0.01, clear_at=0.02, compact_at=0.05, keep_turns=1
        )
        if early
        else ContextSettings(keep_turns=1),
        summariser=cast(Summariser, summing),
    )


async def _long_turn(runtime: ChatRuntime, access: MemoryAccess, profile: str, n: int) -> None:
    async for _ in runtime.stream(
        session_id="s_live",
        text="x" * 2500 + f" {n}",
        model_profile=profile,
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        memory=access,
    ):
        pass


def _everything(request: list[BaseMessage]) -> str:
    return "\n".join(str(m.content) for m in request)


async def test_a_summary_made_after_a_local_read_holds_no_local_note(
    service: MemoryService,
) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, "one", "two", "three"]),
        CHEAP: ToolCallingChatModel(replies=["hosted"]),
    }
    summing = _Summing()
    runtime = _summarising(models, summing)
    access = _access(service)
    await _long_turn(runtime, access, LOCAL, 0)
    await _long_turn(runtime, access, LOCAL, 1)
    await _long_turn(runtime, access, LOCAL, 2)
    assert summing.asked
    assert all(PRIVATE not in text for text in summing.asked)
    stored = await runtime.values("s_live")
    context = cast(dict[str, str], stored["context_view"])
    assert PRIVATE not in context["summary"]
    # A hosted call follows: neither the summary nor the rest of the history holds the note.
    await _long_turn(runtime, access, CHEAP, 3)
    assert PRIVATE not in _everything(models[CHEAP].seen[0])


async def test_a_compact_call_summarises_with_the_local_note_stubbed(
    service: MemoryService,
) -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[RECALL, "one", "two"]),
        CHEAP: ToolCallingChatModel(replies=["hosted"]),
    }
    summing = _Summing()
    runtime = _summarising(models, summing, early=False)
    access = _access(service)
    await _long_turn(runtime, access, LOCAL, 0)
    await _long_turn(runtime, access, LOCAL, 1)
    done = await runtime.compact(
        "s_live",
        "summarise",
        profile=LOCAL,
        options={},
        focus=None,
        system_chars=0,
        tools_chars=0,
    )
    assert done.view is not None
    assert summing.asked and all(PRIVATE not in text for text in summing.asked)
    assert PRIVATE not in str(done.view)
    await _long_turn(runtime, access, CHEAP, 2)
    assert PRIVATE not in _everything(models[CHEAP].seen[0])


async def test_after_a_summary_a_local_chat_still_recalls_the_note_in_full(
    service: MemoryService,
) -> None:
    models = {LOCAL: ToolCallingChatModel(replies=[RECALL, "one", "two", "three", RECALL, "four"])}
    summing = _Summing()
    runtime = _summarising(models, summing)
    access = _access(service)
    await _long_turn(runtime, access, LOCAL, 0)
    await _long_turn(runtime, access, LOCAL, 1)
    await _long_turn(runtime, access, LOCAL, 2)
    assert summing.asked
    await _long_turn(runtime, access, LOCAL, 3)
    assert PRIVATE in _recalls(models[LOCAL].seen[-1])[-1]


# The session manager hands the access to the run.


class _NoArgs(BaseModel):
    pass


async def _risky(args: _NoArgs, ctx: ToolContext) -> ToolResult:
    del args, ctx
    return ToolResult(output="ran", summary="ran")


class _Daemon:
    def __init__(
        self,
        database: Database,
        model: ToolCallingChatModel,
        service: MemoryService | None,
        home: Path,
    ) -> None:
        risky = Tool(name="risky", description="risky", args=_NoArgs, run=_risky, read_only=False)
        base = default_registry()
        tools = ToolRegistry([*base._tools.values(), risky])
        runtime = open_chat(
            ModelRouter(model=model), InMemorySaver(), tools, Policy(None, home=home)
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )
        self.manager.memory = service

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _tool_results(model: ToolCallingChatModel) -> list[str]:
    return [str(m.content) for m in model.seen[-1] if isinstance(m, ToolMessage)]


async def test_remember_in_one_session_is_recalled_in_a_later_one(
    database: Database, tmp_path: Path
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        remember: Calls = [
            (
                "remember",
                {"text": "The user prefers pnpm.", "scope": "you", "quote": "I prefer pnpm"},
            )
        ]
        first = ToolCallingChatModel(replies=[remember, "kept"])
        daemon = _Daemon(database, first, service, tmp_path)
        session_id = await daemon.manager.create(None)
        await daemon.settled(await daemon.manager.send(session_id, "remember that I prefer pnpm"))
        (row,) = await store.list()
        assert (row.state, row.author, row.text) == ("kept", "you", "The user prefers pnpm.")

        second = ToolCallingChatModel(replies=[[("recall", {"query": "pnpm"})], "found"])
        later = _Daemon(database, second, service, tmp_path)
        other = await later.manager.create(None)
        await later.settled(await later.manager.send(other, "what do I prefer?"))
        assert any("The user prefers pnpm." in text for text in _tool_results(second))


async def test_a_run_that_resumes_after_an_approval_still_has_both_tools(
    database: Database, tmp_path: Path
) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        await service.write_by_you(OPEN, "you")
        model = ToolCallingChatModel(
            replies=[[("risky", {})], [("recall", {"query": "pnpm"})], "ok"]
        )
        daemon = _Daemon(database, model, service, tmp_path)
        session_id = await daemon.manager.create(None)
        run_id = await daemon.manager.send(session_id, "go")
        first = await daemon.settled(run_id)
        asked = next(e for e in first if isinstance(e, ApprovalNeededEvent))
        assert "recall" in model.bound and "remember" in model.bound
        model.bound = []
        await daemon.manager.respond(session_id, asked.data.call_id, "allow")
        await daemon.settled(run_id)
        assert "recall" in model.bound and "remember" in model.bound
        assert any(OPEN in text for text in _tool_results(model))


async def test_a_run_with_memory_off_offers_neither_tool(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(replies=["hi"])
    daemon = _Daemon(database, model, None, tmp_path)
    session_id = await daemon.manager.create(None)
    await daemon.settled(await daemon.manager.send(session_id, "hello"))
    assert "recall" not in model.bound and "remember" not in model.bound


async def test_a_helper_session_gets_no_memory_access(database: Database, tmp_path: Path) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        daemon = _Daemon(database, ToolCallingChatModel(replies=[]), service, tmp_path)
        session_id = await daemon.manager.create(None)
        live = daemon.manager._sessions[session_id]
        access: Any = daemon.manager._memory_access
        assert access(live, live.model_profile, "hi") is not None
        cast(Any, live).parent = "s_lead"
        assert access(live, live.model_profile, "hi") is None


# A run that waits on the paid question goes on with both tools.


async def test_a_run_answered_after_the_paid_question_before_its_turn_has_both_tools(
    short_home: Path,
) -> None:
    router = _scripted_router(["unused"], ["done"])
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        _last_input(app, session_id, 20000)
        await _send(client, session_id, "a long question")
        waiting = await client.wait_for_event("route.consent.needed")
        run = cast(str, cast(dict[str, Any], waiting["params"])["run_id"])
        rpc_result(await _answer(client, session_id, run, "once"))
        await _turn_ends(client, 1)
        bound = router.models[CHEAP].bound
        assert "recall" in bound and "remember" in bound
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_run_answered_after_a_paid_question_in_its_middle_has_both_tools(
    short_home: Path,
) -> None:
    router = _scripted_router(BAD_TWICE, ["done"])
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        waiting = await client.wait_for_event("route.consent.needed")
        run = cast(str, cast(dict[str, Any], waiting["params"])["run_id"])
        assert "recall" in router.models[LOCAL].bound
        rpc_result(await _answer(client, session_id, run, "once"))
        await _turn_ends(client, 1)
        bound = router.models[CHEAP].bound
        assert "recall" in bound and "remember" in bound
    finally:
        await client.close()
        await stop_daemon(app, task)


# A lead woken after its helpers is an ordinary run. A helper's run has no memory.


def _watch_tools(chat: _Chat) -> list[list[str]]:
    """The tool names each call of the chat's model was offered, in order."""
    offered: list[list[str]] = []
    bind = chat.model.bind_tools

    def bind_tools(tools: Any, **kwargs: Any) -> Any:
        offered.append([t["function"]["name"] for t in tools])
        return bind(tools, **kwargs)

    object.__setattr__(chat.model, "bind_tools", bind_tools)
    return offered


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_lead_woken_after_its_helper_still_has_both_tools(
    setup: _Setup, database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        chat = _chat(
            database, [_delegate("look"), "found it", "all done"], setup, project, tmp_path
        )
        chat.manager.memory = MemoryService(store, lambda: MemorySettings())
        offered = _watch_tools(chat)
        lead = await chat.lead(project)
        await chat.manager.send(lead, "go")
        await chat.until(lead, "run.completed")
        # Lead, then its helper, then the lead again once it was woken.
        assert len(offered) == 3
        for lead_call in (offered[0], offered[2]):
            assert "recall" in lead_call and "remember" in lead_call
        assert "recall" not in offered[1] and "remember" not in offered[1]


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_helper_resumed_after_a_restart_has_neither_memory_tool(
    setup: _Setup, database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        service = MemoryService(store, lambda: MemorySettings())
        before = _chat(database, [_delegate("hang")], setup, project, tmp_path)
        before.manager.memory = service
        lead = await before.lead(project)
        await before.manager.send(lead, "go")
        await asyncio.wait_for(before.model.waiting.wait(), 5)
        await before.until(lead, "helper.wait")
        after = _Chat(
            database,
            ["found it", "all done"],
            setup,
            project,
            tmp_path,
            saver=before.saver,
            log=before.log,
            hangs=False,
        )
        after.manager.memory = service
        offered = _watch_tools(after)
        await recover_runs(after.runs, after.events, after.log, after.runtime, after.manager)
        await after.until(lead, "run.completed")
        # The helper goes on first, with no memory tools. The woken lead has both.
        assert len(offered) == 2
        assert "recall" not in offered[0] and "remember" not in offered[0]
        assert "recall" in offered[1] and "remember" in offered[1]
