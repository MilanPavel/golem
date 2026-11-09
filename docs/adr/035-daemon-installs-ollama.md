# ADR-035: The daemon installs Ollama, Node, and uv, and checks a key before it stores it

**Date**: 2026-11-03
**Status**: accepted

## The idea

The setup window (step 1.9, [#343](https://github.com/MilanPavel/golem/issues/343), drawn in [the terminal app](../architecture/tui.md)) takes a new user from nothing to a model that answers. Two of its steps used to happen in the wrong place:

- **Installing Ollama.** The TUI ran `brew install ollama` itself, because the daemon runs under launchd with no `PATH` of the user's and no terminal (decision 4 of [#62](https://github.com/MilanPavel/golem/issues/62)). The browser can't run brew, so the web UI had no way to install Ollama, and two TUIs could each start their own install.
- **Checking an API key.** `auth.set` stored any key. A wrong one showed up only as a failed first message.

Both move into the daemon, and the setup screens read one call, `setup.status`.

## What the code does

- **`ollama.install`** (`golem/models/install.py`). The daemon runs `/opt/homebrew/bin/brew install ollama`, or a `brew` on its own `PATH`. It runs with Homebrew's and the system's folders on `PATH`, and with `HOMEBREW_NO_AUTO_UPDATE`, `HOMEBREW_NO_ANALYTICS`, `HOMEBREW_NO_ENV_HINTS`, and `NONINTERACTIVE` set, so it does one thing and never asks. Only one install runs at a time, and a second call answers `started: false` and shares the first one's output. The output goes to every connection as `ollama.install.output`, and the end as `ollama.install.done` (`installed`, `failed` with brew's last line, or `stopped`). Neither is stored, as with `model.pull.progress`. The install keeps going when the client that asked closes. `ollama.install_cancel` stops it. When there is no Homebrew, the call fails with `-32016` and `data.no_brew`, and the client offers the download page.
- **`runtime.install`** (added in step 1.12, [#485](https://github.com/MilanPavel/golem/issues/485)). MCP servers run with `npx` or `uvx`, so a new user without Node or uv could not use most of them. `BrewInstaller` is the same installer for any formula, and `runtime.install {name}` runs it for `node` or `uv` only: the two names are a closed list in `golem/models/install.py`, and the parameter is a literal, so a page cannot ask brew to install anything else. It streams `runtime.install.output {name, text}`, ends with `runtime.install.done {name, ok, error?}`, and `runtime.install_cancel {name}` stops it. Docker is never installed: the hint points to Docker Desktop or OrbStack. A missing brew fails the way `ollama.install` does.
- **`ollama.start`** starts the local Ollama now, the way a model call would ([ADR-026](026-local-model-server.md)).
- **`auth.set` checks first.** For a model provider, the daemon lists the provider's models with the new key (`ModelDiscovery.check_key`). OpenRouter lists its models to anyone, so it asks `/key` too. A 401 or 403 fails with `-32014` and the provider's own reason, such as `anthropic rejected the key (401 · invalid x-api-key)`. No network, or another answer, fails with `-32015`. In both cases nothing is stored, so a working key is never replaced by a broken one. A good key's list is kept for `model.list`, and the result says how many models it opens. `check: false`, and `golem auth set <provider> --no-check`, store a key without asking, for a machine that is offline.
- **`setup.status`** returns the checks `golem doctor` makes (`golem/doctor.py`), each with a `part` (service, engine, model, tools, …), and an `action` a setup screen can offer in place of the command to type: `install_ollama`, `start_ollama`, `pick_model`, `set_key`, or `edit_config`. With no model chosen yet, it also says what could think: the local Ollama, and every provider with a stored key. `golem doctor` prints the same checks and ends with `Next:` and the first fix.

## Other shapes that lost

**Keep brew in the TUI, and have the web UI show a command.** Each client would install in its own way, and the web UI would send a new user to a terminal for a step the daemon can do. Two windows could also run two installs at once.

**Run brew through `launchctl asuser` or a login shell, to get the user's `PATH`.** It reads the user's shell files, which can print, prompt, or fail. Homebrew's own path is fixed on Apple silicon, so the absolute path is simpler and does the same.

**Check a key by sending it a one-token message.** It costs money on some providers, needs a model name before the user has picked one, and is slower. Listing models is free, needs no model, and also fills the picker.

**Store the key, then check it.** A wrong key would replace a working one until the user noticed.

## What it costs

- brew runs as the user, so it installs into the user's Homebrew. A Homebrew that wants a password, or is owned by another user, fails, and the band shows brew's last line.
- A key can't be saved offline without `--no-check`.
- Adding a provider means knowing how to ask it about a key. A provider whose model list needs no key, as OpenRouter's, needs its own question.
- `setup.status` runs the doctor checks in a thread on every call. They touch launchd, the disk, and Ollama's local port, which takes a few tens of milliseconds. A setup screen calls it when it opens and when the user asks again, not on a timer.
