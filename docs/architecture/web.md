---
title: The web UI
description: How a browser page can drive an agent on your own machine without letting every other site in, the usual bridges, and how golem's gateway checks the login, filters each message, and passes lines to the daemon for a page built on the terminal app's client.
order: 13
adrs: [7, 19, 28, 29]
---

# {{ $frontmatter.title }}

A browser draws better than a terminal: real type, images, a diff you can scroll, a palette under ⌘K. But an agent on your machine listens on a private socket, and a browser can't open one. And the browser that would run your agent's page also runs every other site you have open. So how does a page reach an agent on your Mac, while the other tabs can't?

## The idea

::: concept In agents generally

A browser can open only a few kinds of connection: HTTP requests, WebSockets, and server-sent events, all to an address and a port. It can't open a Unix socket, a pipe, or a file. So a local agent that wants a browser screen needs a **bridge**: a small server on the loopback address, `127.0.0.1`, that speaks HTTP on one side and the agent's own protocol on the other.

That bridge is easy to build and easy to get wrong, because **loopback is not private.** Any page in your browser can send a request to `127.0.0.1`. A site you visit can try to open a WebSocket to the bridge's port. A site can also point its own name at `127.0.0.1` after the page has loaded (DNS rebinding), so the browser treats its requests as same-origin. If the bridge answers them, a web page can type commands into your agent, and the agent can run code.

So a local bridge checks three things on every request:

1. **Who.** A secret that only your page holds. The command that opens the page hands it over, and other sites can't read it.
2. **From where.** The `Origin` header says which page sent a request, and browsers don't let a page forge it. The `Host` header says which name the browser thought it was talking to, which stops rebinding.
3. **What.** Even your own page should not be able to send every command. A page shows text from models, tools, and files, and some of that text may try to run as script. So the bridge allows only the commands a page needs.

![A browser reaching a local agent. The agent listens on a Unix socket or a pipe, which a browser can't open: it speaks only HTTP and WebSocket. So a local server on 127.0.0.1 bridges the two. But every page in the browser can send a request to 127.0.0.1: your agent's page, any site you have open, and a site whose name is rebound to 127.0.0.1. So the server checks three things on every request: who, with a secret only your page holds; from where, with the Origin and Host headers; and what, with the list of commands a page may send](../images/web-reach.svg)

Past the bridge, the page is a window like any other (see [The terminal app](./tui.md)): it folds the agent's numbered events into a small state and paints it.

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| The agent serves the page | The agent process opens a port and serves HTTP, often with server-sent events for the stream | One process, one hop | A web server, a port, and login code in the process that holds the chats. A second API beside the agent's own protocol |
| A separate local gateway | A small server on loopback passes the agent's protocol through a WebSocket | The agent stays private. All web security sits in one small program | One more process, and one more hop |
| A hosted relay | The agent dials out to a server on the internet, and the page talks to that server | Reach the agent from a phone or another computer | Your chats pass through someone else's machine. Accounts, and a service to run |
| A tunnel | ngrok, Tailscale, or an SSH forward puts the local port somewhere else | Quick remote access | Whatever guards the port now guards it on the internet too |
| A desktop shell | Electron or a native webview loads the page and talks to the agent itself | No browser tabs, so no foreign origins | An app to build, sign, and update for every platform |

Several open problems are the same for every local web screen:

- **Login without a password.** The page has to prove it was opened by you, with no account and no prompt.
- **Cookies on `127.0.0.1` are shared by every port.** A cookie set by one local server is sent to every other local server you run.
- **The page shows untrusted text.** Model output, a tool's output, or a file's content can hold HTML. If it runs as script in the page, it can send commands.
- **Hidden tabs sleep.** Browsers slow a hidden tab's timers to about once a minute and stop its animation frames, so a heartbeat and a batched paint both stall.
- **An old page after an upgrade.** A cached page may speak an older protocol than the agent it reaches.

## How golem does it

::: golem In golem

