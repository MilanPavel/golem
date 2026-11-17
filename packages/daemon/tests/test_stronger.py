"""Try the last question again on a stronger model: message.send with stronger (9.4.4)."""

# pyright: reportPrivateUsage=false

from __future__ import annotations

from pathlib import Path
from typing import cast

from test_paid_consent import (
    CHEAP,
    LOCAL,
    _answer,
    _call_models,
    _data,
    _Facts,
    _facts,
    _of,
    _paid_ok,
    _Router,
    _send,
    _session,
    _turn_ends,
    _types,
)
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, RoutingSettings
from golem.server.dispatcher import LOCAL_ONLY, MODEL_NOT_CONFIGURED

NO_STRONGER = "No stronger model is ready. Add a key in Settings."


def _router(paid: str = "ask", folder: Path | None = None) -> _Router:
    folders = [] if folder is None else [str(folder)]
    routing = {"mode": "pinned", "paid": paid, "local_only": folders}
    return _Router(GolemSettings(routing=RoutingSettings.model_validate(routing)))


def _ladder() -> _Facts:
    return _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))


async def _stronger(client: RpcClient, session_id: str) -> dict[str, object]:
    params = {"session_id": session_id, "text": "a question", "stronger": True}
    return await client.call("message.send", params)


async def test_a_local_answer_is_tried_again_on_the_budget_model_for_one_turn(
    short_home: Path,
) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_ladder())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        await _send(client, session_id, "what is this")
        await _turn_ends(client, 1)
        assert _call_models(client) == ["small"]
        assert [r.get("replaces_model") for r in _of(client, "model.routed")] == [None]
        # The paid question comes first: the session has not agreed.
        sent = rpc_result(await _stronger(client, session_id))
        run_id = cast(str, sent["run_id"])
        asked = _data(await client.wait_for_event("route.consent.needed"))
        assert asked["model_profile"] == CHEAP
        assert asked["replaces_model"] == LOCAL
        assert asked["why"] == "You asked for a stronger model."
        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _turn_ends(client, 2)
        assert _call_models(client) == ["small", "cheap"]
        again = _of(client, "model.routed")[-1]
        assert (again["model_profile"], again["reason"]) == (CHEAP, "user")
        assert again["detail"] == "you asked for a stronger model"
        assert again["replaces_model"] == LOCAL
        # One turn only: the session keeps its model and route, and the next turn is local.
        assert not _paid_ok(app, session_id)
        await _send(client, session_id, "and now")
        await _turn_ends(client, 3)
        assert _call_models(client) == ["small", "cheap", "small"]
        assert _of(client, "model.routed")[-1].get("replaces_model") is None
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_session_that_agreed_to_paid_models_is_not_asked(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_ladder())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        sent = rpc_result(await _stronger(client, session_id))
        await client.wait_for_event("route.consent.needed")
        rpc_result(await _answer(client, session_id, cast(str, sent["run_id"]), "session"))
        await _turn_ends(client, 2)
        assert _paid_ok(app, session_id)
        await _send(client, session_id)
        await _turn_ends(client, 3)
        rpc_result(await _stronger(client, session_id))
        await _turn_ends(client, 4)
        assert _types(client).count("route.consent.needed") == 1
        assert _call_models(client) == ["small", "cheap", "small", "cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_no_stronger_model_fails_and_no_turn_starts(short_home: Path) -> None:
    facts = _Facts(_facts(LOCAL, "local", 32000))
    app, task = await start_daemon(short_home, router=_router(), facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        failed = await _stronger(client, session_id)
        assert error_code(failed) == MODEL_NOT_CONFIGURED
        assert NO_STRONGER in str(failed)
        assert _types(client).count("run.started") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_pinned_session_does_not_try_again_on_a_stronger_model(
    short_home: Path,
) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_ladder())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL, mode=None)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        failed = await _stronger(client, session_id)
        assert error_code(failed) == MODEL_NOT_CONFIGURED
        assert _types(client).count("run.started") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_paid_never_leaves_no_stronger_model(short_home: Path) -> None:
    router = _router(paid="never")
    app, task = await start_daemon(short_home, router=router, facts=_ladder())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL)
        await _send(client, session_id)
        await _turn_ends(client, 1)
        failed = await _stronger(client, session_id)
        assert error_code(failed) == MODEL_NOT_CONFIGURED
        assert _types(client).count("run.started") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_local_only_folder_refuses_a_stronger_model(short_home: Path) -> None:
    folder = short_home / "work"
    folder.mkdir()
    router = _router(folder=folder)
    app, task = await start_daemon(short_home, router=router, facts=_ladder())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        made = rpc_result(
            await client.call("session.create", {"model_profile": LOCAL, "cwd": str(folder)})
        )
        session_id = cast(str, made["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        route = {"session_id": session_id, "mode": "auto"}
        rpc_result(await client.call("session.set_route", route))
        await _send(client, session_id)
        await _turn_ends(client, 1)
        failed = await _stronger(client, session_id)
        assert error_code(failed) == LOCAL_ONLY
        assert _types(client).count("run.started") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)
