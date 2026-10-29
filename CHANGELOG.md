# Changelog

What changed in each release of golem, newest first. `just release` writes each section from the commit messages on `main` ([CONTRIBUTING.md](CONTRIBUTING.md)), and the release pull request is the place to edit it. The GitHub release shows the same section. How a release is made is in [docs/sre.md](docs/sre.md), section 5.

## [0.4.0] - 2026-10-29

### Features

- **tui:** the composer has a ❯ prompt between two thin rules, and a placeholder ([#132](https://github.com/MilanPavel/golem/pull/132))
- **tui:** short hints such as copied or Ctrl-C again to exit show on the right and go away ([#133](https://github.com/MilanPavel/golem/pull/133))
- **tui:** copies say how many characters, and over SSH they ask the terminal to copy ([#138](https://github.com/MilanPavel/golem/pull/138))
- **tui:** drag over the chat to select text, and it is copied when you let go ([#142](https://github.com/MilanPavel/golem/pull/142))
- **tui:** a long paste shows as [Pasted text #N +M lines] in the input, and sends in full ([#143](https://github.com/MilanPavel/golem/pull/143))
- **tui:** Up and Down move between the rows of a multiline draft ([#144](https://github.com/MilanPavel/golem/pull/144))

### Fixes

- **tui:** the install question goes away once Ollama answers, and stays out of the model picker ([#129](https://github.com/MilanPavel/golem/pull/129))

## [0.3.0] - 2026-10-28

### Features

- **install:** scripts/setup.sh, just setup, and a /setup skill for a fresh checkout ([#19](https://github.com/MilanPavel/golem/pull/19))
- **ci:** a /ship skill that opens a pull request, and skills in .agents/skills for any agent ([#20](https://github.com/MilanPavel/golem/pull/20))
- **skills:** find, list, and check skills, and reload them without a restart ([#55](https://github.com/MilanPavel/golem/pull/55))
- **protocol:** run.failed says which model server did not answer, and how to fix it ([#67](https://github.com/MilanPavel/golem/pull/67))
- **models:** a model server that does not answer says how to start it ([#68](https://github.com/MilanPavel/golem/pull/68))
- **tui:** the banner and the status line say which model server is down ([#70](https://github.com/MilanPavel/golem/pull/70))
- **models:** golem can start and stop a local ollama serve ([#76](https://github.com/MilanPavel/golem/pull/76))
- **models:** golem starts a local Ollama when a model call, a download, or /model needs it ([#77](https://github.com/MilanPavel/golem/pull/77))
- **protocol:** golem status and model.server.status show who runs the local model server ([#78](https://github.com/MilanPavel/golem/pull/78))
- **tui:** the meter says starting ollama while golem starts it ([#79](https://github.com/MilanPavel/golem/pull/79))
- **daemon:** golem doctor no longer asks you to start Ollama, since golem starts it ([#111](https://github.com/MilanPavel/golem/pull/111))
- **protocol:** golem says when Ollama is not installed, not only that it is down ([#117](https://github.com/MilanPavel/golem/pull/117))
- **tui:** the TUI can run brew install ollama and show its output in a band ([#118](https://github.com/MilanPavel/golem/pull/118))
- **tui:** choosing a local model without Ollama offers to install it, then downloads the model ([#119](https://github.com/MilanPavel/golem/pull/119))
- **tui:** a message that fails because Ollama is missing offers to install it and send again ([#120](https://github.com/MilanPavel/golem/pull/120))
- **daemon:** golem doctor and the install guide point to /model to install Ollama ([#121](https://github.com/MilanPavel/golem/pull/121))
- **tui:** the terminal tab shows the session title and whether golem is working ([#125](https://github.com/MilanPavel/golem/pull/125))
- **tui:** terminals that show progress show it on the tab while a run works ([#126](https://github.com/MilanPavel/golem/pull/126))
- **tui:** iTerm2 tabs show a coloured dot and the state ([#127](https://github.com/MilanPavel/golem/pull/127))

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