golem keeps the daemon as it is, on its Unix socket only, and puts a **gateway** in front of it ([ADR-028](../adr/028-web-gateway.md)). `golem web` starts it on `127.0.0.1:7480`, in the same `golem` binary as the TUI ([ADR-019](../adr/019-single-binary.md)). The gateway has three stages:

- **The login.** `Host` and `Origin` must be exactly `127.0.0.1:7480`, and a WebSocket must carry a cookie whose secret the gateway made. A wrong `Host` or `Origin` gets 403. A missing cookie gets a socket that opens and closes at once with code 4401, which the page shows as "Run `golem web` for a fresh link".
- **The filter.** One WebSocket message must be exactly one JSON object, with no line break, and a method a browser may call. Breaking the shape closes the link with 1008. A method a browser may not call, such as `auth.set`, gets the error `-32020 not allowed from the browser`, and the link stays open.
- **The bridge.** Each WebSocket gets its own connection to `golem.sock`. Lines pass through unchanged in both directions. The gateway never speaks the protocol itself.

![golem's gateway, started by golem web on 127.0.0.1 port 7480, in three stages from the page down. The login checks that Host and Origin are exactly 127.0.0.1 and the port, and that the cookie names a live secret. The filter lets through one JSON object per message, with no line break, and only a method a browser may call. The bridge opens one daemon connection per WebSocket and passes lines on unchanged to golem.sock. The daemon is unchanged, with no port and no cookie. Real refusals: Origin evil.example got 403, an upgrade with no cookie was opened and closed with 4401, two objects joined by a newline closed the link with 1008, and auth.set got error -32020. A tab that can't keep up pauses the daemon socket at 4 MiB. hello, session.create, session.attach, and message.send passed through unchanged, and 67 deltas reached the page and a terminal client on the socket alike](../images/web-gateway.svg)

The login trades a token for a cookie. `golem web` writes a random token to `~/.golem/run/web.token`, readable only by you, and opens `http://127.0.0.1:7480/#t=TOKEN`. A browser never sends the part after `#` to a server. The page posts the token to `/auth/exchange` and gets a cookie with a fresh secret, not the token, because every local server would receive a cookie on `127.0.0.1`. Then the page removes `#t=` from the address and opens `/ws`.

