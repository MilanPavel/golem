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
| `golem` | Opens golem in your browser. Asks first whether to keep the service running, when none runs |
| `golem tui` | Opens the terminal chat in this folder. On a first run it opens the setup window |
| `golem --version` | Prints the version |
| `golem status` | Is the daemon up? Prints its pid, version, and uptime |
| `golem doctor` | Checks the whole install, and says how to fix each problem |
| `golem install` / `uninstall` | Sets up or removes both background jobs: the service and the web page. `~/.golem` stays. [Uninstall](./uninstall.md) has the whole removal |
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
| `golem models score --reset <ref>` | Starts a model's score from nothing. The score is how often its tool calls were valid and how often runs stepped up from it. Usage and cost stay |
| `golem cost` | What model calls cost: tokens and money for today and the last 7 days, the week by model, and what running locally saved. Same report as `/cost`, without the session row |
| `golem eval routing [--days 14] [--session <id>]` | What the sessions recorded on this Mac would have cost on a frontier model, on a local model and on `auto`: cost, prompts that would not fit the window, step-ups and the largest share of a window. It also lists the five sessions where `auto` would have spent most. It is a calculation over the stored events, so it calls no model and costs nothing. Sessions from before sizes were recorded are skipped, and the report says how many. See [Replaying recorded sessions](../vision/routing.md#replaying-recorded-sessions) |
| `golem config edit [--project]` | Opens `config.toml` (or the project's) in `$EDITOR`, and saves it only when the daemon accepts it. If a setting needs a restart, it offers one |
| `golem config show` | The settings and tool rules in effect for this folder. `--resolved` is accepted and prints the same |
| `golem skills` | The skills this folder sees, and why one is not used. `golem skills list` is the same |
| `golem skills check <path>` | Checks a skill, its `SKILL.md`, or a folder of skills. Needs no daemon |
| `golem skills new <name> [--project] [--description "…"]` | Makes a skill in `~/.golem/skills`, or in `.agents/skills` of this folder with `--project`, and opens it in `$EDITOR` |
| `golem skills edit <name>` | Opens the skill's `SKILL.md` in `$EDITOR`, then checks it and prints its mistakes |
| `golem routines` | The routines, with each one's schedule in words, next run, and last result. `golem routines list` is the same |
| `golem routines run <name> [--folder <dir>] [--wait]` | Fires a routine now and prints the session id. With `--wait` it prints the summary, like `golem ask` |
| `golem routines pause <name>` / `resume <name>` | Turns a routine off or on again by writing `enabled` in `config.toml`. See [Routines](./routines.md) |
| `golem routines edit` | Opens `config.toml` in `$EDITOR` at the first `[[routine]]`, then checks it and prints mistakes with their lines |
| `golem models check <model>` | Runs ten small tool-calling tasks on a model, prints one line per task as it ends (`✓` passed, `~` the model wrote the call as text and golem read it, `✗` failed with the reason), then a verdict: `reliable`, `usable; golem will step up when it fails`, or `not recommended for tool work`. No tool runs and nothing is written outside golem's home. A hosted model costs a few cents, printed at the end. The result seeds the tool score until 20 real tool calls exist. Exits with 1 when the check cannot run |
| `golem coding bench <profile-or-model> [--task <name>]` | Runs twelve small edit tasks (Python and TypeScript) on a model in a temporary folder and prints, for each, whether it was solved, how many `edit_file` calls it took, how many failed, and which match rung applied them. The last line sums it up: `solved 9/12 · first-try edits 71% · fuzzy matches 3`. It calls the model for real, so a hosted model costs money. Needs no daemon, and exits with 0 whatever the score (1 only for an unknown task or model) |
| `golem ask "<prompt>" [--folder <dir>] [--model <profile>] [--skill <name>]` | Starts a session, waits, and prints the answer. If the run stops to ask you about a tool, it prints the question and exits with 3: answer it with `golem open <id>`. A failed run exits with 1 |
| `golem ask --detach "<prompt>"` | Starts the session and prints its id at once. The work goes on without this window. Open it later with `golem open <id>` |
| `golem open <id> [--web \| --notified]` | Opens the terminal chat on that session. With `--web`, opens the web page at that session. With `--notified`, opens the place `[notifications] open_in` names (the web page by default, the terminal when the web service is not installed). A notification banner shows this command, because clicking the banner does not open golem |
| `golem web` | The same as `golem`, kept as an alias |
| `golem web install` / `uninstall` | Keeps the web page running at login (a launchd job), or removes that job |
| `golem web logout` | Signs every browser out of the web UI |

`golem` and `golem web` take three options:

- `--port N` serves on that port instead of 7480.
- `--no-open` prints the link instead of opening the browser. With no daemon running, it says what to run and exits 1.
- `--json` prints the link, the port, and the pid as JSON, for scripts, and opens no browser.

When it opens the browser, `golem` prints `Chat in the terminal: golem tui`. With `SSH_CONNECTION` set, it behaves as with `--no-open`: no browser, and the link is printed.

`golem web serve [--port N]` runs the same server with no browser, no token in its output, and no service question. It is meant for a background job.

If golem's page is already running, a second `golem` reuses it. With the web job installed, `golem` opens the page and returns the prompt. With no daemon, `golem` first asks to start golem's service.

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
| `/route`, `/route pinned\|local\|auto`, `/route why` | Show how this chat picks its model (the mode, the ladder of tiers on `auto` or the one model on `local` and `pinned`, and today's spend), set the mode, or say why the last answer used its model and which models were left out |
| `/stronger` | On route `auto`, ask the last question again as a new turn on the next tier up, for this one turn. The old answer stays and the new one follows. A paid model asks first. It fails with `No stronger model is ready. Add a key in Settings.` when none may run (a local-only folder, `paid = "never"`, a spent budget, or no key) |
| `/tune` | Tune a local model: a slider and an explanation for each option, such as temperature and context size |
| `/login [provider]`, `/logout <provider>` | Add an API key, checked with the provider, or remove one |
| `/setup` | See what is set up and what is broken, fix it, or walk the setup steps again |

[Models and API keys](./models.md) has the details.

#### Tune a local model

`/tune` opens a panel with one row per option of the model this chat uses, a block slider for each, and what the focused option does under the rows. A model with no `num_ctx` in its Modelfile and none asked for shows `set by Ollama when it loads` for the context size, and the first `←` or `→` starts it at 8192. It is for local Ollama models. A hosted model says so and opens nothing.

| Key | What it does |
|---|---|
| Up, Down | Move between options |
| Left, Right | Change the focused value. Each change is sent at once |
| `r` | Reset the focused option to the model's default |
| `s` | Switch where changes go: saved for this model, or this chat only |
| `1`–`4` | Apply a preset to this chat: precise, balanced, creative, or long memory. Balanced clears this chat's changes. Long memory sets the largest context size that fits in your Mac's memory, up to 32K |
| `S` | Save this chat's changes for the model |
| `t` | Ask your last question again with these settings. The answer shows under the panel, and the try is kept as its own chat. `t` again stops it |
| Esc | Close the panel |

A saved change is kept in `config.toml` for the model, and every chat on it uses it. A change for this chat only is kept with the chat. Either one applies from your next message. When a value is not the default, the row says what the default is. The `num_ctx` row also says how much memory the value costs compared with the default, and whether it fits: `+1.1 GB · fits`, `· tight`, or `· too big`. It is a rough estimate, one rate for every model. The row says nothing when golem does not know your memory or the model's size.

To change one option without the panel, type `/tune <option> <value>`, for example `/tune temperature 0.3`. It is for this chat only. `/tune temperature reset` removes the change, and a value out of range prints the allowed range. After `/tune `, completion lists the options, then the default and range of the one you picked. A model that can think also has a `think` row, `off` and `on`, or `low`, `medium`, and `high` for gpt-oss; `/tune think off` stops its thinking for this chat, and a model that cannot think has no such row.

The status line shows the options that differ from the model's default, such as `temp 0.2 · top_p 0.9`, at most three and then `+N`. The context size is left out, because the context bar already shows it.

The line under an answer ends with the model, `local` for a model on your machine, the tokens the run used, and golem's estimate of its cost, such as `qwen3:27b · local · 4.1K tok · $0.00`. Once a call in the session has cost something, the status line ends with the session's total so far, such as `$0.03`.

### Tools, skills, and MCP

| Command | What it does |
|---|---|
| `/permissions` | Show the tool rules for this folder, and what this chat allows |
| `/artifact [id]` | Open the full output of a long tool call in your pager. With no id, the newest one |
| `/skills` | See the skills this folder has, and why one is or is not used |
| `/routines` | Your routines: run one now, pause or resume it, edit it in `$EDITOR`, open its last run |
| `/runs` | What your routines did, grouped by what needs you |
| `/<skill> [args]` | Run a skill once |
| `/skill run <name> [args]` | Run a skill once, also one named like a command, such as `help` |
| `/skill pin <name>`, `/skill unpin <name>` | Keep a skill on for the whole chat, or turn it off |
| `/skill` | List the pinned skills |
| `/mcp` | Manage MCP servers: view and try tools, hide a tool, test, read the log, reconnect, turn on or off, remove |
| `/config [project]` | Open the config file: in the web UI, Settings → Config file (the project's file with `project`). In a terminal it says to run `golem config edit [--project]` |
| `/mcp add [id]` | Add a server from golem's list, or Other. In the web UI it opens the Add dialog in Settings |
| `/mcp enable <name>`, `/mcp disable <name>` | Turn a server on or off for this chat |
| `/checks on`, `/checks off` | Let golem run the project's checks (lint, type check) after its edits in this chat, or stop it. When golem first edits files it asks; in the terminal `y` and `n` answer, in the web UI the buttons above the composer do. The Checks tab has the same switch and shows each check's output |

[Tools and permissions](./permissions.md), [Skills](./skills.md), and [MCP servers](./mcp.md) have the details.

### The screen

| Command | What it does |
|---|---|
| `/changes` | Review the files this session changed. In the terminal: the files on the left, the diff on the right, `j` and `k` (or Shift with the arrows) move a row cursor, `n` and `p` jump by hunk, `c` writes a note on the row and `x` removes it, `u` undoes the hunk under the cursor and `U` the selected file (each asks `y/n`). In the web UI it opens the Changes tab |
| `/notes` | List the review notes you wrote in `/changes` (or in the Changes tab of the web UI). They go out ahead of your next message and are dropped once it is sent. `/notes clear` drops them without sending |
| `/undo` | Take back the files the last turn changed. It lists them and asks; a file edited since golem wrote it is listed again, and `o` overwrites it or `k` keeps yours. `/undo` again goes one turn further back. Terminal only for now |
| `/commit` | Commit the files this session changed, with your own git and your hooks. golem suggests the message and you can edit it. In the terminal it opens a band under `/changes` (`g` does the same there): `enter` commits all the files, `ctrl+r` suggests again. In the web UI it opens a dialog where you can leave files out. Nothing is committed until you press commit, and nothing is pushed |
| `/todos` | Show or hide the agent's todo list above the composer |
| `/context` | See how full the model's context is, and what fills it. Under the report it lists the actions that can run, each on a key. In the web UI it opens the trace |
| `/cost` | What model calls cost: this session, today, the week, the week by model, and what running locally saved. In the web UI it opens Settings → Usage |
| `/compact [focus]` | Replace the old turns with a summary, so the next call sends less. `focus` is what the summary must keep, such as `/compact the file names and the plan`. The last turns stay as they are |
| `/context clear` | Send old tool results as one line each, keeping the newest few, so the next call sends less |
| `/context grow` | Give a local model the next larger window on the next turn, if this Mac can hold it. It reloads the model |
| `/time` | Show or hide the time beside each message |
| `/thinking` | Show or hide the thinking line above each answer. It only changes what you see; the `think` setting in `/tune` is what the model is asked to do |
| `/detail [quiet\|normal\|verbose]` | Web UI: how much of a turn's tool steps shows. Quiet is the step count, Normal a one-line summary you can open, Verbose opens every step with its arguments and output. Alone, it says the current level |
| `/debug` | Open or close the debug panel |
| `/debug wire`, `/debug model` | Show the protocol messages, or exactly what the model sees |
| `/debug hold`, `/debug go` | Hold your next message, to look at it in the model tab before it is sent, then send it |
| `/help` | List every command |

`/compact` and `/context clear` run between turns, without waiting for the context to fill. Each prints one line when it is done, such as `summarised 9 earlier turns with qwen3:27b · ctx 84% → 31% · 6.2 s` or `cleared 12 old tool results · ctx 71% → 38%`, and `nothing to compact yet` when there is nothing to do. A summary can take a minute with a local model, and the line says it is working meanwhile. They are refused while an answer is running. Nothing is deleted: the chat on screen and the saved session stay whole, and only what the next call sends gets shorter. `/compact` keeps the last `keep_turns` turns and `/context clear` keeps the newest `keep_results` tool results, from `[context]` in the settings.

Under the report, `/context` prints a key row of the actions that can run now, such as `c clear old results · s summarise · g grow to 64K · m larger model`. While the panel is open and the message box is empty, the key runs the action: `c` clears old tool results, `s` summarises earlier turns, `g` grows the window (a local model, planned by golem, when this Mac can hold it), and `m` turns the route to `auto` so a larger model takes over (a paid one asks first). An action that cannot run is left out of the row. The web UI shows the same actions, with their costs, in the popover of the `ctx` chip.

`/context` draws the model's window as a grid of cells, coloured by what fills them, with a legend beside it (or under it in a narrow terminal). One cell is 0.5% of the window. The legend has a `Summary` row when a summary stands for old turns, a `Free` row for what is left outside the reply reserve, a `Reply reserve` row (drawn `▨`, at the end of the grid), and a dim `Cleared · 12 tool results · 11.2K not sent` row when old tool results were sent as one line each. In the chat, a dim line such as `⊖ golem cleared 12 old tool results · ctx 71% → 38%` shows where golem cleared or summarised, or grew the window.

```text
■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■    qwen3:8b
■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ □ □    3.1K / 16.4K · 18%
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □    ■ System prompt        1.2K    7%
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □    ■ Tool definitions     1.4K    9%
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □    ■ Your messages         300    2%
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □    ■ Replies               200    1%
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □    □ Free                13.3K   81%
```

## Keys

| Key | What it does |
|---|---|
| Enter / Shift-Enter | Send / new line |
| Up on an empty line | Recall a message you sent |
| Ctrl-C | Stop the answer. Twice quits |
| Ctrl-O | Show what each tool returned, the instructions of each skill you ran, and the thinking of each reply |
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
