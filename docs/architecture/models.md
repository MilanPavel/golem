---
title: Talking to models
description: What a model call really is, how streaming, tokens, and cost work, and how golem reaches local and hosted models through one router.
order: 2
adrs: [26, 35]
---

# {{ $frontmatter.title }}

[The agent loop](./agent-loop.md) calls the model again and again. But "the model" is not one thing. It can be a server on the other side of the world, or a program on your own Mac, and each one speaks its own dialect. So what actually happens inside one model call, and how does an agent switch between models without changing anything else?

## The idea

::: concept In agents generally

A model call is an HTTP request. The program sends the conversation so far, and the list of tools, to a server that runs the model. The server sends back the reply.

Three things make it more than a plain request:

1. **The reply streams.** A model writes one *token* at a time, a word or a piece of a word. The server sends each one as soon as it exists, so the reply appears as it is written instead of after a long wait.
2. **Everything is counted in tokens.** The model reads the whole conversation on every call, up to its *context window*, the most tokens it can see at once. Hosted models charge per million tokens, for what they read and for what they write. A long chat costs more with every call, because each call reads all of it again.
3. **Where the model runs is a choice.** A *hosted* model runs on the provider's servers: large and fast, but it needs an API key, it costs money, and your conversation leaves your machine. A *local* model runs on your own computer: free and private, but smaller, and it needs memory and disk.

The code that decides *which* model answers is usually kept apart from the code that *uses* the answer. Then a model can change without the agent changing.

