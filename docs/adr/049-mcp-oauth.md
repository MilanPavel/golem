# ADR-049: A hosted MCP server signs in with OAuth, through a loopback listener in the daemon

**Date**: 2026-11-08
**Status**: accepted

## Context

Hosted MCP servers such as Sentry, Linear, Notion, and Atlassian do not take a pasted token. They sign in with OAuth: the user approves golem in the browser, and the server hands out a token that runs out and can be renewed. golem has only a fixed `Authorization` header today, so these servers answer 401 and stop at `mcp.test`'s hint.

The MCP authorization spec for protocol `2025-06-18` says how a client does it:

- The server's 401 names its metadata, which names an authorization server (RFC 9728).
- The authorization server's metadata says where to sign in and where to get a token (RFC 8414, or OpenID Connect).
- A client registers itself (RFC 7591), uses PKCE and `state`, and sends the server's URL as `resource` (RFC 8707).

The daemon is a background process with no window, and many clients (the TUI, the CLI, the browser) can ask it to sign in.

## Decision

- **The daemon does the whole flow,** in `golem/mcp/oauth.py`. A client only asks for `mcp.login`, gets an address, and opens it. No code or token passes through a client or the wire.
- **One loopback listener per sign-in.** `asyncio.start_server` on `127.0.0.1`, an OS-chosen port, one path (`/callback`), and a five-minute life. It answers a small "You can close this tab" page. A request with a wrong `state` is answered 400 and does not end the wait, so a stray request cannot cancel a sign-in or inject a code.
- **golem is a public client.** It registers with `token_endpoint_auth_method: none`, PKCE `S256`, and a fresh registration for each sign-in, because the redirect's port is new every time. golem never ships or stores a client secret of its own. A server that does not register clients takes `oauth = { client_id = "..." }` in `[mcp.<name>]`, which must allow a loopback redirect on any port (RFC 8252).
- **Tokens live in the Keychain** as `mcp/<name>-oauth`, one JSON item: access token, refresh token, expiry, client id, token endpoint, scopes, resource. It follows [ADR-023](023-mcp-client.md): the config file never holds a token, and the daemon never returns one.
- **Refresh.** The access token is renewed 60 s before it expires, and once when the server answers 401. A refresh answer that leaves out a refresh token keeps the old one. When the renewal fails, the server is `needs_auth` and nothing retries until the user signs in again. One lock per server stops two calls from renewing together.
- **Sign out deletes the item.** The server stops, and `needs_auth` follows.

## Alternatives Considered

### Alternative 1: A fixed port for the callback

- **Pros**: One registration could be kept and reused.
- **Cons**: A busy port breaks the sign-in. Two daemons, or two sign-ins at once, collide.
- **Why not**: An OS-chosen port always works, and registration costs one request.

### Alternative 2: A custom URL scheme, such as `golem://callback`

- **Pros**: No listener.
- **Cons**: The daemon is not an app bundle, so macOS has no handler to route it to. Linux has none either.
- **Why not**: It needs an installed app that the daemon is not.

### Alternative 3: The client opens the redirect and passes the code back

- **Pros**: The daemon opens no port.
- **Cons**: A code and a verifier would travel over the wire, and the browser could read them.
- **Why not**: It breaks the rule that a secret does not pass through a page.

## Consequences

### Positive

- One sign-in works the same in the TUI, the CLI, and the browser.
- A token is never in a log, a config file, or a message.

### Negative

- A server that checks the redirect address exactly, and has no registration, cannot be used.
- A sign-in needs a browser on the same Mac as the daemon.

### Risks

- Another program on the Mac could connect to the listener. It would need the `state`, which only the browser has seen, so its request is refused and the sign-in goes on.
- The spec has newer revisions. The client pins `2025-06-18`, and a rule that a newer revision changes belongs in this record.
