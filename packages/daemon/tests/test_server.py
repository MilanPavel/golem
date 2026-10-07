"""Socket server, protocol commands, stale socket, and shutdown."""

from __future__ import annotations

import asyncio
import json
import os
import signal
import stat
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from pydantic import BaseModel, ConfigDict
from support import ServeProcess

from golem.config import load_settings
from golem.logging import configure_logging
from golem.paths import resolve_paths
from golem.server.app import DaemonApp, SocketPathTooLong, assert_socket_path_fits
from golem.server.dispatcher import (
    HELLO_REQUIRED,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    PROTOCOL_MISMATCH,
    Method,
    RequestContext,
)
from golem.server.framing import MAX_LINE_BYTES

_HELLO = {"protocol_major": 1, "protocol_minor": 0, "client": "tui"}


class RpcClient:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer
        self._next = 1

    @classmethod
    async def connect(cls, path: Path) -> RpcClient:
        reader, writer = await asyncio.open_unix_connection(os.fspath(path))
        return cls(reader, writer)

    async def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, object]:
        request_id = self._next
        self._next += 1
        body = {
            "jsonrpc": "2.0",
            "method": method,
            "params": {} if params is None else params,
            "id": request_id,
        }
        self._writer.write(json.dumps(body).encode() + b"\n")
        await self._writer.drain()
        line = await asyncio.wait_for(self._reader.readline(), timeout=2)
        assert line, "connection closed"
        payload = _object_dict(json.loads(line))
        assert payload["id"] == request_id
        return payload

    async def send_raw(self, data: bytes) -> dict[str, object]:
        self._writer.write(data)
        line = await asyncio.wait_for(self._reader.readline(), timeout=2)
        return _object_dict(json.loads(line))

    async def close(self) -> None:
        self._writer.close()
        await self._writer.wait_closed()


