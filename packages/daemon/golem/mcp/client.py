"""A small MCP client over stdio: start a server, list its tools, and call them.

MCP is JSON-RPC 2.0 with one message per line on the server's stdin and
stdout (ADR-023). golem only uses
tools, so it declares no client capabilities and a server has no reason to
ask it anything. A request it sends anyway gets "method not found", except
``ping``, which gets an empty result. The server's stderr goes to the log,
and its last lines explain an exit.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from golem import __version__

log = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
MAX_LINE_BYTES = 16 * 1024 * 1024
"""The longest message golem reads. A tool result is one line, and it can be big."""
STDERR_LINES = 20
STOP_SECONDS = 2.0
METHOD_NOT_FOUND = -32601


class McpError(Exception):
    """The server did not start, broke the protocol, exited, or answered with an error."""


@dataclass(frozen=True, slots=True)
class McpTool:
    """One tool as ``tools/list`` describes it."""

    name: str
    description: str
    input_schema: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class CallResult:
    """``tools/call``'s answer: its content items, and whether the tool failed."""

    content: list[Mapping[str, object]]
    is_error: bool
    structured: object = None


@dataclass(frozen=True, slots=True)
class Launch:
    """The server's process: an absolute ``argv``, its whole environment, and its folder."""

    argv: list[str]
    env: Mapping[str, str] = field(default_factory=dict[str, str])
    cwd: Path | None = None


