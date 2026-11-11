# ADR-048: An MCP server's read-only tools can run without asking, if you trust that server

**Date**: 2026-11-11
**Status**: accepted

## The idea

[ADR-023](023-mcp-client.md) says a server's tool is never `read_only`, whatever the server says about itself, so every MCP call asks, unless you set `approval = "allow"` for the whole server. That is safe and it is tiring: a server of twenty tools, nineteen of which only look things up, asks twenty times as often as it needs to.

MCP lets a tool say what it does. `tools/list` can carry `annotations`, and `readOnlyHint: true` means the tool does not change its environment. Golem now keeps `readOnlyHint` and `destructiveHint`, and a third setting uses the first:

| `approval` | What runs without asking |
|---|---|
| `"ask"` (default) | nothing |
| `"read-only"` | a tool the server marks `readOnlyHint: true`, in `balanced` and `autopilot`, not in `careful` |
| `"allow"` | every tool, in every mode (as before) |

**The hint is the server's word.** Golem cannot check it. A server that is wrong, or that someone has taken over, can mark a tool that deletes things as read-only. So trusting the hint is a choice you make per server, with `approval = "read-only"` in its table or in Settings, and it is never the default, not even for a server the catalog offers. A tool without the hint, or with `readOnlyHint: false`, asks as before. `destructiveHint` is kept and sent to nothing yet: in autopilot, a tool that is not marked read-only asks even if the server says it is not destructive, since an absent hint is not a promise.

## What the code does

- `McpTool` has `read_only` and `destructive`, read from `annotations`. A hint that is not a JSON `true` counts as `false`.
- The supervisor keeps, per server, the names of the tools that say `readOnlyHint`, and drops them when the server stops. A restart lists the tools again, so a changed hint applies at once. `McpSupervisor.read_only_tools(root)` returns them for the servers with `approval = "read-only"` that `root` sees, and a project's server counts only when the project is trusted, as for `"allow"`.
- `Policy.rules` asks for that list on each check, so the decision comes from the live tool list, and adds one `allow` rule per tool, named `mcp.<server> approval = read-only`. The rules sit in the layer of [ADR-012](012-permission-rules.md) where `approval = "allow"` already sits: after the project's file and your `config.toml`. So a `deny` or an `ask` you wrote beats the hint, and a `deny` always wins. In `careful` the layer adds nothing.
- The wire gains `McpToolInfo.read_only` (default `false`), and `McpServerConfig.approval`, `McpServer.approval`, and the catalog default accept `"read-only"`. These are optional values, so `PROTOCOL_MINOR` is 59. An older client that reads `"read-only"` where it expected `ask` or `allow` should treat it as `ask`.
- Settings, MCP, Edit has an Approval select with the three choices, and the Tools tab marks a tool the server says is read-only. The TUI details line says so too.

## Other shapes that lost

**Trust the hint for every server.** The default would then depend on what each server claims. A server you added in a minute would decide what runs unasked.

**Treat a hinted tool as `read_only` in the registry.** Then it would run in `careful` too, and for a server you never trusted. The registry's `read_only` stays "golem knows this tool only reads".

**Allow every tool that is not `destructiveHint: true`.** The spec's default for `destructiveHint` is `true` when a tool is not read-only, and servers rarely set it. A tool with no hint would run unasked.

## What it costs

With `approval = "read-only"`, you rely on the server's honesty about each tool, and the approval card for a mislabelled tool never appears. A server's output is untrusted text in any case ([ADR-023](023-mcp-client.md)), so a read-only tool can still return a page of injected instructions. The rules that would catch the next call still apply to it.
