---
title: Hacking on golem
description: Set up a checkout, run golem from it, the everyday commands, and how a change gets to main.
---

# Hacking on golem

![Half clay, half code: the golem stands across a torn page, parchment sketch on the left and falling green code on the right](../images/hacking.svg)

golem is a Python daemon and TypeScript screens in one repository. From a checkout, `just golem` runs the same CLI as `golem`. [The monorepo](../monorepo.md) explains how the two sides fit together.

## What you need

| Tool | Install |
|---|---|
| [uv](https://docs.astral.sh/uv/) | `brew install uv`. It also installs Python 3.12 |
| Node.js 24 | `brew install node` |
| [bun](https://bun.sh) 1.3 | `brew install oven-sh/bun/bun` |
| pnpm 10 | `corepack enable` |
| [just](https://just.systems) | `brew install just` |
| [gh](https://cli.github.com) | `brew install gh`. Only to open pull requests and to release |

## Get the code

```bash
git clone https://github.com/MilanPavel/golem.git && cd golem
claude
> /setup
```

`/setup` checks your tools against the versions CI uses, and says how to fix anything missing. It asks before it installs anything. Then it installs the packages and the git hooks, and can run `just check` at the end. Run it again at any time; it only does what is missing.

The skills are in `.agents/skills/`, so other coding agents that read Agent Skills find them too. [AGENTS.md](../../AGENTS.md) lists them.

### Without an agent

The skill runs a plain script, so you get the same result without it:

```bash
scripts/setup.sh            # check the tools, install the packages and the hooks
scripts/setup.sh --install  # also brew install the tools that are missing
scripts/setup.sh --check    # also run just check at the end
```

### By hand

Once the tools are in place, the script does these steps:

```bash
uv sync --all-packages      # Python packages and dev tools
pnpm install                # TypeScript packages
just hooks                  # check commit messages before each commit
just check                  # lint, typecheck, and tests
```

## Run it

1. Start the daemon, in a terminal with `uv run python -m golem serve`, or in the background with `just golem daemon install`.
2. Open the chat with `just golem`, or `just tui` to open it in the folder you are in.

- **One daemon at a time.** Only one daemon runs per `~/.golem`, so uninstall a Homebrew one first with `golem daemon uninstall`.
- **A throwaway home.** Set `GOLEM_HOME` to another folder to try things without touching your own chats and settings.
- **The Keychain asks once.** From a checkout, the Keychain trusts uv's shared Python rather than golem itself, so macOS asks once to allow it. A Homebrew golem is signed, so its trust carries over across upgrades.

## Everyday commands

`just` lists every recipe. These are the ones you use most:

| Command | What it does |
|---|---|
| `just check` | Lint, typecheck, tests, and the docs build. This is what CI runs |
| `just test` | Just the tests |
| `just lint`, `just fmt` | Check the formatting and lint, or fix them |
| `just gen` | Regenerates the TypeScript protocol types from Python. Run it after a change to the protocol models |
| `just docs` | Serves this site locally, reloading as you edit |
| `just dist` | Builds a standalone golem into `dist/` |
| `just smoke-dist` | Starts that build against a fake model and checks one chat |

[Building, releasing, and running](../sre.md) has the rest: signing, releases, and CI.

## Ship a change

Changes reach `main` only through a pull request, merged by a person. In Claude Code, `/ship` takes your changes there:

1. It reviews the diff and runs `just check`.
2. It writes the commit message and fills in the PR template.
3. It asks you before it commits and pushes.

It stops at the PR link. You review and merge it on GitHub. Without an agent, [Contributing](./index.md) has the same rules: how to write the commit message, the PR, and an ADR.

## Next

- [Architecture](../architecture.md): how the daemon, the protocol, and the screens fit together.
- [Decisions](../adr/README.md): why things are built the way they are. A non-obvious choice gets a new one.
- [The roadmap](../roadmap.md): what comes next.
