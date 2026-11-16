"""The paid step-up question: route.consent.needed and route.consent.answer (9.3.6)."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import cast

from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import BudgetSettings, GolemSettings, ModelPrice, RoutingSettings
from golem.models.facts import ModelFacts
from golem.models.router import ModelRouter
from golem.models.tiers import Tier, blended
from golem.server.app import DaemonApp
from golem.server.dispatcher import INVALID_PARAMS, MODEL_NOT_CONFIGURED, SESSION_BUSY

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
BIG = "anthropic/big"
APPROVAL_NOT_FOUND = -32010


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
    """A list of facts that a test may change between two turns."""

    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


class _Router(ModelRouter):
    def __init__(self, settings: GolemSettings) -> None:
        super().__init__(settings)
        self.models: dict[str, ScriptedChatModel] = {}

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        ref = self.resolve(profile).ref
        return self.models.setdefault(ref, ScriptedChatModel(replies=["done"] * 6))


def _router(paid: str = "ask", budget: BudgetSettings | None = None) -> _Router:
    return _Router(
        GolemSettings(
            routing=RoutingSettings.model_validate({"mode": "pinned", "paid": paid}),
            budget=budget or BudgetSettings(),
        )
    )


def _called(router: _Router, ref: str) -> int:
    """How many calls the scripted model of ``ref`` took."""
    return len(router.models[ref].seen) if ref in router.models else 0


def _local_does_not_fit() -> _Facts:
    return _Facts(_facts(LOCAL, "local", 8000), _facts(CHEAP, "budget", 128000, 0.5))


def _data(event: Mapping[str, object]) -> dict[str, object]:
    params = cast(dict[str, object], event["params"])
    return cast(dict[str, object], params["data"])


def _types(client: RpcClient) -> list[str]:
    return [cast(dict[str, object], e["params"])["type"] for e in client.events]  # type: ignore[misc]


def _of(client: RpcClient, kind: str) -> list[dict[str, object]]:
    return [_data(e) for e in client.events if cast(dict[str, object], e["params"])["type"] == kind]


def _call_models(client: RpcClient) -> list[str | None]:
    return [cast(str | None, d.get("model")) for d in _of(client, "model.call.started")]


async def _session(client: RpcClient, model: str, mode: str | None = "auto") -> str:
    created = rpc_result(await client.call("session.create", {"model_profile": model}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    if mode is not None:
        rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": mode}))
    return session_id


def _last_input(app: DaemonApp, session_id: str, tokens: int) -> None:
    """Record that the session's last model call sent ``tokens`` of input."""
    with sqlite3.connect(app.paths.database_file) as db:
        db.execute(
            "INSERT OR REPLACE INTO model_calls"
            " (call_id, session_id, run_id, role, started_at, day, input)"
            " VALUES ('c_seed', ?, 'r_seed', 'chat', '2999-01-01T00:00:00Z', '2999-01-01', ?)",
            (session_id, tokens),
        )


def _spend(app: DaemonApp, session_id: str, usd: float) -> None:
    now = datetime.now().astimezone()
    with sqlite3.connect(app.paths.database_file) as db:
        db.execute(
            "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day,"
            " cost_usd) VALUES (?, ?, 'r_seed', 'chat', ?, ?, ?)",
            (f"c_{usd}", session_id, now.isoformat(), now.date().isoformat(), usd),
        )


