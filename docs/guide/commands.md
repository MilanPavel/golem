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
| `golem mcp add <name> -- <command…>` / `--url <url>` | Adds an MCP server to `config.toml` and starts it. `--token` (web) or `--token-env VAR` (command) asks for a token and keeps it in the Keychain |
| `golem mcp remove <name>` | Removes the server from `config.toml`, stops it, and deletes its token |
| `golem auth list` | Which providers have a key |
| `golem models` | Every model you can use or download, with size, price, and context. `--refresh` asks the providers again |
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
| `/login [provider]`, `/logout <provider>` | Add an API key, checked with the provider, or remove one |
| `/setup` | See what is set up and what is broken, fix it, or walk the setup steps again |

[Models and API keys](./models.md) has the details.

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
| `/mcp` | Manage MCP servers: view tools, reconnect, turn on or off |
| `/mcp add [id]` | Add a server from golem's list, or Other. The web UI shows the `golem mcp add --catalog` command instead |
| `/mcp enable <name>`, `/mcp disable <name>` | Turn a server on or off for this chat |

[Tools and permissions](./permissions.md), [Skills](./skills.md), and [MCP servers](./mcp.md) have the details.

### The screen

| Command | What it does |
|---|---|
| `/todos` | Show or hide the agent's todo list above the composer |
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
