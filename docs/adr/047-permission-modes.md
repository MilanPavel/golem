# ADR-047: Permission modes change only the built-in defaults

**Date**: 2026-11-11
**Status**: accepted

## The idea

Asking before every command and every file write is safe and tiring. Asking for none is quick and not safe. A **permission mode** sits between: it says how much the built-in default rules allow without asking.

| Mode | Allowed without asking, besides the read-only tools |
|---|---|
| `careful` | nothing |
| `balanced` (default) | `web_search` and `web_fetch` |
| `autopilot` | also `write_file`, `edit_file`, and `shell` while `[shell] network` is off |

`shell_unsandboxed` and MCP tools ask in every mode. MCP trust is its own decision, see [ADR-048](048-mcp-read-only-tools.md).

The mode touches one layer. The rules are still checked in the order of [ADR-012](012-permission-rules.md): the project's file, your `config.toml`, MCP servers with `approval = "allow"`, and last the built-in defaults, which the mode picks. So a `deny` or an `ask` you wrote beats any mode, and so does what you allowed for the session.

```toml
[permissions]
mode = "balanced"
```

A session can set its own mode with `session.set_mode`, or remove it with `null` to follow `config.toml` again. The daemon stores `session.mode.changed`, so every client sees it and a replayed session gets it back, and keeps it in `sessions.permission_mode`. Only the user's `config.toml` sets the default, as with `[shell]`, and the browser cannot edit it through `config.raw.set`. `PROTOCOL_MINOR` is 58.

## What the code does

- Each `Tool` has `allow_from`, the first mode that allows it, and `offline_only` for `shell`. `ToolRegistry.default_allowed(mode, network=...)` returns the tools a mode allows. There is no list of tool names in the engine.
- `Policy.rules(root, registry, mode)` ends with those allows and a final `* → ask`. Their source reads `built-in default (balanced)`, so the approval card and `config.get` say why a call ran or asked.
- The `tools` node reads the session's mode on each run and passes it to `Policy.check`. A change applies from the next tool call.
- `config.get` adds `default_permission_mode` and `permission_mode`, the mode of the session it was asked about.

## Other shapes that lost

**A mode that overrides every rule.** Then "autopilot" would run a command you denied. A mode is a default, and your rules stay the last word.

**A mode per tool in `config.toml`.** That is what `[[rule]]` already is. A mode is one word you can change in a chat.

**Allow `shell` in balanced.** The sandbox allows writes inside the project, so `rm -rf src` would run unasked while `edit_file` still asks. `shell` runs unasked only in autopilot, and with the network on, a command can also send files out, so it asks again when `[shell] network = true`.

## What it costs

Autopilot changes files and runs commands in the sandbox without asking, and without a diff to approve first.

In balanced, `web_fetch` runs without asking, and so do the read tools. A fetched page with injected instructions could make the model read a file and send it out in the URL of a later fetch. Today's prompt on every fetch blocks that. For now, a `deny` or `ask` rule of yours for `web_fetch` still wins, and `careful` keeps today's behavior. Planned follow-up: once a turn has read untrusted content, a fetch to a host not yet seen in the session asks again.

The source string of a default rule changed, from `built-in default` to `built-in default (<mode>)`, so a client that compares it must match the prefix.
