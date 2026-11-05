---
title: The protocol
description: How a daemon and its windows talk, the common ways to do it and what each costs, and how golem uses JSON-RPC lines on a Unix socket, numbered events, attach and replay, and one set of shapes generated for both languages.
order: 4
adrs: [3, 7, 28]
---

# {{ $frontmatter.title }}

Once the work lives in [a daemon](./daemon.md), every window is a separate program, perhaps in another language. They share no memory and no objects. All they share is what they write to each other. So what do they write, and how does a window that was closed for an hour catch up without missing a word, or seeing one twice?

## The idea

::: concept In agents generally

A **protocol** is the agreement two programs keep when they talk. It answers five questions:

1. **Where does one message end?** Bytes arrive in pieces, so the receiver needs a rule: a length in front, or a line break after. This is **framing**.
2. **What kind of message is it?** Usually one of three: a **request** that wants an answer, the **response** to it, or a **notification** that wants none. A request carries an id, and its response carries the same id, so answers can come back in any order.
3. **What fields does it have?** The **shapes**, written down in a **schema**, so both sides read the same names and types.
4. **What happens when the two sides change?** A **version**, checked when they first connect.
5. **What does a window do after it was gone?** It needs a way to ask for what it missed.

An agent's protocol has two directions with different jobs. **Commands** go from a window to the agent and ask: send this message, cancel that run, allow this tool. **Events** go from the agent to every window and tell what already happened: a token arrived, a tool finished, the run ended.

The second rule is what makes several windows work: **an event is a fact, and the screen is built from the facts, in order.** A window keeps no private story of the chat. If each event also has a **number**, a window that drops out asks for everything after the last number it has, and draws the same screen as one that never left. Sending every event to every window that follows a session is called **fan-out**.

![The two directions of a protocol between a client and an agent. A command has an id and gets one reply with the same id. Events are facts, in order, each with a number, and get no reply. When the connection drops, the client asks for everything after the last number it has, number 41, and gets 42 again and then 43](../images/protocol-two-ways.svg)

:::

## How agents usually do it

The wire:

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| Function calls | The window and the agent are one program, and call each other | Nothing to design | Only works in one process and one language |
| HTTP and server-sent events | A request per command, and a long response that streams events | Every language and tool speaks HTTP | Two channels, a port, and a login. Order between a reply and an event is not given |
| A WebSocket with JSON | One connection both ways, a JSON message per frame | Browsers speak it, both directions on one socket | Still a port and an HTTP upgrade, and each side invents its own envelope |
| JSON-RPC 2.0 over a stream | Requests, responses, and notifications in one envelope, over stdio or a socket. LSP frames each with a `Content-Length` header, and MCP's stdio with one line each | A small standard: ids, errors, and notifications already defined | Text JSON is bigger and slower than binary |
| gRPC and protobuf | A schema in `.proto` files, generated code, binary frames over HTTP/2 | Fast, typed, streaming built in | A toolchain on both sides, and a wire you can't read by eye |

The shapes:

| Approach | Costs |
|---|---|
| Written by hand on both sides | The two copies drift, and the bug shows up as a wrong screen |
| A schema, with types generated for each language | One more build step, which must run before a change is done |
| One language's types as the source, generated for the other | The source language decides what the schema can say |

The open problems are the same in every agent:

- **Catching up.** A window that drops out mid-answer must get the rest without a gap or a repeat.
- **A slow window.** One terminal that reads slowly must not slow the run, or the other windows.
- **The token stream.** A long answer is thousands of small events. Keeping all of them forever costs space, and dropping them costs the replay.
- **Versions.** A window and an agent from different releases must say clearly that they can't talk, not break halfway.

## How golem does it

::: golem In golem

golem speaks **JSON-RPC 2.0, one object per line, over the daemon's Unix socket**. The shapes are Python classes, and `just gen` writes JSON Schema and TypeScript from them ([ADR-003](../adr/003-protocol.md)).

