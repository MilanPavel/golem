"""The paid question comes in the middle of a run when the model struggles (9.4.7)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon
from test_step_up import (
    BAD_TWICE,
    CHEAP,
    _data,  # pyright: ignore[reportPrivateUsage]
    _ended,  # pyright: ignore[reportPrivateUsage]
    _escalations,  # pyright: ignore[reportPrivateUsage]
    _facts_all,  # pyright: ignore[reportPrivateUsage]
    _models,  # pyright: ignore[reportPrivateUsage]
    _of,  # pyright: ignore[reportPrivateUsage]
    _Router,  # pyright: ignore[reportPrivateUsage]
    _send,  # pyright: ignore[reportPrivateUsage]
    _start,  # pyright: ignore[reportPrivateUsage]
    _types,  # pyright: ignore[reportPrivateUsage]
)

from golem.config import GolemSettings, RoutingSettings
from golem.server.app import DaemonApp
from golem.server.dispatcher import APPROVAL_NOT_FOUND


def _router(paid: str = "ask", *, local_only: bool = False) -> _Router:
    routing = RoutingSettings.model_validate(
        {"paid": paid, "local_only": ["/"] if local_only else []}
    )
    return _Router(
        GolemSettings(routing=routing),
        ollama__small=[*BAD_TWICE, "done", "second turn"],
        deepseek__cheap=["on the paid model"],
    )


async def _answer(client: RpcClient, session_id: str, run_id: str, answer: str) -> None:
    rpc_result(
        await client.call(
            "route.consent.answer",
            {"session_id": session_id, "run_id": run_id, "answer": answer},
        )
    )


def _paid_ok(app: Any, session_id: str) -> bool:
    return bool(app.state.sessions._sessions[session_id].paid_ok)  # pyright: ignore


def _run_of(client: RpcClient) -> str:
    for event in client.events:
        params = cast(dict[str, object], event["params"])
        if params["type"] == "route.consent.needed":
            return cast(str, params["run_id"])
    raise AssertionError("no question")


async def _asked(client: RpcClient) -> dict[str, object]:
    found = _data(await client.wait_for_event("route.consent.needed"))
    await client.take_events()
    return found


async def _waits(app: DaemonApp, session_id: str) -> None:
    """Wait until the run is stored as waiting and its task has ended.

    The event comes first, the status and the end of the task after it. A daemon that stops
    before that cancels the run.
    """
    assert app.state.sessions is not None
    runs = app.state.sessions._run_records  # pyright: ignore[reportPrivateUsage]
    sessions = app.state.sessions._sessions  # pyright: ignore[reportPrivateUsage]
    for _ in range(200):
        task = sessions[session_id].task
        parked = task is None or task.done()
        if parked and await runs.waiting(session_id) is not None:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the run never became waiting")


async def test_a_struggling_run_asks_and_a_session_yes_moves_it(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        asked = await _asked(client)
        assert asked["model_profile"] == CHEAP
        assert asked["signal"] == "invalid_tool_calls"
        assert asked["alternatives"] == ["session", "once", "local"]
        assert "2 invalid tool calls in a row" in cast(str, asked["why"])
        assert cast(float, asked["estimated_usd"]) > 0
        assert "run.completed" not in _types(client)
        assert _models(client) == ["small", "small"]
        await _waits(app, session_id)
        await _answer(client, session_id, _run_of(client), "session")
        await _ended(client)
        assert _of(client, "route.consent.answered") == [{"answer": "session"}]
        (escalated,) = _escalations(client)
        assert escalated["model_profile"] == CHEAP
        assert _models(client) == ["small", "small", "cheap"]
        assert _paid_ok(app, session_id)
        assert _types(client).count("route.consent.needed") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_only_this_turn_moves_the_run_and_the_next_turn_starts_local(
    short_home: Path,
) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        await _asked(client)
        await _waits(app, session_id)
        await _answer(client, session_id, _run_of(client), "once")
        await _ended(client)
        assert _models(client) == ["small", "small", "cheap"]
        assert not _paid_ok(app, session_id)
        await _send(client, session_id, "again")
        await _ended(client, 2)
        assert _models(client)[-1] == "small"
        assert _types(client).count("route.consent.needed") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_stay_local_goes_on_with_the_model_and_does_not_ask_again(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        await _asked(client)
        await _waits(app, session_id)
        await _answer(client, session_id, _run_of(client), "local")
        await _ended(client)
        assert "run.completed" in _types(client)
        assert _escalations(client) == []
        assert not router.models[CHEAP].seen
        assert _types(client).count("route.consent.needed") == 1
        notes = [r for r in _of(client, "model.routed") if r["reason"] == "fallback"]
        assert "no stronger model" in cast(str, notes[-1]["detail"])
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_no_question_when_paid_is_never_or_the_folder_is_local_only(
    short_home: Path,
) -> None:
    for name, router, cwd in (
        ("never", _router("never"), None),
        ("folder", _router(local_only=True), str(short_home)),
    ):
        home = short_home / name
        home.mkdir()
        app, task = await start_daemon(home, router=router, facts=_facts_all())
        client = await RpcClient.connect(app.paths.socket_path)
        try:
            await _send(client, await _start(app, client, "auto", paid=False), cwd=cwd)
            await _ended(client)
            assert "route.consent.needed" not in _types(client), name
            assert _models(client) == ["small", "small", "small"], name
        finally:
            await client.close()
            await stop_daemon(app, task)


async def test_a_session_that_said_yes_steps_up_without_a_question(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await _send(client, await _start(app, client, "auto", paid=True))
        await _ended(client)
        assert "route.consent.needed" not in _types(client)
        assert _models(client) == ["small", "small", "cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_always_ask_asks_even_when_the_session_said_yes(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router("always_ask"), facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=True)
        await _send(client, session_id)
        await _asked(client)
        await _waits(app, session_id)
        await _answer(client, session_id, _run_of(client), "once")
        await _ended(client)
        assert _models(client) == ["small", "small", "cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_cancelling_the_open_question_ends_the_run(short_home: Path) -> None:
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        await _asked(client)
        run_id = _run_of(client)
        rpc_result(await client.call("run.cancel", {"run_id": run_id}))
        await client.wait_for_event("run.cancelled")
        assert not router.models[CHEAP].seen
        late = await client.call(
            "route.consent.answer",
            {"session_id": session_id, "run_id": run_id, "answer": "once"},
        )
        assert error_code(late) == APPROVAL_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_open_question_survives_a_daemon_restart(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _start(app, client, "auto", paid=False)
        await _send(client, session_id)
        await _asked(client)
        run_id = _run_of(client)
        await _waits(app, session_id)
    finally:
        await client.close()
        await stop_daemon(app, task)
    router = _router()
    app, task = await start_daemon(short_home, router=router, facts=_facts_all())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        again = _data(await client.wait_for_event("route.consent.needed"))
        assert again["signal"] == "invalid_tool_calls"
        await _answer(client, session_id, run_id, "once")
        await _ended(client)
        assert "run.completed" in _types(client)
        assert _models(client)[-1] == "cheap"
        assert len(router.models[CHEAP].seen) == 1
    finally:
        await client.close()
        await stop_daemon(app, task)
