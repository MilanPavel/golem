"""OAuth for a hosted MCP server: find where to sign in, sign in, keep and refresh the token.

Follows the MCP authorization spec for protocol ``2025-06-18``:

1. A request to the server answers 401. Its ``WWW-Authenticate`` header names
   ``resource_metadata``, or the server's ``/.well-known/oauth-protected-resource``
   says (RFC 9728) which authorization server to use.
2. The authorization server's metadata is read from RFC 8414
   (``/.well-known/oauth-authorization-server``), then from OpenID Connect
   (``/.well-known/openid-configuration``).
3. golem registers itself (RFC 7591) as a public client, ``client_name: golem``
   with ``token_endpoint_auth_method: none``. A server with no registration
   endpoint needs ``oauth.client_id`` in ``[mcp.<name>]``.
4. The sign-in is the authorization code flow with PKCE ``S256``, ``state``, and
   the server's URL as the ``resource`` (RFC 8707). The redirect goes to a
   one-shot listener on ``127.0.0.1`` that lives for five minutes.
5. The tokens are kept in the Keychain as ``mcp/<name>-oauth`` (ADR-049). The
   access token is renewed with the refresh token a minute before it expires,
   and again when the server answers 401. When the renewal fails the server
   needs a new sign-in.

Nothing here reads or writes a secret except through a :class:`~golem.secrets.SecretStore`,
and no function returns a token to a caller outside the daemon.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import hmac
import html
import json
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, cast
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from golem.secrets import SecretStore

CLIENT_NAME = "golem"
LOGIN_SECONDS = 300.0
"""How long the browser has to come back."""
REFRESH_MARGIN_SECONDS = 60.0
HTTP_SECONDS = 15.0
CALLBACK_PATH = "/callback"
MAX_REQUEST_BYTES = 16 * 1024

Clock = Callable[[], float]


class OAuthError(Exception):
    """A step of the sign-in failed. The message says which, and is safe to show."""


class NeedsAuth(OAuthError):
    """There is no token, or it cannot be renewed: the user must sign in again."""


@dataclass(frozen=True, slots=True)
class AuthServer:
    """What the authorization server's metadata says that golem uses."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: str | None = None
    scopes: list[str] = field(default_factory=list[str])


@dataclass(frozen=True, slots=True)
class Tokens:
    """What ``mcp/<name>-oauth`` holds, as JSON."""

    access_token: str
    client_id: str
    token_endpoint: str
    refresh_token: str | None = None
    expires_at: float | None = None
    client_secret: str | None = None
    scopes: list[str] = field(default_factory=list[str])
    resource: str | None = None

    def expired(self, now: float, margin: float = REFRESH_MARGIN_SECONDS) -> bool:
        return self.expires_at is not None and now >= self.expires_at - margin

    def dump(self) -> str:
        return json.dumps({k: v for k, v in asdict(self).items() if v is not None})

    @staticmethod
    def parse(text: str) -> Tokens | None:
        """The tokens ``text`` holds, or None when it is not a valid item."""
        try:
            data: object = json.loads(text)
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        raw = cast(dict[str, Any], data)
        access, client, endpoint = (
            raw.get("access_token"),
            raw.get("client_id"),
            raw.get("token_endpoint"),
        )
        if not all(isinstance(v, str) and v for v in (access, client, endpoint)):
            return None
        scopes = raw.get("scopes")
        expires = raw.get("expires_at")
        return Tokens(
            access_token=cast(str, access),
            client_id=cast(str, client),
            token_endpoint=cast(str, endpoint),
            refresh_token=_text(raw.get("refresh_token")),
            expires_at=float(expires) if isinstance(expires, int | float) else None,
            client_secret=_text(raw.get("client_secret")),
            scopes=[s for s in cast(list[Any], scopes) if isinstance(s, str)]
            if isinstance(scopes, list)
            else [],
            resource=_text(raw.get("resource")),
        )


