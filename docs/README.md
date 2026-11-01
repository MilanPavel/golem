# golem's docs

These files are the source of golem's docs site (Phase 11 of [plan.md](plan.md), [ADR-034](adr/034-docs-site.md)). On GitHub, this page is the map. On the site, the same map is the side menu.

A page with a ticket number is planned and not written yet.

## Get started

For someone who wants to use golem today.

| Page | File | Ticket |
|---|---|---|
| Introduction: why golem, how it works | `guide/introduction.md` | [#277](https://github.com/MilanPavel/golem/issues/277) |
| Install, upgrade, remove | [install.md](install.md) | [#277](https://github.com/MilanPavel/golem/issues/277) |
| First chat | `guide/first-chat.md` | [#277](https://github.com/MilanPavel/golem/issues/277) |

## Use golem

| Page | File | Ticket |
|---|---|---|
| Models and API keys | `guide/models.md` | [#278](https://github.com/MilanPavel/golem/issues/278) |
| Commands, in the shell and in the chat | `guide/commands.md` | [#278](https://github.com/MilanPavel/golem/issues/278) |
| Tools and permissions | `guide/permissions.md` | [#279](https://github.com/MilanPavel/golem/issues/279) |
| MCP servers | `guide/mcp.md` | [#279](https://github.com/MilanPavel/golem/issues/279) |
| Skills | `guide/skills.md` | [#279](https://github.com/MilanPavel/golem/issues/279) |
| The web UI | `guide/web.md` | [#279](https://github.com/MilanPavel/golem/issues/279) |

## How agents work

Each page explains one idea that most agents share, and then how golem builds it. Every page follows [concepts/_template.md](concepts/_template.md). Read them in order.

| # | Page | File | Ticket |
|---|---|---|---|
| 1 | What an agent is: the loop | `concepts/agent-loop.md` | [#283](https://github.com/MilanPavel/golem/issues/283) |
| 2 | Talking to models | `concepts/models.md` | [#284](https://github.com/MilanPavel/golem/issues/284) |
| 3 | Tools and tool calling | `concepts/tools.md` | [#285](https://github.com/MilanPavel/golem/issues/285) |
| 4 | Safety: permissions, approvals, sandboxes | `concepts/safety.md` | [#286](https://github.com/MilanPavel/golem/issues/286) |
| 5 | Context: the system prompt and skills | `concepts/context.md` | [#287](https://github.com/MilanPavel/golem/issues/287) |
| 6 | MCP: tools from outside | `concepts/mcp.md` | [#288](https://github.com/MilanPavel/golem/issues/288) |
| 7 | Sessions that survive | `concepts/durable-sessions.md` | [#289](https://github.com/MilanPavel/golem/issues/289) |
| 8 | The agent and its screens | `concepts/agent-and-screens.md` | [#290](https://github.com/MilanPavel/golem/issues/290) |
| 9 | What comes next | `concepts/whats-next.md` | [#291](https://github.com/MilanPavel/golem/issues/291) |

## Build golem

For someone who wants to change golem.

| Page | File | Ticket |
|---|---|---|
| Architecture tour: one message, end to end | `contributing/architecture-tour.md` | [#292](https://github.com/MilanPavel/golem/issues/292) |
| Architecture, the reference | [architecture.md](architecture.md) | |
| The monorepo | [monorepo.md](monorepo.md) | |
| Hacking: set up, run, ship | `contributing/hacking.md` | [#294](https://github.com/MilanPavel/golem/issues/294) |
| Contributing | `contributing/index.md`, from [CONTRIBUTING.md](../CONTRIBUTING.md) | [#294](https://github.com/MilanPavel/golem/issues/294) |
| Building, releasing, and running | [sre.md](sre.md), split into pages | [#296](https://github.com/MilanPavel/golem/issues/296) |
| The web UI's design | [design/web.md](design/web.md) | |

## Project

| Page | File | Ticket |
|---|---|---|
| The vision | [vision.md](vision.md) | |
| The plan | [plan.md](plan.md) | |
| Decisions (ADRs), by topic | [adr/README.md](adr/README.md) | [#295](https://github.com/MilanPavel/golem/issues/295) |

## Not pages

- `concepts/_template.md`: the shape of a concept page.
- `adr/template.md`: the shape of an ADR.
- `design/prototype.html`: the web UI's prototype. Open it in a browser.
- `images/`: the pictures the pages use.
- `README.md`: this map. The site's home page is `index.md`, from [#274](https://github.com/MilanPavel/golem/issues/274).
