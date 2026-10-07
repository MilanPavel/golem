"""Socket server, protocol commands, stale socket, and shutdown."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import stat
import subprocess
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from pydantic import BaseModel, ConfigDict
from support import ServeProcess

from golem.config import load_settings
from golem.logging import configure_logging
from golem.models.router import ModelRouter
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

HELLO = {"protocol_major": 1, "protocol_minor": 0, "client": "tui"}


class RpcClient:
    """Reads the socket on one task so a response and events can arrive together."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer
        self._next = 1
        self._waiters: dict[int, asyncio.Future[dict[str, object]]] = {}
        self._orphan: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        self.events: list[dict[str, object]] = []
        self._pump = asyncio.create_task(self._read_loop())

    @classmethod
    async def connect(cls, path: Path) -> RpcClient:
        reader, writer = await asyncio.open_unix_connection(os.fspath(path))
        return cls(reader, writer)

    async def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float = 2,
    ) -> dict[str, object]:
        request_id = self._next
        self._next += 1
        loop = asyncio.get_running_loop()
        waiter: asyncio.Future[dict[str, object]] = loop.create_future()
        self._waiters[request_id] = waiter
        body = {
            "jsonrpc": "2.0",
            "method": method,
            "params": {} if params is None else params,
            "id": request_id,
        }
        self._writer.write(json.dumps(body).encode() + b"\n")
        await self._writer.drain()
        try:
            return await asyncio.wait_for(waiter, timeout=timeout)
        finally:
            self._waiters.pop(request_id, None)

    async def send_raw(self, data: bytes) -> dict[str, object]:
        self._writer.write(data)
        return await asyncio.wait_for(self._orphan.get(), timeout=2)

    async def wait_for_event(self, event_type: str, *, timeout: float = 2) -> dict[str, object]:
        """Return a queued ``event`` whose ``params.type`` is ``event_type``."""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            found = _find_event(self.events, event_type)
            if found is not None:
                return found
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise TimeoutError(self.events)
            try:
                payload = await asyncio.wait_for(self._orphan.get(), timeout=remaining)
            except TimeoutError:
                raise TimeoutError(self.events) from None
            if payload.get("method") == "event":
                self.events.append(payload)

    async def close(self) -> None:
        self._pump.cancel()
        self._writer.close()
        with contextlib.suppress(ConnectionError, OSError):
            await self._writer.wait_closed()

    async def _read_loop(self) -> None:
        try:
            while True:
                line = await self._reader.readline()
                if not line:
                    return
                payload = _object_dict(json.loads(line))
                request_id = payload.get("id")
                waiter = self._waiters.get(request_id) if isinstance(request_id, int) else None
                if waiter is not None and not waiter.done():
                    waiter.set_result(payload)
                    continue
                await self._orphan.put(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            return


def _params(event: dict[str, object]) -> dict[str, object] | None:
    params = event.get("params")
    if isinstance(params, dict):
        return cast(dict[str, object], params)
    return None


def _find_event(events: list[dict[str, object]], event_type: str) -> dict[str, object] | None:
    for event in events:
        params = _params(event)
        if params is not None and params.get("type") == event_type:
            return event
    return None


def _object_dict(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def rpc_result(payload: dict[str, object]) -> dict[str, object]:
    assert "error" not in payload, payload
    return _object_dict(payload["result"])


def error_code(payload: dict[str, object]) -> int:
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
    app, task = await start_daemon(short_home)
    try:
        yield app
    finally:
        await stop_daemon(app, task)


async def start_daemon(
    home: Path,
    *,
    extra_methods: Mapping[str, Method] | None = None,
    max_connections: int = 32,
    router: ModelRouter | None = None,
) -> tuple[DaemonApp, asyncio.Task[None]]:
    paths = resolve_paths(home)
    paths.ensure_layout()
    configure_logging(load_settings(home=paths.home, project_dir=paths.home), paths)
    app = DaemonApp(
        paths,
        extra_methods=extra_methods,
        max_connections=max_connections,
        router=router,
    )
    task = asyncio.create_task(app.serve(install_signals=False))
    await _wait_listening(paths.socket_path, task)
    return app, task


async def stop_daemon(app: DaemonApp, task: asyncio.Task[None]) -> None:
    if not task.done():
        app.request_shutdown()
        await asyncio.wait_for(task, timeout=2)


async def test_hello_status_and_ping(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        hello = rpc_result(await client.call("hello", HELLO))
        assert hello["protocol_major"] == 1
        assert hello["protocol_minor"] == 1
        assert hello["daemon_version"] == "0.0.0"
        status = rpc_result(await client.call("daemon.status"))
        assert status["pid"] == os.getpid()
        assert status["state"] == "running"
        assert status["version"] == "0.0.0"
        uptime = status["uptime_seconds"]
        assert isinstance(uptime, int | float)
        assert uptime >= 0
        ping = rpc_result(await client.call("ping", {"nonce": "abc"}))
        assert ping == {"type": "system.ping", "nonce": "abc"}
        mode = stat.S_IMODE(running.paths.socket_path.stat().st_mode)
        assert mode == 0o600
    finally:
        await client.close()


async def test_minor_mismatch_is_accepted(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        hello = rpc_result(
            await client.call("hello", {**HELLO, "protocol_minor": 9}),
        )
        assert hello["protocol_major"] == 1
        assert hello["protocol_minor"] == 1
    finally:
        await client.close()


async def test_major_mismatch_refuses_and_does_not_unlock_commands(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        mismatch = await client.call("hello", {**HELLO, "protocol_major": 2})
        assert error_code(mismatch) == PROTOCOL_MISMATCH
        assert _object_dict(mismatch["error"])["data"] == {"client_major": 2, "daemon_major": 1}
        blocked = await client.call("ping", {"nonce": "x"})
        assert error_code(blocked) == HELLO_REQUIRED
    finally:
        await client.close()


async def test_commands_before_hello_are_rejected(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        status = await client.call("daemon.status")
        assert error_code(status) == HELLO_REQUIRED
        ping = await client.call("ping", {"nonce": "x"})
        assert error_code(ping) == HELLO_REQUIRED
    finally:
        await client.close()


async def test_unknown_method(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = await client.call("no.such")
        assert error_code(missing) == METHOD_NOT_FOUND
    finally:
        await client.close()


async def test_invalid_json(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        payload = await client.send_raw(b"not-json\n")
        assert error_code(payload) == PARSE_ERROR
        assert payload["id"] is None
    finally:
        await client.close()


async def test_line_too_long_closes_the_connection(running: DaemonApp) -> None:
    client = await RpcClient.connect(running.paths.socket_path)
    try:
        payload = await client.send_raw(b"x" * (MAX_LINE_BYTES + 8))
        assert error_code(payload) == PARSE_ERROR
        assert _object_dict(payload["error"])["message"] == "line too long"
    finally:
        await client.close()


async def test_second_connection_is_rejected_at_capacity(short_home: Path) -> None:
    app, task = await start_daemon(short_home, max_connections=1)
    first = await RpcClient.connect(app.paths.socket_path)
    try:
        hello = rpc_result(await first.call("hello", HELLO))
        assert hello["protocol_major"] == 1
        _reader, writer = await asyncio.open_unix_connection(os.fspath(app.paths.socket_path))
        data = await asyncio.wait_for(_reader.read(16), timeout=1)
        assert data == b""
        writer.close()
    finally:
        await first.close()
        await stop_daemon(app, task)


async def test_stale_socket_file_is_replaced(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    paths.ensure_layout()
    paths.socket_path.write_text("stale", encoding="utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(paths.socket_path)
    try:
        assert "result" in await client.call("hello", HELLO)
    finally:
        await client.close()
        await stop_daemon(app, task)


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

    app, task = await start_daemon(
        short_home,
        extra_methods={"test.slow": Method("test.slow", SlowParams, True, slow)},
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    slow_call = asyncio.create_task(client.call("test.slow"))
    await asyncio.wait_for(started.wait(), timeout=2)
    app.request_shutdown()
    payload, _done = await asyncio.wait_for(asyncio.gather(slow_call, task), timeout=2)
    assert rpc_result(payload) == {"done": True}
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


def test_typescript_status_reads_the_daemon(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    serve = ServeProcess(short_home)
    try:
        serve.wait_listening(paths.socket_path)
        completed = _golem_status(short_home)
        assert completed.returncode == 0, completed.stderr
        assert "connected" in completed.stdout
        assert f"pid: {serve.proc.pid}" in completed.stdout
        assert "protocol: 1.1" in completed.stdout
        assert "state: running" in completed.stdout
    finally:
        serve.stop()


def test_typescript_status_fails_when_daemon_is_down(short_home: Path) -> None:
    completed = _golem_status(short_home)
    assert completed.returncode == 1
    assert "daemon is not running" in completed.stderr


def _golem_status(home: Path) -> subprocess.CompletedProcess[str]:
    root = Path(__file__).resolve().parents[3]
    env = os.environ.copy()
    env["GOLEM_HOME"] = str(home)
    return subprocess.run(
        ["pnpm", "exec", "golem", "status"],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
