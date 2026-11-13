"""OAuth for a hosted MCP server, against an authorization server faked with a mock transport.

The browser is played by a real request to the loopback listener.
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from golem.config import McpServerSettings
from golem.mcp import oauth
from golem.mcp.oauth import NeedsAuth, OAuthError, Tokens, TokenSource

MCP_URL = "https://mcp.example.com/mcp"
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


class _AuthServer:
    """Protected-resource and server metadata, registration, and the token endpoint."""

    def __init__(self) -> None:
        self.paths: list[str] = []
        self.registered: list[dict[str, Any]] = []
        self.token_forms: list[dict[str, str]] = []
        self.metadata_at = "/.well-known/oauth-authorization-server"
        self.resource_at: str | None = "/.well-known/oauth-protected-resource/mcp"
        self.register_path: str | None = "/register"
        self.reject_refresh = False
        self.refresh_count = 0
        self.lifetime = 3600

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = urlsplit(str(request.url))
        self.paths.append(url.path)
        if url.netloc == "mcp.example.com":
            if url.path == self.resource_at:
                return httpx.Response(200, json={"authorization_servers": [AUTH]})
            return httpx.Response(404)
        if url.path == self.metadata_at:
            meta: dict[str, Any] = {
                "issuer": AUTH,
                "authorization_endpoint": f"{AUTH}/authorize",
                "token_endpoint": f"{AUTH}/token",
                "code_challenge_methods_supported": ["S256"],
                "scopes_supported": ["read", "write"],
            }
            if self.register_path:
                meta["registration_endpoint"] = f"{AUTH}{self.register_path}"
            return httpx.Response(200, json=meta)
        if url.path == self.register_path:
            self.registered.append(json.loads(request.content))
            return httpx.Response(201, json={"client_id": "client-1"})
        if url.path == "/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            self.token_forms.append(form)
            if form["grant_type"] == "refresh_token":
                self.refresh_count += 1
                if self.reject_refresh:
                    return httpx.Response(400, json={"error": "invalid_grant"})
                return httpx.Response(
                    200,
                    json={"access_token": f"access-r{self.refresh_count}", "expires_in": 3600},
                )
            return httpx.Response(
                200,
                json={
                    "access_token": "access-1",
                    "refresh_token": "refresh-1",
                    "expires_in": self.lifetime,
                    "scope": "read write",
                },
            )
        return httpx.Response(404)


def _http(server: _AuthServer) -> httpx.AsyncClient:
    return oauth.new_client(httpx.MockTransport(server))


async def _browser(link: str, **extra: str) -> httpx.Response:
    """Follow what the browser would: to the redirect, with a code and the given state."""
    query = {k: v[0] for k, v in parse_qs(urlsplit(link).query).items()}
    params = {"code": "code-1", "state": query["state"], **extra}
    async with httpx.AsyncClient() as client:
        return await client.get(query["redirect_uri"], params=params)


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def test_the_resource_metadata_address_is_read_from_the_header() -> None:
    header = 'Bearer realm="mcp", resource_metadata="https://mcp.example.com/.well-known/x"'
    assert oauth.resource_metadata_url(header) == "https://mcp.example.com/.well-known/x"
    assert oauth.resource_metadata_url("Bearer realm=mcp") is None
    assert oauth.resource_metadata_url(None) is None


async def test_discovery_follows_the_header_to_the_authorization_server() -> None:
    server = _AuthServer()
    named = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
    header = f'Bearer resource_metadata="{named}"'
    async with _http(server) as http:
        found = await oauth.discover(MCP_URL, header, http)
    assert found.authorization_endpoint == f"{AUTH}/authorize"
    assert found.token_endpoint == f"{AUTH}/token"
    assert found.registration_endpoint == f"{AUTH}/register"
    assert found.scopes == ["read", "write"]


async def test_discovery_tries_the_well_known_address_without_a_header() -> None:
    server = _AuthServer()
    async with _http(server) as http:
        found = await oauth.discover(MCP_URL, None, http, scopes=["read"])
    assert found.issuer == AUTH
    assert found.scopes == ["read"]
    assert "/.well-known/oauth-protected-resource/mcp" in server.paths


async def test_discovery_falls_back_to_openid_configuration() -> None:
    server = _AuthServer()
    server.metadata_at = "/.well-known/openid-configuration"
    async with _http(server) as http:
        found = await oauth.discover(MCP_URL, None, http)
    assert found.token_endpoint == f"{AUTH}/token"


async def test_a_server_with_no_metadata_says_so() -> None:
    server = _AuthServer()
    server.metadata_at = "/nowhere"
    async with _http(server) as http:
        with pytest.raises(OAuthError, match="no authorization metadata"):
            await oauth.discover(MCP_URL, None, http)


async def test_a_server_without_registration_needs_a_client_id() -> None:
    server = _AuthServer()
    server.register_path = None
    async with _http(server) as http:
        with pytest.raises(OAuthError, match="client_id"):
            await oauth.begin(MCP_URL, None, http)
        login = await oauth.begin(MCP_URL, None, http, client_id="mine")
        await login.cancel()
    assert server.registered == []


async def test_signing_in_registers_golem_and_trades_the_code_for_tokens() -> None:
    server = _AuthServer()
    async with _http(server) as http:
        login = await oauth.begin(MCP_URL, None, http, clock=lambda: 1000.0)
        query = {k: v[0] for k, v in parse_qs(urlsplit(login.url).query).items()}
        assert query["client_id"] == "client-1"
        assert query["code_challenge_method"] == "S256"
        assert query["resource"] == MCP_URL
        assert query["scope"] == "read write"
        assert query["redirect_uri"].startswith("http://127.0.0.1:")
        reply = await _browser(login.url)
        assert reply.status_code == 200
        assert "close this tab" in reply.text
        tokens = await login.finish()
    registered = server.registered[0]
    assert registered["client_name"] == "golem"
    assert registered["token_endpoint_auth_method"] == "none"
    assert registered["redirect_uris"] == [query["redirect_uri"]]
    form = server.token_forms[0]
    assert form["code"] == "code-1"
    assert form["resource"] == MCP_URL
    assert _challenge(form["code_verifier"]) == query["code_challenge"]
    assert tokens.access_token == "access-1"
    assert tokens.refresh_token == "refresh-1"
    assert tokens.expires_at == 1000.0 + 3600
    assert tokens.scopes == ["read", "write"]


async def test_a_wrong_state_is_refused_and_the_sign_in_goes_on() -> None:
    server = _AuthServer()
    async with _http(server) as http:
        login = await oauth.begin(MCP_URL, None, http)
        query = {k: v[0] for k, v in parse_qs(urlsplit(login.url).query).items()}
        async with httpx.AsyncClient() as browser:
            bad = await browser.get(
                query["redirect_uri"], params={"code": "stolen", "state": "not-it"}
            )
            elsewhere = await browser.get(query["redirect_uri"].replace("/callback", "/other"))
        assert bad.status_code == 400
        assert elsewhere.status_code == 404
        await _browser(login.url)
        tokens = await login.finish()
    assert tokens.access_token == "access-1"
    assert [form["code"] for form in server.token_forms] == ["code-1"]


async def test_a_refused_sign_in_reports_what_the_server_said() -> None:
    server = _AuthServer()
    async with _http(server) as http:
        login = await oauth.begin(MCP_URL, None, http)
        query = {k: v[0] for k, v in parse_qs(urlsplit(login.url).query).items()}
        async with httpx.AsyncClient() as browser:
            await browser.get(
                query["redirect_uri"],
                params={
                    "error": "access_denied",
                    "error_description": "no",
                    "state": query["state"],
                },
            )
        with pytest.raises(OAuthError, match="refused the sign-in: no"):
            await login.finish()


async def test_a_sign_in_nobody_finishes_times_out_and_stops_listening() -> None:
    server = _AuthServer()
    async with _http(server) as http:
        login = await oauth.begin(MCP_URL, None, http, timeout=0.05)
        redirect = {k: v[0] for k, v in parse_qs(urlsplit(login.url).query).items()}["redirect_uri"]
        with pytest.raises(OAuthError, match="5 minutes"):
            await login.finish()
    async with httpx.AsyncClient() as browser:
        with pytest.raises(httpx.ConnectError):
            await browser.get(redirect)


def _tokens(**over: Any) -> Tokens:
    base: dict[str, Any] = {
        "access_token": "access-1",
        "client_id": "client-1",
        "token_endpoint": f"{AUTH}/token",
        "refresh_token": "refresh-1",
        "expires_at": 5000.0,
    }
    return Tokens(**{**base, **over})


def test_tokens_round_trip_and_a_bad_item_is_not_tokens() -> None:
    tokens = _tokens(scopes=["read"], resource=MCP_URL)
    assert Tokens.parse(tokens.dump()) == tokens
    assert Tokens.parse("not json") is None
    assert Tokens.parse('{"access_token": "x"}') is None
    assert oauth.secret_name("linear") == "mcp/linear-oauth"


async def test_a_token_near_its_expiry_is_renewed_and_kept() -> None:
    server = _AuthServer()
    store = _Store()
    oauth.save(store, "linear", _tokens(expires_at=1030.0))
    async with _http(server) as http:
        source = TokenSource("linear", store, http, clock=lambda: 1000.0)
        assert await source.token() == "access-r1"
        assert await source.token() == "access-r1"
    assert server.refresh_count == 1
    kept = oauth.load(store, "linear")
    assert kept is not None
    assert kept.access_token == "access-r1"
    assert kept.refresh_token == "refresh-1"


async def test_a_token_far_from_its_expiry_is_used_as_it_is() -> None:
    server = _AuthServer()
    store = _Store()
    oauth.save(store, "linear", _tokens())
    async with _http(server) as http:
        source = TokenSource("linear", store, http, clock=lambda: 1000.0)
        assert await source.token() == "access-1"
    assert server.refresh_count == 0


async def test_a_rejected_token_is_renewed_once() -> None:
    server = _AuthServer()
    store = _Store()
    oauth.save(store, "linear", _tokens())
    async with _http(server) as http:
        source = TokenSource("linear", store, http, clock=lambda: 1000.0)
        assert await source.rejected("access-1") == "access-r1"
        # A second call that sent the old token finds the new one already there.
        assert await source.rejected("access-1") == "access-r1"
    assert server.refresh_count == 1


async def test_a_failed_renewal_needs_a_new_sign_in() -> None:
    server = _AuthServer()
    server.reject_refresh = True
    store = _Store()
    oauth.save(store, "linear", _tokens())
    async with _http(server) as http:
        source = TokenSource("linear", store, http, clock=lambda: 1000.0)
        with pytest.raises(NeedsAuth, match="could not be renewed"):
            await source.rejected("access-1")
        with pytest.raises(NeedsAuth, match="not signed in"):
            await TokenSource("nobody", store, http).token()
    oauth.save(store, "linear", _tokens(refresh_token=None))
    async with _http(server) as http:
        with pytest.raises(NeedsAuth, match="no way to renew"):
            await TokenSource("linear", store, http, clock=lambda: 9999.0).token()


def test_forgetting_removes_the_item() -> None:
    store = _Store()
    oauth.save(store, "linear", _tokens())
    assert oauth.forget(store, "linear") is True
    assert oauth.forget(store, "linear") is False
    assert oauth.load(store, "linear") is None


def test_the_oauth_table_belongs_to_an_http_server() -> None:
    ok = McpServerSettings.model_validate(
        {"url": MCP_URL, "oauth": {"client_id": "mine", "scopes": ["read"]}}
    )
    assert ok.oauth is not None
    assert ok.oauth.client_id == "mine"
    with pytest.raises(ValueError, match="oauth is for an HTTP server"):
        McpServerSettings.model_validate({"command": "x", "oauth": {}})
    with pytest.raises(ValueError):
        McpServerSettings.model_validate({"url": MCP_URL, "oauth": {"token": "x"}})
