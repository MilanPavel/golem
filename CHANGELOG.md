# Changelog

What changed in each release of golem, newest first. `just release` writes each section from the commit messages on `main` ([CONTRIBUTING.md](CONTRIBUTING.md)), and the release pull request is the place to edit it. The GitHub release shows the same section. How a release is made is in [docs/sre.md](docs/sre.md), section 5.

## [0.2.0] - 2026-10-24

### Features

- **release:** when signing settings are missing, say which ones and where they belong
- **cli:** golem doctor checks the install and says how to fix each problem
- **mcp:** golem runs stdio MCP servers from config.toml
- **mcp:** servers per session or project, restarts, HTTP and Keychain tokens, and a /mcp manager
- **ci:** conventional commits, checked by a commit-msg hook
- **ci:** pull requests, a PR template, and a ruleset on main ([#1](https://github.com/MilanPavel/golem/pull/1))
- **release:** CHANGELOG.md and release notes from the commits, with … ([#2](https://github.com/MilanPavel/golem/pull/2))

### Fixes

- **mcp:** the launch test finds sh in /bin first, so it passes on Linux too

### Docs

- a step-by-step guide for installing golem with Homebrew, from setup to the first chat
- a shorter, friendlier front page: the pixel golem, the legend in an old typeface, and brew install first

## [0.1.0] - 2026-10-22

The first release: a daemon that keeps your chats running, and a chat screen in the terminal that attaches to it.

### Features

- **daemon:** one daemon per user on a Unix socket, kept running by launchd. Every session event is stored in golem.db, and a chat's context survives a restart.
- **tui:** a full-terminal chat with streamed answers. Several screens can follow one chat, and a reopened screen catches up on what it missed.
- **sessions:** named sessions, `/sessions`, `/new`, `/title`, `/fork`, closing a session, and filtering the list by typing.
- **tui:** stop an answer with Ctrl-C and keep what it wrote, edit and recall messages, copy an answer, export a chat, and a `/debug` panel.
- **models:** named profiles, Ollama and hosted providers, a `/model` picker that can switch mid-conversation, and downloading and removing Ollama models.
- **secrets:** API keys in the macOS Keychain, with `golem auth` and `/login`.
- **tools:** read, list, glob, and grep inside the session folder; `write_file` and `edit_file` with a diff to approve; a sandboxed shell; `web_fetch` with host rules.
- **tools:** a permission engine with allow, ask, and deny rules, approvals that wait across a restart, and big tool output kept as artifacts.
- **tui:** a todo band above the composer, and `/todos`.
- **install:** one signed `golem` command, safe upgrades that copy the databases first, `golem daemon install | restart | uninstall`, and `brew install` from a tap.
- **release:** a version tag builds, signs, and checks golem on a clean Mac, then publishes it.
