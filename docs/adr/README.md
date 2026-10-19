# Architecture Decision Records

An Architecture Decision Record (ADR) is a short note of one choice: what was decided, what else was considered, and what the code does with that choice today.

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [001](001-process-split.md) | One long-running process, clients that only attach | accepted | 2026-10-05 |
| [002](002-langgraph-boundary.md) | The graph library only runs graphs | accepted | 2026-10-05 |
| [003](003-protocol.md) | One Python model, generated TypeScript | accepted | 2026-10-05 |
| [004](004-pid-lock.md) | A flock on the pid file owns the socket | accepted | 2026-10-06 |
| [005](005-client-package.md) | One TypeScript client, and that client owns the golem command | accepted | 2026-10-06 |
| [006](006-checkpoint-continuity.md) | The checkpoint is the chat's memory | accepted | 2026-10-07 |
| [007](007-attach-and-fan-out.md) | A connection sees only the sessions it attached | accepted | 2026-10-14 |
| [008](008-cancellation.md) | A cancelled run keeps what it said | accepted | 2026-10-14 |
| [009](009-session-list.md) | The session list has its own notification | accepted | 2026-10-15 |
| [010](010-fork.md) | A fork is cut from the checkpoint history | accepted | 2026-10-15 |
| [011](011-tools.md) | Tools run in golem's own node, inside the session folder | accepted | 2026-10-19 |

How the running code fits together is in [../architecture.md](../architecture.md).

New records use [template.md](template.md). Number the next file `012-….md` and add a row here.