![Where a model runs: a hosted API on the provider's servers, paid per token, or a local server on your own Mac, free and private. In both, the request goes down and the tokens stream back](../images/models-where.svg)

:::

## How agents usually do it

Each provider has its own API: Anthropic's Messages API, OpenAI's Chat Completions and Responses. Many others copy OpenAI's shape, so "OpenAI-compatible" has become a common second language. Local servers such as Ollama, LM Studio, and vLLM speak it too, and Ollama also has its own native API.

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| One provider's SDK | The agent calls one API directly | Every feature of that model, the least code | Changing provider means rewriting the calls |
| A wrapper library | One interface in the code, one adapter per provider | Swap a model by name, mix local and hosted | A layer that lags behind each provider's newest features |
| A gateway service | One hosted API in front of many models | One key for hundreds of models | Another company sees your traffic, and adds its own margin |
| A local server | A program on your machine serves open models over HTTP | Private, free, works offline | Needs memory and disk, and small models do less |

These mix freely: a wrapper library can call a gateway for hosted models and a local server for the rest.

Some questions are still open everywhere:

- **Which model for which step.** A big model for planning and a small one for a quick lookup is cheaper, but deciding when to switch is hard.
- **Tools on small models.** Not every model can call tools, and smaller ones call them less reliably.
- **Knowing the cost before you pay it.** Prices and context sizes change, and they are spread across providers.

## How golem does it

::: golem In golem

golem uses a wrapper library, LangChain's chat models, behind its own **model router**. `call_model` never knows which provider it is talking to. It hands the router a name, and gets back a chat model to call.

![golem's model router: call_model gives it a profile name, it resolves the name to a provider, local or hosted, and the reply streams back as tokens](../images/models-router.svg)

One model call, in the order it runs:

1. **A name.** Each session stores a model name. It is either a *profile* from your `config.toml`, such as `qwen`, or a *ref*, a provider and a model id, such as `ollama/qwen3:8b`.
2. **The router resolves it.** It looks the profile up, splits the ref on its first `/`, and finds the provider: a built-in one, such as `anthropic`, `openai`, or `ollama`.
3. **A key, if it needs one.** For a hosted provider, the router reads the API key at the moment of the call, from an environment variable or from the macOS Keychain. The key is never written into the chat's saved state.
4. **A local server, if it needs one.** For a model in Ollama on this Mac, golem starts Ollama when nothing answers, and keeps it running while the call holds it.
5. **The call streams.** The chat model streams tokens back. golem sends each piece to your screen as a `message.delta` event.

Here is the daemon's log of a session that switches model and then calls a server that is not running. It was recorded against a throwaway home with two profiles on an OpenAI-compatible server, `local` and `other`:

```text
seq  event               data
1    session.created     local → vllm / qwen3
2    model.selected      other → vllm / llama3   reason: user
3    message.completed   user  "hello"
4    run.started
5    message.started     assistant
6    run.failed          model_unreachable  vllm
```

Line 2 is `/model other`: the switch is a stored fact, and it applies from the next run. Line 6 is what a client can act on, not a stack trace: the `code` `model_unreachable`, the `provider` `vllm`, the message `vllm at http://127.0.0.1:59999/v1 is not answering`, and the `hint` `check that it is running`.

**Where it lives in the code:**

- `packages/daemon/golem/models/router.py`: `ModelRouter`, with `resolve`, `chat_model`, `api_key`, and `unreachable`.
- `packages/daemon/golem/models/keys.py` and `packages/daemon/golem/secrets.py`: the keys, in the Keychain.
- `packages/daemon/golem/models/ollama.py`: `LocalServer`, which starts and stops a local Ollama.
- `packages/daemon/golem/models/discovery.py`: every model you can use or download, for `/model` and `golem models`.
- `packages/daemon/golem/models/pulls.py`: downloads.

:::

## Why this way

**A wrapper library, behind golem's own router.** LangChain's chat models give one streaming interface over Anthropic, OpenAI, Ollama, and any OpenAI-compatible server, so a new provider is mostly a preset. The router is golem's own, so the choice of model stays ordinary Python, outside the graph ([The agent loop](./agent-loop.md#what-the-graph-owns-and-what-it-calls)). Phase 9 ([#110](https://github.com/MilanPavel/golem/issues/110)) builds on it: tokens and cost per answer, a cheap profile for small jobs, and stepping up to a bigger model when a small one struggles. Until then, golem shows each model's price and context in the picker, and doesn't count each answer yet.

**Local first, so golem runs the local server for you** ([ADR-026](../adr/026-local-model-server.md)). A stopped Ollama used to mean a failed run, and a command to type. Now golem starts it when something needs it. The hard part is stopping it: you may run Ollama yourself, with `brew services` or the app. So golem owns only a server it started, and it never stops any other.

**golem installs Ollama, and checks a key before it keeps it** ([ADR-035](../adr/035-daemon-installs-ollama.md)). A first start should end in a working chat, so the daemon can install Ollama with Homebrew after one question, and `auth.set` tries an API key against its provider before it stores it.

**Keys live in the Keychain, never in a file.** A config file gets copied, shared, and committed. A setting with a key in it does not load, and the error points to `golem auth set`.

## Try it

1. Type `/model` in the chat. You see your local models, popular ones to download with their size, and every hosted model you have a key for, with its price and context.
2. Pick another model, and type `/debug wire`. The next message shows `model.selected`, then a run with many `message.delta` lines: the tokens, as they stream.
3. In a shell, `golem models` prints the same list. `golem models --refresh` asks each provider again.
4. `golem auth list` shows which providers have a key, without showing the keys.

## The details

For contributors: the reference for the router, keys, the local server, downloads, and the model list.

### The router and keys

![How golem finds a provider's key at each model call: first the environment variable that api_key_env names, then the macOS Keychain. With no key, the call fails and names /login](../images/models-keys.svg)

**Never in a file.** API keys are never in the file, and a table with a key such as `api_key`, `token`, `password`, or `secret` does not load: the error points to `golem auth set`.

**One store for every secret.** Every secret golem keeps is in one store, `golem/secrets.py`: the Keychain, service `golem`, through `keyring`, cached in the daemon, with names in namespaces:

| Name | What it holds |
|---|---|
| `provider/<name>` | A model provider's key, stored with the provider name alone as the account |
| `mcp/<server>` | An MCP server's token |
| `hook/<name>` | A hook endpoint's token |

A setting that needs a secret names it as `keychain:<name>` and the daemon resolves it when it uses it.

**Finding a key at each model call** (`golem/models/keys.py`):

1. The router reads the environment variable named by `api_key_env`.
2. Then the provider's key from that store.
3. A provider with `api_key_env` fails without a key, and the error names `/login <provider>`. Other providers, except `ollama`, use a stored key when there is one.

**Only the daemon writes them.** Only the daemon writes those items, through `auth.set`, so the Keychain lets it read them without a prompt. A frozen daemon from `just dist` is a different executable from a checkout's Python. After its first successful read of each item, it deletes the item and writes it again so it owns it, and lists the name in `run/keychain-migrated` so this happens once.

**Model edits need no restart.** The model router re-reads `config.toml` when its modification time changes. A file that no longer validates keeps the last good models and logs a warning.

### Switching a session's model

`session.set_model` switches a session to a profile or ref.
- The daemon checks that the name resolves and that its provider has a key.
- It stores `model.selected`, with the name asked for, what it resolved to, and `reason: user`. The projection updates `sessions.model_profile`.
- The switch applies from the next run, and a run in progress keeps its model. Each turn passes the session's current model into graph state.
- The conversation in the checkpoint carries over unchanged, so the new model sees the whole history.
- Choosing the model the session already has stores nothing.

`model.set_default` writes `default_model` into the user's `config.toml` with `tomlkit`, which keeps comments and layout (`golem/config_edit.py`). The router picks the change up on its next read.

`model.options.set` saves options for a model in `config.toml`, and sends `model.options.saved` with the model and everything saved for it to every welcomed connection, so an open tune panel in another client shows the change at once. It is not stored.

### Model errors

A run ends in `run.failed` with a `message` and no traceback. A failure a client can act on also has a `code`. `model_unreachable`: the model's server did not answer. `not_installed`: the model needs a local Ollama, and no `ollama` binary is on `PATH` or at a known install path. Either comes with the `provider` and a `hint` that says how to fix it, such as `run ollama serve`.

### The local model server

![A local Ollama's life: when something needs it, golem checks whether one answers. If not, it runs ollama serve and waits up to 60 seconds, holds it while calls use it, and stops it after 30 idle minutes or when golem stops. A server that already answered is external: golem uses it and never stops it](../images/models-local-server.svg)

The daemon starts a local Ollama when a model call, `model.list`, or a download needs it and nothing answers (`LocalServer` in `golem/models/ollama.py`, [ADR-026](../adr/026-local-model-server.md)).

**Starting it.**
- It looks for the `ollama` binary on `PATH` and at the Homebrew and app paths.
- It runs `ollama serve` with its output in `logs/ollama.log`.
- It waits up to 60 s for `/api/tags` to answer. Ollama answers only once its GPU discovery ends, which can take its full 15 s watchdog on the first start after an install.

**Who owns it.**
- A server that already answered is `external` and is never stopped.
- One golem started has its pid in `run/ollama-<port>.pid`, so a restarted daemon takes it back.

**Stopping it.** It stops when the daemon stops, and after `[ollama] idle_stop_minutes` with nothing holding it.

**What clients see.** Each change goes out as `model.server.status`. A start that fails ends the run with `model_unreachable` and the log file in `hint`.

**Installing Ollama.** The daemon also installs Ollama, on `ollama.install`. It runs `/opt/homebrew/bin/brew install ollama` by its absolute path, since launchd gives it no `PATH` of yours, with auto-update and analytics off, and streams brew's output to every connection ([ADR-035](../adr/035-daemon-installs-ollama.md)).

**Setup status.** `setup.status` returns the `golem doctor` checks, each with the part of golem it is about and what a setup screen can do about it.

### Downloads

Downloads go through Ollama (`golem/models/pulls.py`):
- **`model.probe`** reports whether a model is installed, whether the Ollama registry has it, its download size (from the registry manifest, `golem/models/registry.py`), whether it fits in memory, and the free disk space.
- **`model.pull`** starts a daemon task that streams Ollama's `/api/pull`, so it keeps going after the client closes. It refuses a name the registry does not know, or a download the disk cannot hold, with error `-32009` and a message that says what to do.
- **Progress:** it is summed over layers and goes out as `model.pull.progress` at most four times a second, and `model.pull.done` goes out at the end. Both go to every welcomed connection. They are the first notifications outside a session, and they are not stored, because a download is not a fact about any session.
- **After reattaching:** `model.list` marks a running download as `pulling` with its progress, so a client that attaches later still sees it.
- **`model.pull_cancel`** stops the task; Ollama keeps the fetched layers for the next try. **`model.delete`** calls `/api/delete`.

### The model list

`model.list` returns `default` (null before one is chosen), this machine's `ram_gb`, `disk_free_gb` in the home folder where Ollama keeps its models, a list of providers with their status (`ready`, `needs_key`, `server_down`, `not_installed` for a local Ollama with no binary, or `unlisted` when nothing uses one yet), and one entry per model ref. Each entry has `categories`, from the fixed set general, coding, reasoning, vision, fast, and long-context, in that order. A catalog model has the catalog's own. Any other model gets general, plus vision and reasoning from Ollama's `/api/show` `capabilities` (`vision`, `thinking`) or LiteLLM's `supports_vision` and `supports_reasoning`, plus long-context when its context holds 200,000 tokens or more. A catalog model carries the catalog's `tags`, and one is `recommended`: the largest entry tagged `starter` whose `min_ram_gb` this Mac has (`models/data/catalog.toml`). With no Ollama binary, a catalog model is `not_installed`, one install away, and the picker labels it `install`. `setup` says where the user is, for a first-run screen in the TUI or the browser: `ollama_installed`, `ollama_running`, `keys` (the providers with a key), and `default_status`, the default model's status, `unknown` when golem does not list it, or null with no default.
- **Where entries come from** (`golem/models/discovery.py`):
  - installed Ollama models, from `/api/tags`, with `/api/show` filling in what an older Ollama leaves out;
  - local models to download, from the bundled `catalog.toml`;
  - each keyed provider's own list (Anthropic, OpenAI, Google, xAI, and `<base_url>/models` for DeepSeek and Moonshot), cut down to the hosted models of `catalog.toml`. A dated snapshot such as `gpt-6-luna-2026-05-01` stands for its catalog ref. `model.list` with `show_all: true` also lists the live models LiteLLM marks as chat models that call tools. A model whose LiteLLM `deprecation_date` has come is never listed;
  - profiles and `default_model`, so a configured model is always listed.
- **What an entry carries:** its status (`ready`, `needs_key`, `not_installed`, or `server_down`), the profile names that point at it, context size, tool support, price in USD per million tokens, download size, and whether it fits in memory.
- **Price and context precedence:** the profile, then the provider's own list (Ollama), then LiteLLM (`golem/models/prices.py`).
- **Caching and time limit:** hosted lists are cached for a day under `cache/`. A listing waits at most 2 seconds for the network. A slower fetch keeps running, and its result is used next time, with `stale` set on what was shown meanwhile. `refresh: true` skips the cache.
- **The window of a local model:** Ollama runs a model at its own default window unless `num_ctx` is sent, so the listing's context size is the model's maximum, not the window. golem finds the window from what it sent, then from Ollama's `/api/ps`, then from the Modelfile, and shows an estimated one with a leading `≈` ([ADR-043](../adr/043-ollama-context-window.md)).

| File | What it does |
|---|---|
| `packages/daemon/golem/models/router.py` | `ModelRouter`: names to chat models, keys, and unreachable errors |
| `packages/daemon/golem/models/keys.py` | A provider's key: the environment, then the Keychain |
| `packages/daemon/golem/secrets.py` | The one store for every secret, in the Keychain |
| `packages/daemon/golem/models/ollama.py` | `LocalServer`: start, hold, and stop a local Ollama |
| `packages/daemon/golem/models/install.py` | Installing Ollama with Homebrew |
| `packages/daemon/golem/models/pulls.py`, `registry.py` | Downloads, and sizes from the registry |
| `packages/daemon/golem/models/discovery.py` | `model.list`: every model, with status, price, and size |
| `packages/daemon/golem/models/prices.py`, `catalog.py`, `hardware.py` | Prices from LiteLLM, the local catalog, and this Mac's memory |
| `packages/daemon/golem/models/errors.py` | `ModelUnreachable` and its codes |

## Read more

- Next: [The daemon](./daemon.md), where the agent runs, apart from its windows.
- Before: [The agent loop](./agent-loop.md).
- [Models and API keys](../guide/models.md), the user's guide to the same thing.
- [The overview](../architecture.md): the whole system on one page.
- [Ollama's API](https://github.com/ollama/ollama/blob/main/docs/api.md), for what a local model server answers.
