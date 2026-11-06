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

## See what is in effect

```sh
golem config show
```

It prints the file it read, the default model, the log level, whether chats get titles, the trusted projects, and the project policy for the folder you are in. Then it lists the tool rules in the order they are checked. In the TUI, `/permissions` shows the same rules and lets you change them.

## When a change takes effect

| Settings | Takes effect |
|---|---|
| `default_model`, `[models.*]`, `[providers.*]` | When the file changes, at the next model call |
| `[[rule]]`, `trusted_projects`, `[shell]`, `[web]` | When the file changes, at the next tool call |
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

### `[[rule]]`

One tool rule. The first rule that matches a call decides it ([Tools and permissions](./permissions.md)).

| Key | Default | Meaning |
|---|---|---|
| `tool` | `*` | A glob on the tool name, such as `shell` or `mcp__git__*` |
| `match` | none | A glob on the call's subject, such as a shell command or a search pattern, with `\|` between alternatives |
| `path` | none | A glob on the path the call touches. `*` stays in one folder, `**` crosses folders, `~` is your home, and a relative glob starts at the chat's folder |
| `action` | required | `allow`, `ask`, or `deny` |

### `[shell]`

Only your own file sets these. A project can't widen them.

| Key | Default | Meaning |
|---|---|---|
| `network` | `false` | Let commands use the network |
| `writable` | none | More folders commands may write to, beside the chat's folder |
| `timeout_seconds` | `120` | The longest a command runs, up to 3600 |

### `[web]`

Only your own file sets these.

| Key | Default | Meaning |
|---|---|---|
| `allow_private` | `false` | Let `web_fetch` reach loopback, private, and link-local addresses |
| `max_bytes` | `5000000` | The most of a page it reads, up to 50 000 000 |
| `timeout_seconds` | `20` | The longest one fetch takes, up to 300 |

A redirect to another host is not followed. The model gets the new URL and asks again.

### `[skills]`

Only your own file sets these ([Skills](./skills.md)).

| Key | Default | Meaning |
|---|---|---|
| `disabled` | none | Skill names that are listed but never used |
| `claude_dirs` | `true` | Also read `~/.claude/skills` and the project's `.claude/skills` |
| `extra_dirs` | none | More folders of skills, after your own |

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
