"""``session.set_checks``: the session's answer to the offer to run the project's checks."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND


async def test_an_answer_is_set_announced_once_and_survives_a_restart(short_home: Path) -> None:
    router = ModelRouter(GolemSettings())
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        result = rpc_result(
            await client.call("session.set_checks", {"session_id": session_id, "on": True})
        )
        assert result == {"session_id": session_id, "on": True}
        event = await client.wait_for_event("session.checks.changed")
        assert cast(dict[str, object], event["params"])["data"] == {"on": True}
        rpc_result(await client.call("session.set_checks", {"session_id": session_id, "on": True}))
        types = [cast(dict[str, object], e["params"])["type"] for e in client.events]
        assert types.count("session.checks.changed") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        before = len(await client.take_events())
        rpc_result(await client.call("session.set_checks", {"session_id": session_id, "on": True}))
        events = await client.take_events()
        later = [cast(dict[str, object], e["params"])["type"] for e in events[before:]]
        assert "session.checks.changed" not in later
        rpc_result(await client.call("session.set_checks", {"session_id": session_id, "on": False}))
        answers = [
            cast(dict[str, object], e["params"])["data"]
            for e in await client.take_events()
            if cast(dict[str, object], e["params"])["type"] == "session.checks.changed"
        ]
        assert answers[-1] == {"on": False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_bad_answer_or_session_is_refused(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings()))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        bad = await client.call(
            "session.set_checks", {"session_id": created["session_id"], "on": "maybe"}
        )
        assert error_code(bad) == INVALID_PARAMS
        missing = await client.call("session.set_checks", {"session_id": "s_nope", "on": True})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)
