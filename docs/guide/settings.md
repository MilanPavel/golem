---
title: Settings
description: Where golem's settings live, what a project folder may add, when a change takes effect, and every key in config.toml.
---

# Settings

golem works with no settings at all. When you want to change something, it is one file: `~/.golem/config.toml`. Most changes take effect without a restart.

## Where settings come from

| Place | What it can set |
|---|---|
| `~/.golem/config.toml` | Everything on this page. Under `GOLEM_HOME`, the file is `$GOLEM_HOME/config.toml` |
| `GOLEM_…` environment variables | The top-level keys, such as `GOLEM_LOG_LEVEL` and `GOLEM_SESSION_TITLES`. They win over the file |
| A project's `.golem/policy.toml` | Tool rules for chats in that folder ([Tools and permissions](./permissions.md)) |
| A project's `.golem/config.toml` | Only `[mcp.<name>]` servers for chats in that folder, and only when the folder is in `trusted_projects` ([MCP servers](./mcp.md)) |

A project's `allow` rules count only when the folder is in `trusted_projects`. Its `ask` and `deny` rules always apply. So a repository you clone can make golem more careful, but never less.

Environment variables are read from the daemon's environment, not your shell's. A daemon that launchd started doesn't see what you export in a terminal.

## Edit the file

In the web UI, Settings → Config file (or `/config`) shows `config.toml` as text, in colour, with line numbers. **This project** switches to that folder's `.golem/config.toml` when you opened Settings from a chat. As you type, the daemon checks the text and lists each problem with its line, and a line with a problem is marked. **Review changes** shows what changes, line by line, and **Save** writes the file. If the file changed on disk after you opened it, nothing is written, and you can reload it or keep editing. A setting that is read only when the daemon starts says so after the save, with `golem daemon restart` to copy.

The page cannot change a few sections: `providers`, the model keys, `trusted_projects`, `shell`, `web`, `skills.extra_dirs`, and `skills.claude_dirs`. A change inside one is a problem, and the file is left as it was. Edit those in a terminal with `golem config edit`.

## See what is in effect

```sh
golem config show
```

It prints the file it read, the default model, the log level, whether chats get titles, the trusted projects, and the project policy for the folder you are in. Then it lists the tool rules in the order they are checked. In the TUI, `/permissions` shows the same rules and lets you change them.

## When a change takes effect

| Settings | Takes effect |
|---|---|
| `default_model`, `[models.*]`, `[providers.*]` | When the file changes, at the next model call |
| `[[rule]]`, `trusted_projects`, `[shell]`, `[web]`, `[permissions]` | When the file changes, at the next tool call |
| `[skills]` | When the file changes |
| `[mcp.*]` | When the file changes. golem starts, stops, or restarts the servers that changed |
| `log_level`, `session_titles`, `[ollama]` | When the daemon starts. Run `golem daemon restart` |

A file that no longer validates keeps the last good models and rules, and the daemon logs why. A project's `policy.toml` that doesn't validate makes every tool call in that folder ask, so a broken `deny` never turns into an allow.

## What golem writes for you

Some answers in the TUI and the web UI edit `config.toml` for you. golem keeps your comments and layout, and writes the file in one step so it is never half written.

- `d` in the `/model` picker sets `default_model`.
- `w` on an approval adds a `[[rule]]` that allows exactly that call.
- `/permissions` changes or removes a rule.
- `/mcp` turns a server on or off with `enabled`.
- `/mcp add` and `golem mcp add` add a `[mcp.<name>]` table, and `golem mcp remove` deletes one.
- Settings → Routing in the web UI changes the routing and budget keys, and Settings → Context changes the context keys.

The web page has two forms. Settings → Routing has `[routing]`, `[routing.ladder]`, `[routing.roles]` and `[budget]`. Settings → Context has `[context]` ([the web page](./web.md)). They write the same keys, and a key set back to its default is removed from the file.

## Secrets stay out of the file

A key named like a secret, such as `api_key`, `token`, or `password`, is refused, and the file doesn't load. Keys go in the macOS Keychain instead: `/login` in the TUI, or `golem auth set <provider>`. A provider's `api_key_env` names an environment variable to read first. An MCP server's `env` or `headers` names a stored secret as `keychain:mcp/<name>`.