def secret_name(server: str) -> str:
    """The Keychain item that holds a server's tokens."""
    return f"mcp/{server}-oauth"


def load(store: SecretStore, server: str) -> Tokens | None:
    text = store.get(secret_name(server))
    return Tokens.parse(text) if text else None


def save(store: SecretStore, server: str, tokens: Tokens) -> None:
    store.set(secret_name(server), tokens.dump())


def forget(store: SecretStore, server: str) -> bool:
    """Delete the tokens. False when there were none."""
    return store.delete(secret_name(server))


def new_client(
    transport: httpx.AsyncBaseTransport | None = None, timeout: float = HTTP_SECONDS
) -> httpx.AsyncClient:
    """The HTTP client for discovery, registration, and tokens. It never follows a redirect."""
    return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)


# --- discovery -------------------------------------------------------------------------------


def resource_metadata_url(authenticate: str | None) -> str | None:
    """The ``resource_metadata`` address of a ``WWW-Authenticate: Bearer`` header, if it has one."""
    if not authenticate:
        return None
    found = re.search(r'resource_metadata\s*=\s*(?:"([^"]+)"|([^\s,]+))', authenticate)
    return (found.group(1) or found.group(2)) if found else None


async def discover(
    url: str, authenticate: str | None, http: httpx.AsyncClient, *, scopes: list[str] | None = None
) -> AuthServer:
    """Find the authorization server of the MCP server at ``url``.

    ``authenticate`` is the ``WWW-Authenticate`` header of its 401, when it sent one.
    """
    issuer = await _authorization_server(url, authenticate, http)
    meta = await _server_metadata(issuer, http)
    wanted = scopes if scopes else _strings(meta.get("scopes_supported"))
    authorize, token = _text(meta.get("authorization_endpoint")), _text(meta.get("token_endpoint"))
    if authorize is None or token is None:
        raise OAuthError(f"{issuer} does not say where to sign in or get a token")
    methods = _strings(meta.get("code_challenge_methods_supported"))
    if methods and "S256" not in methods:
        raise OAuthError(f"{issuer} does not support PKCE S256")
    return AuthServer(
        issuer=_text(meta.get("issuer")) or issuer,
        authorization_endpoint=_absolute(authorize, issuer),
        token_endpoint=_absolute(token, issuer),
        registration_endpoint=_optional_absolute(meta.get("registration_endpoint"), issuer),
        scopes=wanted,
    )


async def _authorization_server(url: str, authenticate: str | None, http: httpx.AsyncClient) -> str:
    candidates: list[str] = []
    if named := resource_metadata_url(authenticate):
        candidates.append(urljoin(url, named))
    parts = urlsplit(url)
    origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    path = parts.path.rstrip("/")
    well_known = "/.well-known/oauth-protected-resource"
    if path:
        candidates.append(f"{origin}{well_known}{path}")
    candidates.append(f"{origin}{well_known}")
    for candidate in dict.fromkeys(candidates):
        meta = await _get_json(http, candidate)
        servers = _strings(meta.get("authorization_servers")) if meta else []
        if servers:
            return servers[0]
    # A server from before the protected-resource document is its own authorization server.
    return origin


async def _server_metadata(issuer: str, http: httpx.AsyncClient) -> dict[str, Any]:
    parts = urlsplit(issuer)
    origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
    path = parts.path.rstrip("/")
    candidates = [
        f"{origin}/.well-known/oauth-authorization-server{path}",
        f"{origin}/.well-known/openid-configuration{path}",
        f"{issuer.rstrip('/')}/.well-known/openid-configuration",
    ]
    for candidate in dict.fromkeys(candidates):
        if meta := await _get_json(http, candidate):
            return meta
    raise OAuthError(f"cannot find how to sign in at {issuer}: it has no authorization metadata")


async def _get_json(http: httpx.AsyncClient, url: str) -> dict[str, Any] | None:
    try:
        response = await http.get(url, headers={"Accept": "application/json"})
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        data: object = response.json()
    except ValueError:
        return None
    return cast(dict[str, Any], data) if isinstance(data, dict) else None


