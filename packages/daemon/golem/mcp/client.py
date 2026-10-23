"""A small MCP client: the handshake, listing tools, calling them, and ``ping``.

MCP is JSON-RPC 2.0 (ADR-023). The messages travel over a
:class:`~golem.mcp.transport.Transport`, a child process's stdio or HTTP.
golem only uses tools, so it declares no client capabilities and a server
has no reason to ask it anything. A request it sends anyway gets "method not
found", except ``ping``, which gets an empty result.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, cast

from golem import __version__
from golem.mcp.transport import Launch, McpError, StdioTransport, Transport

log = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
METHOD_NOT_FOUND = -32601


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


class McpClient:
    """One server. :meth:`start` it, then list and call its tools.

    ``on_tools_changed`` runs when the server says its tool list changed.
    """

    def __init__(
        self, transport: Transport, *, on_tools_changed: Callable[[], None] | None = None
    ) -> None:
        self._transport = transport
        self._on_tools_changed = on_tools_changed
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._next_id = 0
        self._failure: str | None = None
        self._watch: asyncio.Task[None] | None = None

    async def start(self, timeout: float) -> None:
        """Open the transport and finish MCP's handshake. Raises :class:`McpError`."""
        await self._transport.open(self._handle)
        self._watch = asyncio.create_task(self._watch_transport(), name="mcp-watch")
        params = {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "golem", "version": __version__},
        }
        result = await self._request("initialize", params, timeout)
        version = result.get("protocolVersion")
        self._transport.protocol_version = version if isinstance(version, str) else PROTOCOL_VERSION
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
        params = {"name": name, "arguments": dict(arguments)}
        result = await self._request("tools/call", params, timeout)
        return CallResult(
            content=_list(result.get("content")),
            is_error=result.get("isError") is True,
            structured=result.get("structuredContent"),
        )

    async def ping(self, timeout: float) -> None:
        """Ask whether the server still answers. Raises :class:`McpError`."""
        await self._request("ping", {}, timeout)

    async def wait_closed(self) -> str:
        """Wait until the server is gone, and say why."""
        return await self._transport.wait_closed()

    async def close(self) -> None:
        self._fail("stopped")
        await self._transport.close()
        if self._watch is not None:
            self._watch.cancel()
            await asyncio.gather(self._watch, return_exceptions=True)

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
            message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)}
            await self._send(message)
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
        await self._transport.send(message)

    async def _watch_transport(self) -> None:
        self._fail(await self._transport.wait_closed())

    async def _handle(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if isinstance(method, str):
            if "id" in message:
                await self._answer(message["id"], method)
            elif method == "notifications/tools/list_changed" and self._on_tools_changed:
                self._on_tools_changed()
            return
        future = self._pending.get(message.get("id"))  # pyright: ignore[reportArgumentType]
        if future is None or future.done():
            return
        error = message.get("error")
        if isinstance(error, dict):
            text = cast(dict[str, Any], error).get("message")
            reason = text if isinstance(text, str) and text else "the server returned an error"
            future.set_exception(McpError(reason))
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


def _list(value: object) -> list[Mapping[str, object]]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [cast(dict[str, object], item) for item in items if isinstance(item, dict)]


__all__ = [
    "PROTOCOL_VERSION",
    "CallResult",
    "Launch",
    "McpClient",
    "McpError",
    "McpTool",
    "StdioTransport",
]
