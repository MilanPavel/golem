---
title: Commands
description: Every golem command in the shell, every slash command in the chat, and the keys.
---

# Commands

golem has commands in two places: `golem …` in your shell, and `/…` inside the chat.

## In the shell

`golem --help` prints the short form of this table.

| Command | What it does |
|---|---|
| `golem` | Opens the chat in this folder |
| `golem --version` | Prints the version |
| `golem status` | Is the daemon up? Prints its pid, version, and uptime |
| `golem doctor` | Checks the whole install, and says how to fix each problem |
| `golem daemon install` / `uninstall` | Sets up or removes the background service. `~/.golem` stays |
| `golem daemon start` / `stop` / `restart` | Controls the daemon. `restart` after an upgrade |
| `golem daemon logs` | Follows the daemon's log |
| `golem auth set <provider>` / `remove <provider>` | Saves or deletes an API key, or an MCP token (`mcp/<name>`), in the Keychain. A model key is tried first; `--no-check` skips that |
| `golem mcp add --catalog <id>` | Adds a server from golem's list. It asks for a token, hidden, and keeps it in the Keychain. `--input <id>=<value>` fills an input and `--name` renames the server |
| `golem mcp add <name> -- <command…>` / `--url <url>` | Adds an MCP server to `config.toml` and starts it. `--token` (web) or `--token-env VAR` (command) asks for a token and keeps it in the Keychain. `--env K=V` and `--header K=V` (repeatable), `--cwd`, `--on-demand`, `--project`, `--timeout <seconds>`, and `--approval allow` set the rest. Once added, golem tests the server and says what to try if it fails |
| `golem mcp edit <name> [--project]` | Opens the server's tables in `$EDITOR`, and saves them only when the daemon accepts the text. An error shows its line, and you can edit again or discard |
| `golem mcp import [--from <app>\|<file>] [--all] [--project]` | Lists the servers in Claude Desktop, Claude Code, Cursor, VS Code, and Windsurf (or a JSON file) and adds the ones you pick. `--all` adds every new one. Tokens go to the Keychain |
| `golem mcp export` | Prints your servers as the `mcpServers` JSON of Claude Desktop, Claude Code, Cursor, or Windsurf. `--format vscode` gives VS Code's `servers`, and `--scope project` the project's. Secrets become `${MCP_…}` variables and are never printed |
| `golem mcp list [--json]` | Lists your MCP servers: state, tools, token cost, and marks such as `on demand`, `hidden N tools`, and `allow` |
| `golem mcp show <name> [--json]` | One server's command or URL, settings, and which secrets are stored. A secret's value is never shown |
| `golem mcp test <name>` / `--catalog <id>` | Starts the server, lists its tools, and pings it, printing each step. It exits 1 when the test fails and says what to try. With `--catalog`, it tests an entry from golem's list before you add it (`--input`, `--name` as for add) |
| `golem mcp logs <name> [-f]` | The server's recent log. `-f` follows new lines until Ctrl-C |
| `golem mcp enable <name> [--on-demand]` / `disable <name>` | Turns a server on for every chat, on for the chats that ask, or off. It applies at once |
| `golem mcp restart <name>` | Starts a server again now |
| `golem mcp tools <name> [--hide <glob>] [--show <glob>]` | Lists a server's tools with their token cost. `--hide` keeps tools matching a pattern from the model, and `--show` takes a pattern back out |
| `golem mcp remove <name>` | Removes the server from `config.toml`, stops it, and deletes its token |
| `golem auth list` | Which providers have a key |
| `golem models` | Every model you can use or download, with size, price, and context. `--refresh` asks the providers again |
| `golem config edit [--project]` | Opens `config.toml` (or the project's) in `$EDITOR`, and saves it only when the daemon accepts it. If a setting needs a restart, it offers one |
| `golem config show` | The settings and tool rules in effect for this folder. `--resolved` is accepted and prints the same |
| `golem skills` | The skills this folder sees, and why one is not used. `golem skills list` is the same |
| `golem skills check <path>` | Checks a skill, its `SKILL.md`, or a folder of skills. Needs no daemon |
| `golem web` | Serves the chat in your browser on 127.0.0.1, until Ctrl-C |

`golem web` takes three options:

- `--port N` serves on that port instead of 7480.
- `--no-open` prints the link instead of opening the browser. With no daemon running, it says what to run and exits 1.
- `--json` prints the link, the port, and the pid as JSON, for scripts, and opens no browser.

If `golem web` is already running, a second one reuses it. With no daemon, `golem` and `golem web` first ask to start golem's service.

## In the chat

Type `/` and suggestions appear, with each command's arguments. `/help` lists everything.

### Chats

| Command | What it does |
|---|---|
| `/sessions` | Switch between chats |
| `/new` | Start a new chat |
| `/fork` | Copy this chat up to its newest finished message, and continue in the copy |
| `/close` | Close this chat and open another |
| `/title [name]` | Show the title, or rename the chat |
| `/copy`, `/copy code` | Copy the last answer, or its last code block |
| `/export [path]` | Save this chat as markdown, in `~/.golem/exports/` unless you give a path |

### Models and keys

| Command | What it does |
|---|---|
| `/model` | Open the model picker |
| `/model <name>` | Switch this chat to a model or a profile |
| `/model pull <name>`, `/model rm <name>` | Download or remove a local model |
| `/tune` | Tune a local model: a slider and an explanation for each option, such as temperature and context size |
| `/login [provider]`, `/logout <provider>` | Add an API key, checked with the provider, or remove one |
| `/setup` | See what is set up and what is broken, fix it, or walk the setup steps again |

[Models and API keys](./models.md) has the details.

#### Tune a local model

`/tune` opens a panel with one row per option of the model this chat uses, a block slider for each, and what the focused option does under the rows. It is for local Ollama models. A hosted model says so and opens nothing.

| Key | What it does |
|---|---|
| Up, Down | Move between options |
| Left, Right | Change the focused value. Each change is sent at once |
| `r` | Reset the focused option to the model's default |
| `s` | Switch where changes go: saved for this model, or this chat only |
| `1`–`4` | Apply a preset to this chat: precise, balanced, creative, or long memory. Balanced clears this chat's changes |
| `S` | Save this chat's changes for the model |
| `t` | Ask your last question again with these settings. The answer shows under the panel, and the try is kept as its own chat. `t` again stops it |
| Esc | Close the panel |

A saved change is kept in `config.toml` for the model, and every chat on it uses it. A change for this chat only is kept with the chat. Either one applies from your next message. When a value is not the default, the row says what the default is.

### Tools, skills, and MCP

| Command | What it does |
|---|---|
| `/permissions` | Show the tool rules for this folder, and what this chat allows |
| `/artifact [id]` | Open the full output of a long tool call in your pager. With no id, the newest one |
| `/skills` | See the skills this folder has, and why one is or is not used |
| `/<skill> [args]` | Run a skill once |
| `/skill run <name> [args]` | Run a skill once, also one named like a command, such as `help` |
| `/skill pin <name>`, `/skill unpin <name>` | Keep a skill on for the whole chat, or turn it off |
| `/skill` | List the pinned skills |
| `/mcp` | Manage MCP servers: view and try tools, hide a tool, test, read the log, reconnect, turn on or off, remove |
| `/config [project]` | Open the config file: in the web UI, Settings → Config file (the project's file with `project`). In a terminal it says to run `golem config edit [--project]` |
| `/mcp add [id]` | Add a server from golem's list, or Other. In the web UI it opens the Add dialog in Settings |
| `/mcp enable <name>`, `/mcp disable <name>` | Turn a server on or off for this chat |

[Tools and permissions](./permissions.md), [Skills](./skills.md), and [MCP servers](./mcp.md) have the details.

### The screen

| Command | What it does |
|---|---|
| `/todos` | Show or hide the agent's todo list above the composer |
| `/context` | See how full the model's context is, and what fills it. In the web UI it opens the trace |
| `/time` | Show or hide the time beside each message |
| `/debug` | Open or close the debug panel |
| `/debug wire`, `/debug model` | Show the protocol messages, or exactly what the model sees |
| `/debug hold`, `/debug go` | Hold your next message, to look at it in the model tab before it is sent, then send it |
| `/help` | List every command |

## Keys

| Key | What it does |
|---|---|
| Enter / Shift-Enter | Send / new line |
| Up on an empty line | Recall a message you sent |
| Ctrl-C | Stop the answer. Twice quits |
| Ctrl-O | Show what each tool returned, and the instructions of each skill you ran |
| Ctrl-G | Edit the message in `$EDITOR` |
| Page Up / Page Down, End | Scroll, and jump back to the newest line |
| `?` on an empty line, or F1 | All keys |

While golem waits on an approval, **a**, **s**, **w**, **e**, and **d** answer it. [First chat](./first-chat.md#answer-an-approval) shows what each one does.

## Where things live

| Path | What |
|---|---|
| `~/.golem/config.toml` | Your settings |
| `~/.golem/golem.db`, `checkpoints.db` | Your chats, and what the model remembers of them |
| `~/.golem/*.db.bak-<version>` | Copies taken before an upgrade changed a database |
| `~/.golem/logs/` | The daemon's log, and Ollama's |
| `~/.golem/skills/` | Your own skills |
| `~/.golem/exports/` | Chats saved with `/export` |

Set `GOLEM_HOME` to use another folder, for example a throwaway one for experiments.
