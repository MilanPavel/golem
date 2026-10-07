# golem

<p align="center">
  <img src="docs/golem-logo.jpg" alt="golem" width="220">
</p>

Golem is a personal agent that works for you. You hand it a task, of any kind, and it carries the work through: a question, a chore, a job that takes all day. It keeps going when you step away, and it asks before it does something that matters.

It is meant to get better at the work you give it. What it learns from one task should make the next one easier.

The name comes from the Prague legend. A clay servant, brought to life to work on its maker's behalf.

See [docs/architecture.md](docs/architecture.md) for the architecture, [docs/monorepo.md](docs/monorepo.md) for the Python and TypeScript workspace setup, and [docs/plan.md](docs/plan.md) for the phased plan.

## Run the daemon

There is no chat yet. Phase 1 connects a client to the daemon and reconnects after a crash. Sending a message is Phase 2.

From the repository, after `uv sync --all-packages` and `pnpm install`:

```bash
just golem daemon install   # write ~/Library/LaunchAgents/dev.golem.daemon.plist and load it
just golem daemon start     # start it if it is stopped
just golem status           # pid, version, protocol, uptime; exits 1 if nothing is listening
just tui                    # one line: connected, or reconnecting. Ctrl-C quits the TUI only
just golem daemon logs      # ~/.golem/logs/golem.jsonl
just golem daemon stop      # unload the job so it stays down
```

`install` is macOS only. It records this checkout's virtualenv, so run it again if you move the repo. `uv run python -m golem serve` runs the same process in the foreground, without launchd.

To see a restart: run `just tui`, then kill the pid from `just golem status`. Do not use `stop`. The line switches to `reconnecting`. launchd starts the daemon again, and the line returns to `connected`. `stop` unloads the job, so launchd will not bring it back.
