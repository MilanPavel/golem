"""A run on route auto moves one tier up when its model struggles (9.4.2)."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from fakes import Calls, ToolCallingChatModel
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_paid_consent import _facts  # pyright: ignore[reportPrivateUsage]
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import BudgetSettings, ContextSettings, GolemSettings, RoutingSettings
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.step_up import StepRequest, StepUp
from golem.models.errors import ContextFull
from golem.models.facts import ModelFacts
from golem.models.pick import Choice
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.server.app import DaemonApp
from golem.tools.registry import ToolRegistry

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
BIG = "anthropic/big"

BAD: Calls = [("no_such_tool", {})]
BAD_TWICE: list[str | Calls] = [BAD, [("no_such_tool", {"again": 1})]]


class _Facts:
    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


class _Router(ModelRouter):
    def __init__(self, settings: GolemSettings, **replies: list[str | Calls]) -> None:
        super().__init__(settings)
        self.models = {
            ref.replace("__", "/"): ToolCallingChatModel(replies=list(r))
            for ref, r in replies.items()
        }

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        return self.models[self.resolve(profile).ref]


def _router(
    local: list[str | Calls],
    cheap: list[str | Calls],
    big: list[str | Calls] | None = None,
    *,
    local_only: bool = False,
    budget: BudgetSettings | None = None,
) -> _Router:
    routing = RoutingSettings.model_validate({"local_only": ["/"] if local_only else []})
    settings = GolemSettings(routing=routing, budget=budget or BudgetSettings())
    replies = {"ollama__small": local, "deepseek__cheap": cheap}
    if big is not None:
        replies["anthropic__big"] = big
    return _Router(settings, **replies)


def _facts_all() -> _Facts:
    return _Facts(
        _facts(LOCAL, "local", 32000),
        _facts(CHEAP, "budget", 128000, 0.5),
        _facts(BIG, "frontier", 200000, 5.0),
    )


def _data(event: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], cast(dict[str, object], event["params"])["data"])


def _of(client: RpcClient, kind: str) -> list[dict[str, object]]:
    return [_data(e) for e in client.events if cast(dict[str, object], e["params"])["type"] == kind]


def _types(client: RpcClient) -> list[str]:
    return [cast(str, cast(dict[str, object], e["params"])["type"]) for e in client.events]


def _models(client: RpcClient) -> list[str | None]:
    return [cast(str | None, d.get("model")) for d in _of(client, "model.call.started")]


def _escalations(client: RpcClient) -> list[dict[str, object]]:
    return [r for r in _of(client, "model.routed") if r["reason"] == "escalated"]


async def _ended(client: RpcClient, count: int = 1) -> None:
    for _ in range(300):
        await client.take_events()
        ended = _types(client).count("run.completed") + _types(client).count("run.failed")
        if ended >= count:
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


async def _start(app: DaemonApp, client: RpcClient, mode: str | None, *, paid: bool = True) -> str:
    """A session on ``LOCAL`` in route ``mode`` that has (or has not) said yes to paid models."""
    await client.call("hello", HELLO)
    created = rpc_result(await client.call("session.create", {"model_profile": LOCAL}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    if mode is not None:
        rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": mode}))
    assert app.state.sessions is not None
    live = app.state.sessions._sessions[session_id]  # pyright: ignore[reportPrivateUsage]
    live.paid_ok = paid
    return session_id


async def _send(
    client: RpcClient, session_id: str, text: str = "go", cwd: str | None = None
) -> None:
    params: dict[str, object] = {"session_id": session_id, "text": text}
    if cwd is not None:
        params["cwd"] = cwd
    rpc_result(await client.call("message.send", params))


async def test_two_invalid_calls_step_up_once_and_the_run_finishes(short_home: Path) -> None:
    router = _router(BAD_TWICE, ["done"])
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto"))
        await _ended(client)
        assert "run.completed" in _types(client)
        (escalated,) = _escalations(client)
        assert escalated["model_profile"] == CHEAP
        assert escalated["tier"] == "budget"
        assert escalated["detail"] == "2 invalid tool calls in a row on small"
        assert _models(client) == ["small", "small", "cheap"]
        # The stronger model saw the failed calls.
        assert len(router.models[CHEAP].seen[0]) > 3
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_call_written_as_unreadable_json_steps_up(short_home: Path) -> None:
    leaked = '{"type":"function","function":{"name":"no_such_tool","parameters":{"a":"b"}}}'
    router = _router([leaked], ["done"])
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto"))
        await _ended(client)
        (escalated,) = _escalations(client)
        assert escalated["model_profile"] == CHEAP
        assert _models(client) == ["small", "cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_pinned_and_local_never_step_up(short_home: Path) -> None:
    for mode in (None, "local"):
        router = _router([*BAD_TWICE, "done"], ["nope"])
        home = short_home / (mode or "pinned")
        home.mkdir()
        app, task = await start_daemon(home, router=router, facts=_facts_all())
        client = await RpcClient.connect(app.paths.socket_path)
        try:
            await _send(client, await _start(app, client, mode))
            await _ended(client)
            assert "run.completed" in _types(client)
            assert _escalations(client) == []
            assert _models(client) == ["small", "small", "small"]
        finally:
            await client.close()
            await stop_daemon(app, task)


async def test_a_run_steps_up_only_once(short_home: Path) -> None:
    router = _router(BAD_TWICE, [*BAD_TWICE, "done"], ["unused"])
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto"))
        await _ended(client)
        assert "run.completed" in _types(client)
        assert len(_escalations(client)) == 1
        assert _models(client) == ["small", "small", "cheap", "cheap", "cheap"]
        assert not router.models[BIG].seen
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_paid_step_up_needs_the_sessions_yes(short_home: Path) -> None:
    router = _router([*BAD_TWICE, "done"], ["nope"])
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto", paid=False))
        await _ended(client)
        assert "run.completed" in _types(client)
        assert "route.consent.needed" not in _types(client)
        assert _models(client) == ["small", "small", "small"]
        assert not router.models[CHEAP].seen
        # The run says it stayed.
        notes = [r for r in _of(client, "model.routed") if r["reason"] == "fallback"]
        assert "no stronger model" in cast(str, notes[-1]["detail"])
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_local_only_session_never_steps_up_to_a_hosted_model(short_home: Path) -> None:
    router = _router([*BAD_TWICE, "done"], ["nope"], local_only=True)
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto"), cwd=str(short_home))
        await _ended(client)
        assert "run.completed" in _types(client)
        assert _models(client) == ["small", "small", "small"]
        assert not router.models[CHEAP].seen
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_spent_budget_stops_a_paid_step_up(short_home: Path) -> None:
    router = _router([*BAD_TWICE, "done"], ["nope"], budget=BudgetSettings(session_usd=0.01))
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto")
        now = datetime.now().astimezone()
        with sqlite3.connect(app.paths.database_file) as db:
            db.execute(
                "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day,"
                " cost_usd) VALUES ('c_x', ?, 'r_seed', 'chat', ?, ?, 1.0)",
                (session_id, now.isoformat(), now.date().isoformat()),
            )
        await _send(client, session_id)
        await _ended(client)
        assert "run.completed" in _types(client)
        assert _models(client) == ["small", "small", "small"]
        assert not router.models[CHEAP].seen
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_signal_that_stepped_up_two_runs_raises_the_floor_of_the_session(
    short_home: Path,
) -> None:
    router = _router([*BAD_TWICE, *BAD_TWICE], ["done", "again", "third"])
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto")
        for count, text in enumerate(("one", "two", "three"), start=1):
            await _send(client, session_id, text)
            await _ended(client, count)
        assert len(_escalations(client)) == 2
        # The third run began on the budget model: the small one took only the first two runs.
        assert _models(client) == ["small", "small", "cheap", "small", "small", "cheap", "cheap"]
        assert len(router.models[LOCAL].seen) == 4
    finally:
        await client.close()
        await stop_daemon(app, task)


# The graph alone, with a scripted answer of the router.


class _TwoModels(ModelRouter):
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


def _graph(
    models: dict[str, ToolCallingChatModel],
    asked: list[tuple[str, StepRequest]],
    *,
    to: str | None,
) -> ChatRuntime:
    windows = {LOCAL: 4000, CHEAP: 100000}

    async def next_model(session_id: str, profile: str, ask: StepRequest) -> StepUp | None:
        del session_id
        asked.append((profile, ask))
        return None if to is None else StepUp(to, "budget", Choice(None, "fit", "", ()))

    return open_chat(
        _TwoModels(models),
        InMemorySaver(),
        tools=ToolRegistry([]),
        window_of=lambda profile, _o: ContextWindow(window=windows[profile]),
        context=ContextSettings(reply_reserve=500, clear_at=0.98, clear_to=0.97, compact_at=0.99),
        next_model=next_model,
    )


async def _stream(
    runtime: ChatRuntime, text: str, *, step_up: bool = True, n: int = 0
) -> list[dict[str, Any]]:
    """The ``model.routed`` items of one turn."""
    found: list[dict[str, Any]] = []
    async for part in runtime.stream(
        session_id="s_step",
        text=text,
        model_profile=LOCAL,
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        step_up=step_up,
    ):
        data = cast(Mapping[str, Any], part).get("data") if isinstance(part, Mapping) else None
        if isinstance(data, Mapping):
            item = dict(cast(Mapping[str, Any], data))
            if item.get("golem") == "model.routed":
                found.append(item)
    return found


async def test_a_prompt_that_cannot_fit_steps_up_without_calling_the_small_model() -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=["small"]),
        CHEAP: ToolCallingChatModel(replies=["big window"]),
    }
    asked: list[tuple[str, StepRequest]] = []
    items = await _stream(_graph(models, asked, to=CHEAP), "x" * 20000)
    assert not models[LOCAL].seen
    assert len(models[CHEAP].seen) == 1
    assert asked[0][0] == LOCAL and asked[0][1].signal == "context_full"
    assert cast(int, asked[0][1].need) > 4000
    (item,) = items
    assert item["reason"] == "escalated" and item["profile"] == CHEAP
    assert item["detail"].startswith("did not fit in 4K on")


async def test_a_prompt_that_cannot_fit_fails_when_nothing_is_larger() -> None:
    models = {LOCAL: ToolCallingChatModel(replies=["small"])}
    asked: list[tuple[str, StepRequest]] = []
    failed = False
    try:
        await _stream(_graph(models, asked, to=None), "x" * 20000)
    except ContextFull as exc:
        failed = exc.window == 4000
    assert failed
    assert not models[LOCAL].seen


async def test_a_prompt_that_cannot_fit_fails_when_the_run_may_not_step_up() -> None:
    models = {LOCAL: ToolCallingChatModel(replies=["small"])}
    asked: list[tuple[str, StepRequest]] = []
    failed = False
    try:
        await _stream(_graph(models, asked, to=CHEAP), "x" * 20000, step_up=False)
    except ContextFull:
        failed = True
    assert failed and asked == []


async def test_an_empty_reply_is_dropped_and_the_stronger_model_answers_the_request() -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=[""]),
        CHEAP: ToolCallingChatModel(replies=["an answer"]),
    }
    asked: list[tuple[str, StepRequest]] = []
    runtime = _graph(models, asked, to=CHEAP)
    await _stream(runtime, "hello")
    assert asked[0][1].signal == "empty_reply"
    assert [type(m) for m in models[CHEAP].seen[0]] == [HumanMessage]
    kept = cast(list[Any], (await runtime.values("s_step"))["messages"])
    assert [type(m) for m in kept] == [HumanMessage, AIMessage]
    assert kept[-1].text == "an answer"


async def test_a_cut_reply_is_kept_and_the_stronger_model_goes_on() -> None:
    models = {
        LOCAL: ToolCallingChatModel(
            replies=["half an ans"], response_metadata={"done_reason": "length"}
        ),
        CHEAP: ToolCallingChatModel(replies=["wer"]),
    }
    asked: list[tuple[str, StepRequest]] = []
    await _stream(_graph(models, asked, to=CHEAP), "hello")
    assert asked[0][1].signal == "cut_reply"
    assert [m.text for m in models[CHEAP].seen[0]] == ["hello", "half an ans"]


async def test_no_stronger_model_ends_a_cut_reply_as_it_was() -> None:
    models = {
        LOCAL: ToolCallingChatModel(
            replies=["half an ans"], response_metadata={"done_reason": "length"}
        ),
    }
    asked: list[tuple[str, StepRequest]] = []
    items = await _stream(_graph(models, asked, to=None), "hello")
    assert len(asked) == 1
    assert [i["reason"] for i in items] == ["fallback"]
    assert len(models[LOCAL].seen) == 1


async def test_a_new_turn_can_step_up_again() -> None:
    models = {
        LOCAL: ToolCallingChatModel(replies=["", ""]),
        CHEAP: ToolCallingChatModel(replies=["one", "two"]),
    }
    asked: list[tuple[str, StepRequest]] = []
    runtime = _graph(models, asked, to=CHEAP)
    await _stream(runtime, "first")
    await _stream(runtime, "second", n=1)
    assert len(asked) == 2
    assert len(models[LOCAL].seen) == 2