![The login, over time, across four lanes: golem web, the page, the gateway, and the daemon. golem web starts the gateway, or reuses the one in run/web.json, and the gateway writes run/web.token with mode 0600 and O_EXCL. golem web opens 127.0.0.1 port 7480 with the token after the hash, which a browser never sends to a server. The page posts the token to /auth/exchange, and gets back 204 with a cookie that holds a fresh secret, not the token. The page removes the hash from the address with replaceState. Then it opens /ws with the cookie, the gateway connects to golem.sock, and the page's hello goes through the bridge to the daemon, which answers and sends the events](../images/web-login.svg)

Inside, the page is the terminal app's client in a browser ([ADR-029](../adr/029-web-stack.md)). `@golem/client` is the same code, with `wsDial` in place of the Unix socket: `hello`, the ping, the reconnect, and the attach after the last `seq`. `reduceChat` from `@golem/view` folds each session's events. What differs is where the state lives:

- **Session stores**, one per attached session, folded by `reduceChat`. Deltas wait for the next animation frame. Any other event folds them first, then applies at once, so a hidden tab still shows a waiting approval.
- **The live store:** the link, the session list, and downloads, which the daemon pushes to every connection.
- **TanStack Query:** answers to requests such as `model.list` and `skill.list`. A pushed event marks an answer stale, so nothing polls.

![Inside the page, from the gateway's /ws up. @golem/client, the same client the TUI uses, runs over wsDial: hello, the ping, the reconnect, seq order, and repeats dropped. It feeds three kinds of state. Session events go to session stores, one per attached session, folded by reduceChat from @golem/view, with deltas folded once per frame. Live facts go to the live store: the link, the session list, downloads, and server status, pushed and never stored. Replies go to TanStack Query: model.list, skill.list, and the rest, pulled with a request and marked stale when a pushed event says so. The screens in features and ui read from all three. A hidden tab runs no frames, so any other event folds the waiting deltas first. There are no optimistic updates: your line appears when message.completed comes back](../images/web-page.svg)

Here is a real run against a throwaway daemon with `qwen3.5:4b`. The gateway is golem's own `startGateway` on port 7491. A script plays every part: a foreign site, the page, and a terminal client on the Unix socket that attaches to the same session. Times are milliseconds from the start, ids are shortened, `→` is a line the page sent, and `←` a line it got:

```text
    7 GET /healthz → 200 {"golem":"web","pid":…}
    8 upgrade from Origin http://evil.example: HTTP 403 bad origin
    8 upgrade from Origin http://localhost:7491: HTTP 403 bad origin
    9 upgrade from the right Origin, no cookie: opened, then closed 4401 login required
   10 POST /auth/exchange, a wrong token → 403 bad token
   10 POST /auth/exchange, the token → 204 Set-Cookie: golem_7491=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000
   11 upgrade with the token itself as the cookie: opened, then closed 4401 login required
   13 two objects joined by \n: closed 1008 line-break
   13 page link open
   13 → {"jsonrpc":"2.0","id":1,"method":"hello","params":{"protocol_major":2,"protocol_minor":35,"client":"web"}}
   14 ← {"jsonrpc":"2.0","result":{"protocol_major":2,"protocol_minor":35,"daemon_version":"0.0.0-dev"},"id":1}
   14 → {"jsonrpc":"2.0","id":2,"method":"auth.set","params":{"provider":"anthropic","key":"x"}}
   14 ← {"jsonrpc":"2.0","id":2,"error":{"code":-32020,"message":"not allowed from the browser"}}
   14 → {"jsonrpc":"2.0","id":3,"method":"session.create","params":{"cwd":"/tmp/g10"}}
   15 ← {"jsonrpc":"2.0","result":{"session_id":"s_0040…"},"id":3}
   17 terminal client on the Unix socket attached to the same session
   17 → {"jsonrpc":"2.0","id":4,"method":"session.attach","params":{"session_id":"s_0040…","after_seq":0}}
   18 ← event seq 1 session.created
   18 ← {"jsonrpc":"2.0","result":{"session_id":"s_0040…","last_seq":1},"id":4}
   18 → {"jsonrpc":"2.0","id":5,"method":"message.send","params":{"session_id":"s_0040…","text":"In two sentences, what is a clay golem? Do not use tools."}}
   54 ← {"jsonrpc":"2.0","result":{"run_id":"r_1715…"},"id":5}
   55 ← event seq 2 message.completed
   56 ← event seq 3 run.started
   57 ← event seq 4 message.started
 1408 ← event seq 5 message.delta "A"
 1419 ← event seq 6 message.delta " clay"
 2164 ← event seq 72 message.completed  (after 67 deltas)
 2165 ← event seq 73 run.completed
 2466 page: 73 events, 67 deltas; terminal: 67 deltas; same answer: true (360 chars)
```

Every refusal came before a single protocol line reached the daemon. `localhost` is a different origin from `127.0.0.1`, so it is refused too. The token itself is worthless as a cookie, because the gateway accepts only the secrets it made. The `\n` rule is the one that matters most: without it, `ping` would pass the method check and `auth.set` would reach the daemon behind it. `auth.set` sent alone got a JSON-RPC error with its own `id`, and the link stayed up. Then the page's lines went through byte for byte, the daemon's reply came back with its own key order, and the page and the terminal client got the same 67 deltas and the same 360-character answer.

The same rules are tests. `packages/gateway/src/framing.test.ts` and `auth.test.ts` cover the cases ADR-028 lists, from `Host: 127.0.0.1.nip.io:7480` to a duplicate `method` key. `just e2e` drives Chrome against a real daemon with a fake model and the gateway, and fails on any CSP violation or console error.

**Where it lives in the code:**

- `packages/cli/src/web-command.ts`: `golem web`. It finds or starts the gateway, writes the token, and opens the link through `osascript`.
- `packages/gateway/src/bun/server.ts`: `startGateway`, the `Bun.serve` adapter: `/healthz`, `/auth/exchange`, `/ws`, and the page's files.
- `packages/gateway/src/auth.ts`: `checkRequest`, `checkUpgrade`, and `exchangeToken`.
- `packages/gateway/src/framing.ts`: `filterMessage`, which forwards, denies, or refuses one message.
- `packages/gateway/src/bridge.ts`: `createBridge`, one WebSocket to one daemon connection, with the pause at 4 MiB.
- `packages/protocol/gen/browser-methods.ts`: `BROWSER_METHODS`, written by `just gen`.
- `packages/web/src/store/boot.ts`: `bootPage`, which trades the token and makes the one client.
- `packages/web/src/store/session-store.ts`: `createSessionStore`, `reduceChat` with deltas once per frame.
- `packages/web/src/store/query.ts`: `keepQueriesHonest`, the pushed events that make answers stale.

:::

## Why this way

**A gateway, not a web server in the daemon** ([ADR-028](../adr/028-web-gateway.md)). The daemon holds every chat, and it stays a process with no port, no TLS, no cookies, and no login code. All network security lives in one small TypeScript program whose core is plain functions over `Request` and strings, tested on their own. The cost is one more process when you use the web UI, and one more hop, which costs microseconds.

**The protocol through a WebSocket, not a second HTTP API.** The page speaks the same JSON-RPC lines as the TUI, so attach, replay from `after_seq`, and fan-out come for free ([ADR-007](../adr/007-attach-and-fan-out.md)). An HTTP API with server-sent events would be a second shape to keep in step with the protocol, and replay would have to be built again.

**Forward the text, never a copy.** The gateway parses each message only to check it, then forwards the original text with one `\n`. If it re-serialized the JSON, the daemon would read something the page did not write, and an encoding difference would become a bug in the security boundary.

**An allowlist, generated from the protocol.** Each command declares whether a browser may call it, and `just gen` writes the list. A test fails when the daemon answers a method nobody declared, so a new command such as `daemon.shutdown` can't reach the browser by accident. A denylist would be shorter today, and every new privileged command would be open on the day it lands.

**A token in the fragment, then a cookie of the gateway's own.** The token travels only in the address after `#` and in one `POST` body. The cookie holds a secret that the gateway keeps only as a hash on disk, named after the port (`golem_7480`), `HttpOnly` and `SameSite=Strict`. A local dev server on another port that receives it can't use it without the right `Origin`. The cost: a file of hashes in `run/`, which gives a program running as you nothing it cannot already get.

**A 4401 close, not an HTTP 401.** A browser reports a refused upgrade only as a generic failure, the same as a network error, and the client would retry forever. A socket that opens and closes with 4401 lets the page stop and say what to run.

**The terminal app's client and reducer** ([ADR-029](../adr/029-web-stack.md)). A bug fixed in `@golem/client` or `reduceChat` is fixed in both windows, and the two can't disagree about the same chat. Only the way bytes move differs, so that part is an interface: `unixDial` for the terminal, `wsDial` for the page.

**Pushed facts and pulled answers apart.** A session is pushed, in `seq` order, up to hundreds of times a second, so it folds into a small store. An answer such as `model.list` is pulled once and cached, so it lives in TanStack Query. Writing each delta into a query cache would wake every subscriber on every delta. No command updates the screen optimistically: your line appears with `message.completed`, as in the TUI, so the page never shows what the daemon didn't store.

**Untrusted text stays data.** DOMPurify is the only way HTML enters the page, and a lint rule forbids `dangerouslySetInnerHTML` anywhere else. A strict Content Security Policy backs it up: no inline script, no script from another host, no `eval`, and no WASM.

## Try it

1. Run `golem web`. The page opens on `127.0.0.1:7480`, and the address bar no longer shows `#t=` once the page has loaded.
2. Run `golem` in a terminal in the same folder, and ask something there. The browser's sidebar shows the session working, and opening it shows the same answer streaming.
3. Open `http://localhost:7480` instead. The gateway answers `bad host`, because only `127.0.0.1` is let in.
4. Stop `golem web` with Ctrl-C and start it again, then reload the tab. It connects without a new link, because the gateway kept a hash of the cookie. Run `golem web logout` and the next request shows "This page needs a fresh link".
5. In the page's devtools, open the Network tab and the `/ws` socket. Every frame is one protocol line, the same lines `/debug wire` shows in the TUI.

## The details

For contributors: the reference for the gateway and the page. [ADR-028](../adr/028-web-gateway.md) and [ADR-029](../adr/029-web-stack.md) hold the reasons and the shapes that lost. [The design system](../design/index.md) holds the look, and [the gallery](/gallery/) shows it screen by screen.

### golem web

`golem web` is in the `golem` binary. With no daemon running, it first asks to start golem's service ([ADR-033](../adr/033-golem-offers-to-start-the-service.md)). Then it reads `~/.golem/run/web.json`, which holds `pid`, `port`, and `started_at`. If that pid is a live `golem` process and `/healthz` answers `{"golem":"web","pid":N}` with it, `golem web` reuses that gateway: it reads `web.token` and opens the same kind of link. Otherwise it removes the stale file and starts a new gateway. The gateway starts before `web.token` is written, so a port that is taken never replaces the token of the gateway that holds it.

| Option | What it does |
|---|---|
| `--port N` | Serve on another port. The default stays 7480, because a new port is a new origin, and the cookie and the remembered theme go with it. A port that is taken fails with a message that names `--port` |
| `--no-open` | Print the link, with its token, instead of opening the browser |
| `--json` | Print `{url, port, pid}` and open nothing, for scripts |

The browser is opened through `osascript` reading the link on stdin, because process arguments are visible to other users, and the link holds the token. Without `--no-open` the terminal shows the address without the token. `golem web` runs the gateway in the foreground until Ctrl-C. `golem web logout` signs every browser out. The gateway does not read `config.toml`.

### The token and the cookie

- **The token file is the root of trust.** `web.token` holds a random 32-byte value, mode `0600`, opened with `O_EXCL` so no other file can be in its place. The gateway refuses to start when `run/` can be written by anyone but you. A new token is written each time a gateway starts, and the gateway deletes it when it stops.
- **`POST /auth/exchange`** takes `{"token": "…"}` as `application/json`, at most 4096 bytes, and compares it in constant time. A good token gets 204 and a cookie with a fresh secret: `golem_<port>=<secret>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` (30 days). It has no `Secure` flag, because the page is plain `http` on `127.0.0.1`, and browsers drop a `Secure` cookie there.
- **Sign-ins survive a restart.** The gateway keeps `~/.golem/run/web-sessions`: a SHA-256 of each live secret and its expiry, mode `0600`, written to a temp file and renamed (`O_EXCL`, as `web.token` is). The secret itself is never written. The gateway reads the file on each check, so a corrupt file is replaced and everyone signs in again, and `golem web logout`, which empties it, takes effect on the next request. A cookie is compared by its hash, in constant time. The code is `sessions.ts` (the store, free of Node) and `session-file.ts` (the file).
- **The page** reads `#t=` in `takeLoginToken`, removes it with `history.replaceState` so it doesn't stay in the history, and posts it. The result of the exchange is ignored: a stale token ends in close code 4401, which shows the right screen.

### What every request is checked for

| Check | Rule | Refused with |
|---|---|---|
| `Host` | Exactly `127.0.0.1:<port>`. Stops DNS rebinding | 403 `bad host` |
| `Origin` | Exactly `http://127.0.0.1:<port>`. `localhost`, another port, upper case, or a trailing slash is refused. On an upgrade or a `POST`, a missing `Origin` is refused too, because browsers always send it there | 403 `bad origin`, `origin required` |
| `Sec-Fetch-Site` | When present, `same-origin` or `none` | 403 `bad fetch site` |
| The cookie | On `/ws` only, it must name a live secret | Opened, then closed with 4401 `login required`, before any line passes |
| How many | At most 16 WebSockets at once | 503 |

`/healthz` checks `Host` only and needs no secret. The page's files are served without a cookie, so the page can load and run the exchange. Nothing in them is private.

### One message, one line

The daemon reads JSON lines and splits on `\n` ([ADR-003](../adr/003-protocol.md)). A browser sends whole WebSocket messages. `filterMessage` joins the two without ever building a line the page didn't send.

- **Browser to daemon: one text message is exactly one JSON object.** A message is refused, and the link closed with 1008, when it is binary, larger than 1 MiB (the daemon's `MAX_LINE_BYTES`, also Bun's `maxPayloadLength`), contains `\n` or `\r`, isn't JSON, isn't a plain object, or has no string `method`. The gateway appends the one `\n` itself and forwards the original text.
- **A method a browser may not call** gets a JSON-RPC error with the request's `id`, code `-32020`, and the link stays open. A denied request whose `id` is an object or an array gets no reply, because JSON-RPC can't address it.
- **Daemon to browser: one line is one WebSocket message.** `createLineSplitter` decodes the socket's bytes with a streaming UTF-8 decoder, so a character split across two reads stays whole, splits on `\n`, and sends each line without it. The daemon's lines are trusted and not parsed.
- **The gateway never speaks the protocol.** It sends no `hello` and no `ping` on a bridged connection, so request ids belong to the page alone.

### Which methods a browser may call

Each command in `golem_protocol` declares whether a browser may call it, and `just gen` writes `packages/protocol/gen/browser-methods.ts`, which the gateway imports. `packages/daemon/tests/test_browser_methods.py` fails when a method the daemon answers has no declaration.

- **Denied:** `auth.set`, because the API key would pass through the page's memory, its devtools, and its wire view, and `auth.remove`, because key management stays in the terminal, where the Keychain prompt is.
- **Allowed, and easy to get wrong:** `auth.list` never returns a key, only where each one is stored. `policy.update`, `approval.respond`, and `message.send` are the point of the web UI. Together they can make golem run code on the Mac, which is why the threat to guard against is cross-site scripting, not secrets.

### Liveness and load

- **The heartbeat is end to end.** The page's client keeps its `ping` every 5 s and its 10 s timeout, through the gateway, to the daemon. When a tab becomes visible again, the page calls `checkNow`, which pings at once, because a hidden tab's timers run about once a minute.
- **Between the browser and the gateway,** Bun's `idleTimeout` (120 s) and `sendPings` close a dead WebSocket.
- **A close on either side closes the other.** A daemon that is down at the upgrade opens the socket and closes it with 1013, so the page can tell "daemon down" from "gateway down". A daemon that closes later closes the WebSocket with 1001. The page reconnects, says `hello`, and attaches again from its last `seq`.
- **Backpressure.** When the browser falls behind and its buffered amount passes 4 MiB, the bridge stops reading the daemon socket and resumes on `drain`. The daemon's queue for that connection then fills, and at `MAX_PENDING_FRAMES` (20 000) the daemon drops the connection. The page attaches again from `after_seq`. Input toward the daemon that piles up past 4 MiB unwritten closes the WebSocket with 1008.

### Headers and the page's files

`withSecurityHeaders` adds these to every answer:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

`'unsafe-inline'` is for styles only, because Radix's scroll lock injects a `<style>`. `frame-ancestors 'none'` stops another page from framing the approval card. `index.html` is `no-cache` and hashed assets are `immutable`, so after `brew upgrade` the next load is the new page. There is no service worker, because one would show an old page, speaking an old protocol, after an upgrade.

The page's files are embedded in `bin/golem` at `just dist`, from `packages/web/dist`. A checkout serves that folder when it is built, and a placeholder otherwise. A path without a file extension serves `index.html`, so the page's routes reload.

In development, `vite dev` serves the page on its own port. Its proxy for `/ws` and `/auth` rewrites `Origin` and `Host` to the gateway's own, and accepts only the dev page itself, so the gateway runs with the same checks as a release (`packages/web/vite.config.ts`).

### What the page holds

`bootPage` trades the token, then makes one client with `wsDial` on the page's own host and `clientName: "web"`, and `createPage` builds everything on it.

| Kind | Examples | Where it lives |
|---|---|---|
| A session's events | The transcript, streaming text, tool calls, the waiting approval, todos | A session store per attached session, folded by `reduceChat` |
| Live facts | The connection, the session list (`session.list` with `watch`), downloads, MCP and model server status | The live stores: `connection.ts`, `session-list.ts`, `pulls.ts` |
| Answers to a request | `model.list`, `setup.status`, `skill.list`, `session.inspect` | TanStack Query, keys `[method, ...params]` |
| Screen-only state | The draft, an open drawer, the theme, the palette | React state, a context, and `localStorage` for the theme |

- **The new-session store** (`new-session.ts`) holds what the empty screen has chosen: the folder, and the model. The model is `null` for the default and is sent as `model_profile` of `session.create`. It is cleared once the first message is sent, and a reload starts from the default again.
- **A session store** is `createStore` (a snapshot and its listeners) with `dispatch`. `message.delta` waits in a map by message id until the next `requestAnimationFrame`. Any other event folds that map first, then itself, at once. `fold` also keeps the session's title, folder, and model from `session.created`, `model.selected`, and `session.updated`. In dev mode, each store reports what it folded to the Redux DevTools extension through its plain browser API, with no Redux in the bundle.
- **Stores come and go with use.** `acquire(id)` attaches on the first use and detaches after the last release. The detach waits one tick, so React's strict-mode remount keeps the attachment. A session you are not looking at costs nothing. The sidebar's dots come from the session list, so a session doesn't have to be attached to show that it works or waits.
- **Unchanged messages keep their identity.** `reduceChat` returns the same object for every message an event didn't touch, so a memoized row doesn't render again while another message streams.
- **Answers stay fresh until an event says otherwise.** `staleTime` is `Infinity` and refetching on focus is off. `keepQueriesHonest` marks them stale:

  | Pushed | Makes stale |
  |---|---|
  | `skill.registry.changed` | `skill.list` |
  | `mcp.server.status` | `mcp.list`, `mcp.tools` |
  | a download that ends, a model server that changes | `model.list`, `setup.status` |
  | `session.updated`, a session summary | that session's `session.inspect` |
  | a reconnect | everything |

- **Commands are thin calls.** `PageActions` in `page.ts` wraps `message.send`, `approval.respond`, `run.cancel`, `session.set_model`, and the rest. Their results arrive as events, so there is nothing to merge.
- **The draft** is kept per session id, or `"new"`, in memory only, so switching away and back keeps what you typed.
- **Routes** are `/`, `/s/:id`, `/settings`, and `/welcome`, from a small history router in `router.ts`. `/welcome` is first run, with no sidebar: `?step=engine|model|tools|ready` names the step and `?from=send` says a send with no model sent the person there. At the start, a fresh home goes to `/welcome` and a default that is gone goes to `/welcome?step=model` ([ADR-039](../adr/039-web-setup-as-pages.md)). `Later` leaves a `Finish setup` strip on home until a default model is ready. A send that fails with no model navigates to `/welcome?from=send` and the draft stays under its key, and `/setup` and the palette's Setup row navigate to `/settings/setup`, whose `Run setup again` goes to `/welcome`. The web has no setup dialog: setup is these two pages.

### The look, and what may render

- **Tokens only.** `src/styles/tokens.css` is the one place golem's colours, fonts, and sizes are defined, each colour once as `light-dark(slip, kiln)`. Tailwind's own palette is removed, so a component can only write `bg-surface text-ink`. `no-arbitrary.test.ts` fails on a class such as `bg-[#123456]`, and `tokens.test.ts` checks the contrast of every text-on-surface pair in both themes. The docs site reads the same file.
- **The theme** is `color-scheme`. With no `data-theme` on `<html>` the system decides, with no script and no flash. `data-theme="slip"` or `"kiln"` forces one.
- **The layers.** `ui/` holds primitives (Radix, `cva`) and imports nothing from `features/` or `store/`. `features/` holds the screens and never imports `@golem/client`: they read and act through `store/`. ESLint enforces both, and `lint-rules.test.ts` checks the rules.
- **Untrusted text.** Markdown goes through `marked`, then DOMPurify (`features/chat/markdown.ts`), which forbids `style`, `<svg>`, `<math>`, forms, `javascript:` and `data:` links, and remote images. Links open in a new tab with `rel="noopener noreferrer"`. `xss-corpus.ts` is the test corpus. Tool output and diffs are text. Code is highlighted by Shiki with its JavaScript regex engine, because the CSP forbids WASM.
- **The tab** shows golem's state without the page being on screen. `features/tab-status` sets the favicon and the title from the same states as the TUI's tab, outside the animation frame.
- **Commands the page doesn't have yet** are listed in `TERMINAL_ONLY` (`features/composer/terminal-only.ts`). The palette marks them `In the terminal for now`, and running one says where it lives.

### Files

| File | What it does |
|---|---|
| `packages/cli/src/web-command.ts`, `web.ts` | `golem web`: find or start the gateway, write the token, open the link |
| `packages/gateway/src/bun/server.ts` | `startGateway`: the routes, the WebSocket, one daemon socket per link |
| `packages/gateway/src/auth.ts` | `checkRequest`, `checkUpgrade`, `exchangeToken`, the cookie |
| `packages/gateway/src/framing.ts` | `filterMessage`: forward, deny, or refuse one message |
| `packages/gateway/src/bridge.ts` | `createBridge`: the queue, the pause at 4 MiB, the close codes |
| `packages/gateway/src/lines.ts` | `createLineSplitter`: daemon bytes into whole lines |
| `packages/gateway/src/token-file.ts`, `run-file.ts` | `web.token` and `web.json` |
| `packages/gateway/src/headers.ts` | `withSecurityHeaders` and the CSP |
| `packages/protocol/gen/browser-methods.ts` | `BROWSER_METHODS`, from `just gen` |
| `packages/client/src/ws-link.ts` | `wsDial`: the client's link over a WebSocket |
| `packages/web/src/store/boot.ts`, `login.ts` | The token for the cookie, then the one client |
| `packages/web/src/store/page.ts` | `createPage`: every store on one client, and `acquire` |
| `packages/web/src/store/session-store.ts` | One session's view, deltas once per frame |
| `packages/web/src/store/query.ts` | The query client, and the events that make answers stale |
| `packages/web/src/styles/tokens.css` | golem's look, in slip and kiln |
| `packages/web/e2e/` | `just e2e`: Chrome against a real daemon and gateway |

## Read more

- Next: [Tracing](./tracing.md): how an answer was made.
- Before: [The terminal app](./tui.md): the fold, the batcher, and the client this page shares.
- [The web UI](../guide/web.md): how to use it.
- [The design system](../design/index.md): the pixel golem, the shem, the type, and the tokens. [The gallery](/gallery/) shows every screen.
- [The protocol](./protocol.md): `hello`, `seq`, and attach, which pass through the gateway unchanged.
- [The daemon](./daemon.md): the socket the gateway stands in front of.
- [The overview](../architecture.md): the whole system on one page.
