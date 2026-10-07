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

How the running code fits together is in [../architecture.md](../architecture.md).

New records use [template.md](template.md). Number the next file `006-….md` and add a row here.
