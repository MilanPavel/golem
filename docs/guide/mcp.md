---
title: MCP servers
description: Give golem more tools with MCP servers, local or on the web, and keep their tokens in the Keychain.
---

# MCP servers

Any [MCP](https://modelcontextprotocol.io) server gives golem new tools: a git server, a browser, your issue tracker. golem starts the server, lists its tools for the model, and asks before every call.

## Add a server

### From a chat

Type `/mcp add`. golem lists the servers it knows, each with one line on what it does:

- **Filesystem** and **Git** ask for a folder. It starts at the chat's folder, so Enter takes it.
- **Fetch**, **Time**, **Memory**, **Sequential Thinking**, **Playwright**, and **Context7** ask for nothing.
- **GitHub** and **Brave Search** ask for a token. The prompt hides what you type, and the token goes to the Keychain. GitHub's prompt says how to make one: at github.com/settings/personal-access-tokens/new, pick the repos under Repository access, then add Contents, Issues, and Pull requests.
- **Other** asks for a name, then a command or a URL.

A server you already added says so, and one that can't be added says why. Servers added this way are **on demand**: they cost no tokens until a chat turns them on.

`/mcp add github` goes straight to that server. With no servers yet, `/mcp` shows the same list. The web UI cannot add a server. `/mcp add` there shows the `golem mcp add --catalog` command to copy.

### From a terminal

Run `golem mcp add`. Put the server's command after `--`:

```bash
golem mcp add git -- uvx mcp-server-git --repository /path/to/your/repo
```

To add one from the same list, give its id. golem asks for a token, hidden, when the server needs one. Give an input with `--input`, and a different name with `--name`:

```bash
golem mcp add --catalog github
golem mcp add --catalog filesystem --input folder=/path/to/docs --name docs
```

For a server that is not on the list, give its URL. With `--token`, golem asks for the token and keeps it in the Keychain:

```bash
golem mcp add github --url https://api.githubcopilot.com/mcp/ --token
```

golem writes `[mcp.<name>]` to `~/.golem/config.toml` and starts the server, with no restart. `golem mcp remove git` deletes it again, and its token with it.

A command that needs a token gets it in an environment variable: add `--token-env API_TOKEN`.

You can write the table yourself instead. Add it to `~/.golem/config.toml`:

```toml
[mcp.git]
command = "uvx"
args = ["mcp-server-git", "--repository", "/path/to/your/repo"]
```

golem notices the change and starts it, with no restart. The model sees its tools as `mcp__git__<tool>`.

### Add with more settings

The same command takes the other settings of a server:

```bash
golem mcp add github --url https://api.githubcopilot.com/mcp/ --token --on-demand
golem mcp add db --env DB_URL=postgres://localhost/app --env DB_PASSWORD --timeout 60 -- uvx mcp-server-postgres
```

A variable or header whose name looks like a secret (`TOKEN`, `KEY`, `PASSWORD`, `Authorization`) goes to the Keychain. Give just its name, as `--env DB_PASSWORD`, and golem asks for the value, hidden, so it never lands in your shell's history. `--project` writes the folder's `.golem/config.toml`, which needs a trusted project. When the server is written, golem starts it once and shows each step. If that fails it tells you what to try, and the server stays.

To try a server from the list first, run `golem mcp test --catalog fetch`. It starts the entry without saving it.

### See and control your servers from a terminal

```bash
golem mcp list                          # state, tools, token cost, and marks
golem mcp show github                   # its setup, and which secrets are stored
golem mcp test github                   # start it, list its tools, ping it
golem mcp logs github -f                # its log, and new lines as they come
golem mcp tools github --hide 'delete_*'   # keep some tools from the model
golem mcp enable github --on-demand     # on only in the chats that turn it on
golem mcp restart github
golem mcp edit github                  # its tables in $EDITOR
golem config edit                       # the whole file, with the same checks
```

`golem mcp test` prints each step as it ends. When it fails it shows what the server said on stderr and one next step, such as installing Node. A pattern in `--hide` is written to `tools.exclude` of the server, and `--show` with the same pattern takes it out again.

## Bring your servers from another app

If you already set servers up in Claude Desktop, Claude Code, Cursor, VS Code, or Windsurf, golem can read them. It looks at each app's config file and, for the project you are in, that project's own files. Pasted JSON works too: any of those files' shapes, or one server on its own.

golem only reads those files. It never changes one.

What happens to each server:

- A command or URL server comes over as it is. A server marked `disabled` comes in turned off.
- A token in `env`, or in a header such as `Authorization: Bearer …`, goes to your Keychain and the config names it as `keychain:mcp/<name>`. The value is never written to `config.toml` and never sent back to the screen.
- A value that only names a secret, such as VS Code's `${input:token}`, comes in without a value. golem says so, and you type the value when you import it, or set it later.
- A server that uses the old SSE transport is imported with a warning, because golem doesn't speak it yet.
- Names are made to fit: `_`, `.`, and spaces become `-`, and a name that is already taken gets `-2`. A server golem already has with the same command or URL is marked as already added.

In a terminal, run `golem mcp import`. It lists what it found, numbered, and asks which to add. Type numbers, `2=my-name` to rename one, or `a` for every new one. `--from cursor` looks at one app, `--from ./servers.json` reads a file, and `--all` adds every new server without asking. A value another app only named, such as `${input:token}`, is asked for, hidden.

### Send your servers to another app

`golem mcp export` prints your servers as the JSON those apps read:

```bash
golem mcp export                       # Claude Desktop, Claude Code, Cursor, Windsurf: mcpServers
golem mcp export --format vscode       # VS Code: servers
golem mcp export --scope project       # the project you are in, not your own servers
```

A secret is never printed. `keychain:mcp/github` becomes `${MCP_GITHUB}` (`${env:MCP_GITHUB}` for VS Code), and golem tells you on stderr which variable to set. A tool filter and an approval setting have no place in those formats, so they are left out, and golem says so.

## Manage servers in the chat

Type `/mcp` to see your servers:

- which are running, and what their tools cost in each prompt. A row also says how many tools are hidden from the model, and `allow` when its calls run without asking;
- open one to see its tools. Press Space on a tool to hide it from the model, or to show it again. This edits `tools.exclude` of the server. Press Enter on a tool to try it: type its arguments as JSON, and golem runs it at once, without asking. A try is not part of any chat;
- test the connection, and watch each step as it ends, so you see why a server fails;
- read the server's log, which keeps coming in while it is open;
- reconnect one, turn it off, or remove it. Remove asks first, and drops the token it stored in the Keychain. A project's server is not removed from here: change that project's `.golem/config.toml`.

The web UI has the same list at Settings → MCP servers, and `/mcp` there opens it. You can open a server, see its tools, reconnect it, and turn it on or off. Turning on a server that was off asks first and shows the command golem will run.

A server that crashes or stops answering starts again by itself. While it is down, the status line shows `mcp ✗ <name>` in red.

## Approvals

golem asks before every MCP call, because only the server knows what a tool really does. A [rule](./permissions.md#rules) can allow the ones you trust:

```toml
[[rule]]
tool = "mcp__git__git_status"
action = "allow"
```

To allow every tool of one server, set `approval = "allow"` in its table. Your own `[[rule]]`s still come first, so a `deny` rule beats it, and a server in a project's file counts only when the project is in `trusted_projects`.

## Only when you need it

Every server's tools go into every prompt. That costs tokens, and many tools confuse small local models. With `enabled = "on_demand"`, a server stays out until a chat asks for it:

```toml
[mcp.browser]
command = "npx"
args = ["@playwright/mcp"]
enabled = "on_demand"
```

Type `/mcp enable browser` in a chat. Only that chat gets the server, and it stays on after a restart. `/mcp disable browser` turns it off again.

## Servers on the web, with a token

golem never keeps a token in the file. `golem mcp add <name> --url <url> --token` stores the token and writes the header for you. To do it by hand, name a Keychain secret, then store it:

```toml
[mcp.github]
url = "https://api.githubcopilot.com/mcp/"
headers = { Authorization = "Bearer keychain:mcp/github" }
```

```bash
golem auth set mcp/github     # prompts for the token
```

## Choose which tools the model gets

A server can offer dozens of tools, and each one's schema costs tokens in every call. `tools` keeps some of them from the model:

```toml
[mcp.github]
url = "https://api.githubcopilot.com/mcp/"
tools = { include = ["list_*", "get_*"], exclude = ["get_secret_scanning_*"] }
```

Both lists are patterns on the server's own tool names, such as `list_issues`, not the `mcp__github__list_issues` name the model sees. An empty `include` means every tool, and `exclude` wins. The model never sees a hidden tool, and it costs nothing in a prompt. A tool list for a server still shows hidden tools, marked as hidden.

## Per project

A project's `.golem/config.toml` can add servers for chats in that folder, once you list the folder in `trusted_projects` in your own config.

## Server settings

| Setting | Default | Meaning |
|---|---|---|
| `command` | | A program to run, on your `PATH` or as a full path. Homebrew's folders and `~/.local/bin` are searched too |
| `args` | `[]` | Its arguments |
| `env` | `{}` | Extra environment variables. A server sees only these, plus `HOME`, `PATH`, and a few basics |
| `env_passthrough` | `[]` | Names of variables from golem's own environment to hand to the server. Not for secrets: a name such as `GITHUB_TOKEN` is refused, so use `env` with a Keychain secret. Under launchd golem has no shell environment, so a variable from your shell may not be there |
| `cwd` | your home, or the project | Where the server runs |
| `url` | | An HTTP server's address, instead of `command` |
| `headers` | `{}` | Headers sent with every request to `url` |
| `enabled` | `true` | `"on_demand"` for chats that run `/mcp enable`, or `false` to keep the settings without starting it |
| `timeout_seconds` | `120` | The longest one tool call may take |
| `tools` | all | `include` and `exclude` patterns for the tools the model gets, see above |
| `approval` | `"ask"` | `"allow"` runs this server's calls without asking, after your own rules |

- **Secrets.** A value in `env` or `headers` can name a Keychain secret, `keychain:mcp/<name>`, alone or inside the text. A name that looks like a secret, such as `GITHUB_TOKEN`, must.
- **Names.** A server name may use letters, digits, and `-`.
- **Checks.** `golem doctor` checks that each server's command is found and its secrets are stored. When the daemon is running, it also says whether each server is running or why it failed.

## When a server doesn't work

`golem doctor --mcp` tries each server that is not turned off, the way golem starts it, and prints one line for each with what stopped it and what to do:

```text
✓ mcp git      fake answers with 9 tools
✗ mcp github   initialize: HTTP 401
               The token was refused: paste a new one
✗ mcp notes    resolve: command not found: npx
               Node is missing: golem can install it
```

A test goes through five steps: it finds the command (or the host), starts the process (or connects), shakes hands, lists the tools, and pings. The first step that fails stops the test, and the hint is about that step. A server that is still downloading its package on the first run can time out: try again. The web UI shows the same steps as they happen, and keeps the last 500 lines of each server's log, with its secrets hidden.

How golem talks to servers is in [MCP](../architecture/mcp.md), and why in [ADR-023](../adr/023-mcp-client.md).
