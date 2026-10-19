"""Socket-level chat: create, attach, stream, busy, missing, list, and checkpoint resume."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import cast

from fakes import GatedChatModel, ScriptedChatModel, ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.router import ModelRouter
from golem.server.dispatcher import (
    APPROVAL_NOT_FOUND,
    INVALID_PARAMS,
    MESSAGE_NOT_FOUND,
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
        assert status["model_provider"] == "ollama"
        assert status["model_name"] == "qwen3.5:4b"
        await _open(client)
        await client.wait_for_event("session.created")
        params = _record(client.events[0].get("params"))
        data = _record(params.get("data")) if params else None
        assert data is not None
        assert data["model_profile"] == "remote"
        assert data["model_provider"] == "ollama"
        assert data["model_name"] == "qwen3.5:4b"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_session_pinned_to_another_model_names_it(short_home: Path) -> None:
    settings = GolemSettings(model_provider="openai_compat", model_name="qwen3.5:4b")
    app, task = await start_daemon(short_home, router=ModelRouter(settings))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(
            await client.call("session.create", {"model_profile": "anthropic/claude-test"})
        )
        session_id = created["session_id"]
        assert isinstance(session_id, str)
        await _attach(client, session_id)
        await client.wait_for_event("session.created")
        params = _record(client.events[0].get("params"))
        data = _record(params.get("data")) if params else None
        assert data is not None
        assert data["model_profile"] == "anthropic/claude-test"
        assert data["model_provider"] == "anthropic"
        assert data["model_name"] == "claude-test"
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


async def test_close_hides_the_session_after_a_restart(short_home: Path) -> None:
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=["ok"]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        closed_id = await _open(client)
        kept_id = await _open(client)
        await client.call("message.send", {"session_id": closed_id, "text": "remember this"})
        await client.wait_for_event("run.completed")

        closed = rpc_result(await client.call("session.close", {"session_id": closed_id}))
        assert closed["session_id"] == closed_id
        await client.wait_for_event("session.closed")
        listed = rpc_result(await client.call("session.list", {}))
        assert _session_ids(listed) == [kept_id]
        again = rpc_result(await client.call("session.close", {"session_id": closed_id}))
        assert again["session_id"] == closed_id
        missing = await client.call("message.send", {"session_id": closed_id, "text": "no"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)

    restarted, restarted_task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=["ok"]))
    )
    again_client = await RpcClient.connect(restarted.paths.socket_path)
    try:
        await again_client.call("hello", HELLO)
        listed = rpc_result(await again_client.call("session.list", {}))
        assert _session_ids(listed) == [kept_id]
        with sqlite3.connect(restarted.paths.database_file) as raw:
            rows = raw.execute(
                "SELECT type FROM events WHERE session_id = ? ORDER BY seq",
                (closed_id,),
            ).fetchall()
        assert "session.created" in [row[0] for row in rows]
        assert "session.closed" in [row[0] for row in rows]
        assert "message.completed" in [row[0] for row in rows]
    finally:
        await again_client.close()
        await stop_daemon(restarted, restarted_task)


async def test_close_cancels_a_run_in_progress(short_home: Path) -> None:
    model = GatedChatModel()
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        await client.call("message.send", {"session_id": session_id, "text": "hi"})
        await model.started.wait()
        closed = rpc_result(await client.call("session.close", {"session_id": session_id}))
        assert closed["session_id"] == session_id
        await client.wait_for_event("run.cancelled")
        await client.wait_for_event("session.closed")
        listed = rpc_result(await client.call("session.list", {}))
        assert _session_ids(listed) == []
    finally:
        model.release.set()
        await client.close()
        await stop_daemon(app, task)


def _session_ids(listed: dict[str, object]) -> list[str]:
    found: list[str] = []
    sessions = listed.get("sessions")
    if not isinstance(sessions, list):
        return found
    for item in cast(list[object], sessions):
        record = _record(item)
        if record is None:
            continue
        session_id = record.get("session_id")
        if isinstance(session_id, str):
            found.append(session_id)
    return found


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


class _OneTitle:
    async def title(self, model_profile: str, prompt: str, reply: str) -> str:
        del model_profile, prompt, reply
        return "Greeting"


async def _summaries_until(
    client: RpcClient, done: Callable[[list[dict[str, object]]], bool]
) -> list[dict[str, object]]:
    async with asyncio.timeout(2):
        while True:
            summaries = [
                params
                for item in await client.take_summaries()
                if (params := _record(item.get("params"))) is not None
            ]
            if done(summaries):
                return summaries
            await asyncio.sleep(0.01)


async def test_a_watcher_follows_every_session_without_attaching(short_home: Path) -> None:
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model), titles=_OneTitle())
    watcher = await RpcClient.connect(app.paths.socket_path)
    sender = await RpcClient.connect(app.paths.socket_path)
    try:
        await watcher.call("hello", HELLO)
        await sender.call("hello", HELLO)
        listed = rpc_result(await watcher.call("session.list", {"watch": True}))
        assert listed["sessions"] == []

        session_id = await _open(sender)
        await sender.call("message.send", {"session_id": session_id, "text": "hello"})

        summaries = await _summaries_until(
            watcher, lambda found: any(s.get("title") == "Greeting" for s in found)
        )
        assert {s["session_id"] for s in summaries} == {session_id}
        assert [s["status"] for s in summaries][:3] == ["idle", "idle", "running"]
        last = summaries[-1]
        assert (last["status"], last["title"]) == ("idle", "Greeting")
        seqs = [cast(int, s["last_seq"]) for s in summaries]
        assert seqs == sorted(seqs)
        assert watcher.events == []

        relisted = rpc_result(await sender.call("session.list", {}))
        assert _record(cast(list[object], relisted["sessions"])[0]) == last
    finally:
        await watcher.close()
        await sender.close()
        await stop_daemon(app, task)


async def test_rename_sets_the_title_a_watcher_sees(short_home: Path) -> None:
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=[]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        await client.call("session.list", {"watch": True})

        renamed = await client.call("session.rename", {"session_id": session_id, "title": "Plans."})
        assert rpc_result(renamed) == {"title": "Plans"}
        await _summaries_until(client, lambda found: any(s.get("title") == "Plans" for s in found))
        updated = await client.wait_for_event("session.updated")
        assert _event_data(updated) == {"title": "Plans", "cwd": None}

        blank = await client.call("session.rename", {"session_id": session_id, "title": " "})
        assert error_code(blank) == INVALID_PARAMS
        missing = await client.call("session.rename", {"session_id": "s_missing", "title": "x"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_fork_returns_a_session_whose_replay_is_the_copied_history(short_home: Path) -> None:
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=["Hi"]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        source = await _open(client)
        await client.call("message.send", {"session_id": source, "text": "hello"})
        await client.wait_for_event("run.completed")
        reply = _event_data(client.events[-2])
        assert reply["role"] == "assistant"

        missing = await client.call("session.fork", {"session_id": source, "at_message_id": "m_x"})
        assert error_code(missing) == MESSAGE_NOT_FOUND
        forked = rpc_result(
            await client.call(
                "session.fork", {"session_id": source, "at_message_id": reply["message_id"]}
            )
        )
        fork = forked["session_id"]
        assert isinstance(fork, str) and fork != source

        before = len(client.events)
        await _attach(client, fork)
        replay = (await client.take_events())[before:]
        assert _event_types(replay) == ["session.created", "message.completed", "message.completed"]
        assert _completed_text(replay, "assistant") == ["Hi"]
        created = _event_data(replay[0])
        assert created["forked_from"] == {"session_id": source, "message_id": reply["message_id"]}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_config_get_lists_the_rules_for_a_folder(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        '[[rule]]\ntool = "grep"\nmatch = "*secret*"\naction = "deny"\n', encoding="utf-8"
    )
    project = short_home / "project"
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "policy.toml").write_text(
        '[[rule]]\ntool = "*"\naction = "allow"\n', encoding="utf-8"
    )
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=[]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        result = rpc_result(await client.call("config.get", {"cwd": str(project)}))
        assert isinstance(result, dict)
        assert result["project_trusted"] is False
        assert result["project_policy"] == str(project / ".golem" / "policy.toml")
        rules = cast(list[dict[str, object]], result["rules"])
        first, second = rules[0], rules[1]
        assert (first["action"], first["ignored"]) == (
            "allow",
            "the project is not in trusted_projects",
        )
        assert (second["tool"], second["match"], second["action"]) == ("grep", "*secret*", "deny")
        assert rules[-1] == {
            "tool": "*",
            "match": None,
            "path": None,
            "action": "ask",
            "source": "built-in default",
            "ignored": None,
        }
        relative = await client.call("config.get", {"cwd": "project"})
        assert error_code(relative) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_approval_respond_goes_on_with_the_waiting_run(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        '[[rule]]\ntool = "read_file"\naction = "ask"\n', encoding="utf-8"
    )
    project = short_home / "project"
    project.mkdir()
    (project / "notes.txt").write_text("42\n", encoding="utf-8")
    model = ToolCallingChatModel(replies=[[("read_file", {"path": "notes.txt"})], "It is 42."])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        assert isinstance(created, dict)
        session_id = str(created["session_id"])
        await _attach(client, session_id)
        await client.call("message.send", {"session_id": session_id, "text": "read notes"})
        needed = _event_data(await client.wait_for_event("approval.needed"))
        assert (needed["name"], needed["args"]) == ("read_file", {"path": "notes.txt"})
        assert needed["source"].endswith("config.toml rule 1")  # type: ignore[union-attr]

        wrong = await client.call(
            "approval.respond", {"session_id": session_id, "call_id": "nope", "decision": "allow"}
        )
        assert error_code(wrong) == APPROVAL_NOT_FOUND
        answered = await client.call(
            "approval.respond",
            {"session_id": session_id, "call_id": needed["call_id"], "decision": "allow"},
        )
        assert isinstance(rpc_result(answered), dict)
        await client.wait_for_event("run.completed")
        assert _completed_text(client.events, "assistant")[-1] == "It is 42."
        assert "tool.completed" in _event_types(client.events)
    finally:
        await client.close()
        await stop_daemon(app, task)
