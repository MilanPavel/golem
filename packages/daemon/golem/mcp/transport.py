"""How MCP messages travel: a child process's stdin and stdout, or Streamable HTTP.

A transport sends one JSON-RPC message at a time and hands every message it
receives to ``deliver``. It knows nothing about requests and answers: that is
:class:`~golem.mcp.client.McpClient`'s job. When it can no longer talk to the
server, it closes, and :meth:`Transport.wait_closed` says why.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
from collections import deque
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, cast

import httpx

log = logging.getLogger(__name__)

MAX_LINE_BYTES = 16 * 1024 * 1024
"""The longest message golem reads. A tool result is one line, and it can be big."""
STDERR_LINES = 20
STOP_SECONDS = 2.0
HTTP_ERROR = -32000

Deliver = Callable[[dict[str, Any]], Awaitable[None]]


class McpError(Exception):
    """The server did not start, broke the protocol, went away, or answered with an error."""


class Transport(Protocol):
    protocol_version: str | None
    """Set once ``initialize`` answers. HTTP sends it with every later request."""

    async def open(self, deliver: Deliver) -> None:
        """Start talking. Raises :class:`McpError` when the server cannot be reached."""
        ...

    async def send(self, message: Mapping[str, object]) -> None:
        """Send one message. Raises :class:`McpError` when the transport is closed."""
        ...

    async def wait_closed(self) -> str: ...

    async def close(self) -> None: ...


class _Closing:
    """The closed state every transport shares: the first reason wins."""

    def __init__(self) -> None:
        self.reason: str | None = None
        self.closed = asyncio.Event()

    def fail(self, reason: str) -> None:
        if self.reason is None:
            self.reason = reason
        self.closed.set()

    def check(self) -> None:
        if self.reason is not None:
            raise McpError(self.reason)


@dataclass(frozen=True, slots=True)
class Launch:
    """A stdio server's process: an absolute ``argv``, its whole environment, and its folder."""

    argv: list[str]
    env: Mapping[str, str] = field(default_factory=dict[str, str])
    cwd: Path | None = None


class StdioTransport:
    """One message per line on a child process's stdin and stdout.

    The child runs in its own process group, so stopping it also stops what it
    started, such as ``npx``'s ``node``. Its stderr goes to the log, and its
    last line explains an exit. ``stop_seconds`` is how long :meth:`close`
    waits after closing stdin, then after SIGTERM, before SIGKILL.
    """

    def __init__(self, launch: Launch, *, stop_seconds: float = STOP_SECONDS) -> None:
        self.protocol_version: str | None = None
        self._launch = launch
        self._stop_seconds = stop_seconds
        self._process: asyncio.subprocess.Process | None = None
        self._stderr: deque[str] = deque(maxlen=STDERR_LINES)
        self._tasks: list[asyncio.Task[None]] = []
        self._state = _Closing()

    async def open(self, deliver: Deliver) -> None:
        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._launch.argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=dict(self._launch.env),
                cwd=self._launch.cwd,
                limit=MAX_LINE_BYTES,
                start_new_session=True,
            )
        except OSError as exc:
            raise McpError(f"cannot start {self._launch.argv[0]}: {exc.strerror or exc}") from exc
        self._tasks = [
            asyncio.create_task(self._read_stdout(deliver), name="mcp-stdout"),
            asyncio.create_task(self._read_stderr(), name="mcp-stderr"),
        ]

    async def send(self, message: Mapping[str, object]) -> None:
        self._state.check()
        process = self._process
        if process is None or process.stdin is None:
            raise McpError("the server is not running")
        try:
            process.stdin.write(json.dumps(message, ensure_ascii=False).encode() + b"\n")
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise McpError(self._exit_reason()) from exc

    async def wait_closed(self) -> str:
        await self._state.closed.wait()
        return self._state.reason or "stopped"

    async def close(self) -> None:
        """Close stdin, then SIGTERM, then SIGKILL, as the stdio transport asks."""
        self._state.fail("stopped")
        process = self._process
        if process is not None and process.returncode is None:
            if process.stdin is not None:
                with contextlib.suppress(OSError):
                    process.stdin.close()
            for sig in (None, signal.SIGTERM, signal.SIGKILL):
                if sig is not None:
                    with contextlib.suppress(ProcessLookupError, PermissionError):
                        os.killpg(process.pid, sig)
                try:
                    await asyncio.wait_for(process.wait(), self._stop_seconds)
                    break
                except TimeoutError:
                    continue
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    async def _read_stdout(self, deliver: Deliver) -> None:
        process = self._process
        assert process is not None and process.stdout is not None
        try:
            while line := await process.stdout.readline():
                message = _json_object(line)
                if message is None:
                    log.debug("mcp %s wrote a line that is not JSON", self._launch.argv[0])
                else:
                    await deliver(message)
        except ValueError:
            self._state.fail(f"the server sent a message over {MAX_LINE_BYTES // (1024 * 1024)} MB")
            return
        await process.wait()
        self._state.fail(self._exit_reason())

    async def _read_stderr(self) -> None:
        process = self._process
        assert process is not None and process.stderr is not None
        with contextlib.suppress(ValueError):
            while line := await process.stderr.readline():
                text = line.decode(errors="replace").rstrip()
                if text:
                    self._stderr.append(text)
                    log.debug("mcp %s: %s", self._launch.argv[0], text)

    def _exit_reason(self) -> str:
        process = self._process
        code = None if process is None else process.returncode
        said = self._stderr[-1] if self._stderr else ""
        reason = "the server exited" if code is None else f"the server exited with code {code}"
        return f"{reason}: {said}" if said else reason


