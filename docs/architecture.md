# Architecture

## The system on one machine

Everything runs on your machine, except the model when you pick a remote provider. There are two kinds of process: one daemon, and any number of clients.

<SystemMap />

What talks to what, and how:

- **Client to daemon.** A Unix socket file. Each line is one JSON-RPC 2.0 object. No network port is opened.
- **Inside the daemon.** Ordinary Python calls in one asyncio process. A run is an asyncio task. The graph is a library the session manager calls. It is not a second process.
- **Daemon to model.** HTTPS to Anthropic, OpenAI, or another hosted provider, or plain HTTP to Ollama's native API. The model router resolves each session's model name to one of them.
- **Daemon to disk.** SQLite files under `~/.golem`. `checkpoints.db` is written by LangGraph's SQLite checkpointer. `golem.db` is ours: the event log and the session and run tables, through one `aiosqlite` connection.
- **Who starts what.** launchd starts the daemon at login and again after a crash. You start the clients. When no daemon answers and there is no launch agent, the TUI's setup window asks once whether to install it, or to run a daemon only while the terminal is open ([ADR-036](adr/036-setup-window-asks-for-the-service.md)). `golem web` asks the same in plain lines before it opens the browser ([ADR-033](adr/033-golem-offers-to-start-the-service.md)).

## Where to go next

- Start with [The agent loop](architecture/agent-loop.md), chapter 1, and follow the Next links.
- The choice behind each part is an ADR in [Decisions](adr/README.md).
- How the Python and TypeScript trees share one repository is in [The monorepo](monorepo.md).
- Every setting in `config.toml` is in [Settings](guide/settings.md).
