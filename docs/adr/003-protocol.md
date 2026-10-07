# ADR-003: One Python model, generated TypeScript

**Date**: 2026-10-05
**Status**: accepted

## The idea

The daemon and the TUI have to agree on message shapes. Those shapes are written once, in Python. TypeScript is generated. A hand edit to the TypeScript would be overwritten, and `just check` would fail if someone forgot to regenerate.

On the wire, once a socket exists, each line is one JSON-RPC 2.0 object. Events go from the daemon to the client. Commands go from the client to the daemon.

An event is a fact that already happened. The client builds its screen by reading the facts in order. It does not keep a second, private copy of the session.

```mermaid
sequenceDiagram
  participant Model as Ping in events.py
  participant Schema as ping.schema.json
  participant TS as ping.ts
  participant TUI as pingNonce
  Model->>Schema: just gen
  Schema->>TS: json2ts
  TUI->>TS: read nonce
```

The walk with the real model is in [architecture.md](../architecture.md).

## What the code does today

The daemon speaks these models. `just gen` writes a JSON Schema and a TypeScript file for each one, plus `version.ts` from `PROTOCOL_MAJOR` and `PROTOCOL_MINOR`.

| Model | Role |
|---|---|
| `HelloParams`, `HelloResult` | `hello`. The major number must match. Any minor on that major is accepted. |
| `DaemonStatus` | Result of `daemon.status`: pid, version, protocol, uptime, `running` or `draining`. |
| `PingParams`, `Ping` | `ping`. The daemon echoes `nonce` on a `system.ping` result. |
| `RpcRequest`, `RpcSuccess`, `RpcFailure` | One JSON-RPC 2.0 object per line. |

`hello` runs before `ping` and `daemon.status`. A different major number is error `-32001`, and the client stops reconnecting. `@golem/client` imports the generated types. `pingNonce` in the TUI still reads a `Ping` nonce. That helper is the Phase 0 proof. The screen is the connection line.

## Other shapes that lost

Sending the graph library's own chunks to the TUI would make the screen depend on that library's classes.

Writing the TypeScript by hand would let the two sides drift. The bug would show up as a wrong screen. Here it shows up as a failed `just check`.

Using AG-UI or ACP as the native message format is not decided. This record does not pick either one.

## What it costs

`json-schema-to-typescript` is locked in `pnpm-lock.yaml`. Two machines generate the same TypeScript.

A breaking change to a model bumps `PROTOCOL_MAJOR`. `hello` refuses a client on the wrong major number.

Something still has to turn a graph library's stream into these models, and turn a person's answer back into a resume. That translator is not in the tree. The socket today carries `hello`, `daemon.status`, and `ping`.
