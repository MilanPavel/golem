# ADR-053: `golem` opens the web UI, and `golem tui` opens the terminal chat

**Date**: 2026-11-14
**Status**: accepted
**Deciders**: Milan Pavel

## Context

Bare `golem` opens the terminal chat ([ADR-019](019-single-binary.md)). `golem web` opens the web UI ([ADR-028](028-web-gateway.md)). The web UI is now the main surface, so it should be the default command.

Installed launchd plists run `<golem> web serve` at every login, so `golem web` has to keep working.

## Decision

| Command | Does |
|---|---|
| `golem`, `golem --port N`, `golem --no-open`, `golem --json` | Opens the web UI, as `golem web` did |
| `golem tui` | Opens the terminal chat |
| `golem web` | Stays. It is a permanent alias of `golem` |
| `golem web serve\|install\|uninstall\|logout` | Unchanged |

- `--help`, `-h` and `--version` still come first.
- The name is `tui` because it is short and matches `packages/tui`. `golem code` was rejected: it reads as a coding agent.
- When bare `golem` opens the browser, it prints one line on stderr: `Chat in the terminal: golem tui`. It does not print it with `--json` or `--no-open`.
- With `SSH_CONNECTION` set, bare `golem` and `golem web` act as if `--no-open` was given. Only bare `golem` prints the hint. A browser cannot open over SSH, so the link prints straight away.
- The first run asks about the service in the terminal ([ADR-033](033-golem-offers-to-start-the-service.md)), then the browser shows `/welcome`. The setup window now belongs to `golem tui` and `/setup`.
- Text that tells a person to run `golem` for the terminal chat now says `golem tui`. This includes hints the daemon prints. The daemon and the CLI ship in one brew archive, so a version skew lasts only until the daemon restarts.

## Alternatives Considered

### Alternative 1: Keep the terminal chat as the default

- **Pros**: no change for anyone.
- **Cons**: the main surface needs a longer command.
- **Why not**: the web UI is where new users start.

### Alternative 2: `golem code` for the terminal chat

- **Pros**: reads as a verb.
- **Cons**: suggests a coding agent, which golem is not only.
- **Why not**: `golem tui` says what it is.

### Alternative 3: Drop `golem web`

- **Pros**: one way to do it.
- **Cons**: breaks the launchd plists already installed, and old docs.
- **Why not**: `web serve` must keep working, and the alias costs nothing.

## Consequences

### Positive

- The default command opens the main surface.
- Over SSH, `golem` just prints the link.
- No installed job needs to change.

### Negative

- Anyone used to bare `golem` for the terminal chat gets a browser. The hint line says what to type.
- Old ADRs and changelog entries still say `golem` for the terminal chat. They are history and are not rewritten.

### Risks

- A script that ran bare `golem` and expected a terminal UI now starts the gateway. That script was already interactive, so the risk is small.
