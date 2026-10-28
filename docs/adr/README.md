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
| [012](012-permission-rules.md) | Tool rules: first match wins, and a project cannot allow itself | accepted | 2026-10-19 |
| [013](013-approvals.md) | An approval is an interrupt, and the waiting run has no task | accepted | 2026-10-19 |
| [014](014-shell-sandbox.md) | The shell runs under sandbox-exec, or not at all | accepted | 2026-10-19 |
| [015](015-write-tools.md) | A file change is planned, shown as a diff, and applied only as shown | accepted | 2026-10-20 |
| [016](016-artifacts.md) | Big tool output is an artifact in golem.db, and the model reads it in pages | accepted | 2026-10-20 |
| [017](017-web-fetch.md) | web_fetch asks per host, refuses private addresses, and returns data | accepted | 2026-10-20 |
| [018](018-tool-state-updates.md) | A tool returns a state update, and the node applies only the keys it allows | accepted | 2026-10-20 |
| [019](019-single-binary.md) | The `golem` command is one bun binary | accepted | 2026-10-20 |
| [020](020-safe-upgrades.md) | An upgrade copies a database first, and a newer one is refused with a way back | accepted | 2026-10-21 |
| [021](021-release-signing.md) | Releases are signed with one self-signed certificate, and published only after a clean runner checks them | accepted | 2026-10-21 |
| [022](022-homebrew-tap.md) | Homebrew installs the signed release unchanged, from a tap the release workflow keeps up to date | accepted | 2026-10-22 |
| [023](023-mcp-client.md) | MCP servers run under golem's own small client, and their tools ask first | accepted | 2026-10-23 |
| [024](024-commits-prs-releases.md) | Conventional commits reach main as squashed pull requests, and git-cliff turns them into the release notes | accepted | 2026-10-23 |
| [025](025-skill-sources.md) | Skills come from the project, then the user, then golem, and a broken one never wins a name | accepted | 2026-10-25 |
| [026](026-local-model-server.md) | golem starts a local Ollama when it needs one, and stops only the one it started | accepted | 2026-10-27 |
| [027](027-terminal-tab-status.md) | The tab shows golem's state with escape sequences, and iTerm2 gets its own | accepted | 2026-10-28 |

How the running code fits together is in [../architecture.md](../architecture.md).

New records use [template.md](template.md). Number the next file `028-….md` and add a row here.
