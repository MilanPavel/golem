# golem's docs

These files are the source of golem's docs site (Phase 11 of the [roadmap](roadmap.md), [ADR-034](adr/034-docs-site.md)). On GitHub, this page is the map. On the site, the same map is the side menu.

A page with a ticket number is planned and not written yet.

## Get started

For someone who wants to use golem today.

| Page | File | Ticket |
|---|---|---|
| Introduction: why golem, how it works | [guide/introduction.md](guide/introduction.md) | |
| Install, upgrade, remove | [install.md](install.md) | |
| First chat | [guide/first-chat.md](guide/first-chat.md) | |

## Use golem

| Page | File | Ticket |
|---|---|---|
| Models and API keys | [guide/models.md](guide/models.md) | |
| Commands, in the shell and in the chat | [guide/commands.md](guide/commands.md) | |
| Tools and permissions | [guide/permissions.md](guide/permissions.md) | |
| MCP servers | [guide/mcp.md](guide/mcp.md) | |
| Skills | [guide/skills.md](guide/skills.md) | |
| The web UI | [guide/web.md](guide/web.md) | |
| Settings: every key in `config.toml` | [guide/settings.md](guide/settings.md) | |

## How golem works

golem's architecture, one idea per chapter. Each chapter explains an idea that most agents share, then how golem builds it, and ends with golem's details for contributors. Every chapter follows [architecture/_template.md](architecture/_template.md). Read them in order. [architecture.md](architecture.md) is the overview: the whole system on one page, and one message followed end to end.

| Chapter | File | Ticket |
|---|---|---|
| Overview, and one message end to end | [architecture.md](architecture.md) | [#292](https://github.com/MilanPavel/golem/issues/292) |
| The agent loop | [architecture/agent-loop.md](architecture/agent-loop.md) | |
| Talking to models | [architecture/models.md](architecture/models.md) | |
| The daemon | [architecture/daemon.md](architecture/daemon.md) | |
| The protocol | [architecture/protocol.md](architecture/protocol.md) | |
| Sessions | [architecture/sessions.md](architecture/sessions.md) | |
| Tools | [architecture/tools.md](architecture/tools.md) | |
| Permissions | [architecture/permissions.md](architecture/permissions.md) | |
| Sandboxes | [architecture/sandboxes.md](architecture/sandboxes.md) | |
| Context | [architecture/context.md](architecture/context.md) | |
| Skills | [architecture/skills.md](architecture/skills.md) | |
| MCP | [architecture/mcp.md](architecture/mcp.md) | |
| The terminal app | [architecture/tui.md](architecture/tui.md) | |
| The web UI | [architecture/web.md](architecture/web.md) | |
| Tracing | [architecture/tracing.md](architecture/tracing.md) | |
| What comes next | `architecture/whats-next.md` | [#291](https://github.com/MilanPavel/golem/issues/291) |

## Build golem

For someone who wants to change golem.

| Page | File | Ticket |
|---|---|---|
| Settings, the reference | `settings.md` | [#292](https://github.com/MilanPavel/golem/issues/292) |
| The monorepo | [monorepo.md](monorepo.md) | |
| Hacking: set up, run, ship | [contributing/hacking.md](contributing/hacking.md) | |
| Contributing | [contributing/index.md](contributing/index.md), which includes [CONTRIBUTING.md](../CONTRIBUTING.md) | |
| Building, releasing, and running | [ops/build.md](ops/build.md), [ops/release.md](ops/release.md), [ops/run.md](ops/run.md), split into pages | [#296](https://github.com/MilanPavel/golem/issues/296) |
| The web UI's design | [design/web.md](design/web.md) | |

## Project

| Page | File | Ticket |
|---|---|---|
| The vision | [vision.md](vision.md) | |
| The roadmap | [roadmap.md](roadmap.md) | |
| Decisions (ADRs), by topic | [adr/README.md](adr/README.md) | [#295](https://github.com/MilanPavel/golem/issues/295) |

## Not pages

- `architecture/_template.md`: the shape of a "How golem works" chapter.
- `adr/template.md`: the shape of an ADR.
- `design/prototype.html`: the web UI's prototype. Open it in a browser.
- `images/`: the pictures the pages use.
- `README.md`: this map. The site's home page is `index.md`, from [#274](https://github.com/MilanPavel/golem/issues/274).
