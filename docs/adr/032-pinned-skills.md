# ADR-032: Pinned skills live in the session record, not in graph state

**Date**: 2026-11-01
**Status**: accepted

## Context

A pinned skill's body is in the system prompt of every model call, until the user unpins it (step 2.3). The pins must survive a daemon restart, a client must be able to show them, and a pin can be made between turns, when no graph run is open.

The ticket for 2.3.2 (#37) asked for two copies: an `active_skills` list in `AgentState`, and a `sessions.skills` column. The phase plan says graph state holds only skill names.

## Decision

- **One copy, in the session record.** `session.set_skills` stores `skill.activated` with `how: "pinned"` for each new pin and `skill.deactivated` for each unpin. Both events have no run. The projection keeps `sessions.skills`, the names in pin order, in step with them. The daemon loads the list with the session after a restart.
- **Passed to each turn.** The manager hands the pins to the graph in `configurable`, the way it hands the on-demand MCP servers. The system prompt's pinned section reads them from there (`PromptContext.pinned`).
- **Bodies are read for each call.** Only names are stored. The section finds each name in the session's skill view and reads its `SKILL.md` for every model call, so an edit shows on the next one.
- **A pin is checked once.** Pinning needs a usable skill: one that exists in the session's view, is not turned off in `[skills]`, and is not broken. `user-invocable: false` does not stop a pin, because such skills are background knowledge. Later, a pinned skill that is gone or broken is left out of the prompt and stays pinned until the user unpins it.

## Alternatives Considered

### `active_skills` in `AgentState`

- **Pros**: The checkpoint alone says which skills were on. A fork copies it with the history.
- **Cons**: A pin made between turns has to write a checkpoint outside a run. The list would sit in two places, the checkpoint and the session record, and they could disagree. A client would still need an event to show it.
- **Why not**: The session record already holds the other per-session switches (`allowed_tools`, `mcp_servers`), and the event log already makes them survive a restart.

### One `session.updated` with the whole list

- **Pros**: Copies `mcp.enable` exactly.
- **Cons**: The log would not say which skill turned on, how, or with which `SKILL.md` hash.
- **Why not**: `skill.activated` already carries that, for invoked skills, and a client already reads it.

## Consequences

### Positive

- Pins survive `kill -9`: the events are written before `session.set_skills` returns.
- The checkpoint stays as small as before.

### Negative

- A fork does not copy the pins yet. 2.3.5 copies `sessions.skills` and `mcp_servers` together.
- A turn that is already running keeps the pins it started with. A pin applies from the next turn.

### Risks

- The projection rewrites `sessions.skills` from the events. A bug there would show as a lost pin after a restart. A test restarts the daemon and checks the pin is still in the prompt.
