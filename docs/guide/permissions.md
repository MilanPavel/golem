---
title: Tools and permissions
description: The tools golem has, which ones ask first, how to write rules, and what the shell sandbox stops.
---

# Tools and permissions

golem does its work through **tools**: small actions it asks the daemon to run, such as reading a file or running a command. Before any tool runs, one check decides: **allow**, **ask** you, or **deny**.

## The built-in tools

| Tool | What it does | By default |
|---|---|---|
| `read_file` | Reads a file in the project, in pages of lines | Allowed |
| `list_dir` | Lists a folder in the project | Allowed |
| `glob` | Finds files by pattern, such as `**/*.py` | Allowed |
| `grep` | Searches file contents with a regular expression | Allowed |
| `git_status`, `git_diff`, `git_log` | The branch, the changes, and recent commits | Allowed |
| `read_artifact` | Reads more of a long tool output that was cut | Allowed |
| `todo_write` | Keeps the agent's todo list, shown with `/todos` | Allowed |
| `write_file` | Creates a file, or replaces all of it | Asks, with the diff |
| `edit_file` | Replaces exact text in a file | Asks, with the diff |
| `shell` | Runs a command, in a sandbox | Asks |
| `shell_unsandboxed` | Runs a command outside the sandbox, with your credentials and the network, for `gh` and `git push` | Asks |
| `web_fetch` | Reads one web page | Asks, per host |
| `web_search` | Searches the web with DuckDuckGo | Asks, for `html.duckduckgo.com` |
| `mcp__<server>__<tool>` | A tool from an [MCP server](./mcp.md) | Asks |

The read-only tools only see the folder you opened golem in. Reads change nothing, so they never stop to ask.

## Answering a question

When a call asks, the answer pauses until you choose:

```tablet
Allow shell pytest -q?
asked by built-in default
a once · s this session · w always (saves a rule) · e edit · d deny
```

- **a** (or Enter) allows this one call.
- **s** allows it, and the same tool on the same subject for the rest of the chat.
- **w** allows it, and writes a rule to `~/.golem/config.toml` that allows exactly this call from now on.
- **e** opens the call's arguments as JSON, so you can change them, then allows it once.
- **d** (or Esc) denies it. The model reads that the call was denied, and carries on.

A file change shows its diff above the question. Approving it approves that diff and nothing else: if the file changes before the write, the call fails instead of writing something you did not see.

[First chat](./first-chat.md#answer-an-approval) walks through a first approval.

## Rules

A rule names a tool, and can narrow it to a subject (`match`) or a path (`path`). The first rule that matches decides.

```toml
# Never read .env files, in any project.
[[rule]]
tool = "read_file"
path = "**/.env"
action = "deny"

# Let the tests run without asking.
[[rule]]
tool = "shell"
match = "pytest*|just test*"
action = "allow"

# Ask before any search for secrets.
[[rule]]
tool = "grep"
match = "*password*|*secret*"
action = "ask"
```

| Field | Meaning |
|---|---|
| `tool` | The tool name, as a glob. `*` is every tool, `mcp__git__*` every tool of one server |
| `match` | The subject: a shell command, a search pattern, or a web host. Globs, with `\|` between alternatives |
| `path` | A glob on the real path. `*` stays in one folder, `**` crosses folders, `~` is your home, and a relative glob starts at the project |
| `action` | `allow`, `ask`, or `deny` |

**Where rules live, checked in this order:**

1. The project's `.golem/policy.toml`, for everyone who works in that folder.
2. Your `~/.golem/config.toml`.
3. The built-in defaults in the table above.

A project file can make golem stricter: its `deny` and `ask` rules always count. Its `allow` rules count only when you list the folder in `trusted_projects` in your own config, so a cloned repository cannot give itself a shell.

```toml
trusted_projects = ["~/repos/my-app"]
```

**See and change them.** `golem config show` prints the rules in effect for the folder you are in, in the order they are checked, and where each one came from. In the chat, `/permissions` shows the same list and what this chat allows, and changes or deletes a rule. Rules apply on the next call, with no restart.

## The shell sandbox

A command you allow still runs in a sandbox (`sandbox-exec`, built into macOS). If the sandbox cannot start, the command does not run.

- **Writes** only to the project folder, the temp folders, the usual caches (`~/.cache`, `~/.npm`, and others), and any folder in `[shell] writable`. In a git worktree, it may also write the worktree's git folders in the main checkout, so `git commit` works.
- **No network,** unless `[shell] network = true`.
- **No secrets.** It cannot read `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.golem`, your Keychains, and similar folders. Variables that look like credentials are removed from its environment.
- **A time limit** of 120 seconds by default, `[shell] timeout_seconds`.

When the sandbox refuses something, the result says so: the tool line reads `exit 1, blocked by the sandbox`, and the output names what was blocked and how to allow it. The model reads the same line, so it can tell you.

With the network off, a command that names a network client such as `curl`, `wget`, or `git clone` also gets a last line after the exit code. It says the sandbox has no network, and points to `web_fetch` or `shell_unsandboxed`. The line is a hint, so it appears whatever the exit code is.

`git_status`, `git_diff`, and `git_log` run git directly, in the same sandbox, with hooks and other ways for a repository to run code switched off.

```toml
[shell]
network = false
writable = ["~/scratch"]
timeout_seconds = 300
```

The `[shell]` settings are read only from your own `config.toml`. A project cannot widen them. A change applies from the next command.

### Outside the sandbox

`gh` and `git push` need your login and the network, which the sandbox keeps out. For such a command the model uses `shell_unsandboxed`. It runs in the project folder like `shell`, but without the sandbox, so it can do anything you can. It asks every time, and the question names the tool:

```tablet
Allow shell_unsandboxed gh pr create --fill?
asked by built-in default
a once · s this session · w always (saves a rule) · e edit · d deny
```

**s** and **w** cover that exact command. Only a rule that names `shell_unsandboxed` allows it: `tool = "*"` or `tool = "shell*"` with `action = "allow"` does not. Keep its `match` exact, because `match = "gh *"` would also allow `gh x; rm -rf ~`.

## The web

`web_fetch` asks once per host, so a rule can allow the sites you trust:

```toml
[[rule]]
tool = "web_fetch"
match = "docs.python.org|developer.mozilla.org"
action = "allow"
```

`web_search` sends the words it searches for to DuckDuckGo. It asks once for the host `html.duckduckgo.com`, whatever the query, so one rule allows searches:

```toml
[[rule]]
tool = "web_search"
match = "html.duckduckgo.com"
action = "allow"
```

`web_fetch` refuses addresses inside your network (such as `192.168.…` or `localhost`) unless `[web] allow_private = true`. What a page says is treated as data, never as instructions, so a page cannot approve anything.

## Long output

A tool result over 20 000 characters is stored once, and the model sees its start and its end, with a note. It reads the rest with `read_artifact` when it needs to. `/artifact` opens the whole output in your pager.

## Why it works this way

- [ADR-012](../adr/012-permission-rules.md): rules, first match wins, and a project cannot allow itself.
- [ADR-013](../adr/013-approvals.md): an approval pauses the run.
- [ADR-014](../adr/014-shell-sandbox.md): the shell runs under `sandbox-exec`, or not at all.
- [ADR-038](../adr/038-shell-unsandboxed.md): a command you approve may run outside the sandbox, as a tool of its own.
- [ADR-015](../adr/015-write-tools.md): a file change is applied only as shown.
- [ADR-016](../adr/016-artifacts.md) and [ADR-017](../adr/017-web-fetch.md): long output, and the web.
