"""MCP over Streamable HTTP, against a server faked with ``httpx.MockTransport``."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from golem.mcp.client import McpClient, McpError
from golem.mcp.transport import HttpTransport

URL = "https://mcp.example.com/mcp"


class _Server:
    """Answers ``initialize`` and ``tools/call`` with JSON, ``tools/list`` as an event stream.

    The stream asks golem for ``ping`` before it answers. ``refuse`` makes
    calls fail with 401, and ``forget`` ends the session.
    """

    def __init__(self) -> None:
        self.seen: list[tuple[str, dict[str, Any], httpx.Headers]] = []
        self.refuse = False
        self.forget = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            self.seen.append(("DELETE", {}, request.headers))
            return httpx.Response(200)
        message: dict[str, Any] = json.loads(request.content)
        self.seen.append((message.get("method", "answer"), message, request.headers))
        if self.forget:
            return httpx.Response(404)
        method = message.get("method")
        if method is None or "id" not in message:
            return httpx.Response(202)
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "serverInfo": {"name": "x"},
            }
            return _json(message["id"], result, {"Mcp-Session-Id": "s-1"})
        if method == "tools/list":
            ping = {"jsonrpc": "2.0", "id": "srv-1", "method": "ping"}
            tools = {"tools": [{"name": "search", "inputSchema": {"type": "object"}}]}
            answer = {"jsonrpc": "2.0", "id": message["id"], "result": tools}
            body = f"event: message\ndata: {json.dumps(ping)}\n\ndata: {json.dumps(answer)}\n\n"
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        if method == "tools/call":
            if self.refuse:
                return httpx.Response(401, text="bad token")
            text = f"found {message['params']['arguments']['q']}"
            return _json(message["id"], {"content": [{"type": "text", "text": text}]})
        return _json(message["id"], {})


def _json(
    request_id: object, result: object, headers: dict[str, str] | None = None
) -> httpx.Response:
    return httpx.Response(
        200, json={"jsonrpc": "2.0", "id": request_id, "result": result}, headers=headers
    )


async def _client(server: _Server, headers: dict[str, str] | None = None) -> McpClient:
    client = McpClient(HttpTransport(URL, headers, transport=httpx.MockTransport(server)))
    await client.start(5)
    return client


async def test_a_session_over_http_lists_and_calls_tools() -> None:
    server = _Server()
    client = await _client(server, {"Authorization": "Bearer t0ken"})
    try:
        tools = await client.list_tools(5)
        assert [tool.name for tool in tools] == ["search"]
        result = await client.call_tool("search", {"q": "golem"}, 5)
        assert result.content == [{"type": "text", "text": "found golem"}]
        await client.ping(5)
    finally:
        await client.close()
    methods = [method for method, _, _ in server.seen]
    assert methods[:3] == ["initialize", "notifications/initialized", "tools/list"]
    assert "answer" in methods  # golem answered the server's ping inside the stream
    assert methods[-1] == "DELETE"
    first, later = server.seen[0][2], server.seen[2][2]
    assert first["authorization"] == "Bearer t0ken"
    assert "mcp-session-id" not in first and "mcp-protocol-version" not in first
    assert later["mcp-session-id"] == "s-1"
    assert later["mcp-protocol-version"] == "2025-06-18"
    assert "text/event-stream" in later["accept"]


async def test_an_http_error_fails_the_call_and_keeps_the_session() -> None:
    server = _Server()
    client = await _client(server)
    try:
        server.refuse = True
        with pytest.raises(McpError, match="HTTP 401: bad token"):
            await client.call_tool("search", {"q": "x"}, 5)
        server.refuse = False
        assert (await client.call_tool("search", {"q": "y"}, 5)).content[0]["text"] == "found y"
    finally:
        await client.close()


async def test_an_ended_session_closes_the_transport() -> None:
    server = _Server()
    client = await _client(server)
    try:
        server.forget = True
        with pytest.raises(McpError, match="ended the session"):
            await client.call_tool("search", {"q": "x"}, 5)
        assert await client.wait_closed() == "the server ended the session"
    finally:
        await client.close()


async def test_a_server_that_cannot_be_reached_closes_the_transport() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = McpClient(HttpTransport(URL, transport=httpx.MockTransport(down)))
    with pytest.raises(
        McpError, match=r"cannot reach https://mcp\.example\.com/mcp: connection refused"
    ):
        await client.start(5)
    assert "connection refused" in await client.wait_closed()
    await client.close()
