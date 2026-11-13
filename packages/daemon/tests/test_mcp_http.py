"""MCP over Streamable HTTP, against a server faked with ``httpx.MockTransport``."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import BaseModel

from golem.config import McpServerSettings
from golem.mcp import McpServerError, McpSupervisor, Timing, oauth
from golem.mcp.client import McpClient, McpError
from golem.mcp.oauth import Tokens
from golem.mcp.transport import HttpTransport
from golem.tools.registry import ToolContext, ToolScope
from golem_protocol.commands import McpServer
from golem_protocol.rpc import McpLoginDoneNotification, McpServerStatusNotification

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


AUTH = "https://auth.example.com"


class _Store:
    def __init__(self) -> None:
        self.items: dict[str, str] = {}

    def get(self, name: str) -> str | None:
        return self.items.get(name)

    def set(self, name: str, value: str) -> None:
        self.items[name] = value

    def delete(self, name: str) -> bool:
        return self.items.pop(name, None) is not None


class _Hosted(_Server):
    """The MCP server of ``URL``, which wants ``Bearer <valid>``, and its authorization server."""

    def __init__(self) -> None:
        super().__init__()
        self.valid: str | None = None
        self.reject_refresh = False
        self.refreshes = 0
        self.bearers: list[str | None] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = urlsplit(str(request.url))
        if url.netloc == "auth.example.com":
            return self._auth(request, url.path)
        if url.path.startswith("/.well-known/"):
            return httpx.Response(200, json={"authorization_servers": [AUTH]})
        bearer = request.headers.get("authorization")
        self.bearers.append(bearer)
        if bearer is None or bearer != f"Bearer {self.valid}":
            challenge = 'Bearer resource_metadata="https://mcp.example.com/.well-known/x"'
            return httpx.Response(401, headers={"www-authenticate": challenge})
        return super().__call__(request)

    def _auth(self, request: httpx.Request, path: str) -> httpx.Response:
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(
                200,
                json={
                    "issuer": AUTH,
                    "authorization_endpoint": f"{AUTH}/authorize",
                    "token_endpoint": f"{AUTH}/token",
                    "registration_endpoint": f"{AUTH}/register",
                    "code_challenge_methods_supported": ["S256"],
                },
            )
        if path == "/register":
            return httpx.Response(201, json={"client_id": "client-1"})
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        if form["grant_type"] == "refresh_token":
            if self.reject_refresh:
                return httpx.Response(400, json={"error": "invalid_grant"})
            self.refreshes += 1
            self.valid = f"access-r{self.refreshes}"
            return httpx.Response(200, json={"access_token": self.valid, "expires_in": 3600})
        self.valid = "access-1"
        body = {"access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3600}
        return httpx.Response(200, json=body)


FAST = Timing(backoff_first=0.05, backoff_max=0.2, health_seconds=60, reload_seconds=60)
HOSTED = McpServerSettings.model_validate({"url": URL, "oauth": {}})
EVERYONE = ToolScope()


@pytest.fixture
async def made() -> AsyncIterator[list[McpSupervisor]]:
    supervisors: list[McpSupervisor] = []
    yield supervisors
    for supervisor in supervisors:
        await supervisor.aclose()


def _supervisor(
    made: list[McpSupervisor], fake: _Hosted, store: _Store, sent: list[BaseModel]
) -> McpSupervisor:
    supervisor = McpSupervisor(
        {"hosted": HOSTED},
        timing=FAST,
        store=store,
        http=httpx.MockTransport(fake),
        broadcast=sent.append,
    )
    made.append(supervisor)
    return supervisor


def _state(supervisor: McpSupervisor) -> McpServer:
    return next(status for status in supervisor.statuses() if status.name == "hosted")


async def _until(check: Callable[[], bool]) -> None:
    async with asyncio.timeout(10):
        while not check():
            await asyncio.sleep(0.02)


def _query(link: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(link).query).items()}


async def _browser(link: str, **extra: str) -> None:
    """Play the browser: come back to the loopback with the state, and a code unless told."""
    query = _query(link)
    params = {"state": query["state"], **(extra or {"code": "code-1"})}
    async with httpx.AsyncClient() as client:
        await client.get(query["redirect_uri"], params=params)


def _saved(store: _Store, **over: Any) -> None:
    base: dict[str, Any] = {
        "access_token": "old",
        "client_id": "client-1",
        "token_endpoint": f"{AUTH}/token",
        "refresh_token": "refresh-1",
        "expires_at": time.time() - 10,
    }
    store.set("mcp/hosted-oauth", Tokens(**{**base, **over}).dump())


async def _call(supervisor: McpSupervisor) -> str:
    tool = next(tool for tool in supervisor.tools(EVERYONE) if tool.name == "mcp__hosted__search")
    return (await tool.call({"q": "x"}, ToolContext(root=None))).summary


async def test_a_server_that_wants_a_sign_in_says_so_then_runs_after_one(
    made: list[McpSupervisor],
) -> None:
    fake, store, sent = _Hosted(), _Store(), list[BaseModel]()
    supervisor = _supervisor(made, fake, store, sent)
    supervisor.start()
    await _until(lambda: _state(supervisor).state == "needs_auth")
    assert supervisor.tools(EVERYONE) == [] and _state(supervisor).tools == []
    assert fake.bearers == []  # no token, so nothing was sent

    link = await supervisor.login(EVERYONE, "hosted")
    assert link.startswith(f"{AUTH}/authorize?")
    await _browser(link)
    await _until(lambda: _state(supervisor).state == "running")
    done = [n for n in sent if isinstance(n, McpLoginDoneNotification)]
    assert [(n.params.name, n.params.ok, n.params.error) for n in done] == [("hosted", True, None)]
    assert _state(supervisor).tools == ["mcp__hosted__search"]
    assert "Bearer access-1" in fake.bearers
    assert await _call(supervisor) == "found x"
    assert "access-1" not in repr(sent)


async def test_a_token_that_ran_out_is_renewed_before_and_after_a_server_drops_it(
    made: list[McpSupervisor],
) -> None:
    fake, store, sent = _Hosted(), _Store(), list[BaseModel]()
    _saved(store)
    supervisor = _supervisor(made, fake, store, sent)
    supervisor.start()
    await _until(lambda: _state(supervisor).state == "running")
    assert fake.refreshes == 1  # renewed at start, because it was past its expiry

    # The server stops accepting the token early: a 401 renews once and the call goes through.
    fake.valid = "dropped"
    stored = oauth.load(store, "hosted")
    assert stored is not None and stored.access_token == "access-r1"
    fake.reject_refresh = False
    assert await _call(supervisor) == "found x"
    assert fake.refreshes == 2


async def test_a_renewal_that_fails_puts_the_server_back_to_needs_auth(
    made: list[McpSupervisor],
) -> None:
    fake, store, sent = _Hosted(), _Store(), list[BaseModel]()
    _saved(store, expires_at=time.time() + 3600, access_token="good")
    fake.valid = "good"
    supervisor = _supervisor(made, fake, store, sent)
    supervisor.start()
    await _until(lambda: _state(supervisor).state == "running")

    fake.valid, fake.reject_refresh = "changed", True
    with pytest.raises(Exception, match="sign-in needed"):
        await _call(supervisor)
    await _until(lambda: _state(supervisor).state == "needs_auth")
    assert supervisor.tools(EVERYONE) == []
    assert "renewed" in (_state(supervisor).error or "")
    await asyncio.sleep(0.3)  # nothing retries by itself
    assert _state(supervisor).state == "needs_auth"


async def test_signing_out_deletes_the_item_and_needs_auth_follows(
    made: list[McpSupervisor],
) -> None:
    fake, store, sent = _Hosted(), _Store(), list[BaseModel]()
    _saved(store, expires_at=time.time() + 3600, access_token="good")
    fake.valid = "good"
    supervisor = _supervisor(made, fake, store, sent)
    supervisor.start()
    await _until(lambda: _state(supervisor).state == "running")

    status = await supervisor.logout(EVERYONE, "hosted")
    assert status.state == "needs_auth" and status.tools == []
    assert "mcp/hosted-oauth" not in store.items
    assert supervisor.tools(EVERYONE) == []
    assert any(
        isinstance(n, McpServerStatusNotification) and n.params.state == "needs_auth" for n in sent
    )


async def test_a_sign_in_the_server_refuses_ends_with_the_reason(
    made: list[McpSupervisor],
) -> None:
    fake, store, sent = _Hosted(), _Store(), list[BaseModel]()
    supervisor = _supervisor(made, fake, store, sent)
    supervisor.start()
    await _until(lambda: _state(supervisor).state == "needs_auth")
    await _browser(await supervisor.login(EVERYONE, "hosted"), error="access_denied")
    await _until(lambda: any(isinstance(n, McpLoginDoneNotification) for n in sent))
    done = next(n for n in sent if isinstance(n, McpLoginDoneNotification))
    assert not done.params.ok and "access_denied" in (done.params.error or "")
    assert _state(supervisor).state == "needs_auth"


async def test_only_a_hosted_server_signs_in(made: list[McpSupervisor]) -> None:
    supervisor = McpSupervisor(
        {"local": McpServerSettings(command="x", enabled=False)}, store=_Store()
    )
    made.append(supervisor)
    with pytest.raises(McpServerError, match="not a hosted server"):
        await supervisor.login(EVERYONE, "local")
    with pytest.raises(McpServerError, match="not a hosted server"):
        await supervisor.logout(EVERYONE, "local")