# --- registration ----------------------------------------------------------------------------


async def register(
    server: AuthServer, redirect_uri: str, http: httpx.AsyncClient
) -> tuple[str, str | None]:
    """Register golem as a client (RFC 7591). Returns ``(client_id, client_secret)``."""
    if server.registration_endpoint is None:
        raise OAuthError(
            f"{server.issuer} does not register clients by itself: "
            'add oauth = { client_id = "..." } to the server in config.toml'
        )
    body: dict[str, Any] = {
        "client_name": CLIENT_NAME,
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    try:
        response = await http.post(server.registration_endpoint, json=body)
    except httpx.HTTPError as exc:
        raise OAuthError(f"cannot register golem at {server.issuer}: {_why(exc)}") from exc
    if response.status_code not in (200, 201):
        raise OAuthError(
            f"{server.issuer} refused to register golem (HTTP {response.status_code}"
            f'{_detail(response)}): add oauth = {{ client_id = "..." }} to the server'
        )
    data = _object(response)
    client_id = _text(data.get("client_id"))
    if client_id is None:
        raise OAuthError(f"{server.issuer} registered golem but sent no client_id")
    return client_id, _text(data.get("client_secret"))


# --- the sign-in -----------------------------------------------------------------------------


def pkce_pair() -> tuple[str, str]:
    """``(verifier, challenge)`` for PKCE ``S256``."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_url(
    server: AuthServer,
    *,
    client_id: str,
    redirect_uri: str,
    challenge: str,
    state: str,
    resource: str,
) -> str:
    query = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "resource": resource,
    }
    if server.scopes:
        query["scope"] = " ".join(server.scopes)
    base = server.authorization_endpoint
    joiner = "&" if urlsplit(base).query else "?"
    return f"{base}{joiner}{urlencode(query)}"


class Callback:
    """A one-shot listener on ``127.0.0.1`` for the browser's redirect.

    It answers ``GET /callback`` with a page that says the tab can be closed. A
    request whose ``state`` is wrong is refused with 400 and does not end the
    wait, so a stray request cannot cancel a sign-in. :meth:`code` returns the
    code of the first good one.
    """

    def __init__(self, state: str) -> None:
        self._state = state
        self._server: asyncio.Server | None = None
        self._result: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self.port = 0

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]

    @property
    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.port}{CALLBACK_PATH}"

    async def code(self, timeout: float = LOGIN_SECONDS) -> str:
        """The authorization code. Raises :class:`OAuthError` on a refusal or a timeout."""
        try:
            return await asyncio.wait_for(asyncio.shield(self._result), timeout)
        except TimeoutError:
            raise OAuthError("the sign-in was not finished in 5 minutes") from None

    async def close(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
            with contextlib.suppress(Exception):
                await server.wait_closed()
        if not self._result.done():
            self._result.cancel()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10.0)
            status, page = self._answer(head[:MAX_REQUEST_BYTES])
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError):
            status, page = 400, _page("That request could not be read.")
        body = page.encode()
        reason = {200: "OK", 400: "Bad Request", 404: "Not Found"}.get(status, "Error")
        writer.write(
            f"HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\n"
            f"Content-Length: {len(body)}\r\nConnection: close\r\n"
            "Cache-Control: no-store\r\n\r\n".encode()
            + body
        )
        with contextlib.suppress(ConnectionError, OSError):
            await writer.drain()
        writer.close()

    def _answer(self, head: bytes) -> tuple[int, str]:
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        parts = line.split(" ")
        if len(parts) < 2 or parts[0] != "GET":
            return 404, _page("Not found.")
        target = urlsplit(parts[1])
        if target.path != CALLBACK_PATH:
            return 404, _page("Not found.")
        query = dict(parse_qsl(target.query))
        if not hmac.compare_digest(query.get("state", ""), self._state):
            return 400, _page("This sign-in does not belong to golem. Nothing was changed.")
        if self._result.done():
            return 400, _page("This sign-in was already used.")
        if "error" in query:
            said = query.get("error_description") or query["error"]
            self._result.set_exception(OAuthError(f"the server refused the sign-in: {said}"))
            return 400, _page("The sign-in was refused. You can close this tab.")
        code = query.get("code")
        if not code:
            return 400, _page("The sign-in sent no code.")
        self._result.set_result(code)
        return 200, _page("You are signed in to golem. You can close this tab.")


def _page(message: str) -> str:
    return (
        "<!doctype html><meta charset=utf-8><title>golem</title>"
        '<body style="font:16px system-ui;margin:3rem auto;max-width:28rem">'
        f"<p>{html.escape(message)}</p>"
    )


@dataclass(slots=True)
class Login:
    """A sign-in in progress: send the user to :attr:`url`, then :meth:`finish`."""

    url: str
    _callback: Callback
    _exchange: Callable[[str], Any]
    _timeout: float

    async def finish(self) -> Tokens:
        """Wait for the browser, trade the code for tokens, and stop the listener."""
        try:
            code = await self._callback.code(self._timeout)
            return cast(Tokens, await self._exchange(code))
        finally:
            await self._callback.close()

    async def cancel(self) -> None:
        await self._callback.close()


async def begin(
    url: str,
    authenticate: str | None,
    http: httpx.AsyncClient,
    *,
    client_id: str | None = None,
    scopes: list[str] | None = None,
    timeout: float = LOGIN_SECONDS,
    clock: Clock = time.time,
) -> Login:
    """Start signing in to the MCP server at ``url``.

    ``client_id`` and ``scopes`` come from ``oauth`` in ``[mcp.<name>]``. Without
    a ``client_id`` golem registers one. Raises :class:`OAuthError` before it opens
    anything when discovery or registration fails.
    """
    state = secrets.token_urlsafe(24)
    verifier, challenge = pkce_pair()
    callback = Callback(state)
    await callback.start()
    try:
        server = await discover(url, authenticate, http, scopes=scopes)
        client_secret: str | None = None
        if client_id is None:
            client_id, client_secret = await register(server, callback.redirect_uri, http)
        granted_to = client_id
        link = authorize_url(
            server,
            client_id=client_id,
            redirect_uri=callback.redirect_uri,
            challenge=challenge,
            state=state,
            resource=url,
        )
    except BaseException:
        await callback.close()
        raise

    async def exchange(code: str) -> Tokens:
        return await _token_request(
            http,
            server.token_endpoint,
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": callback.redirect_uri,
                "code_verifier": verifier,
                "resource": url,
            },
            client_id=granted_to,
            client_secret=client_secret,
            scopes=server.scopes,
            resource=url,
            previous=None,
            clock=clock,
        )

    return Login(link, callback, exchange, timeout)


# --- tokens ----------------------------------------------------------------------------------


async def refresh(tokens: Tokens, http: httpx.AsyncClient, *, clock: Clock = time.time) -> Tokens:
    """Renew ``tokens`` with their refresh token. Raises :class:`NeedsAuth` when that fails."""
    if tokens.refresh_token is None:
        raise NeedsAuth("the sign-in ended and the server gave no way to renew it")
    form = {"grant_type": "refresh_token", "refresh_token": tokens.refresh_token}
    if tokens.resource:
        form["resource"] = tokens.resource
    try:
        return await _token_request(
            http,
            tokens.token_endpoint,
            form,
            client_id=tokens.client_id,
            client_secret=tokens.client_secret,
            scopes=tokens.scopes,
            resource=tokens.resource,
            previous=tokens,
            clock=clock,
        )
    except OAuthError as exc:
        raise NeedsAuth(f"the sign-in could not be renewed: {exc}") from exc


async def _token_request(
    http: httpx.AsyncClient,
    endpoint: str,
    form: dict[str, str],
    *,
    client_id: str,
    client_secret: str | None,
    scopes: list[str],
    resource: str | None,
    previous: Tokens | None,
    clock: Clock,
) -> Tokens:
    body = {**form, "client_id": client_id}
    if client_secret:
        body["client_secret"] = client_secret
    try:
        response = await http.post(endpoint, data=body, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise OAuthError(f"cannot reach the token endpoint: {_why(exc)}") from exc
    data = _object(response)
    if response.status_code != 200:
        said = _text(data.get("error_description")) or _text(data.get("error")) or ""
        raise OAuthError(f"the token endpoint answered HTTP {response.status_code}: {said}".strip())
    access = _text(data.get("access_token"))
    if access is None:
        raise OAuthError("the token endpoint sent no access token")
    lifetime = data.get("expires_in")
    granted = _text(data.get("scope"))
    return Tokens(
        access_token=access,
        client_id=client_id,
        token_endpoint=endpoint,
        # A refresh answer may leave out the refresh token: the old one stays good.
        refresh_token=_text(data.get("refresh_token"))
        or (previous.refresh_token if previous else None),
        expires_at=clock() + float(lifetime) if isinstance(lifetime, int | float) else None,
        client_secret=client_secret,
        scopes=granted.split() if granted else scopes,
        resource=resource,
    )


class TokenSource:
    """A server's access token, renewed when it is due. One per server.

    :meth:`token` returns the token to send, and renews it first when it is
    within a minute of expiring. :meth:`rejected` is called when the server
    answered 401 with a token: it renews once, and returns the new token, or
    raises :class:`NeedsAuth`.
    """

    def __init__(
        self,
        server: str,
        store: SecretStore,
        http: httpx.AsyncClient,
        *,
        clock: Clock = time.time,
    ) -> None:
        self._server = server
        self._store = store
        self._http = http
        self._clock = clock
        self._lock = asyncio.Lock()

    async def token(self) -> str:
        async with self._lock:
            tokens = await asyncio.to_thread(load, self._store, self._server)
            if tokens is None:
                raise NeedsAuth("not signed in")
            if tokens.expired(self._clock()):
                tokens = await self._renew(tokens)
            return tokens.access_token

    async def rejected(self, sent: str) -> str:
        async with self._lock:
            tokens = await asyncio.to_thread(load, self._store, self._server)
            if tokens is None:
                raise NeedsAuth("not signed in")
            if tokens.access_token != sent:
                # Another call already renewed it.
                return tokens.access_token
            return (await self._renew(tokens)).access_token

    async def _renew(self, tokens: Tokens) -> Tokens:
        renewed = await refresh(tokens, self._http, clock=self._clock)
        await asyncio.to_thread(save, self._store, self._server, renewed)
        return renewed


# --- small helpers ---------------------------------------------------------------------------


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _strings(value: object) -> list[str]:
    return (
        [v for v in cast(list[Any], value) if isinstance(v, str)] if isinstance(value, list) else []
    )


def _absolute(value: str, base: str) -> str:
    return urljoin(base if base.endswith("/") else base + "/", value)


def _optional_absolute(value: object, base: str) -> str | None:
    text = _text(value)
    return None if text is None else _absolute(text, base)


def _object(response: httpx.Response) -> dict[str, Any]:
    try:
        data: object = response.json()
    except ValueError:
        return {}
    return cast(dict[str, Any], data) if isinstance(data, dict) else {}


def _detail(response: httpx.Response) -> str:
    data = _object(response)
    said = _text(data.get("error_description")) or _text(data.get("error"))
    return f": {said}" if said else ""


def _why(exc: Exception) -> str:
    return str(exc) or type(exc).__name__


__all__ = [
    "AuthServer",
    "Callback",
    "Login",
    "NeedsAuth",
    "OAuthError",
    "TokenSource",
    "Tokens",
    "authorize_url",
    "begin",
    "discover",
    "forget",
    "load",
    "new_client",
    "pkce_pair",
    "refresh",
    "register",
    "resource_metadata_url",
    "save",
    "secret_name",
]
