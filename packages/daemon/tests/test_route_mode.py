"""``session.set_route`` and the pick of each turn (ticket 9.3.4, ADR-055)."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import cast

from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelPrice, RoutingSettings
from golem.models.facts import ModelFacts
from golem.models.router import ModelRouter
from golem.models.tiers import Tier, blended
from golem.server.app import DaemonApp
from golem.server.dispatcher import INVALID_PARAMS, MODEL_NOT_CONFIGURED, SESSION_NOT_FOUND

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
BIG = "anthropic/big"


def _facts(ref: str, tier: Tier, window: int, price: float | None = None) -> ModelFacts:
    model_price = None if price is None else ModelPrice(input=price, output=price)
    return ModelFacts(
        ref=ref,
        profile=ref,
        tier=tier,
        ready=True,
        why_not_ready=None,
        window=window,
        window_exact=True,
        tools=True,
        vision=False,
        price=model_price,
        blended=None if model_price is None else blended(model_price),
        prompt_tps=None,
        reply_tps=None,
        tool_score=None,
    )


class _Facts:
    """A fixed list of facts, whatever refs are asked for."""

    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


class _Router(ModelRouter):
    """Real name resolution; each ref has its own scripted model, which records its prompts."""

    def __init__(self, settings: GolemSettings) -> None:
        super().__init__(settings)
        self.models: dict[str, ScriptedChatModel] = {}

    def chat_model(
        self, profile: str, overrides: Mapping[str, float | str] | None = None
    ) -> BaseChatModel:
        ref = self.resolve(profile).ref
        model = self.models.setdefault(ref, ScriptedChatModel(replies=["done"] * 4))
        return model


def _router(mode: str = "pinned") -> _Router:
    return _Router(GolemSettings(routing=RoutingSettings.model_validate({"mode": mode})))


def _data(event: Mapping[str, object]) -> dict[str, object]:
    params = cast(dict[str, object], event["params"])
    return cast(dict[str, object], params["data"])


def _types(client: RpcClient) -> list[str]:
    return [cast(dict[str, object], e["params"])["type"] for e in client.events]  # type: ignore[misc]


async def _session(client: RpcClient, model: str, mode: str | None = None) -> str:
    created = rpc_result(await client.call("session.create", {"model_profile": model}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    if mode is not None:
        rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": mode}))
    return session_id


async def _turn(client: RpcClient, session_id: str, text: str = "hi") -> None:
    def finished() -> int:
        return _types(client).count("run.completed") + _types(client).count("run.failed")

    before = finished()
    rpc_result(await client.call("message.send", {"session_id": session_id, "text": text}))
    for _ in range(200):
        await client.take_events()
        if finished() > before:
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


def _call_models(client: RpcClient) -> list[str | None]:
    return [
        cast(str | None, _data(e).get("model"))
        for e in client.events
        if cast(dict[str, object], e["params"])["type"] == "model.call.started"
    ]


def _routed(client: RpcClient) -> list[dict[str, object]]:
    return [
        _data(e)
        for e in client.events
        if cast(dict[str, object], e["params"])["type"] == "model.routed"
    ]


def _last_input(app: DaemonApp, session_id: str, tokens: int) -> None:
    """Record that the session's last model call sent ``tokens`` of input."""
    with sqlite3.connect(app.paths.database_file) as db:
        db.execute(
            "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day, input)"
            " VALUES ('c_seed', ?, 'r_seed', 'chat', '2999-01-01T00:00:00Z', '2999-01-01', ?)",
            (session_id, tokens),
        )


