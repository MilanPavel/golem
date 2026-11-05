---
title: MCP servers
description: Give golem more tools with MCP servers, local or on the web, and keep their tokens in the Keychain.
---

# MCP servers

Any [MCP](https://modelcontextprotocol.io) server gives golem new tools: a git server, a browser, your issue tracker. golem starts the server, lists its tools for the model, and asks before every call.

## Add a server

### From a chat

Type `/mcp add`. golem shows four choices:

- **Filesystem** lets golem read and write files in the chat's folder.
- **GitHub** asks for a token. The prompt hides what you type, and the token goes to the Keychain. It says how to make one: at github.com/settings/personal-access-tokens/new, pick the repos under Repository access, then add Contents, Issues, and Pull requests.
- **Fetch** reads web pages as text.
- **Other** asks for a name, then a command or a URL. For a token, use `golem mcp add --token` below.

`/mcp add github` goes straight to the token. With no servers yet, `/mcp` shows the same choices. The web UI cannot add a server. `/mcp add` there shows the `golem mcp add` command to copy.

### From a terminal

Run `golem mcp add`. Put the server's command after `--`:

```bash
golem mcp add git -- uvx mcp-server-git --repository /path/to/your/repo
```

For a server on the web, give its URL. With `--token`, golem asks for the token and keeps it in the Keychain:

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

## Manage servers in the chat

Type `/mcp` to see your servers:

- which are running, and what their tools cost in each prompt;
- open one to see its tools;
- reconnect one, or turn it off.

A server that crashes or stops answering starts again by itself. While it is down, the status line shows `mcp ✗ <name>` in red.

## Approvals

golem asks before every MCP call, because only the server knows what a tool really does. A [rule](./permissions.md#rules) can allow the ones you trust:

```toml
[[rule]]
tool = "mcp__git__git_status"
action = "allow"
```

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

## Per project

A project's `.golem/config.toml` can add servers for chats in that folder, once you list the folder in `trusted_projects` in your own config.

## Server settings

| Setting | Default | Meaning |
|---|---|---|
| `command` | | A program to run, on your `PATH` or as a full path. Homebrew's folders and `~/.local/bin` are searched too |
| `args` | `[]` | Its arguments |
| `env` | `{}` | Extra environment variables. A server sees only these, plus `HOME`, `PATH`, and a few basics |
| `cwd` | your home, or the project | Where the server runs |
| `url` | | An HTTP server's address, instead of `command` |
| `headers` | `{}` | Headers sent with every request to `url` |
| `enabled` | `true` | `"on_demand"` for chats that run `/mcp enable`, or `false` to keep the settings without starting it |
| `timeout_seconds` | `120` | The longest one tool call may take |

- **Secrets.** A value in `env` or `headers` can name a Keychain secret, `keychain:mcp/<name>`, alone or inside the text. A name that looks like a secret, such as `GITHUB_TOKEN`, must.
- **Names.** A server name may use letters, digits, and `-`.
- **Checks.** `golem doctor` checks that each server's command is found and its secrets are stored.

How golem talks to servers is in [MCP](../architecture/mcp.md), and why in [ADR-023](../adr/023-mcp-client.md).