def _paid_ok(app: DaemonApp, session_id: str) -> bool:
    with sqlite3.connect(app.paths.database_file) as db:
        row = db.execute(
            "SELECT paid_ok FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
    return bool(row[0])


async def _until(client: RpcClient, done: str, count: int = 1) -> None:
    for _ in range(300):
        await client.take_events()
        if _types(client).count(done) >= count:
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


async def _send(client: RpcClient, session_id: str, text: str = "a long question") -> str:
    result = rpc_result(await client.call("message.send", {"session_id": session_id, "text": text}))
    return cast(str, result["run_id"])


async def _answer(
    client: RpcClient, session_id: str, run_id: str, answer: str
) -> dict[str, object]:
    return await client.call(
        "route.consent.answer", {"session_id": session_id, "run_id": run_id, "answer": answer}
    )


async def _turn_ends(client: RpcClient, count: int) -> None:
    for _ in range(300):
        await client.take_events()
        ended = sum(_types(client).count(t) for t in ("run.completed", "run.failed"))
        if ended >= count:
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


async def test_the_first_paid_turn_asks_and_a_session_answer_is_remembered(
    short_home: Path,
) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        asked = _data(await client.wait_for_event("route.consent.needed"))
        assert asked["model_profile"] == CHEAP
        assert (asked["provider"], asked["model"], asked["tier"]) == ("deepseek", "cheap", "budget")
        assert asked["alternatives"] == ["session", "once", "local"]
        assert "did not fit" in cast(str, asked["why"])
        estimate = cast(float, asked["estimated_usd"])
        assert 0.01 < estimate < 0.02
        assert asked.get("caps") is None
        types = _types(client)
        assert types[-3:] == ["message.completed", "run.started", "route.consent.needed"]
        # The run waits: the session is busy and nothing paid was called.
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["status"] == "waiting"
        busy = await client.call("message.send", {"session_id": session_id, "text": "again"})
        assert error_code(busy) == SESSION_BUSY
        assert _called(router, CHEAP) == 0
        result = rpc_result(await _answer(client, session_id, run_id, "session"))
        assert result == {"run_id": run_id}
        await _turn_ends(client, 1)
        assert _of(client, "route.consent.answered") == [{"answer": "session"}]
        routed = _of(client, "model.routed")
        assert [(r["model_profile"], r["tier"]) for r in routed] == [(CHEAP, "budget")]
        assert _call_models(client) == ["cheap"]
        assert _paid_ok(app, session_id)
        # The yes is remembered: the second paid turn asks nothing.
        await _send(client, session_id, "and another long one")
        await _turn_ends(client, 2)
        assert _types(client).count("route.consent.needed") == 1
        assert _call_models(client) == ["cheap", "cheap"]
        # A second answer to the same question finds nothing waiting.
        late = await _answer(client, session_id, run_id, "once")
        assert error_code(late) == APPROVAL_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_once_answer_runs_the_turn_and_asks_again_next_time(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _turn_ends(client, 1)
        assert _call_models(client) == ["cheap"]
        assert not _paid_ok(app, session_id)
        await _send(client, session_id)
        await _until(client, "route.consent.needed", 2)
        assert _called(router, CHEAP) == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_always_ask_asks_every_time_and_remembers_nothing(short_home: Path) -> None:
    router = _router(paid="always_ask")
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        rpc_result(await _answer(client, session_id, run_id, "session"))
        await _turn_ends(client, 1)
        assert _call_models(client) == ["cheap"]
        assert not _paid_ok(app, session_id)
        assert all(d.get("paid_ok") is None for d in _of(client, "session.updated"))
        await _send(client, session_id)
        await _until(client, "route.consent.needed", 2)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_never_asks_nothing_and_leaves_the_paid_models_out(short_home: Path) -> None:
    router = _router(paid="never")
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        assert "route.consent.needed" not in _types(client)
        assert _call_models(client) == ["small"]
        assert _called(router, CHEAP) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_never_refuses_a_hosted_session_model_when_nothing_local_fits(
    short_home: Path,
) -> None:
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(BIG, "frontier", 200000, 5.0))
    router = _router(paid="never")
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG)
        _last_input(app, session_id, 20000)
        refused = await client.call("message.send", {"session_id": session_id, "text": "long"})
        assert error_code(refused) == MODEL_NOT_CONFIGURED
        assert "paid models are turned off" in str(refused)
        assert _called(router, BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_fallback_to_a_hosted_session_model_asks_too(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(BIG, "frontier", 10000))
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        asked = _data(await client.wait_for_event("route.consent.needed"))
        assert asked["model_profile"] == BIG
        assert asked["tier"] == "frontier"
        assert asked["estimated_usd"] is None  # the price is unknown
        assert _called(router, BIG) == 0
        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _turn_ends(client, 1)
        assert _call_models(client) == ["big"]
        assert [r["reason"] for r in _of(client, "model.routed")] == ["fallback"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_pinned_paid_model_never_asks(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(BIG, "frontier", 200000, 5.0))
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, None)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        assert "route.consent.needed" not in _types(client)
        assert _call_models(client) == ["big"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_local_answer_picks_again_among_the_local_models(short_home: Path) -> None:
    facts = _local_does_not_fit()
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        # The local model can take the turn by the time the user answers.
        facts.models[0] = _facts(LOCAL, "local", 64000)
        rpc_result(await _answer(client, session_id, run_id, "local"))
        await _turn_ends(client, 1)
        routed = _of(client, "model.routed")
        assert [(r["model_profile"], r["tier"]) for r in routed] == [(LOCAL, "local")]
        assert routed[0]["detail"] == "you chose to stay local"
        assert _call_models(client) == ["small"]
        assert _called(router, CHEAP) == 0
        assert not _paid_ok(app, session_id)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_local_answer_with_no_local_model_that_fits_fails_the_run(
    short_home: Path,
) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        rpc_result(await _answer(client, session_id, run_id, "local"))
        await _turn_ends(client, 1)
        failed = _of(client, "run.failed")[0]
        assert failed["code"] == "context_full"
        assert "No local model can take this turn" in cast(str, failed["message"])
        assert _called(router, CHEAP) == 0
        # The session is free again.
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["status"] == "idle"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_cancelling_a_waiting_question_ends_the_run(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        rpc_result(await client.call("run.cancel", {"run_id": run_id}))
        await _until(client, "run.cancelled")
        assert _called(router, CHEAP) == 0
        late = await _answer(client, session_id, run_id, "once")
        assert error_code(late) == APPROVAL_NOT_FOUND
        _last_input(app, session_id, 100)
        await _send(client, session_id, "short")
        await _turn_ends(client, 1)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_waiting_question_survives_a_daemon_restart(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
    finally:
        await client.close()
        await stop_daemon(app, task)
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["status"] == "waiting"
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        again = _data(await client.wait_for_event("route.consent.needed"))
        assert again["model_profile"] == CHEAP
        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _turn_ends(client, 1)
        assert _call_models(client) == ["cheap"]
        assert _types(client).count("run.started") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_fork_does_not_copy_the_yes(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        await client.wait_for_event("route.consent.needed")
        rpc_result(await _answer(client, session_id, run_id, "session"))
        await _turn_ends(client, 1)
        assert _paid_ok(app, session_id)
        reply = [
            d
            for d in _of(client, "message.completed")
            if d["role"] == "assistant" and not d.get("interrupted")
        ][-1]
        forked = rpc_result(
            await client.call(
                "session.fork", {"session_id": session_id, "at_message_id": reply["message_id"]}
            )
        )
        fork_id = cast(str, forked["session_id"])
        assert not _paid_ok(app, fork_id)
        rpc_result(await client.call("session.attach", {"session_id": fork_id, "after_seq": 0}))
        _last_input(app, fork_id, 20000)
        before = _types(client).count("route.consent.needed")
        await _send(client, fork_id)
        await _until(client, "route.consent.needed", before + 1)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_spent_cap_with_over_ask_asks_with_once_and_local_only(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(BIG, "frontier", 200000, 5.0))
    budget = BudgetSettings(daily_usd=2.0, session_usd=100.0, over="ask")
    router = _router(budget=budget)
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG)
        _last_input(app, session_id, 20000)
        _spend(app, session_id, 2.0)
        run_id = await _send(client, session_id)
        asked = _data(await client.wait_for_event("route.consent.needed"))
        assert asked["why"] == "The daily budget ($2.00) is spent."
        assert asked["alternatives"] == ["once", "local"]
        assert asked["caps"] == {
            "session_usd": 100.0,
            "daily_usd": 2.0,
            "spent_session": 2.0,
            "spent_today": 2.0,
        }
        refused = await _answer(client, session_id, run_id, "session")
        assert error_code(refused) == INVALID_PARAMS
        assert _called(router, BIG) == 0
        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _turn_ends(client, 1)
        assert _call_models(client) == ["big"]
        assert not _paid_ok(app, session_id)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_spent_cap_with_over_local_never_asks(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 8000), _facts(CHEAP, "budget", 128000, 0.5))
    router = _router(budget=BudgetSettings(daily_usd=0.01))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        _spend(app, session_id, 0.02)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        assert "route.consent.needed" not in _types(client)
        assert _called(router, CHEAP) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)
