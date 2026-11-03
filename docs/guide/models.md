---
title: Models and API keys
description: Pick, download, and switch models, keep API keys in the Keychain, and give models short names.
---

# Models and API keys

golem works with a local model on your Mac, a hosted one, or both. Each chat runs on one model, and you can switch it at any time.

## Pick a model

The easiest way is inside the chat: type `/model`.

- The picker lists your Ollama models, popular ones to download, and every hosted model you have a key for. A model to download shows its size, and whether it fits in your Mac's memory.
- **Enter** switches the current chat. The next message uses the new model.
- **`d`** switches it, and also makes it the default for new chats.
- **`x`** removes a downloaded model.

You can also skip the picker:

| Command | What it does |
|---|---|
| `/model ollama/qwen3:8b` | Switches this chat to that model |
| `/model pull <name>` | Downloads any Ollama model |
| `/model rm <name>` | Removes a downloaded model |

In a shell, `golem models` lists every model you can use or download, with its size, price, and context. golem keeps the hosted lists and the prices for a while; `golem models --refresh` fetches them again.

## Local models

A local model runs in [Ollama](https://ollama.com), on your Mac. It's free, it needs no account, and nothing leaves the machine. It needs a few GB of disk and memory.

- **Nothing to install first.** On the first start, or in `/setup`, **On this Mac** installs Ollama with Homebrew, or opens its download page and goes on when Ollama appears. Then it lists the models sized for your Mac, with one marked `recommended`, and downloads the one you pick with its speed and time left. Esc keeps the download going in the chat.
- **golem starts Ollama** when a local model needs it, and stops it after 30 minutes unused. Its log is `~/.golem/logs/ollama.log`.
- **Your own Ollama wins.** If you run Ollama yourself, for example with `brew services start ollama`, golem uses that one and never stops it.

[LM Studio](https://lmstudio.ai) works too: keep the app running with its server on, and its models appear in the picker.

## Hosted models and API keys

A hosted model needs an API key from its provider. golem keeps the key in the macOS Keychain, never in a file.

```bash
golem auth set anthropic     # prompts for the key; nothing is echoed
golem auth list              # which providers have a key
golem auth remove anthropic  # delete it from the Keychain
```

golem tries the key with the provider before it saves it. A key the provider refuses is not saved, and golem says why, for example `anthropic rejected the key (401 · invalid x-api-key)`. Offline, add `--no-check` to save it anyway.

In the chat, `/login` opens the key panel: pick the provider, then paste the key, or use the one your shell has. golem checks it and says why when the provider refuses it. `/login anthropic` goes straight to the key, and `/logout anthropic` removes it. A model whose provider has no key shows `needs key` in red.

| Provider | What you need |
|---|---|
| `ollama`, `lmstudio` | The app running on your Mac. No key |
| `anthropic`, `openai` | An API key |
| `openrouter`, `groq`, `together` | An API key, for hosted open models |

An environment variable such as `ANTHROPIC_API_KEY` wins over the Keychain, which helps in scripts.

## Short names, and other providers

golem reads `~/.golem/config.toml`, and picks up model changes without a restart. A **profile** gives a model a short name:

```toml
default_model = "qwen"             # what new chats start on

[models.qwen]
model = "ollama/qwen3:8b"
ctx = 32768                        # optional context size for Ollama

[models.sonnet]
model = "anthropic/<model-id>"
price = { input = 3.0, output = 15.0 }   # optional, USD per million tokens
```

Then `/model qwen` switches to it. Any OpenAI-compatible server works too:

```toml
[providers.vllm]
base_url = "http://127.0.0.1:8000/v1"
api_key_env = "VLLM_API_KEY"       # optional
```

## Settings

All settings live in `~/.golem/config.toml`. `golem config show` prints the ones in effect for the folder you are in, with the tool rules.

| Setting | Default | Meaning |
|---|---|---|
| `default_model` | picked on first start | A profile name, or a `provider/model-id` |
| `[models.<name>]` | none | `model`, optional `ctx`, optional `price = { input = 3.0, output = 15.0 }` in USD per million tokens |
| `[providers.<name>]` | built-in | `kind` (`anthropic`, `openai`, `ollama`, `openai_compat`), `base_url`, `api_key_env` |
| `[ollama]` | | `start = true` lets golem start a local Ollama, `idle_stop_minutes = 30` stops the one it started (0 never) |
| `session_titles` | `true` | Name each chat after its first answer, with one extra model call |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, or `ERROR` |
| `[shell]` | | `network = false`, `writable = []`, `timeout_seconds = 120` |
| `[web]` | | `allow_private = false`, `max_bytes = 5000000`, `timeout_seconds = 20` |

- **From the environment.** Every setting can also come from an environment variable: `GOLEM_` plus the name in capitals, for example `GOLEM_LOG_LEVEL`.
- **When it applies.** Model settings apply at once. For the others, restart the daemon with `golem daemon restart`.
- **Tool rules** (allow, ask, or deny a tool by name or path) live in the same file, or in a project's `.golem/policy.toml`. [Tools and permissions](./permissions.md) explains them, and the `[shell]` and `[web]` settings.
- **MCP servers and skills** have their own pages: [MCP servers](./mcp.md) and [Skills](./skills.md).

## Next

[Commands](./commands.md): every command, in the shell and in the chat.