def _object_dict(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _result(payload: dict[str, object]) -> dict[str, object]:
    assert "error" not in payload, payload
    return _object_dict(payload["result"])


def _error_code(payload: dict[str, object]) -> int:
    code = _object_dict(payload["error"])["code"]
    assert isinstance(code, int)
    return code


async def _wait_listening(path: Path, task: asyncio.Task[None]) -> None:
    deadline = asyncio.get_running_loop().time() + 2
    while asyncio.get_running_loop().time() < deadline:
        if task.done():
            task.result()
            raise RuntimeError("server exited before listening")
        if path.exists():
            try:
                client = await RpcClient.connect(path)
            except OSError:
                await asyncio.sleep(0.01)
                continue
            await client.close()
            # Let the server drop the probe before the test opens its own connection.
            await asyncio.sleep(0.05)
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(path)


@pytest.fixture
async def running(short_home: Path) -> AsyncIterator[DaemonApp]:
    app, task = await _start(short_home)
    try:
        yield app
    finally:
        await _stop(app, task)


async def _start(
    home: Path,
    *,
    extra_methods: Mapping[str, Method] | None = None,
    max_connections: int = 32,
) -> tuple[DaemonApp, asyncio.Task[None]]:
    paths = resolve_paths(home)
    paths.ensure_layout()
    configure_logging(load_settings(home=paths.home, project_dir=paths.home), paths)
    app = DaemonApp(paths, extra_methods=extra_methods, max_connections=max_connections)
    task = asyncio.create_task(app.serve(install_signals=False))
    await _wait_listening(paths.socket_path, task)
    return app, task


async def _stop(app: DaemonApp, task: asyncio.Task[None]) -> None:
    if not task.done():
        app.request_shutdown()
        await asyncio.wait_for(task, timeout=2)


async def test_hello_status_and_ping(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        hello = _result(await client.call("hello", _HELLO))
        assert hello["protocol_major"] == 1
        assert hello["protocol_minor"] == 0
        assert hello["daemon_version"] == "0.0.0"
        status = _result(await client.call("daemon.status"))
        assert status["pid"] == os.getpid()
        assert status["state"] == "running"
        assert status["version"] == "0.0.0"
        uptime = status["uptime_seconds"]
        assert isinstance(uptime, int | float)
        assert uptime >= 0
        ping = _result(await client.call("ping", {"nonce": "abc"}))
        assert ping == {"type": "system.ping", "nonce": "abc"}
        mode = stat.S_IMODE(running.paths.socket_path.stat().st_mode)
        assert mode == 0o600
    finally:
        await client.close()


async def test_minor_mismatch_is_accepted(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        hello = _result(
            await client.call("hello", {**_HELLO, "protocol_minor": 9}),
        )
        assert hello["protocol_major"] == 1
        assert hello["protocol_minor"] == 0
    finally:
        await client.close()


async def test_major_mismatch_refuses_and_does_not_unlock_commands(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        mismatch = await client.call("hello", {**_HELLO, "protocol_major": 2})
        assert _error_code(mismatch) == PROTOCOL_MISMATCH
        assert _object_dict(mismatch["error"])["data"] == {"client_major": 2, "daemon_major": 1}
        blocked = await client.call("ping", {"nonce": "x"})
        assert _error_code(blocked) == HELLO_REQUIRED
    finally:
        await client.close()


async def test_commands_before_hello_are_rejected(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        status = await client.call("daemon.status")
        assert _error_code(status) == HELLO_REQUIRED
        ping = await client.call("ping", {"nonce": "x"})
        assert _error_code(ping) == HELLO_REQUIRED
    finally:
        await client.close()


async def test_unknown_method(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        await client.call("hello", _HELLO)
        missing = await client.call("no.such")
        assert _error_code(missing) == METHOD_NOT_FOUND
    finally:
        await client.close()


async def test_invalid_json(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        payload = await client.send_raw(b"not-json\n")
        assert _error_code(payload) == PARSE_ERROR
        assert payload["id"] is None
    finally:
        await client.close()


async def test_line_too_long_closes_the_connection(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        payload = await client.send_raw(b"x" * (MAX_LINE_BYTES + 8))
        assert _error_code(payload) == PARSE_ERROR
        assert _object_dict(payload["error"])["message"] == "line too long"
    finally:
        await client.close()


async def test_second_connection_is_rejected_at_capacity(short_home: Path) -> None:
    app, task = await _start(short_home, max_connections=1)
    first = await RpcClient.connect(app.paths.socket_path)
    try:
        hello = _result(await first.call("hello", _HELLO))
        assert hello["protocol_major"] == 1
        _reader, writer = await asyncio.open_unix_connection(os.fspath(app.paths.socket_path))
        data = await asyncio.wait_for(_reader.read(16), timeout=1)
        assert data == b""
        writer.close()
    finally:
        await first.close()
        await _stop(app, task)


async def test_stale_socket_file_is_replaced(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    paths.ensure_layout()
    paths.socket_path.write_text("stale", encoding="utf-8")
    app, task = await _start(short_home)
    client = await RpcClient.connect(paths.socket_path)
    try:
        assert "result" in await client.call("hello", _HELLO)
    finally:
        await client.close()
        await _stop(app, task)


async def test_shutdown_drains_in_flight_handler(short_home: Path) -> None:
    started = asyncio.Event()

    class SlowParams(BaseModel):
        model_config = ConfigDict(extra="forbid", frozen=True)

    class SlowResult(BaseModel):
        model_config = ConfigDict(extra="forbid", frozen=True)
        done: bool = True

    async def slow(ctx: RequestContext, params: SlowParams) -> SlowResult:
        del ctx, params
        started.set()
        await asyncio.sleep(0.3)
        return SlowResult()

    app, task = await _start(
        short_home,
        extra_methods={"test.slow": Method("test.slow", SlowParams, True, slow)},
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", _HELLO)
    slow_call = asyncio.create_task(client.call("test.slow"))
    await asyncio.wait_for(started.wait(), timeout=2)
    app.request_shutdown()
    payload, _done = await asyncio.wait_for(asyncio.gather(slow_call, task), timeout=2)
    assert _result(payload) == {"done": True}
    assert not app.paths.socket_path.exists()
    await client.close()


def test_socket_path_length_guard() -> None:
    assert_socket_path_fits(Path("/tmp/golem.sock"))
    long_path = Path("/tmp") / ("n" * 120) / "golem.sock"
    with pytest.raises(SocketPathTooLong):
        assert_socket_path_fits(long_path)


async def test_serve_rejects_a_long_socket_path() -> None:
    root = Path(__file__).resolve().parents[3]
    home = root / ".test-socks" / ("n" * 80)
    app = DaemonApp(resolve_paths(home))
    with pytest.raises(SocketPathTooLong):
        await app.serve(install_signals=False)


def test_second_process_exits(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    first = ServeProcess(short_home)
    second: ServeProcess | None = None
    try:
        first.wait_listening(paths.socket_path)
        second = ServeProcess(short_home)
        assert second.proc.wait(timeout=5) == 1
        assert "already running" in second.output()
    finally:
        if second is not None:
            second.stop()
        first.stop()


def test_sigterm_removes_the_socket(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    serve = ServeProcess(short_home)
    try:
        serve.wait_listening(paths.socket_path)
        assert paths.pid_file.read_text(encoding="utf-8").strip() == str(serve.proc.pid)
        serve.proc.send_signal(signal.SIGTERM)
        assert serve.proc.wait(timeout=5) == 0
        assert not paths.socket_path.exists()
    finally:
        serve.stop()


def test_kill_leaves_a_socket_the_next_start_replaces(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    first = ServeProcess(short_home)
    second: ServeProcess | None = None
    try:
        first.wait_listening(paths.socket_path)
        first.proc.kill()
        assert first.proc.wait(timeout=5) is not None
        assert paths.socket_path.exists()
        second = ServeProcess(short_home)
        second.wait_listening(paths.socket_path)
    finally:
        if second is not None:
            second.stop()
        first.stop()
