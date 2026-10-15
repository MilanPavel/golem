"""Socket-level chat: create, attach, stream, busy, missing, list, and checkpoint resume."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import cast

from fakes import GatedChatModel, ScriptedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.router import ModelRouter
from golem.server.dispatcher import (
    MODEL_NOT_CONFIGURED,
    RUN_NOT_FOUND,
    SESSION_BUSY,
    SESSION_NOT_FOUND,
)


def _record(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return cast(dict[str, object], value)
    return None


def _event_types(events: list[dict[str, object]]) -> list[str]:
    types: list[str] = []
    for event in events:
        params = _record(event.get("params"))
        if params is None:
            continue
        kind = params.get("type")
        if isinstance(kind, str):
            types.append(kind)
    return types


def _delta_text(event: dict[str, object]) -> str:
    params = _record(event.get("params"))
    if params is None or params.get("type") != "message.delta":
        return ""
    data = _record(params.get("data"))
    if data is None:
        return ""
    text = data.get("text")
    if isinstance(text, str):
        return text
    return ""


def _completed_text(events: list[dict[str, object]], role: str) -> list[str]:
    texts: list[str] = []
    for event in events:
        params = _record(event.get("params"))
        if params is None or params.get("type") != "message.completed":
            continue
        data = _record(params.get("data"))
        if data is None or data.get("role") != role:
            continue
        text = data.get("text")
        if isinstance(text, str):
            texts.append(text)
    return texts


async def test_send_streams_deltas_then_completes(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        assert "result" in await client.call("hello", HELLO)
        session_id = await _open(client)
        await client.wait_for_event("session.created")
        sent = rpc_result(
            await client.call("message.send", {"session_id": session_id, "text": "hello"}),
        )
        assert isinstance(sent["run_id"], str)
        await client.wait_for_event("run.completed")
        types = _event_types(client.events)
        assert types[0] == "session.created"
        created_params = _record(client.events[0].get("params"))
        created_data = _record(created_params.get("data")) if created_params else None
        assert created_data is not None
        assert created_data["model_profile"] == "remote"
        assert created_data["model_provider"] is None
        assert created_data["model_name"] is None
        assert "message.delta" in types
        assert "message.completed" in types
        assert types[-1] == "run.completed"
        assert _completed_text(client.events, "user") == ["hello"]
        assert _completed_text(client.events, "assistant") == ["Hi"]
        assert "".join(_delta_text(event) for event in client.events) == "Hi"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_inspect_reads_checkpoint_messages(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("session.inspect", {"session_id": "s_missing"})
        assert error_code(missing) == SESSION_NOT_FOUND
        session_id = await _open(client)
        empty = rpc_result(await client.call("session.inspect", {"session_id": session_id}))
        assert empty["message_count"] == 0
        assert empty["messages"] == []
        assert empty["model_profile"] == "remote"
        assert empty["model_provider"] is None
        assert empty["model_name"] is None
        await client.call("message.send", {"session_id": session_id, "text": "hello"})
        await client.wait_for_event("run.completed")
        inspected = rpc_result(await client.call("session.inspect", {"session_id": session_id}))
        assert inspected["message_count"] == 2
        assert inspected["messages"] == [
            {"role": "user", "text": "hello"},
            {"role": "assistant", "text": "Hi"},
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_missing_and_busy_sessions(short_home: Path) -> None:
    model = GatedChatModel()
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("message.send", {"session_id": "s_missing", "text": "hi"})
        assert error_code(missing) == SESSION_NOT_FOUND
        session_id = await _open(client)
        sent = rpc_result(
            await client.call("message.send", {"session_id": session_id, "text": "hi"}),
        )
        assert isinstance(sent["run_id"], str)
        await model.started.wait()
        busy = await client.call("message.send", {"session_id": session_id, "text": "again"})
        assert error_code(busy) == SESSION_BUSY
        model.release.set()
        await client.wait_for_event("run.completed")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_status_and_session_name_the_configured_model(short_home: Path) -> None:
    settings = GolemSettings(model_provider="openai_compat", model_name="qwen3.5:4b")
    app, task = await start_daemon(short_home, router=ModelRouter(settings))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        assert "result" in await client.call("hello", HELLO)
        status = rpc_result(await client.call("daemon.status"))
        assert status["model_profile"] == "remote"
        assert status["model_provider"] == "openai_compat"
        assert status["model_name"] == "qwen3.5:4b"
        await _open(client)
        await client.wait_for_event("session.created")
        params = _record(client.events[0].get("params"))
        data = _record(params.get("data")) if params else None
        assert data is not None
        assert data["model_profile"] == "remote"
        assert data["model_provider"] == "openai_compat"
        assert data["model_name"] == "qwen3.5:4b"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_unconfigured_model_is_an_rpc_error(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        failed = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(failed) == MODEL_NOT_CONFIGURED
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_restart_continues_the_same_thread(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["alpha", "beta"])
    router = ModelRouter(model=model)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        await client.call("message.send", {"session_id": session_id, "text": "one"})
        await client.wait_for_event("run.completed")
    finally:
        await client.close()
        await stop_daemon(app, task)

    last_seq = max(_seqs(client.events))
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _attach(client, session_id, after_seq=last_seq)
        await client.call("message.send", {"session_id": session_id, "text": "two"})
        await client.wait_for_event("run.completed")
        assert model.seen[1] == ["one", "alpha", "two"]
        assert min(_seqs(client.events)) == last_seq + 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_session_never_sent_survives_a_restart(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["alpha"])
    router = ModelRouter(model=model)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
    finally:
        await client.close()
        await stop_daemon(app, task)

    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await _attach(client, session_id)
        sent = await client.call("message.send", {"session_id": session_id, "text": "one"})
        assert "result" in sent
        await client.wait_for_event("run.completed")
        assert model.seen[0] == ["one"]
    finally:
        await client.close()
        await stop_daemon(app, task)


def _seqs(events: list[dict[str, object]]) -> list[int]:
    seqs: list[int] = []
    for event in events:
        params = _record(event.get("params"))
        seq = params.get("seq") if params else None
        if isinstance(seq, int):
            seqs.append(seq)
    return seqs


async def _open(client: RpcClient) -> str:
    created = rpc_result(await client.call("session.create", {}))
    session_id = created["session_id"]
    assert isinstance(session_id, str)
    await _attach(client, session_id)
    return session_id


async def _attach(client: RpcClient, session_id: str, *, after_seq: int = 0) -> int:
    attached = rpc_result(
        await client.call("session.attach", {"session_id": session_id, "after_seq": after_seq}),
    )
    assert attached["session_id"] == session_id
    last_seq = attached["last_seq"]
    assert isinstance(last_seq, int)
    return last_seq


async def _until(
    client: RpcClient,
    done: Callable[[list[dict[str, object]]], bool],
    *,
    timeout: float = 2,
) -> list[dict[str, object]]:
    async with asyncio.timeout(timeout):
        while not done(events := await client.take_events()):
            await asyncio.sleep(0.01)
    return events


def _streamed(text: str) -> Callable[[list[dict[str, object]]], bool]:
    return lambda events: "".join(_delta_text(event) for event in events) == text


async def test_a_second_client_attaches_mid_run_and_sees_every_event(short_home: Path) -> None:
    model = GatedChatModel(streamed="Hel", reply="lo")
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    first = await RpcClient.connect(app.paths.socket_path)
    second = await RpcClient.connect(app.paths.socket_path)
    try:
        await first.call("hello", HELLO)
        session_id = await _open(first)
        await first.call("message.send", {"session_id": session_id, "text": "hi"})
        await _until(first, _streamed("Hel"))
        await first.close()

        await second.call("hello", HELLO)
        await _attach(second, session_id)
        model.release.set()
        await second.wait_for_event("run.completed")
        seqs = _seqs(second.events)
        assert seqs == sorted(set(seqs))
        assert _event_types(second.events)[0] == "session.created"
        assert "".join(_delta_text(event) for event in second.events) == "Hello"
        assert _completed_text(second.events, "assistant") == ["Hello"]
    finally:
        await second.close()
        await stop_daemon(app, task)


async def test_attach_after_seq_replays_only_newer_events(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    other = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await other.call("hello", HELLO)
        session_id = await _open(client)
        await client.call("message.send", {"session_id": session_id, "text": "hello"})
        await client.wait_for_event("run.completed")
        live = await client.take_events()
        seqs = _seqs(live)
        stored = _seqs([event for event in live if _event_types([event]) != ["message.delta"]])

        last_seq = await _attach(other, session_id, after_seq=seqs[2])
        assert last_seq == seqs[-1]
        assert _seqs(await other.take_events()) == [seq for seq in stored if seq > seqs[2]]
    finally:
        await client.close()
        await other.close()
        await stop_daemon(app, task)


async def test_only_attached_connections_get_events(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    sender = await RpcClient.connect(app.paths.socket_path)
    watcher = await RpcClient.connect(app.paths.socket_path)
    try:
        await sender.call("hello", HELLO)
        await watcher.call("hello", HELLO)
        created = rpc_result(await sender.call("session.create", {}))
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        await _attach(watcher, session_id)
        await sender.call("message.send", {"session_id": session_id, "text": "hello"})
        await watcher.wait_for_event("run.completed")
        assert await sender.take_events() == []
    finally:
        await sender.close()
        await watcher.close()
        await stop_daemon(app, task)


async def test_detach_stops_events(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    watcher = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await watcher.call("hello", HELLO)
        session_id = await _open(client)
        await _attach(watcher, session_id)
        assert "result" in await client.call("session.detach", {"session_id": session_id})
        before = len(await client.take_events())
        await client.call("message.send", {"session_id": session_id, "text": "hello"})
        await watcher.wait_for_event("run.completed")
        assert len(await client.take_events()) == before
    finally:
        await client.close()
        await watcher.close()
        await stop_daemon(app, task)


async def test_attach_to_a_missing_session_is_not_found(short_home: Path) -> None:
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=[]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("session.attach", {"session_id": "s_missing"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_list_puts_recent_activity_first(short_home: Path) -> None:
    model = GatedChatModel()
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        older = await _open(client)
        newer = await _open(client)
        await client.call("message.send", {"session_id": older, "text": "hi"})
        await model.started.wait()

        listed = rpc_result(await client.call("session.list", {}))
        sessions = [_record(item) for item in cast(list[object], listed["sessions"])]
        summaries = [item for item in sessions if item is not None]
        assert [item["session_id"] for item in summaries] == [older, newer]
        assert [item["status"] for item in summaries] == ["running", "idle"]
        assert summaries[1]["last_seq"] == 1
        assert summaries[1]["title"] is None

        model.release.set()
        await client.wait_for_event("run.completed")
        limited = rpc_result(await client.call("session.list", {"limit": 1}))
        only = _record(cast(list[object], limited["sessions"])[0])
        assert only is not None
        assert (only["session_id"], only["status"]) == (older, "idle")
    finally:
        await client.close()
        await stop_daemon(app, task)


def _event_data(event: dict[str, object]) -> dict[str, object]:
    params = _record(event.get("params"))
    data = _record(params.get("data")) if params else None
    assert data is not None
    return data


async def test_run_cancel_stops_the_run_and_keeps_the_partial_reply(short_home: Path) -> None:
    model = GatedChatModel(streamed="Hel", reply="lo")
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("run.cancel", {"run_id": "r_missing"})
        assert error_code(missing) == RUN_NOT_FOUND
        session_id = await _open(client)
        sent = rpc_result(
            await client.call("message.send", {"session_id": session_id, "text": "hi"})
        )
        await _until(client, _streamed("Hel"))

        cancelled = rpc_result(await client.call("run.cancel", {"run_id": sent["run_id"]}))
        assert cancelled == {"cancelled": True}
        events = await client.take_events()
        assert _event_types(events)[-2:] == ["message.completed", "run.cancelled"]
        assert _event_data(events[-2])["interrupted"] is True
        assert _event_data(events[-1]) == {"reason": "user"}
        again = rpc_result(await client.call("run.cancel", {"run_id": sent["run_id"]}))
        assert again == {"cancelled": False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_stopping_the_daemon_cancels_runs_with_the_shutdown_reason(short_home: Path) -> None:
    model = GatedChatModel(streamed="Hel", reply="lo")
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        await client.call("message.send", {"session_id": session_id, "text": "hi"})
        await _until(client, _streamed("Hel"))
        await stop_daemon(app, task)
        cancelled = await client.wait_for_event("run.cancelled")
        assert _event_data(cancelled) == {"reason": "shutdown"}
    finally:
        await client.close()
        await stop_daemon(app, task)
