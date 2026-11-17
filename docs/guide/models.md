---
title: Models and API keys
description: Pick, download, and switch models, keep API keys in the Keychain, and give models short names.
---

# Models and API keys

golem works with a local model on your Mac, a hosted one, or both. Each chat runs on one model, and you can switch it at any time.

## Pick a model

The easiest way is inside the chat: type `/model`.

- The picker lists your Ollama models, popular ones to download, and the current hosted models you have a key for. Press Ctrl-A in the picker, or tick **Show all models** in the browser, to also see every other model your key can call. A model to download shows its size, and whether it fits in your Mac's memory.
- A row of tabs under the title filters the list by what a model is for: All, General, Coding, Reasoning, Vision, Fast, and Long context. **Tab** or **→** moves to the next tab, and **Shift-Tab** or **←** to the one before. In the browser the same filters are chips above the list. Each model shows its categories beside it.
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

### The window golem picks

Ollama reloads a model whenever a request asks for another context window, and its own default window can be small. So golem picks one window for each local model and sends it on every call. It is based on the model's size and maximum and your Mac's memory, and a model that does not fit on the GPU at that size is stepped down once, and golem remembers it. It can be below Ollama's default on a Mac with 48 GiB or more, because a very large window costs a lot of memory. To choose yourself, set `[context] window` to a number, or to `"ollama"` to send no window at all and get what Ollama does without golem. A `num_ctx` you set for the model or a chat always wins. golem does not read `OLLAMA_NUM_PARALLEL`, which multiplies the memory a window takes, so keep it at 1 or set the window yourself. See [Settings](./settings.md#context).

When a local chat keeps running close to its window, even after golem cleared old tool results twice or summarised once, and this Mac can hold a larger window, golem moves the model up one step before the next turn. It does this once in ten minutes at most, never above the model's maximum, and never when you set the window (`[context] window` as a number or `"ollama"`, or a `num_ctx` for the model or the chat). A new window reloads the model, which takes seconds to minutes and drops the server's cache of the prompt, so the chat says what happened, for example `window grew 32K → 64K · reloaded in 8 s`, and the meter says `loading <model> with a 64K window` while it loads. If the larger window then spills to the CPU, golem goes back down and does not grow again. To grow by hand, type `/context grow`; it needs no full window, and it tells you when this Mac cannot hold a larger one or the window is yours. The window is planned for the model, not for the chat, so two chats on the same local model share it: when one grows it, both run at the new size, and they never reload each other.

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
| `ollama` | The app running on your Mac. No key |
| `anthropic`, `openai`, `google`, `deepseek`, `xai`, `moonshot` | An API key |

An environment variable such as `ANTHROPIC_API_KEY` wins over the Keychain, which helps in scripts.

### Caps on paid models

`[budget] daily_usd` and `session_usd` cap what hosted models may cost. A cap is checked before each paid call, and a call's cost is known only after it ends, so one call can pass a cap by its own cost. When a cap is spent, a chat that picks its model runs a local one, a chat pinned to a paid model is refused with `budget_spent` (raise the cap in Settings › Routing, or switch the model), and a run that is under way stops before its next paid call. A local model is never blocked. See [Settings](./settings.md#budget).

### The paid question

On `auto`, golem stays on a local model until a turn does not fit any of them. Then it asks before it uses a paid model: "Use a paid model for this?", with the model, its tier and a rough cost for the turn. The web shows a card above the composer, and the terminal a band with keys.

| Answer | Key | What happens |
|---|---|---|
| Allow for this session | `a` | This turn runs on the paid model, and later turns of this chat need no question while the caps hold |
| Just this once | `o` | This turn runs on the paid model, and the next paid turn asks again |
| Stay local | `l` | golem picks again among the local models. If none fits, the turn fails and says why |

The question shows on every screen attached to the chat, and any of them may answer it, once. The turn waits, with no model call made, until someone answers, and it survives a restart of golem. Stop cancels it like any other turn. A chat pinned to a paid model never asks: you chose that model.

`[routing] paid` sets how often golem asks. `ask` asks once and remembers "for this session", `always_ask` asks before every paid turn and remembers nothing (so the first answer behaves like "just this once"), and `never` never asks and never uses a paid model. A fork does not copy the answer: it asks again. A routine never asks and never uses a paid model on `auto`.

With `[budget] over = "ask"`, a spent cap asks the same question ("The daily budget ($2.00) is spent."), with only "Just this once" and "Stay local". The answer is not remembered. A chat pinned to a paid model is still refused when a cap is spent.

## Keep a folder on this Mac

List folders under `[routing] local_only` in `~/.golem/config.toml`, and a chat in one of them, or in a folder inside one, is read only by a local model:

```toml
[routing]
local_only = ["~/work/private"]
```