## An example

```toml
default_model = "fast"
session_titles = true

[models.fast]
model = "ollama/qwen3.5:4b"
ctx = 16384

[models.smart]
model = "anthropic/<model-id>"

[[rule]]
tool = "shell"
match = "git status|git diff*"
action = "allow"

[[rule]]
tool = "write_file"
path = "~/notes/**"
action = "allow"

trusted_projects = ["~/repos/golem"]

[shell]
writable = ["~/scratch"]
timeout_seconds = 300

[skills]
disabled = ["pdf"]

[mcp.git]
command = "uvx"
args = ["mcp-server-git", "--repository", "/path/to/your/repo"]
```

## Every key

### The top level

| Key | Default | Meaning |
|---|---|---|
| `default_model` | none | A profile name or a `provider/model` ref. New chats store it as their model. With none, sending a message fails with `no model chosen yet`. Environment: `GOLEM_DEFAULT_MODEL` |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, or `ERROR`. Each record goes to stderr as a short line and to `~/.golem/logs/golem.jsonl` as JSON. Environment: `GOLEM_LOG_LEVEL` |
| `session_titles` | `true` | Name each chat after its first completed answer, with one extra model call. Environment: `GOLEM_SESSION_TITLES` |
| `trusted_projects` | none | Folders whose `.golem/policy.toml` may allow tools, and whose `.golem/config.toml` may add MCP servers |

### `[models.<name>]`

A profile: a short name for a model.

| Key | Default | Meaning |
|---|---|---|
| `model` | required | A `provider/model` ref, such as `ollama/qwen3.5:4b` |
| `ctx` | none | The context window. The `ollama` provider sends it as `num_ctx` |
| `price` | discovered | `{ input = 3.0, output = 15.0, cached_input = 0.3 }`, in USD per million tokens. Overrides the price golem found |

### `[providers.<name>]`

