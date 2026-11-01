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
- **A change is logged once, by the call that sees it** (2.3.4). While it builds the prompt, the pinned section reports each pin to the run through the graph's stream: the `SKILL.md` hash it read, or why it left the skill out. The session keeps what its log last said about each pin (`PinMemory`). A run logs only a change: `skill.activated` with the new hash, or `skill.skipped` with `missing`, `disabled`, or `broken`. Many calls with the same body log nothing more. After a restart the memory is rebuilt from the stored events, so an unchanged pin is not logged again.
- **A pinned folder is a read root.** Each turn passes the folders of the pins the session can use now, and the read tools accept paths inside them, as for an invoked skill ([ADR-030](030-skill-read-roots.md)). Unlike an invoked skill's folder, it stops being readable when the skill is unpinned.

## Alternatives Considered

### `active_skills` in `AgentState`

- **Pros**: The checkpoint alone says which skills were on. A fork copies it with the history.
- **Cons**: A pin made between turns has to write a checkpoint outside a run. The list would sit in two places, the checkpoint and the session record, and they could disagree. A client would still need an event to show it.
- **Why not**: The session record already holds the other per-session switches (`allowed_tools`, `mcp_servers`), and the event log already makes them survive a restart.

### Check the pins once per turn, in the manager

- **Pros**: No stream reports. The events would come before the run starts.
- **Cons**: A long run with many tool calls reads the body on every call, so an edit mid-run would reach the model without an event.
- **Why not**: The log should say what the model read. The section already reads the file, so it is the one place that knows.

### Log `skill.skipped` on every call

- **Pros**: No memory to keep.
- **Cons**: A skill deleted once would add an event to every model call for the rest of the session.
- **Why not**: One event says it. The status line keeps showing `terse (skipped)` until a call reads it again.

### One `session.updated` with the whole list

- **Pros**: Copies `mcp.enable` exactly.
- **Cons**: The log would not say which skill turned on, how, or with which `SKILL.md` hash.
- **Why not**: `skill.activated` already carries that, for invoked skills, and a client already reads it.

## Consequences

### Positive

- Pins survive `kill -9`: the events are written before `session.set_skills` returns.
- The checkpoint stays as small as before.

### Negative

- A fork copies the pins as they are when it forks, not as they were at the cut ([ADR-010](010-fork.md)).
- A turn that is already running keeps the pins it started with. A pin applies from the next turn.
- The registry notices an edit by the file's size and time. Two edits of the same size within the file system's time step could look like one.

### Risks

- `PinMemory` is shared by a session's runs and changed by them. One run at a time per session keeps it safe.
- The projection rewrites `sessions.skills` from the events. A bug there would show as a lost pin after a restart. A test restarts the daemon and checks the pin is still in the prompt.