- A chat pinned to a hosted model there is refused with `local_only` and the message "This folder is local only. Pick a local model with /model." Nothing is sent.
- On `auto`, hosted models are never picked, whatever you agreed to and whatever the budget. If only a hosted model is left, the turn is refused.
- Titles, summaries, `/compact` and the commit message the Changes screen suggests also use only a local model. When there is none, a title is the first line of your message and a summary is refused.
- A project can mark itself private: put `[routing]` with `local_only = true` (a boolean, not a list) in its `.golem/config.toml`. It counts without trusting the project, because it can only make a chat more private. It applies to the folder holding the file and to every folder below it.
- A chat whose folder is set by its first message becomes local only with that message.
- The chat shows a `local only` tag next to its folder in the web app, and in the status line of the terminal.

"Local only" is about which model reads your chat. Web fetch, web search and MCP servers are not model calls, and it does not block them. Turn them off in [Settings](./settings.md) if the folder needs that too.

### See and change the route

A chat's route mode says how it picks the model of each turn: `pinned` (the model you chose), `local` (never a hosted model), or `auto` (local first, a hosted model only when the routing rules allow it). The new mode applies from the next turn.

- **Web:** the route chip next to the permission chip. Its popover has the switch, the ladder of tiers with each model's state, and today's spend against the `[budget]` caps.
- **Terminal:** `/route` prints the mode, the ladder, and the spend. `/route pinned`, `/route local`, and `/route auto` set the mode. `/route why` prints why the last answer used its model: the picked one, then each model that was left out and why. The status line shows the mode after the model, and hides it on `pinned`.

An answer that ran on a model other than the chat's own starts its footer with a note, such as `↑ deepseek-chat · did not fit in 32K`. The arrow is there when the model is in a higher tier than the chat's. The model pickers show each model's tier: `local`, `budget`, or `frontier`.

### How a model did

golem counts, on this Mac, how often a model's tool calls were invalid, how often a run had to step up to a stronger model, and how often you asked for another model. The model list shows a line such as `tool calls 96% ok · stepped up 2 of 41 runs`. The tool part appears after 20 tool calls and reads the last 200.

On route `auto`, a local model below 50% valid tool calls is left out of calls that need tools while another model can take them, and `/route why` says so. A model you update recovers by itself as new calls come in. To start a model's score again, run `golem models score --reset <ref>`; your usage and costs are kept.

### Test a model before you trust it

`golem models check <model>` asks a model ten small tool tasks and prints how each went, one line per task, then a verdict. The tasks read a file, search, list a folder, answer without a tool, read two files, write a nested todo list, handle a missing argument, use a tool result, pick the right tool from the whole list, and finish a call under a small reply limit. No tool runs: the results it sees are made up, and nothing is written outside golem's home. Each call is judged by the same check golem applies in a real run. A call the model writes as text that golem can read counts as recovered (`~`).

```
qwen3:27b on this Mac
✓ read a file             1.2 s
~ nested arguments        2.0 s   written as text, recovered
✗ missing argument        1.1 s   invalid arguments for read_file: path: Field required
8 of 10 passed · 1 recovered · tool calls look reliable
```

Nine or ten tasks working (passed or recovered) is `reliable`, seven or eight is `usable; golem will step up when it fails`, fewer is `not recommended for tool work`. The result also seeds the score above: until a model has 20 real tool calls, its tool score is the share of tasks that worked. Checking a hosted model works too and costs a few cents; the cost is printed at the end.

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

All settings live in `~/.golem/config.toml`. `golem config show` prints the ones in effect for the folder you are in, with the tool rules. Every key is in [Settings](./settings.md); these are the ones for models.

| Setting | Default | Meaning |
|---|---|---|
| `default_model` | picked on first start | A profile name, or a `provider/model-id` |
| `[models.<name>]` | none | `model`, optional `ctx`, optional `price = { input = 3.0, output = 15.0 }` in USD per million tokens |
| `[providers.<name>]` | built-in | `kind` (`anthropic`, `openai`, `google`, `xai`, `ollama`, `openai_compat`), `base_url`, `api_key_env` |
| `[ollama]` | | `start = true` lets golem start a local Ollama, `idle_stop_minutes = 30` stops the one it started (0 never) |
| `session_titles` | `true` | Name each chat after its first answer, with one extra model call |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, or `ERROR` |
| `[shell]` | | `network = false`, `writable = []`, `timeout_seconds = 120` |
| `[web]` | | `allow_private = false`, `max_bytes = 5000000`, `timeout_seconds = 20`, `search = "duckduckgo"` |

- **From the environment.** Every setting can also come from an environment variable: `GOLEM_` plus the name in capitals, for example `GOLEM_LOG_LEVEL`.
- **When it applies.** Model settings apply at once. For the others, restart the daemon with `golem daemon restart`.
- **Tool rules** (allow, ask, or deny a tool by name or path) live in the same file, or in a project's `.golem/policy.toml`. [Tools and permissions](./permissions.md) explains them, and the `[shell]` and `[web]` settings.
- **MCP servers and skills** have their own pages: [MCP servers](./mcp.md) and [Skills](./skills.md).

## Next

[Commands](./commands.md): every command, in the shell and in the chat.