The providers are `openai`, `anthropic`, `google`, `deepseek`, `xai`, `moonshot`, and `ollama` (Ollama's own API). A table with one of those names changes only the keys it sets. Any other name is an error that lists them.

| Key | Default | Meaning |
|---|---|---|
| `kind` | `openai_compat` for a new name | `anthropic`, `openai`, `google`, `xai`, `ollama`, or `openai_compat` |
| `base_url` | the preset's | Where the API answers, such as `http://127.0.0.1:1234/v1` |
| `api_key_env` | the preset's, such as `ANTHROPIC_API_KEY` | The environment variable read before the Keychain |

### `[ollama]`

| Key | Default | Meaning |
|---|---|---|
| `start` | `true` | Run `ollama serve` when a local model is needed and nothing answers |
| `idle_stop_minutes` | `30` | Stop a server golem started after this long unused. `0` never stops it |
| `parallel` | `1` | How many generations golem sends to a local server at once (1 to 8). Raise it only if you also set `OLLAMA_NUM_PARALLEL` |

### `[context]`

Settings → Context in the web UI changes these keys. `window` and `keep_alive` are for Ollama only. The shares, the reply reserve and the keep counts apply to every model with a known window, hosted ones too, and the shares are of the window less the reply reserve.

| Key | Default | Meaning |
|---|---|---|
| `window` | `"auto"` | The context window golem asks Ollama for. `"auto"` plans one from the model's size and maximum and this Mac's memory. `"ollama"` sends none, so Ollama uses its own default. A number from 512 to 262144 is used as it is, and cut to the model's maximum when that is known. A `num_ctx` you set for a model, a profile's `ctx`, or a chat's option always wins |
| `keep_alive` | `"30m"` | How long Ollama keeps the model loaded after a call. golem sends it only with a window it planned, and never over a `keep_alive` you set. Leave it out to send none |
| `reply_reserve` | `4096` | Tokens of the window kept free for the reply. The rest is the room the history may fill |
| `clear_at` | `0.70` | When the history passes this share of the room, golem sends old tool results as one line each |
| `clear_to` | `0.40` | How far clearing goes down, as a share of the room. Must be above 0 and below `clear_at` |
| `compact_at` | `0.85` | When the history is still past this share of the room after clearing, golem replaces the old turns with a summary in what it sends. Must be above `clear_at` and below 1 |
| `keep_results` | `4` | The newest tool results that are never cleared. A model whose window is unknown is never cleared |
| `keep_turns` | `4` | The newest turns that are never summarised. At least 1 |

### `[routing]`

| Key | Default | Meaning |
|---|---|---|
| `mode` | `"pinned"` | How a chat picks its model. `pinned` uses the model the chat names. `local` uses only models on this Mac. `auto` picks the cheapest model that fits the call |
| `paid` | `"ask"` | When `auto` wants a paid model: `ask` asks once per chat, `always_ask` asks every time, `never` never uses one |
| `local_only` | `[]` | Folders whose chats stay on this Mac, and the folders inside them. Only local models read the chat there: no hosted model is picked, called, or used for a title or summary. In a project's `.golem/config.toml` it is `true` instead of a list, and makes that project's folder local only. See [Keep a folder on this Mac](./models.md#keep-a-folder-on-this-mac). Web tools and MCP servers are not blocked |
| `budget_max_price` | `1.50` | The most a hosted model may cost, in USD per million tokens, to be in the `budget` tier. The price is blended as `(3 × input + output) / 4`. A model above it, or with no known price, is `frontier`. Ollama models are `local` |

### `[routing.ladder]`

The model to use in each tier when `mode` is `auto`. A value is a profile name or a `provider/model` ref. Left out, golem chooses: for `local` the chat's own model if it is local, else the ready local model with the largest window; for `budget` the cheapest ready budget model that takes tools; for `frontier` none.

| Key | Default | Meaning |
|---|---|---|
| `local` | none | The model of the `local` tier |
| `budget` | none | The model of the `budget` tier |
| `frontier` | none | The model of the `frontier` tier |

### `[budget]`

Caps on what paid models may cost.

| Key | Default | Meaning |
|---|---|---|
| `daily_usd` | none | The most paid models may cost in one day, in USD. None means no cap |
| `session_usd` | none | The most paid models may cost in one chat, in USD. None means no cap |
| `over` | `"local"` | What to do at a cap: `local` goes on with a local model, `ask` asks you |

The spend is what the `model_calls` table holds for paid models: chat calls, titles and summaries. "Today" is your local day. At a cap, a chat that picks its model (`auto`) runs a local one, and its model chip says `the daily budget is spent` or `the session budget is spent`. A chat pinned to a paid model is refused with `budget_spent` and a message that names the cap and the amount. A run already going stops before its next paid call. A local model is never stopped by a cap, and a title or summary that would use a paid model is skipped.

A cap is checked before a call, and a call costs what it costs only when it ends. So one call can pass a cap by its own cost. Golem does not guess the cost of the next call to block it. With `over = "ask"`, a chat on `auto` that would use a paid model over a spent cap asks first, and only "Just this once" and "Stay local" are offered. A chat pinned to a paid model is refused in both cases.

### `[notifications]`

What tells you, and where a notification lands. Settings › Notifications in the web page sets the same keys.

| Key | Default | Meaning |
|---|---|---|
| `needs_you` | `true` | An approval or a question is waiting in a session nobody watches. It cannot be turned off: `false` is a config error that names the line |
| `failed` | `true` | A run of a session nobody watches stopped with an error |
| `finished` | `false` | A run of a session nobody watches finished |
| `open_in` | `"web"` | `web` opens the web page on the session. `terminal` opens the chat in the terminal. With `web`, a Mac that has no web service (`golem web install`) opens the terminal instead |
| `terminal_app` | `"Terminal"` | The app `terminal` opens in: `"Terminal"`, `"iTerm"` or `"Ghostty"`. Any other name is a config error that names the line. golem keeps it for the helper app that will open a click; nothing uses it yet |

A `[[routine]]` can override `failed` and `finished` for its own runs with `notify_failed` and `notify_finished`. A routine that sets `notify_finished = true` tells you when it is done even with `finished = false`, and `notify_failed = false` silences its failures. There is no override for `needs_you`.

The banner golem posts today is a plain macOS notification, and macOS gives it to Script Editor: **clicking it does not open golem.** So the banner ends with the command that does. Run it in any terminal:

```
golem open <id>
```

It opens the chat on that session, with a waiting approval on screen. `golem open <id> --notified` picks the place from `open_in`, as a click will once golem posts its own notifications (a small signed helper app is planned for that). `golem open <id> --web` always opens the page.

### `[agents.explorer]`

What bounds the helper that the `delegate` tool starts. A helper only reads: it never writes, runs a command or asks for approval.

| Key | Default | Meaning |
|---|---|---|
| `max_calls` | `15` | Model calls before the helper must answer. 1 to 50 |
| `timeout_seconds` | `300` | Wall time of one helper |
| `answer_chars` | `6000` | The most characters its answer may have. The rest is cut |
| `max_per_turn` | `3` | The most helpers one run may start. A further `delegate` call gets an error the model reads: `no more helpers in this turn; continue with what you have` |

`[agents.explorer]` also takes every key of `[agents.<name>]` below. `timeout_seconds` is the old name of `working_seconds` and `max_per_turn` the old name of `[agents] max_per_batch`: an old config keeps working, and giving an old name and the new one different values is an error. The old keys win over the explorer's file only when you write them.

`[agents.<name>]` takes more keys for each bundled type (`explorer`, `worker`, `reviewer`, `advisor`): `model`, a wish (`cheapest`, `same`, `stronger`, `local`, `budget`, `frontier`) or a model name, and the limits of one helper of that type: `max_calls` (1 or more), `working_seconds` (1 or more), `max_cost` (US dollars, 0 or more) and `max_tokens` (1 or more). They replace the same limits in the bundled file; the prompt and the tools stay the bundled ones. Changing a wish in Settings or `/agents` writes it. A file of the same name in `~/.golem/agents` wins over both.

The daemon also writes your own agent files, and only in `~/.golem/agents`. `agents.save` saves the whole text of a file, and only when the agent parser finds nothing wrong: otherwise nothing is written and the problems come back, each with its line when it is about a frontmatter key. The `name` inside the file decides the file name, a changed name renames the file, and a name another file of yours has is refused. `agents.copy` copies a bundled agent there unchanged, and `agents.delete` removes your file, which brings the bundled agent of that name back. Bundled and project agents cannot be deleted. A name with a `/`, a `..`, a leading dot or anything but lowercase letters, digits and single hyphens is refused. No restart is needed: the next helper reads the new file.

A helper also stops when its calls have taken in more than 8 times its model's window in all (`tokens`), or when a cap in `[budget]` is spent before one of its paid calls (`budget`). It then returns what it has, and the result starts with `explorer finished: <reason>`. Its calls count against the same caps as the chat's, and `golem cost` and Settings → Usage list them as `helper` under "by job".

### `[agents]`

How long a finished helper keeps its steps. After that only a receipt stays: its brief, its answer and its end. Its cost and usage totals, its runs and its artifacts do not change, and nothing in the lead's chat changes.

| Key | Default | Meaning |
|---|---|---|
| `keep_days` | `7` | Days a finished helper keeps its steps, counted from the end of its last run, not from when you opened it. 0 keeps them for ever. A helper whose steps were removed cannot be continued as a chat |
| `keep_problem_days` | `30` | The same for a helper that failed, was cancelled or asked you something (an approval or the paid question). 0 keeps them for ever |
| `max_calls`, `working_seconds`, `max_cost`, `max_tokens` | not set | The limits of one helper of every type, when neither its own `[agents.<name>]` table nor its agent file sets them. The order is `[agents.<name>]`, the agent file, `[agents]`, then the built-in default (15 calls; no other limit). `working_seconds` does not count the time a helper waits |
| `at_once` | `3` | How many helpers run at once. 1 to 16. Stored for now; nothing enforces it yet |
| `max_per_batch` | `3` | How many helpers one message of the lead may start. 1 to 20. `[agents.explorer] max_per_turn` is its old name. It sets the cap that `delegate` already has |
| `per_message_cost` | `1.0` | Most US dollars all helpers of one message may cost. Stored for now |
| `estimate_over` | `0.25` | A batch estimated above this many US dollars asks you first. Stored for now |

Settings › Agents is a list of the agents on the left and the chosen one on the right. On a narrow window it is one column, and a row opens in place. Each agent is a Markdown file. The **Overview** tab shows the model it uses now and why (the wish is a dropdown that saves at once), the tools it can use with the ones that change things marked, its limits (tool calls, time, answer length, and whether it may ask you a question), its prompt, and how often it ran in the last 30 days. The **Definition** tab shows the file itself with its path, the settings at the top tinted, and **Copy text**. A file that comes with golem says it is read-only. An agent that cannot be started yet shows "not yet" and the reason, and an agent whose file has a problem shows the problem. A project agent in a folder that is not trusted is not listed, and a line says to trust the folder.

You make, change and delete your own agents on that page. **+ New agent** (above the list) opens the Definition tab with a template in a text box and a "new agent · not saved yet" row; **Save** writes `~/.golem/agents/<name>.md` and chooses the new agent. On a file that comes with golem, **Make my own copy** copies it; the copy is marked "yours", says it replaces the bundled one, and can be edited. On your own agent, **Edit** puts the file in a text box with **Save** and **Cancel**. When the text has a mistake nothing is written: the text stays and the page says "Not saved." with each problem and its line. **Delete** asks once, in place; for a copy it says the bundled agent comes back. Changing the model on your own agent rewrites the `model:` line of its file; on a bundled agent it is still the override in `config.toml`. Choosing another agent or tab, or **+ New agent**, while the text box holds unsaved changes asks "Discard changes?" first. Project agents are shown but not edited here. Opening the file in your editor is not on the page yet.

The bottom of the page has a "Finished helpers" line for both keys, each with a "for ever" choice that writes 0, and `/agents` shows the two values on one line. A change there is written to `config.toml` with its comments kept. The terminal does not edit them.

A value below 0 is a config error that names the line. A helper that is running or waiting is never trimmed, and neither is one whose lead is waiting for its helpers. golem checks when it starts and then once an hour, and a change in `config.toml` applies to the next check without a restart.

### `[routing.roles]`

The model for each internal job. A value is `"session"`, a profile name, or a `provider/model` ref.

| Key | Default | Meaning |
|---|---|---|
| `titles` | `"session"` | The model that names a chat after its first run |
| `summarise` | `"session"` | The model that summarises |
| `explore` | `"session"` | The model that explores |

`"session"` on a local chat uses the chat's own model with the chat's own options, so Ollama does not reload it. On a hosted chat it uses the cheapest ready budget model that takes tools, and the chat's own model when there is none. A model that is not ready is never downloaded for a role.

### `[[rule]]`

One tool rule. The first rule that matches a call decides it ([Tools and permissions](./permissions.md)).

| Key | Default | Meaning |
|---|---|---|
| `tool` | `*` | A glob on the tool name, such as `shell` or `mcp__git__*` |
| `match` | none | A glob on the call's subject, such as a shell command or a search pattern, with `\|` between alternatives |
| `path` | none | A glob on the path the call touches. `*` stays in one folder, `**` crosses folders, `~` is your home, and a relative glob starts at the chat's folder |
| `action` | required | `allow`, `ask`, or `deny` |

### `[permissions]`

Only your own file sets this. A chat can use another mode for itself.

| Key | Default | Meaning |
|---|---|---|
| `mode` | `"balanced"` | How much the built-in defaults allow without asking: `careful`, `balanced`, or `autopilot`. See [permission modes](./permissions.md#permission-modes) |

### `[shell]`

Only your own file sets these. A project can't widen them.

| Key | Default | Meaning |
|---|---|---|
| `network` | `false` | Let commands use the network |
| `writable` | none | More folders commands may write to, beside the chat's folder |
| `timeout_seconds` | `120` | The longest a command runs, up to 3600 |

### `[coding]`

Only your own file sets these.

| Key | Default | Meaning |
|---|---|---|
| `checks` | `"ask"` | Whether golem runs checks after it changed files: `ask`, `auto`, or `off` |
| `fix_rounds` | `2` | How many times golem may fix what a check found, up to 5 |

After a turn in which the model wrote a file, edited a file, or ran a shell command that succeeded, golem runs the checks one by one in the shell sandbox, with your `[shell]` settings, and shows each as it starts and ends. With `ask`, it offers them once in a session and runs nothing until you say yes. In autopilot mode `ask` runs them without asking. `auto` runs them unless you said no in that session. A failed check is shown to you only, and is not yet given to the model.

Each `[[coding.check]]` is one command. With none, golem looks at the project's own files: a `lint` recipe in a justfile, a `lint` or `typecheck` script in `package.json`, a ruff setup, `Cargo.toml`, or `go.mod`. Tests are never detected. Add them yourself.

| Key | Default | Meaning |
|---|---|---|
| `name` | required | A short name, up to 40 characters |
| `command` | required | The command to run in the project's folder |
| `timeout_seconds` | `120` | The longest it runs, up to 1800 |

```toml
[coding]
checks = "auto"
fix_rounds = 3

[[coding.check]]
name = "tests"
command = "uv run pytest -q"
timeout_seconds = 300
```

### `[web]`

Only your own file sets these.

| Key | Default | Meaning |
|---|---|---|
| `allow_private` | `false` | Let `web_fetch` reach loopback, private, and link-local addresses |
| `max_bytes` | `5000000` | The most of a page it reads, up to 50 000 000 |
| `timeout_seconds` | `20` | The longest one fetch or search takes, up to 300 |
| `search` | `"duckduckgo"` | Who `web_search` asks. `"off"` leaves the tool out |

A redirect to another host is not followed. The model gets the new URL and asks again.

`web_search` sends the query to DuckDuckGo, a third party, and needs no key or account. Searches start at least 5 seconds apart. DuckDuckGo may still refuse a burst, and the model is then told to wait a minute. Restart the daemon after you change `search`.

### `[skills]`

Only your own file sets these ([Skills](./skills.md)).

| Key | Default | Meaning |
|---|---|---|
| `disabled` | none | Skill names that are listed but never used |
| `claude_dirs` | `true` | Also read `~/.claude/skills` and the project's `.claude/skills` |
| `extra_dirs` | none | More folders of skills, after your own |
| `index_budget` | `4000` | How many characters the skill index in the system prompt may use. A skill that does not fit is left out of it, and `skill.list` shows `indexed: false` |

### `[memory]`

Only your own file sets these, and Settings › Memory writes the three privacy keys. A project's `.golem/config.toml` may set only `private = true`, which makes that project's notes local models only ([Memory](./memory.md)).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` turns memory off: no file is opened, nothing is added to the prompt, and the model has no `recall` or `remember` |
| `you`, `projects`, `history` | `"chat"` | The privacy of a scope. `"chat"` lets a note go where the chat goes. `"local"` keeps every note of that scope on local models |
| `auto_keep` | none | Folders where a note with sources would be kept without asking. No effect yet, and the web page cannot change it |
| `share`, `min_tokens`, `max_tokens`, `helper_share` | `0.02`, `200`, `1500`, `0.01` | The size of the memory block. No effect yet: the block is capped at 1500 characters |

### `[mcp.<name>]`

One MCP server ([MCP servers](./mcp.md)). The name may use letters, digits, and `-`, up to 32 characters.

| Key | Default | Meaning |
|---|---|---|
| `command` | none | A server golem starts, talking over stdin and stdout |
| `args`, `env`, `cwd` | none | Its arguments, environment, and folder |
| `url` | none | A server golem reaches over HTTP, instead of `command` |
| `headers` | none | HTTP headers for a `url` server |
| `enabled` | `true` | `true`, `"on_demand"` (only for chats that run `/mcp enable`), or `false` to keep the settings without starting it |
| `timeout_seconds` | `120` | The longest one tool call takes, up to 3600 |

A value in `env` or `headers` may name `keychain:mcp/<name>`, and a key that looks like a secret must.

### Older keys

`model_profile`, `model_provider`, `model_name`, and `model_base_url` are the settings from before profiles. They still load, as one profile named after `model_profile` (`remote` when unset), so older chats keep working. Use `default_model` and `[models.<name>]` instead.
