# Architecture

<img src="images/map.jpg" alt="A pen-and-ink study of the clay golem inscribed in a circle and a square, arms in two positions" width="280" align="left" hspace="20" vspace="4">

*First the body, set in a circle and a square. The street, the socket, and the screen are built around that figure.*

Golem is one long-running program, and several clients that attach to it. This file explains those pieces in plain words: the daemon, the clients, the protocol between them, the screen, and where the data lives.

The choice behind each piece is in [adr/](adr/README.md). How the Python and TypeScript trees share one repository is in [monorepo.md](monorepo.md).

This file is becoming the overview of "How golem works". Each part below moves to its own chapter in `docs/architecture/`: the idea in agents generally, how golem builds it, and these details. A part that has moved leaves a link here.

<br clear="left">

## The short version

The **daemon** is the process that does the work. It keeps running after you close a terminal. Chats, tool calls, and long flows live there. The model is only ever called from the daemon.

A **client** attaches to that work. The TUI and the `golem` command are clients today. A timer or a file watch will be one later. A client connects, sends commands, and draws the events it receives. It does not hold the model's memory. The screen itself is [The terminal app](architecture/tui.md). The choices behind it are in [ADR-005](adr/005-client-package.md).

The **protocol** is the only language between them. The daemon is Python. The clients are TypeScript. They do not share objects. They share message shapes, written once and generated for both sides.

## The system on one machine

Everything runs on your machine, except the model when you pick a remote provider. There are two kinds of process: one daemon, and any number of clients.

<SystemMap />

What talks to what, and how:

- **Client to daemon.** A Unix socket file. Each line is one JSON-RPC 2.0 object. No network port is opened.
- **Inside the daemon.** Ordinary Python calls in one asyncio process. A run is an asyncio task. The graph is a library the session manager calls. It is not a second process.
- **Daemon to model.** HTTPS to Anthropic, OpenAI, or a hosted OpenAI-compatible API such as OpenRouter, or plain HTTP to Ollama's native API or a local OpenAI-compatible server. The model router resolves each session's model name to one of them.
- **Daemon to disk.** SQLite files under `~/.golem`. `checkpoints.db` is written by LangGraph's SQLite checkpointer. `golem.db` is ours: the event log and the session and run tables, through one `aiosqlite` connection.
- **Who starts what.** launchd starts the daemon at login and again after a crash. You start the clients. When no daemon answers and there is no launch agent, the TUI's setup window asks once whether to install it, or to run a daemon only while the terminal is open ([ADR-036](adr/036-setup-window-asks-for-the-service.md)). `golem web` asks the same in plain lines before it opens the browser ([ADR-033](adr/033-golem-offers-to-start-the-service.md)).

## The daemon

<img src="images/daemon.jpg" alt="The golem walks the lanes of old Prague at night with a lantern while the rabbi stays at his window" width="280" align="left" hspace="20" vspace="4">

*Like the golem of Prague, the daemon keeps working through the night while its master is away.*

The daemon's process, its socket and lock, and what it owns are in [The daemon](architecture/daemon.md).

<br clear="left">

### One turn