- **Framing.** Each message is one line of UTF-8 JSON, ended by `\n`. JSON writes a line break inside a string as `\n`, so a message never contains one. A line over 1 MiB closes the connection.
- **The envelope.** A command is a JSON-RPC request with an `id`. Its reply has the same `id`, with `result` or `error`. An event is a notification with method `event`, and no `id`.
- **`hello` first.** The client sends its protocol version. A different major number is refused, and any minor on the same major is accepted. Today it is `2.35`.
- **Events carry `seq`.** A rising number per session, from the event log, so it survives a restart. Each event is written to `golem.db` before it is sent ([Sessions that survive](./sessions.md#the-event-log)).
- **Attach and replay.** A connection gets a session's events only after `session.attach` with `after_seq`. The daemon sends the stored events after that number, then the reply with `last_seq`, then live events. One lock per session covers both, so no event lands in between ([ADR-007](../adr/007-attach-and-fan-out.md)).
- **Fan-out.** Every connection attached to a session gets every event. Each connection has its own queue and writer, so a slow one never blocks a run, and one that falls 20 000 lines behind is dropped. It reconnects, and attaches from its last `seq`.
- **One client.** `@golem/client` is the only code that speaks the protocol, for the TUI, `golem status`, and the web UI. It sends a `ping` every 5 s, and after a reconnect attaches to each session again from its last `seq`.
- **The browser.** A web page speaks the same lines over a WebSocket to `golem web`, which checks the token, the `Origin`, and the method, and passes each line on unchanged ([ADR-028](../adr/028-web-gateway.md)).

![The real two-window trace. The log numbers 43 events of one session. A, the TUI, attached first and gets each one live. B, a web page, connects 6.081 seconds in and attaches with after_seq 0. Seq 1 to 9 come to it as one replay, then the reply says last_seq 9. From seq 10 on, A and B get each event in the same millisecond](../images/protocol-attach.svg)

Here is the real wire, recorded against a throwaway daemon with `qwen3.5:4b`. Connection A opens a session and asks a question. When its fifth token arrives, connection B says `hello` and attaches to the same session from the start. The ids are shortened, and long lines are cut with `…`:

```text
0.000 A → {"jsonrpc":"2.0","id":1,"method":"hello",
           "params":{"protocol_major":2,"protocol_minor":34,
           "client":"tui"}}
0.001 A ← {"jsonrpc":"2.0","result":{"protocol_major":2,
           "protocol_minor":34,"daemon_version":"0.0.0-dev"},
           "id":1}
0.002 A → {"jsonrpc":"2.0","id":3,"method":"session.attach",
           "params":{"session_id":"s_520d…","after_seq":0}}
0.002 A ← {"jsonrpc":"2.0","method":"event","params":
           {"seq":1,…,"type":"session.created",…}}
0.002 A ← {"jsonrpc":"2.0","result":{…,"last_seq":1},"id":3}
0.002 A → {"jsonrpc":"2.0","id":4,"method":"message.send",
           "params":{"session_id":"s_520d…",
           "text":"In one sentence, what is a golem?"}}
0.180 A ← {"jsonrpc":"2.0","result":{"run_id":"r_6681…"},
           "id":4}
6.038 A ← … seq 5 to 9, the first tokens
6.081 B → {"jsonrpc":"2.0","id":2,"method":"session.attach",
           "params":{"session_id":"s_520d…","after_seq":0}}
6.083 B ← seq 1 to 9, the replay, in one burst
6.083 B ← {"jsonrpc":"2.0","result":{…,"last_seq":9},"id":2}
6.092 B ← {"jsonrpc":"2.0","method":"event","params":
           {"seq":10,…,"type":"message.delta",
           "data":{…,"text":" mythical"}}}
6.092 A ← the same line
6.453 A, B ← seq 42, message.completed: "A golem is a
           mythical creature created by Jewish mystics
           from inanimate materials…"
6.455 A, B ← seq 43, run.completed
```

The attach reply comes after its replay, and says where the replay ended. Everything after it is live. Seq 10 reached both connections in the same millisecond, and neither got an event twice.

A third connection shows what the daemon refuses:

```text
C → {"jsonrpc":"2.0","id":1,"method":"session.list","params":{}}
C ← {"jsonrpc":"2.0","error":{"code":-32002,
     "message":"hello required","data":null},"id":1}
C → {not json
C ← {"jsonrpc":"2.0","error":{"code":-32700,
     "message":"parse error","data":null},"id":null}
C → {"jsonrpc":"2.0","id":2,"method":"hello","params":
     {"protocol_major":1,"protocol_minor":0,"client":"old"}}
C ← {"jsonrpc":"2.0","error":{"code":-32001,
     "message":"protocol major mismatch: client 1, daemon 2",
     "data":{"client_major":1,"daemon_major":2}},"id":2}
```

While the model loaded, A also got two `model.server.status` notifications, with no `seq`. The daemon sends those to every connection, attached or not.

![One shape for the daemon and every client. The messages are Python classes in golem_protocol. just gen writes a JSON Schema and a TypeScript file for each message into packages/protocol/gen, and @golem/client uses them. The TUI and golem status reach the daemon over the Unix socket, one JSON object per line. A web page reaches it over a WebSocket through golem web, the gateway, which checks the token, the Origin, and the method, and passes the same line on. The daemon reads each line into the same Python classes](../images/protocol-one-shape.svg)

**Where it lives in the code:**

- `packages/protocol/golem_protocol/`: the shapes, in `commands.py`, `events.py`, and `rpc.py`, and `version.py`.
- `packages/protocol/gen/`: the generated JSON Schema and TypeScript. Never edited by hand.
- `packages/daemon/golem/server/framing.py`: `read_frame`, one line at a time.
- `packages/daemon/golem/server/dispatcher.py`: the envelope, `hello`, the error codes, and each command run as a task.
- `packages/daemon/golem/server/handlers.py`: one handler per command.
- `packages/daemon/golem/sessions/log.py` and `sessions/bus.py`: `seq`, attach, and fan-out.
- `packages/client/src/connect.ts`: `connectGolem`, the one client, over `unix-link.ts` or `ws-link.ts`.

:::

## Why this way

**JSON, not a binary format.** Python and TypeScript both read it with no library. A person can read it too: in `/debug wire`, in a log, or by typing into `nc`. Its cost is size and speed, and neither is what limits an agent. In the trace, a token arrived every 11 ms, as a line of about 300 bytes. The model is the slow part, by far.

**JSON-RPC 2.0, not an envelope of our own.** It already says how an id pairs a reply with its request, how an error looks, and what a notification is. It is the same envelope LSP and MCP use, so golem's own [MCP client](./mcp.md) speaks the same shape, and the error codes, such as `-32700` and `-32602`, mean what they mean everywhere.

**Lines, not length headers.** A newline is the whole framing rule: the daemon reads with one `readuntil(b"\n")`, and a client splits on `\n`. JSON never puts a raw line break inside a message, so nothing needs escaping. LSP's `Content-Length` headers solve the same problem with more code on both sides.

**One socket for both directions, not HTTP.** A command, its reply, and the events all go through one queue per connection, so the order on the wire is the order they happened. HTTP with server-sent events would need two channels and a port. A port would need a login, and the socket's file mode already is one ([The daemon](./daemon.md#why-this-way)). The WebSocket appears only where a browser needs it, at the gateway, and carries the same lines.

**Not gRPC.** Protobuf needs a compiler and generated code for both languages, and HTTP/2 under it. The `golem` command is one bun binary ([ADR-019](../adr/019-single-binary.md)), and its wire would no longer be readable by eye. Its gains, smaller and faster messages, solve a problem golem doesn't have.

**Events are facts, written first** ([ADR-006](../adr/006-checkpoint-continuity.md), [ADR-007](../adr/007-attach-and-fan-out.md)). The screen is a function of the events, so a replay is not a special mode: it is the same stream, read from a number. A second window, a reconnect, and a restart of the TUI all use it.

**A queue per connection, and a limit.** Writing to a socket from the place that emits an event would let one slow terminal stall the run. Waiting on a full queue would do the same. Dropping a client that falls 20 000 lines behind turns it into a reconnect, which the replay already handles.

**Python classes as the source** ([ADR-003](../adr/003-protocol.md)). The daemon reads every line into the same Pydantic class it was written from, so an unknown field or a wrong type is refused at the door. The TypeScript is generated from those classes, so the two can't drift, and `just check` fails if someone forgot `just gen`.

**A major and a minor.** Adding a command or an event bumps the minor, and an older client ignores what it doesn't know. Changing a shape, or which connection gets an event, bumps the major, and `hello` refuses the mismatch at once.

## Try it

1. Open `golem`, type `/debug wire`, and send a message. It lists the recent protocol lines in both directions, with pings hidden.
2. Talk to the daemon yourself:

   ```sh
   hello='{"jsonrpc":"2.0","id":1,"method":"hello",'
   hello+='"params":{"protocol_major":2,"protocol_minor":34,'
   hello+='"client":"nc"}}'
   ask='{"jsonrpc":"2.0","id":2,"method":"daemon.status"}'
   { echo "$hello"; echo "$ask"; sleep 1; } \
     | nc -U ~/.golem/run/golem.sock
   ```

   Two lines come back: the `hello` reply, and the daemon's status.
3. Open `golem` in two terminals, and pick the same chat in `/sessions` in the second. Send a message in one: both stream it.

## The details

For contributors: the reference for the protocol's shapes, what is on the wire, and the error codes.

### Why the daemon translates

The protocol exists so a client never has to understand the daemon's insides.

The graph library has its own message classes, and those classes change. If the TUI spoke those classes, every client would be tied to that library, and a reconnect would have no stable history to read. So the daemon translates. What crosses the socket is our messages only.

### Two directions

**Commands** go from client to daemon. They ask for something: open a session, send a sentence, approve a tool, cancel a run, list flows.

**Events** go from daemon to client. They report something that already happened: a token arrived, a tool finished, a model was chosen, a run stopped.

An event is a fact. The client builds the whole screen from the facts, in order. The daemon writes every fact to the event log first. Replay is not a special mode: it is the same stream, read from the start or from the last number the client has.

`hello` is the first command. The client and the daemon compare protocol versions. A break in the shapes bumps the major number, and the daemon refuses the client. Any minor on the same major is accepted. The current numbers and what each minor added are in [ADR-003](../adr/003-protocol.md).

A connection gets a session's events only after `session.attach`. Several connections can attach to one session, and each gets every event. The daemon holds one lock per session while it reads the replay and subscribes the connection, so no event lands in between. Each connection has its own outbound queue, so a slow terminal does not slow a run. A client that falls 20 000 lines behind is dropped, and it attaches again from its last `seq`.

Each event line is one JSON-RPC 2.0 notification. The fields that matter:

| Field | Meaning |
|---|---|
| `seq` | A rising number for this session. It survives a restart and can skip numbers. The client uses it to ask for "everything after here". |
| `session_id` | Which chat or flow |
| `run_id` | Which execution, when a session can have more than one |
| `type` | What happened, such as `message.delta` |
| `data` | The payload for that type |

`tool.output` works the same way for a running tool call: its rows are deleted when the call's `tool.completed` or `tool.failed` is written, which keeps a short preview.

`message.delta` is the live token stream. `golem.db` keeps the deltas only while the message is open. Writing its `message.completed` deletes them in the same transaction, so the database does not keep every fragment, and a reader that comes in mid-answer can still see the text so far. That is why `seq` skips numbers.

`message.completed` has `interrupted: true` when the run stopped before the model finished. Its text is then what had streamed.

### What is on the wire today

| Commands | Events |
|---|---|
| `hello`, `ping`, `daemon.status`, `session.create`, `session.attach`, `session.detach`, `session.list`, `session.rename`, `session.fork`, `session.close`, `session.set_skills`, `message.send`, `run.cancel`, `approval.respond`, `session.inspect`, `config.get`, `policy.update`, `policy.remove`, `session.revoke`, `auth.set`, `auth.remove`, `auth.list`, `model.list`, `session.set_model`, `model.set_default`, `model.probe`, `model.pull`, `model.pull_cancel`, `model.delete`, `artifact.read`, `mcp.list`, `mcp.enable`, `mcp.disable`, `mcp.tools`, `mcp.restart`, `mcp.set_enabled`, `mcp.add`, `mcp.remove`, `skill.list`, `setup.status`, `ollama.install`, `ollama.install_cancel`, `ollama.start` | `session.created`, `model.selected`, `message.started`, `message.delta`, `message.completed`, `tool.requested`, `tool.started`, `tool.output`, `tool.completed`, `tool.failed`, `approval.needed`, `approval.resolved`, `todos.updated`, `skill.activated`, `skill.deactivated`, `skill.skipped`, `run.started`, `run.completed`, `run.failed`, `run.cancelled`, `session.updated`, `session.closed`; `session.summary` to watchers; `model.pull.progress`, `model.pull.done`, `ollama.install.output`, `ollama.install.done`, `mcp.server.status`, `model.server.status`, and `skill.registry.changed` to every connection |

After `hello`, a client sends `ping` every few seconds so a half-open socket is noticed. `daemon.status` returns the pid, uptime, and configured model, and the local model servers golem has used: who runs each one, and for one golem started its pid and memory. A new chat sends `session.create` with its `cwd`, then `session.attach` with `after_seq` 0, then `message.send`. `session.list` returns sessions newest activity first, each with `idle`, `running`, or `waiting` for an approval, its title, its folder (`cwd`), and its last `seq`. With `cwd`, it lists only the sessions in that folder; `cwd` does not go with `watch`. With `watch: true`, the connection also gets a `session.summary` after every change to any session, until it closes. `session.rename` sets a title by hand. `session.fork` copies a session's history up to one message into a new session, and the client attaches to it. `session.detach` stops one session's events. `session.inspect` reads the saved checkpoint messages and does not call the model. When golem has a system prompt for the session, it comes first, with role `system`, and `message_count` leaves it out ([ADR-031](../adr/031-system-prompt.md)). A reply that called tools lists each call as `→ name(args)` after its text. `auth.set` tries a model provider's API key against the provider, then stores it in the Keychain, and a key the provider refuses is not stored ([ADR-035](../adr/035-daemon-installs-ollama.md)). `auth.remove` deletes it, and `auth.list` says where each provider's key is without returning it. The client shows `auth.set` in the wire view with the key replaced by `[redacted]`.

Switching a session's model, model errors, the local model server, and downloads are in [Talking to models](./models.md#the-details).

The MCP methods, `mcp.list` to `mcp.server.status`, are in [MCP](./mcp.md#on-the-wire).

The default model and `model.list` are in [Talking to models](./models.md#the-model-list).

### Why a protocol package

Those shapes are written once, as Python classes in `golem_protocol`. `just gen` writes JSON Schema, then TypeScript, into `packages/protocol/gen/`. `@golem/client` imports the generated types, and the TUI and `golem status` both use that client. A hand-written TypeScript copy would drift, and the bug would show up as a wrong screen. Here `just check` fails if the generated files do not match the classes.

Adding a message is the same every time. Add a class, run `just gen`, and the client sees a typed payload.

### Error codes

| Code | Name | When |
|---|---|---|
| `-32700` | parse error | A line that is not JSON |
| `-32600` | invalid request | JSON that is not a JSON-RPC request |
| `-32601` | method not found | A method the daemon doesn't have |
| `-32602` | invalid params | Params that don't fit the command's class |
| `-32603` | internal error | A handler failed |
| `-32001` | protocol mismatch | `hello` with another major |
| `-32002` | hello required | Any command before `hello` |
| `-32003` | session not found | |
| `-32004` | session busy | `message.send` while a run is open |
| `-32005` | model not configured | |
| `-32006` | run not found | `run.cancel` with an id the daemon never ran |
| `-32007` | message not found | `session.fork` at a message it can't cut at |
| `-32008` | keychain unavailable | |
| `-32009` | model pull failed | |
| `-32010` | approval not found | `approval.respond` when no run waits on that call |
| `-32011` | invalid tool args | Edited arguments that the tool or the rules refuse |
| `-32012` | artifact not found | |
| `-32013` | skill not found | A skill the session can't run |
| `-32014`, `-32015` | key rejected, key unchecked | `auth.set` |
| `-32016` | Ollama failed | |
| `-32020` | not allowed from the browser | Sent by the gateway, never by the daemon |

### Limits

- **A line is at most 1 MiB.** A longer one gets `-32700` with `line too long`, and the connection closes. The gateway refuses a WebSocket message over the same size before it reaches the daemon.
- **A replay is one burst.** Attaching to a long session queues its whole replay inside the session's lock, so an emit for that session waits until the burst is queued.

### Files

| File | What it does |
|---|---|
| `packages/protocol/golem_protocol/commands.py` | The params and results of every command |
| `packages/protocol/golem_protocol/events.py` | `ChatEvent` and its data, one class per event type |
| `packages/protocol/golem_protocol/rpc.py` | The JSON-RPC envelope: requests, results, errors, notifications |
| `packages/protocol/golem_protocol/version.py` | `PROTOCOL_MAJOR` and `PROTOCOL_MINOR` |
| `packages/protocol/golem_protocol/codegen.py` | What `just gen` writes into `packages/protocol/gen/` |
| `packages/daemon/golem/server/framing.py` | One line at a time, with the size limit |
| `packages/daemon/golem/server/dispatcher.py` | The envelope, `hello`, and the error codes |
| `packages/daemon/golem/server/handlers.py` | One handler per command |
| `packages/daemon/golem/sessions/bus.py` | Which connections follow which session |
| `packages/client/src/connect.ts` | `connectGolem`: `hello`, ping, reconnect, attach, and `seq` |
| `packages/client/src/unix-link.ts`, `ws-link.ts` | The two links: the Unix socket, and a WebSocket to the gateway |
| `packages/gateway/src/framing.ts`, `bridge.ts` | The gateway's filter, and its bridge to the daemon |

## Read more

- Next: [Sessions that survive](./sessions.md), the event log and checkpoints that the events come from.
- Before: [The daemon](./daemon.md).
- [ADR-003](../adr/003-protocol.md) lists every shape and what each minor added.
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification), the envelope.
- [The overview](../architecture.md): the whole system on one page.