async def test_the_route_is_set_stored_and_survives_a_restart(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_Facts())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        result = rpc_result(
            await client.call("session.set_route", {"session_id": session_id, "mode": "auto"})
        )
        assert result == {"session_id": session_id, "mode": "auto"}
        updated = await client.wait_for_event("session.updated")
        assert _data(updated)["route"] == "auto"
        rpc_result(
            await client.call("session.set_route", {"session_id": session_id, "mode": "auto"})
        )
        assert _types(client).count("session.updated") == 1
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["route"] == "auto"
        bad = await client.call("session.set_route", {"session_id": session_id, "mode": "cheap"})
        assert error_code(bad) == INVALID_PARAMS
        gone = await client.call("session.set_route", {"session_id": "s_nope", "mode": "auto"})
        assert error_code(gone) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router, facts=_Facts())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["route"] == "auto"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_new_session_takes_the_configured_mode_and_a_fork_copies_the_route(
    short_home: Path,
) -> None:
    app, task = await start_daemon(short_home, router=_router("local"), facts=_Facts())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        created = await client.wait_for_event("session.created")
        assert _data(created)["route"] == "local"
        rpc_result(
            await client.call("session.set_route", {"session_id": session_id, "mode": "auto"})
        )
        await _turn(client, session_id)
        reply = next(
            _data(e)
            for e in client.events
            if cast(dict[str, object], e["params"])["type"] == "message.completed"
            and _data(e)["role"] == "assistant"
        )
        forked = rpc_result(
            await client.call(
                "session.fork", {"session_id": session_id, "at_message_id": reply["message_id"]}
            )
        )
        listed = rpc_result(await client.call("session.list", {}))
        routes = {
            s["session_id"]: s["route"] for s in cast(list[dict[str, object]], listed["sessions"])
        }
        assert routes[forked["session_id"]] == "auto"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_pinned_runs_the_sessions_model_and_says_nothing(short_home: Path) -> None:
    router = _router()
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(BIG, "frontier", 200000, 5.0))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG)
        await _turn(client, session_id)
        assert "model.routed" not in _types(client)
        assert _call_models(client) == ["big"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_local_with_a_hosted_session_model_runs_a_local_one(short_home: Path) -> None:
    router = _router()
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(BIG, "frontier", 200000, 5.0))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, "local")
        await _turn(client, session_id)
        routed = _routed(client)
        assert len(routed) == 1
        assert routed[0]["model_profile"] == LOCAL
        assert routed[0]["tier"] == "local"
        assert routed[0]["reason"] == "privacy"
        assert routed[0]["rejected"] == [
            {"ref": BIG, "tier": "frontier", "why": "this chat stays on this Mac"}
        ]
        assert _call_models(client) == ["small"]
        assert router.models[BIG].seen == []
        assert len(router.models[LOCAL].seen) == 1
        types = _types(client)
        assert types.index("model.routed") == types.index("run.started") + 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_local_with_no_local_model_refuses_the_turn(short_home: Path) -> None:
    facts = _Facts(_facts(BIG, "frontier", 200000, 5.0))
    app, task = await start_daemon(short_home, router=_router(), facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, "local")
        refused = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(refused) == MODEL_NOT_CONFIGURED
        assert "local only" in str(refused)
        assert "run.started" not in _types(client)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_auto_runs_the_cheapest_model_that_fits(short_home: Path) -> None:
    router = _router()
    facts = _Facts(
        _facts(LOCAL, "local", 32000),
        _facts(CHEAP, "budget", 128000, 0.5),
        _facts(BIG, "frontier", 200000, 5.0),
    )
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, "auto")
        await _turn(client, session_id)
        routed = _routed(client)
        assert [(r["model_profile"], r["reason"]) for r in routed] == [(LOCAL, "cheapest")]
        assert _call_models(client) == ["small"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_auto_that_does_not_fit_locally_stays_local_and_lists_the_paid_model(
    short_home: Path,
) -> None:
    router = _router()
    facts = _Facts(
        _facts(LOCAL, "local", 8000),
        _facts(CHEAP, "budget", 128000, 0.5),
    )
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL, "auto")
        _last_input(app, session_id, 20000)
        await _turn(client, session_id, "a long question")
        routed = _routed(client)
        assert len(routed) == 1
        assert routed[0]["model_profile"] == LOCAL
        assert routed[0]["reason"] == "fallback"
        assert "no other model passed" in cast(str, routed[0]["detail"])
        rejected = cast(list[dict[str, str]], routed[0]["rejected"])
        by_ref = {r["ref"]: r["why"] for r in rejected}
        assert by_ref[CHEAP] == "a paid model needs your OK"
        assert by_ref[LOCAL].startswith("does not fit")
        assert _call_models(client) == ["small"]
        assert CHEAP not in router.models
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_auto_with_a_yes_for_paid_models_runs_the_budget_model(short_home: Path) -> None:
    router = _router()
    facts = _Facts(
        _facts(LOCAL, "local", 8000),
        _facts(CHEAP, "budget", 128000, 0.5),
    )
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL, "auto")
        sessions = app.state.sessions
        assert sessions is not None
        live = sessions._sessions[session_id]  # pyright: ignore[reportPrivateUsage]
        live.paid_ok = True
        _last_input(app, session_id, 20000)
        await _turn(client, session_id, "a long question")
        routed = _routed(client)
        assert [(r["model_profile"], r["tier"], r["reason"]) for r in routed] == [
            (CHEAP, "budget", "fit")
        ]
        assert _call_models(client) == ["cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_trace_of_a_routed_run_has_the_pick(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(BIG, "frontier", 200000, 5.0))
    app, task = await start_daemon(short_home, router=_router(), facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, "local")
        await _turn(client, session_id)
        traced = rpc_result(await client.call("trace.get", {"session_id": session_id}))
        run = cast(list[dict[str, object]], traced["runs"])[0]
        assert run["route"] == {
            "reason": "privacy",
            "detail": "this chat stays on this Mac",
            "rejected": [{"ref": BIG, "tier": "frontier", "why": "this chat stays on this Mac"}],
        }
    finally:
        await client.close()
        await stop_daemon(app, task)