class McpClient:
    """One running server. :meth:`start` it, then list and call its tools.

    ``on_tools_changed`` runs when the server says its tool list changed.
    ``stop_seconds`` is how long :meth:`close` waits after each step.
    """

    def __init__(
        self,
        launch: Launch,
        *,
        on_tools_changed: Callable[[], None] | None = None,
        stop_seconds: float = STOP_SECONDS,
    ) -> None:
        self._launch = launch
        self._stop_seconds = stop_seconds
        self._on_tools_changed = on_tools_changed
        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._next_id = 0
        self._stderr: deque[str] = deque(maxlen=STDERR_LINES)
        self._tasks: list[asyncio.Task[None]] = []
        self._closed = asyncio.Event()
        self._failure: str | None = None

    async def start(self, timeout: float) -> None:
        """Start the process and finish MCP's handshake. Raises :class:`McpError`."""
        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._launch.argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=dict(self._launch.env),
                cwd=self._launch.cwd,
                limit=MAX_LINE_BYTES,
                # Its own process group: stopping it also stops what it started, such as node.
                start_new_session=True,
            )
        except OSError as exc:
            raise McpError(f"cannot start {self._launch.argv[0]}: {exc.strerror or exc}") from exc
        self._tasks = [
            asyncio.create_task(self._read_stdout(), name="mcp-stdout"),
            asyncio.create_task(self._read_stderr(), name="mcp-stderr"),
        ]
        params = {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "golem", "version": __version__},
        }
        result = await self._request("initialize", params, timeout)
        log.info("mcp server %s speaks %s", self._launch.argv[0], result.get("protocolVersion"))
        await self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    async def list_tools(self, timeout: float) -> list[McpTool]:
        """Every tool, across pages. Raises :class:`McpError`."""
        tools: list[McpTool] = []
        cursor: str | None = None
        while True:
            params = {} if cursor is None else {"cursor": cursor}
            result = await self._request("tools/list", params, timeout)
            for item in _list(result.get("tools")):
                name = item.get("name")
                if not isinstance(name, str) or not name:
                    continue
                description = item.get("description") or item.get("title") or ""
                schema = item.get("inputSchema")
                tools.append(
                    McpTool(
                        name=name,
                        description=description if isinstance(description, str) else "",
                        input_schema=cast(dict[str, object], schema)
                        if isinstance(schema, dict)
                        else {},
                    )
                )
            next_cursor = result.get("nextCursor")
            if not isinstance(next_cursor, str) or not next_cursor:
                return tools
            cursor = next_cursor

    async def call_tool(
        self, name: str, arguments: Mapping[str, object], timeout: float
    ) -> CallResult:
        """Run one tool. Raises :class:`McpError` when there is no answer in time."""
        result = await self._request(
            "tools/call", {"name": name, "arguments": dict(arguments)}, timeout
        )
        return CallResult(
            content=_list(result.get("content")),
            is_error=result.get("isError") is True,
            structured=result.get("structuredContent"),
        )

    async def wait_closed(self) -> str:
        """Wait until the server is gone, and say why."""
        await self._closed.wait()
        return self._failure or "stopped"

    async def close(self) -> None:
        """Close stdin, then SIGTERM, then SIGKILL, as the stdio transport asks."""
        self._fail("stopped")
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

    async def _request(
        self, method: str, params: Mapping[str, object], timeout: float
    ) -> dict[str, Any]:
        if self._failure is not None:
            raise McpError(self._failure)
        self._next_id += 1
        request_id = self._next_id
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._send(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)}
            )
            return await asyncio.wait_for(future, timeout)
        except TimeoutError:
            if method == "tools/call":
                note = {"requestId": request_id, "reason": "timed out"}
                with contextlib.suppress(McpError):
                    await self._send(
                        {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": note}
                    )
            raise McpError(f"{method} got no answer within {timeout:g} s") from None
        finally:
            self._pending.pop(request_id, None)

    async def _send(self, message: Mapping[str, object]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise McpError("the server is not running")
        try:
            process.stdin.write(json.dumps(message, ensure_ascii=False).encode() + b"\n")
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise McpError(self._exit_reason()) from exc

    async def _read_stdout(self) -> None:
        process = self._process
        assert process is not None and process.stdout is not None
        try:
            while line := await process.stdout.readline():
                await self._handle(line)
        except ValueError:
            self._fail(f"the server sent a message over {MAX_LINE_BYTES // (1024 * 1024)} MB")
            return
        await process.wait()
        self._fail(self._exit_reason())

    async def _read_stderr(self) -> None:
        process = self._process
        assert process is not None and process.stderr is not None
        with contextlib.suppress(ValueError):
            while line := await process.stderr.readline():
                text = line.decode(errors="replace").rstrip()
                if text:
                    self._stderr.append(text)
                    log.debug("mcp %s: %s", self._launch.argv[0], text)

    async def _handle(self, line: bytes) -> None:
        try:
            message: object = json.loads(line)
        except ValueError:
            log.debug("mcp %s wrote a line that is not JSON", self._launch.argv[0])
            return
        if not isinstance(message, dict):
            return
        message = cast(dict[str, Any], message)
        method = message.get("method")
        if isinstance(method, str):
            if "id" in message:
                await self._answer(message["id"], method)
            elif (
                method == "notifications/tools/list_changed" and self._on_tools_changed is not None
            ):
                self._on_tools_changed()
            return
        future = self._pending.get(message.get("id"))  # pyright: ignore[reportArgumentType]
        if future is None or future.done():
            return
        error = message.get("error")
        if isinstance(error, dict):
            text = cast(dict[str, Any], error).get("message")
            future.set_exception(
                McpError(text if isinstance(text, str) and text else "the server returned an error")
            )
            return
        result = message.get("result")
        future.set_result(cast(dict[str, Any], result) if isinstance(result, dict) else {})

    async def _answer(self, request_id: object, method: str) -> None:
        if method == "ping":
            reply: dict[str, object] = {"jsonrpc": "2.0", "id": request_id, "result": {}}
        else:
            error = {"code": METHOD_NOT_FOUND, "message": f"golem does not support {method}"}
            reply = {"jsonrpc": "2.0", "id": request_id, "error": error}
        with contextlib.suppress(McpError):
            await self._send(reply)

    def _fail(self, reason: str) -> None:
        if self._failure is None:
            self._failure = reason
        for future in self._pending.values():
            if not future.done():
                future.set_exception(McpError(self._failure))
        self._closed.set()

    def _exit_reason(self) -> str:
        process = self._process
        code = None if process is None else process.returncode
        said = self._stderr[-1] if self._stderr else ""
        reason = "the server exited" if code is None else f"the server exited with code {code}"
        return f"{reason}: {said}" if said else reason


def _list(value: object) -> list[Mapping[str, object]]:
    if not isinstance(value, list):
        return []
    return [
        cast(dict[str, object], item)
        for item in cast(list[object], value)
        if isinstance(item, dict)
    ]


__all__ = ["PROTOCOL_VERSION", "CallResult", "Launch", "McpClient", "McpError", "McpTool"]