One turn, the graph, its messages, failures and the cap, the folder, and models without tools are in [The agent loop](architecture/agent-loop.md#the-details).

The system prompt, built for each call and never stored, is in [Context](architecture/context.md#the-system-prompt). Tool events, long output and artifacts, and todos are in [Tools](architecture/tools.md#the-details).

A run with no window, a cancel, and a crash are in [Sessions that survive](architecture/sessions.md#the-details).

The shell sandbox, the git tools, and the file tools' folders are in [Sandboxes](architecture/sandboxes.md#the-details).

`write_file` and `edit_file`, `web_fetch`, and the shell's output and timeout are in [Tools](architecture/tools.md#the-details).

Approvals, from the pause to the resume, are in [Permissions](architecture/permissions.md#approvals).

### Files on disk

The files under `~/.golem`, the event log, and migrations and backups are in [Sessions that survive](architecture/sessions.md#files-on-disk).

### Settings

Settings come from three places. Each one overrides the one before it: `~/.golem/config.toml`, then `<project>/.golem/config.toml`, then `GOLEM_…` environment variables. An explicit `log_level` passed to `load_settings` wins over all three. The keys read today:

- `log_level`: `DEBUG`, `INFO`, `WARNING`, or `ERROR`. Environment: `GOLEM_LOG_LEVEL`.
- `default_model`: a profile name or a `provider/model` ref. New sessions store it as their `model_profile`. Defaults to the flat settings' profile when those are set, and to none otherwise. A session made with none stores `remote` and uses the default once one is chosen. Sending with no model fails with `model_not_configured` and `no model chosen yet`.
- `[models.<name>]`: a profile with `model` (a ref) and optional `ctx`, which the `ollama` provider sends as `num_ctx`.
- `[providers.<name>]`: `kind`, `base_url`, and `api_key_env`. Built-in presets are `anthropic`, `openai`, `ollama` (native API), `openrouter`, `groq`, `together`, and `lmstudio`. A new name is `openai_compat` and needs `base_url`.
- `model_profile`, `model_provider`, `model_name`, `model_base_url`: the flat settings from before profiles. They load as one profile named `model_profile` (`remote` when unset), so stored sessions keep resolving. An empty or Ollama `model_base_url` maps to the `ollama` provider.
- `[ollama]`: `start` (default `true`) lets the daemon run `ollama serve` when a local model is needed and nothing answers. `idle_stop_minutes` (default 30, 0 never) stops a server it started after that long unused.
- `session_titles`: default `true`. Name each session after its first completed run with one model call. Environment: `GOLEM_SESSION_TITLES`.
- `[[rule]]`: a tool rule with `tool` (a glob on the tool name, default `*`), optional `match` (a glob on the tool's subject, such as a `grep` or `glob` pattern, with `|` between alternatives), optional `path` (a glob on the resolved path the call touches), and `action`: `allow`, `ask`, or `deny`.
- `trusted_projects`: folders whose `.golem/policy.toml` may allow tools.
- `[shell]`: `network` (default `false`) lets commands use the network, `writable` adds folders they may write to, and `timeout_seconds` (default 120) is the longest a command runs. Only the user's file sets these; a project file cannot.
- `[web]`: `allow_private` (default `false`) lets `web_fetch` reach loopback, private, and link-local addresses, `max_bytes` (default 5 000 000) is the most of a page it reads, and `timeout_seconds` (default 20) the longest a whole fetch takes. A redirect to another host is not followed: the model gets the new URL and asks again. Only the user's file sets these.
- `[skills]`: `disabled` (names listed but never used), `claude_dirs` (default `true`, read both `.claude/skills` folders), and `extra_dirs` (more folders of skills, after the user's own). Only the user's file sets these, and the daemon reads them again when the file changes ([ADR-025](adr/025-skill-sources.md)).
- `[mcp.<name>]`: an MCP server. A stdio one has `command`, optional `args`, `env`, and `cwd`. An HTTP one has `url` and optional `headers`. A value in `env` or `headers` may name `keychain:mcp/<name>`, and a name that looks like a secret must. `enabled` is `true` (default), `"on_demand"`, or `false`, and `timeout_seconds` (default 120) bounds one tool call. The name may use letters, digits, and `-`. The daemon reads the user's file and, for sessions in a folder in `trusted_projects`, the project's `.golem/config.toml`, again whenever they change ([ADR-023](adr/023-mcp-client.md)).

The order tool rules are checked in, and what a rule matches, are in [Permissions](architecture/permissions.md#the-details).

API keys, the Keychain, and how the router finds a key are in [Talking to models](architecture/models.md#the-router-and-keys).

Each log record is written twice: a short line on stderr, and a JSON line in `logs/golem.jsonl`.

## Skills

Skills, from finding and listing them to running one by name, are in [Skills](architecture/skills.md). Pinned skills, and the system prompt they go into, are in [Context](architecture/context.md).

## The protocol

<img src="images/protocol.jpg" alt="The rabbi slides a scroll marked with JSON braces into the slot in the golem's chest" width="280" align="left" hspace="20" vspace="4">

*In the legend, the golem obeyed only what was written on the shem, the scroll in its chest. The daemon is the same: it acts only on messages in the agreed shape.*

The protocol, from `hello` to what is on the wire, is in [The protocol](architecture/protocol.md).

<br clear="left">

## The TUI

<img src="images/tui.jpg" alt="The rabbi paints a dark mark onto the golem's chest with a brush and palette" width="280" align="left" hspace="20" vspace="4">

*The body is already standing. The brush is still laying on the mark.*

The TUI, from the keys to the screen, what the screen keeps, and the shared client are in [The terminal app](architecture/tui.md).

<br clear="left">