class HttpTransport:
    """MCP's Streamable HTTP: each message is a POST to one URL.

    A request's answer comes back as JSON, or as a server-sent event stream
    that may carry the server's own requests first. The server may give an
    ``Mcp-Session-Id``, which goes with every later message, and a 404 then
    means the session ended: the transport closes, and the supervisor starts
    over with a new ``initialize``. A server that cannot be reached closes it
    too. golem does not open the optional GET stream, so a server's own
    notifications reach it only inside an answer.
    """

    def __init__(
        self,
        url: str,
        headers: Mapping[str, str] | None = None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.protocol_version: str | None = None
        self._url = url
        self._headers = dict(headers or {})
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._deliver: Deliver | None = None
        self._session_id: str | None = None
        self._posts: set[asyncio.Task[None]] = set()
        self._state = _Closing()

    async def open(self, deliver: Deliver) -> None:
        self._deliver = deliver
        timeout = httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0)
        self._client = httpx.AsyncClient(transport=self._transport, timeout=timeout)

    async def send(self, message: Mapping[str, object]) -> None:
        self._state.check()
        if "method" in message and "id" in message:
            # A request's answer may stream for as long as the tool runs.
            task = asyncio.create_task(self._post(message), name="mcp-http-post")
            self._posts.add(task)
            task.add_done_callback(self._posts.discard)
            return
        await self._post(message)

    async def wait_closed(self) -> str:
        await self._state.closed.wait()
        return self._state.reason or "stopped"

    async def close(self) -> None:
        self._state.fail("stopped")
        for task in list(self._posts):
            task.cancel()
        await asyncio.gather(*self._posts, return_exceptions=True)
        client = self._client
        if client is None:
            return
        if self._session_id is not None:
            with contextlib.suppress(httpx.HTTPError):
                await client.delete(self._url, headers=self._request_headers(), timeout=2.0)
        await client.aclose()

    async def _post(self, message: Mapping[str, object]) -> None:
        client = self._client
        assert client is not None
        request_id = message.get("id") if "method" in message else None
        try:
            async with client.stream(
                "POST", self._url, json=dict(message), headers=self._request_headers()
            ) as response:
                if session := response.headers.get("mcp-session-id"):
                    self._session_id = session
                if response.status_code == 404 and self._session_id is not None:
                    self._state.fail("the server ended the session")
                    await self._answer_error(request_id, "the server ended the session")
                    return
                if response.status_code >= 400:
                    body = (await response.aread()).decode(errors="replace").strip()
                    reason = f"HTTP {response.status_code}" + (f": {body[:200]}" if body else "")
                    if request_id is None:
                        raise McpError(reason)
                    await self._answer_error(request_id, reason)
                    return
                kind = response.headers.get("content-type", "")
                if "text/event-stream" in kind:
                    await self._read_events(response)
                elif "application/json" in kind:
                    await self._deliver_body(await response.aread())
        except httpx.HTTPError as exc:
            reason = f"cannot reach {self._url}: {exc or type(exc).__name__}"
            self._state.fail(reason)
            if request_id is None:
                raise McpError(reason) from exc
            await self._answer_error(request_id, reason)

    async def _read_events(self, response: httpx.Response) -> None:
        data: list[str] = []
        async for line in response.aiter_lines():
            if line == "":
                if data:
                    await self._deliver_body("\n".join(data).encode())
                data = []
            elif line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
        if data:
            await self._deliver_body("\n".join(data).encode())

    async def _deliver_body(self, body: bytes) -> None:
        assert self._deliver is not None
        try:
            parsed: object = json.loads(body)
        except ValueError:
            log.debug("mcp %s sent a body that is not JSON", self._url)
            return
        items = cast(list[object], parsed) if isinstance(parsed, list) else [parsed]
        for item in items:
            if isinstance(item, dict):
                await self._deliver(cast(dict[str, Any], item))

    async def _answer_error(self, request_id: object, reason: str) -> None:
        if request_id is None or self._deliver is None:
            return
        error = {"code": HTTP_ERROR, "message": reason}
        await self._deliver({"jsonrpc": "2.0", "id": request_id, "error": error})

    def _request_headers(self) -> dict[str, str]:
        headers = {
            **self._headers,
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id is not None:
            headers["Mcp-Session-Id"] = self._session_id
        if self.protocol_version is not None:
            headers["MCP-Protocol-Version"] = self.protocol_version
        return headers


def _json_object(line: bytes) -> dict[str, Any] | None:
    try:
        message: object = json.loads(line)
    except ValueError:
        return None
    return cast(dict[str, Any], message) if isinstance(message, dict) else None


__all__ = ["HttpTransport", "Launch", "McpError", "StdioTransport", "Transport"]
