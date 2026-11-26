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

**A wrapper library, behind golem's own router.** LangChain's chat models give one streaming interface over Anthropic, OpenAI, Ollama, and any OpenAI-compatible server, so a new provider is mostly a preset. The router is golem's own, so the choice of model stays ordinary Python, outside the graph ([The agent loop](./agent-loop.md#what-the-graph-owns-and-what-it-calls)). Phase 9 ([#110](https://github.com/MilanPavel/golem/issues/110)) builds on it: tokens and cost per answer, a cheap profile for small jobs, and stepping up to a bigger model when a small one struggles. golem shows each model's price and context in the picker. Each `model.call.completed` also records what that call cost and the price it used, worked out when the call ends from the call's tokens (a local model costs `0`), so the cost of an answer does not change when prices do. The tokens and cost under each answer, and the totals, come with the other Phase 9 steps.

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
| `data/<source>` | A database source's password |
| `hook/<name>` | A hook endpoint's token |

A setting that needs a secret names it as `keychain:<name>` and the daemon resolves it when it uses it.

**Finding a key at each model call** (`golem/models/keys.py`):

1. The router reads the environment variable named by `api_key_env`.
2. Then the provider's key from that store.
3. A provider with `api_key_env` fails without a key, and the error names `/login <provider>`. Other providers, except `ollama`, use a stored key when there is one.

**Only the daemon writes them.** Only the daemon writes those items, through `auth.set`. On macOS it does so through `/usr/bin/security`, with the command on stdin, so the Keychain trusts a program that is the same in every release ([ADR-021](../adr/021-release-signing.md)). A frozen daemon from `just dist` reads an item an older build saved through `keyring` once, then deletes it and stores it again through `security`, and lists the name in `run/keychain-security` so this happens once. Other systems use `keyring`.

**Model edits need no restart.** The model router re-reads `config.toml` when its modification time changes. A file that no longer validates keeps the last good models and logs a warning.

### Switching a session's model

`session.set_model` switches a session to a profile or ref.
- The daemon checks that the name resolves and that its provider has a key.
- It stores `model.selected`, with the name asked for, what it resolved to, and `reason: user`. The projection updates `sessions.model_profile`.
- The switch applies from the next run, and a run in progress keeps its model. Each turn passes the session's current model into graph state.
- The conversation in the checkpoint carries over unchanged, so the new model sees the whole history.
- A hosted model may answer with parts only its own provider reads, such as OpenAI's `reasoning` and `function_call` parts. A call to another provider sends such a reply as its text, with its tool calls (`_portable` in `graphs/chat.py`). The checkpoint keeps the parts. This holds for every change of model: a switch, a step up, a fallback, and the next turn on route `auto`.
- Choosing the model the session already has stores nothing.

`model.set_default` writes `default_model` into the user's `config.toml` with `tomlkit`, which keeps comments and layout (`golem/config_edit.py`). The router picks the change up on its next read.

`model.options.set` saves options for a model in `config.toml`, and sends `model.options.saved` with the model and everything saved for it to every welcomed connection, so an open tune panel in another client shows the change at once. It is not stored.

`think` is the one option that depends on the model. `model.options.get` sends its row only for a model whose `/api/show` `capabilities` include `thinking`, as a `choice` with `values` (the same list as `think_values` in `model.list`), and `model.options.set` and `session.set_options` check a value against that list. The router maps it to `ChatOllama.reasoning` (`off` is `False`, `on` is `True`, a level is sent as it is), sends nothing when it is unset, and drops a saved value the model does not take.

### Routing a turn

A session has a route mode: `pinned`, `local` or `auto` ([ADR-055](../adr/055-model-routing.md)). A new session takes `[routing] mode`, which is `pinned` by default, and a fork copies the mode of its source. `session.set_route` changes it. The daemon stores `session.updated` with `route`, the projection sets `sessions.route`, and the mode applies from the next turn.

`SessionManager.send` picks the model of a turn when the mode is not `pinned`:
- The candidates come from `ladder`: one local, one budget and one frontier model (the tier picks). The session's own model joins only when its tier has no pick; `_route` still finds it among all the facts, for the last-resort path. Their facts are the cached ones from `ListedFacts`, so `send` never waits for the network.
- The traits are the input tokens of the session's last chat model call plus `len(text) // 4` (none before the first call), `[context] reply_reserve`, tools needed, and `local_only` on mode `local`. `paid_allowed` is true when the session has `paid_ok` and `[routing] paid` is not `always_ask`.
- With `paid = "never"` (and for the sessions of routines), `_route` takes the paid candidates out before the pick and lists each as rejected ("paid models are turned off").
- `pick` returns the choice. When its best model is paid, `_route` returns it with a question to ask first (see the paid question below).
- When nothing passes, the turn runs on the session's own model, with the reason `fallback` and a detail that says no other model passed. When that model is paid, the same question comes first, and with `paid = "never"` the turn is refused. On mode `local` with a hosted session model it is refused instead: "this session is local only and has no local model; pick one with /model".

The turn runs on the picked profile. `sessions.model_profile` stays the user's choice: it is the pinned model and the start of the ladder, and routing never stores `model.selected`. The runner emits `model.routed` right after `run.started`, with the profile, what it resolved to, the tier, the `reason`, a one-line `detail`, and the `rejected` candidates with why. A `pinned` session emits nothing. The run span of `trace.get` carries the same `reason`, `detail` and `rejected` as `route`. Only the model that was picked is waited for while it downloads.

The table below lists situations and the decision each must lead to. It is made from `packages/daemon/tests/data/routing_cases.toml`, which `packages/daemon/tests/test_routing_table.py` runs through `SessionManager.send` (and, for the mid-run cases, the graph) on a daemon with fake facts and scripted models. A change to a rule that moves a decision fails the case that names it. After you change a case, run `just routing-table` and paste its output between the two markers; a test fails while the table here differs. A case that asks the paid question shows the model and reason the answer "once" runs.

<!-- routing-table:begin -->

| Case | Route | Session model | Situation | Model | Reason |
| --- | --- | --- | --- | --- | --- |
| pinned keeps its model, whatever the prompt | `pinned` | `ollama/qwen3:27b` | prompt 41K; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `pinned` |
| pinned runs a paid model the user chose, with no question | `pinned` | `anthropic/opus` | models qwen3:27b, opus | `anthropic/opus` | `pinned` |
| auto, everything fits | `auto` | `ollama/qwen3:27b` | prompt 1K; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| auto on a paid session model still starts on the cheapest model that fits | `auto` | `anthropic/opus` | paid yes; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| auto, the ladder names another local model: it starts the turn, not the session's | `auto` | `ollama/qwen3:27b` | prompt 1K; models qwen3:27b, qwen3:8b | `ollama/qwen3:8b` | `cheapest` |
| auto, the ladder names nothing: the session's local model is the local step | `auto` | `ollama/qwen3:27b` | prompt 1K; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `cheapest` |
| auto, the ladder's model does not fit and no paid model may run: the session's model | `auto` | `ollama/qwen3:27b` | prompt 41K; paid = never; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `fallback` |
| local keeps hosted models out | `local` | `ollama/qwen3:27b` | prompt 1K; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `privacy` |
| local runs a local model when the session model is hosted | `local` | `anthropic/opus` | models qwen3:27b, opus | `ollama/qwen3:27b` | `privacy` |
| local, nothing local fits: the session's model runs anyway | `local` | `ollama/qwen3:27b` | prompt 41K; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `fallback` |
| local with no local model is refused | `local` | `anthropic/opus` | models opus | refused: `model_not_configured` |  |
| too big for local, no yes yet: the paid question comes first | `auto` | `ollama/qwen3:27b` | prompt 41K; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `fit` |
| too big for local, consent given | `auto` | `ollama/qwen3:27b` | prompt 41K; paid yes; daily cap $2.00; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` | `fit` |
| too big for local, paid is never: the local model runs and the paid one is listed | `auto` | `ollama/qwen3:27b` | prompt 41K; paid yes; paid = never; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `fallback` |
| too big for local, paid is always_ask: asks even after a session yes | `auto` | `ollama/qwen3:27b` | prompt 41K; paid yes; paid = always_ask; models qwen3:27b, deepseek-chat | `deepseek/deepseek-chat` after the paid question | `fit` |
| no local model passes and the session model is hosted: asks about it | `auto` | `deepseek/deepseek-chat` | prompt 200K; models qwen3:8b, deepseek-chat | `deepseek/deepseek-chat` after the paid question | `fallback` |
| the daily cap is spent: auto runs local and says so | `auto` | `ollama/qwen3:27b` | paid yes; spent $2.00; daily cap $2.00; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `budget` |
| the session cap is spent: auto runs local | `auto` | `ollama/qwen3:27b` | paid yes; spent $0.60; daily cap $100.00; session cap $0.50; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `budget` |
| a spent cap with over = ask: the question offers this turn only | `auto` | `ollama/qwen3:8b` | prompt 20K; spent $2.00; daily cap $2.00; over = ask; models qwen3:8b, deepseek-chat | `deepseek/deepseek-chat` after the paid question | `fit` |
| a spent cap and a prompt too big for local: the session model runs | `auto` | `ollama/qwen3:8b` | prompt 20K; paid yes; spent $2.00; daily cap $2.00; models qwen3:8b, deepseek-chat | `ollama/qwen3:8b` | `fallback` |
| pinned paid model over a spent cap is refused | `pinned` | `anthropic/opus` | spent $0.02; daily cap $0.01; models qwen3:27b, opus | refused: `budget_spent` |  |
| pinned local model ignores a spent cap | `pinned` | `ollama/qwen3:27b` | spent $5.00; daily cap $0.00; models qwen3:27b, opus | `ollama/qwen3:27b` | `pinned` |
| the session model is not ready: the next tier takes the turn | `auto` | `ollama/down` | paid yes; models down, deepseek-chat | `deepseek/deepseek-chat` | `fit` |
| an unknown window passes the fit rule | `auto` | `ollama/mystery` | prompt 41K; models mystery, deepseek-chat | `ollama/mystery` | `cheapest` |
| no model call yet: the prompt size is unknown and the local model runs | `auto` | `ollama/qwen3:8b` | models qwen3:8b, deepseek-chat | `ollama/qwen3:8b` | `cheapest` |
| after two step-ups the session starts at the budget tier | `auto` | `ollama/qwen3:27b` | paid yes; floor budget; models qwen3:27b, deepseek-chat | `deepseek/deepseek-chat` | `cheapest` |
| a local model that fails tool calls is left out when a budget model can take over | `auto` | `ollama/flaky` | paid yes; models flaky, deepseek-chat | `deepseek/deepseek-chat` | `fit` |
| a local model that fails tool calls still runs when it is the only one | `auto` | `ollama/flaky` | models flaky | `ollama/flaky` | `cheapest` |
| a local model that fails tool calls still runs on local when it is the only local one | `local` | `ollama/flaky` | models flaky, deepseek-chat | `ollama/flaky` | `privacy` |
| local-only folder, pinned hosted model: refused | `pinned` | `anthropic/opus` | local-only folder; models qwen3:27b, opus | refused: `local_only` |  |
| local-only folder, pinned local model runs | `pinned` | `ollama/qwen3:27b` | local-only folder; models qwen3:27b, opus | `ollama/qwen3:27b` | `pinned` |
| local-only folder, local route with hosted models only: refused | `local` | `anthropic/opus` | local-only folder; models deepseek-chat, opus | refused: `local_only` |  |
| local-only folder, local route runs the local model | `local` | `ollama/qwen3:27b` | local-only folder; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` |  |
| local-only folder, auto with a yes and room for paid models stays local | `auto` | `anthropic/opus` | prompt 20K; paid yes; local-only folder; daily cap $100.00; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` |  |
| local-only folder, auto with hosted models only: refused | `auto` | `anthropic/opus` | paid yes; local-only folder; models deepseek-chat, opus | refused: `local_only` |  |
| a struggling run steps up one tier | `auto` | `ollama/qwen3:27b` | paid yes; struggle; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` | `escalated` |
| a struggling run asks the paid question in the middle of the run | `auto` | `ollama/qwen3:27b` | struggle; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `escalated` |
| a struggling run on local does not step up | `local` | `ollama/qwen3:27b` | paid yes; struggle; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `privacy` |
| a struggling pinned run does not step up | `pinned` | `ollama/qwen3:27b` | paid yes; struggle; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `pinned` |
| a struggling run with paid never stays on its model | `auto` | `ollama/qwen3:27b` | paid yes; paid = never; struggle; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `fallback` |
| a struggling run in a local-only folder stays on its model | `auto` | `ollama/qwen3:27b` | paid yes; local-only folder; struggle; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `fallback` |
| a hosted provider that is down falls back to a local model | `auto` | `deepseek/deepseek-chat` | paid yes; floor budget; provider down; models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `fallback` |
| two rate limits fall back to another model of the same tier | `auto` | `deepseek/deepseek-chat` | paid yes; floor budget; rate limited; models qwen3:27b, deepseek-chat, kimi | `moonshot/kimi` | `fallback` |
| a pinned session does not fall back: the run fails with the code | `pinned` | `deepseek/deepseek-chat` | paid yes; rate limited; models qwen3:27b, deepseek-chat, kimi | refused: `rate_limited` |  |
| try again stronger from local asks, then runs the budget model | `auto` | `ollama/qwen3:27b` | stronger; models qwen3:27b, deepseek-chat | `deepseek/deepseek-chat` after the paid question | `user` |
| try again stronger with a session yes runs at once | `auto` | `ollama/qwen3:27b` | paid yes; stronger; models qwen3:27b, deepseek-chat | `deepseek/deepseek-chat` | `user` |
| try again stronger on pinned is refused | `pinned` | `ollama/qwen3:27b` | stronger; models qwen3:27b, deepseek-chat | refused: `model_not_configured` |  |
| try again stronger with paid never is refused | `auto` | `ollama/qwen3:27b` | paid = never; stronger; models qwen3:27b, deepseek-chat | refused: `model_not_configured` |  |
| try again stronger in a local-only folder is refused | `auto` | `ollama/qwen3:27b` | local-only folder; stronger; models qwen3:27b, deepseek-chat | refused: `local_only` |  |
| a title on a local session uses the session's model |  | `ollama/qwen3:27b` | models qwen3:27b, deepseek-chat | `ollama/qwen3:27b` | `session is local` |
| a title on a hosted session uses the cheapest budget model |  | `anthropic/opus` | models qwen3:27b, deepseek-chat, kimi, opus | `deepseek/deepseek-chat` | `cheapest budget model` |
| a title on a hosted session with no budget model uses the session's model |  | `anthropic/opus` | models opus | `anthropic/opus` | `no budget model ready` |
| a title in a local-only folder with no local model falls to the session's model |  | `anthropic/opus` | local-only folder; models deepseek-chat, opus | `anthropic/opus` | `no local model` |
| a title takes the model the settings name |  | `ollama/qwen3:27b` | titles = deepseek/deepseek-chat; models qwen3:27b, deepseek-chat | `deepseek/deepseek-chat` | `configured` |
| a helper in a local-only session stays on the local model |  | `ollama/qwen3:27b` | local-only folder; explore = anthropic/opus; models qwen3:27b, opus | `ollama/qwen3:27b` | `session is local` |
| a helper that the settings send to a hosted model, outside a local-only folder |  | `ollama/qwen3:27b` | explore = anthropic/opus; models qwen3:27b, opus | `anthropic/opus` | `configured` |
| local only: cheapest is the lead's own loaded model |  | `ollama/qwen3:27b` | wish cheapest; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `cheapest` |
| local only: same is the lead's model |  | `ollama/qwen3:27b` | wish same; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `same` |
| local only: stronger is the lead's model with a fresh window |  | `ollama/qwen3:27b` | wish stronger; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` in a fresh window | `lead` |
| local only: a budget wish takes the nearest tier, local |  | `ollama/qwen3:27b` | wish budget; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `nearest` |
| local only: a frontier wish takes the nearest tier, local |  | `ollama/qwen3:27b` | wish frontier; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `nearest` |
| local only: a local wish takes the local model |  | `ollama/qwen3:27b` | wish local; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` | `tier` |
| local only: a named local model |  | `ollama/qwen3:27b` | wish ollama/qwen3:8b; models qwen3:27b, qwen3:8b | `ollama/qwen3:8b` | `named` |
| local only: a named hosted model that is not here is the lead's model |  | `ollama/qwen3:27b` | wish anthropic/opus; models qwen3:27b, qwen3:8b | `ollama/qwen3:27b` in a fresh window | `lead` |
| local only folder: a frontier wish stays on the local model |  | `ollama/qwen3:27b` | local-only folder; wish frontier; models qwen3:27b, opus | `ollama/qwen3:27b` in a fresh window | `privacy` |
| mixed: cheapest is the lead's local model |  | `ollama/qwen3:27b` | wish cheapest; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| mixed: same is the lead's model |  | `ollama/qwen3:27b` | wish same; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `same` |
| mixed, local lead: stronger is the budget tier, after the paid question |  | `ollama/qwen3:27b` | wish stronger; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `stronger` |
| mixed, local lead, chat already paid: stronger asks nothing |  | `ollama/qwen3:27b` | paid yes; wish stronger; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` | `stronger` |
| mixed, local lead: a budget wish asks the paid question |  | `ollama/qwen3:27b` | wish budget; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `tier` |
| mixed, local lead: a frontier wish asks the paid question |  | `ollama/qwen3:27b` | wish frontier; models qwen3:27b, deepseek-chat, opus | `anthropic/opus` after the paid question | `tier` |
| mixed, local lead: a named hosted model asks the paid question |  | `ollama/qwen3:27b` | wish anthropic/opus; models qwen3:27b, deepseek-chat, opus | `anthropic/opus` after the paid question | `named` |
| mixed, budget lead: cheapest goes down to the local model |  | `deepseek/deepseek-chat` | wish cheapest; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| mixed, budget lead: stronger is the frontier tier, after the paid question |  | `deepseek/deepseek-chat` | wish stronger; models qwen3:27b, deepseek-chat, opus | `anthropic/opus` after the paid question | `stronger` |
| mixed, budget lead: same is the lead's model without a question |  | `deepseek/deepseek-chat` | wish same; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` | `same` |
| mixed, frontier lead: cheapest goes down to the local model |  | `anthropic/opus` | wish cheapest; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| mixed, frontier lead: stronger is the lead's model with a fresh window |  | `anthropic/opus` | wish stronger; models qwen3:27b, deepseek-chat, opus | `anthropic/opus` in a fresh window | `lead` |
| mixed, frontier lead: a budget wish takes the budget model |  | `anthropic/opus` | wish budget; models qwen3:27b, deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `tier` |
| mixed without a budget model: a budget wish takes the nearest tier, the cheaper one |  | `ollama/qwen3:27b` | wish budget; models qwen3:27b, opus | `ollama/qwen3:27b` | `nearest` |
| mixed in a local-only folder: stronger stays local with a fresh window |  | `ollama/qwen3:27b` | local-only folder; wish stronger; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` in a fresh window | `lead` |
| mixed in a local-only folder: cheapest is the local model |  | `ollama/qwen3:27b` | local-only folder; wish cheapest; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` | `cheapest` |
| mixed in a local-only folder: a named hosted model stays local |  | `ollama/qwen3:27b` | local-only folder; wish anthropic/opus; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` in a fresh window | `privacy` |
| cloud only, budget lead: cheapest is the lead's model, no question |  | `deepseek/deepseek-chat` | wish cheapest; models deepseek-chat, opus | `deepseek/deepseek-chat` | `cheapest` |
| cloud only, budget lead: stronger is the frontier model, after the paid question |  | `deepseek/deepseek-chat` | wish stronger; models deepseek-chat, opus | `anthropic/opus` after the paid question | `stronger` |
| cloud only, budget lead: same is the lead's model |  | `deepseek/deepseek-chat` | wish same; models deepseek-chat, opus | `deepseek/deepseek-chat` | `same` |
| cloud only, budget lead: a local wish takes the nearest tier, budget |  | `deepseek/deepseek-chat` | wish local; models deepseek-chat, opus | `deepseek/deepseek-chat` | `nearest` |
| cloud only, budget lead: a frontier wish asks the paid question |  | `deepseek/deepseek-chat` | wish frontier; models deepseek-chat, opus | `anthropic/opus` after the paid question | `tier` |
| cloud only, frontier lead: cheapest is the budget model |  | `anthropic/opus` | wish cheapest; models deepseek-chat, opus | `deepseek/deepseek-chat` after the paid question | `cheapest` |
| cloud only, frontier lead: stronger is the lead's model with a fresh window |  | `anthropic/opus` | wish stronger; models deepseek-chat, opus | `anthropic/opus` in a fresh window | `lead` |
| cloud only, frontier lead: same is the lead's model |  | `anthropic/opus` | wish same; models deepseek-chat, opus | `anthropic/opus` | `same` |
| cloud only, frontier lead: a named model that is not here is the lead's model |  | `anthropic/opus` | wish moonshot/kimi; models deepseek-chat, opus | `anthropic/opus` in a fresh window | `lead` |
| mixed, local lead: an unknown name is the lead's model |  | `ollama/qwen3:27b` | wish gpt6-luna; models qwen3:27b, deepseek-chat, opus | `ollama/qwen3:27b` in a fresh window | `lead` |
| cloud only, frontier lead: a named budget model is used, no question |  | `anthropic/opus` | wish deepseek/deepseek-chat; models deepseek-chat, opus | `deepseek/deepseek-chat` | `named` |
| cloud only, one frontier model: cheapest is the lead's model |  | `anthropic/opus` | wish cheapest; models opus | `anthropic/opus` | `cheapest` |
| cloud only, one frontier model: a budget wish takes the nearest tier, frontier |  | `anthropic/opus` | wish budget; models opus | `anthropic/opus` | `nearest` |

<!-- routing-table:end -->

### Stepping up inside a run

On route `auto` a run may move to a stronger model once, when its model struggles or its prompt cannot fit (see [The agent loop](./agent-loop.md)). `SessionManager._next_model` answers the graph's ask:
- A struggle asks for the tier above the current model's (`Traits.min_tier`). `ContextFull` asks for any model whose window takes the prompt estimate the failed call made.
- Privacy, caps and the paid yes are the pick's own: a local-only folder and route `local` keep it on this Mac, a spent cap leaves the paid models out, and `paid = "never"` and routines allow none.
- A paid model needs a yes the session already gave (`paid_ok`, and `paid = "ask"`). Without it a struggle asks the paid question in the middle of the run, once, when the session is interactive, `paid` is `ask` or `always_ask`, the folder is not local only and the caps leave room. `_next_model` then returns a `StepAsk` (the paid model and the `Consent` card, built by `_question`), and the `step_up` node pauses the run with `interrupt()`, the way a tool approval does. The runner stores `route.consent.needed` with `signal` set to the struggle and `why` saying how the model struggles, and the run is `waiting`. `route.consent.answer` finds the question with `pending_consent`; when it has a `signal` it resumes the same run (`Resume.consent`, `ChatRuntime.resume`) instead of starting a turn. `session` sets `paid_ok` (unless `always_ask`) and moves the run, `once` moves this run only, `local` keeps the run on its model with the note below and does not ask again (`stepped_up`). A cancel closes the question like any waiting run, and a restart finds it again in the log and the checkpoint. A failing provider (`fallback`) and `ContextFull` never ask mid-run: the run stays, and `ContextFull` fails with `context_full`. In every other case without the yes, the run logs `model.routed` with the reason `fallback` and "no stronger model is available".
- A success logs `model.routed` with the reason `escalated`, the struggle's detail and the old model's name ("2 invalid tool calls in a row on qwen3:27b", "did not fit in 4K on qwen3:27b").
- `message.send` with `stronger: true` runs one turn on the tier above the model of the newest `model.routed` in the session (a new turn in the same chat, no fork). `_route` takes it as `replaces`: `min_tier` is that tier plus one, the reason is `user` and the detail `you asked for a stronger model`, and the turn's `model.routed` carries `replaces_model` (`provider/model`). The paid question is the one before a turn (`_question`); its `route.consent.needed` carries `replaces_model` too, so the answer finds the same floor. The session's model, route and `step_floor` do not change. It needs route `auto`. A local-only folder fails with `local_only`; no stronger ready model (nothing above, `paid = "never"`, a routine session, or the answer `local`) fails with "No stronger model is ready. Add a key in Settings." and no turn starts.
- The session counts in memory (not stored) the runs each signal stepped up. At the second one the session's later picks start at the stepped-up tier (`_LiveSession.step_floor`).

### The scoreboard

golem remembers how each model did on this Mac. The projection of the event log fills three columns of `model_calls` (`tool_calls`, `bad_tool_calls`, `recovered_text_calls`) and the table `model_outcomes`:
- `tool.requested` adds a tool call to the model call named by its `message_id`. A `tool.failed` for invalid arguments or an unknown tool adds a bad one. A reply whose `text_tool_calls` is `unread` adds a bad call too; `recovered` is only counted. A tool that raised, a denied call and a cancelled call are the world's fault and never count.
- `model.routed` with the reason `escalated` writes a `stepped_up` row for the model that was answering the run.
- A `retried_by_user` row is for the retry on a stronger model; nothing writes it until that retry carries the model it replaces on `model.routed`.

`Scores` (`golem/models/scores.py`) reads them, kept in memory for a minute. `tool_score` is `1 − bad / tool_calls` over the newest 200 tool calls, and unknown under 20. `golem models score --reset <ref>` (`model.score_reset`) stores a `reset_at` for the ref in `model_score_resets`; the score ignores older rows, and no usage row is deleted.

`golem models check` leaves a seed in `model_check_seeds` (`ref`, `working`, `total`, `at`; one row per ref, replaced by the next check). `Scores` uses it as `tool_score` while the real count is under 20 (`Score.seeded` is true then), and ignores a seed older than the ref's `reset_at`. Real use never writes to the table.

`ListedFacts` gives `pick` the `tool_score`. `pick` leaves out a local model below `MIN_LOCAL_TOOL_SCORE` (0.5) for a call that needs tools, only when another candidate passes. `model.list` carries `score` on each model, and the pickers show one line from `scoreLabel` in `packages/view`.

### The paid question

A turn that would run on a paid model without the user's yes becomes a run that starts waiting ([ADR-055](../adr/055-model-routing.md), section 7). `SessionManager.send` makes the run as usual, with the skill, the user's `message.completed` and `run.started`, then stores `route.consent.needed` and stops: no graph runs, no model is called, and the run has no task. The projection marks the run `waiting`, as for an approval, so the session is busy, `session.list` says `waiting`, a reattach replays the question, `run.cancel` ends it with `run.cancelled`, and a restart leaves it waiting (recovery closes only `running` runs).

`route.consent.needed` carries the paid model (`model_profile`, `provider`, `model`, `tier`), `why`, `estimated_usd`, `alternatives` and, when a cap is set, `caps`. The estimate is `cost_usd` of the prompt estimate as input and `[context] reply_reserve` as output at the model's price (the price of its facts, else the profile's), null when there is none. Over a spent cap with `[budget] over = "ask"`, `why` is "The daily budget ($2.00) is spent." and `alternatives` leaves out `session`.

`route.consent.answer` (`session_id`, `run_id`, `answer`) reads the question from the run's events (`sessions/approvals.py`, `pending_consent`) under the manager's lock, so one answer wins and any other gets `-32010`. An answer the question did not offer is `-32602`. It stores `route.consent.answered`, which marks the run `running`, then picks again with `SessionManager._route` and starts a task for the same run (`Turn.begun` skips the events already stored):

| Answer | What the pick does |
|---|---|
| `session` | Stores `session.updated` with `paid_ok` (not with `always_ask`), then picks with the paid models allowed |
| `once` | Picks with the paid models allowed, and over a cap lets this run's paid calls pass `Budget.paid_ok` until it ends |
| `local` | Picks among the local candidates, and `model.routed.detail` is "you chose to stay local". If none passes, the run fails (`context_full` when the reason is fit) |

`sessions.paid_ok` is a column set by `session.updated`. A fork does not copy it. A pinned session never asks, and a spent cap still refuses a pinned paid model with `budget_spent`.

### Helpers and the dispatcher

A helper's model is a wish in its agent file, and `pick_helper` (`models/pick_helper.py`) turns it into a model. It is pure and never fails on an empty tier: the wished tier, then the nearest tier you have, then the lead's model. With local models only, `stronger` is the lead's model in a fresh window. With cloud models only, `cheapest` is the cheapest hosted model and no paid question is asked. A local-only folder or a `local` route keeps every helper local. When a helper would go to a paid model from a local lead, the paid question is asked once for the chat, worded for a helper. The pick is written to the helper's `model.routed` and to `helper.started.pick_reason`.

A helper's model call takes a slot of the dispatcher like any other call, with the role `helper`. A call that waits more than a second tells its lead with `helper.state waiting` and the reason `slot` or `provider`, and the card shows the line, the place in it and the backoff. `[agents] at_once` limits how many helpers of one lead run, and the dispatcher limits how many calls a model runs. See [Helpers](./helpers.md) and [ADR-060](../adr/060-dispatcher-and-engine-profile.md).

### Model errors

A run ends in `run.failed` with a `message` and no traceback. A failure a client can act on also has a `code`. `model_unreachable`: the model's server did not answer. `not_installed`: the model needs a local Ollama, and no `ollama` binary is on `PATH` or at a known install path. Either comes with the `provider` and a `hint` that says how to fix it, such as `run ollama serve`. `budget_spent`: a cap in `[budget]` is spent, so a run stopped before its next paid call (see `models/budget.py`); it has a `hint` and no `provider`. `local_only`: the chat's folder stays on this Mac and a hosted model was about to be called, so nothing was sent (the backstop in `ModelRouter.chat_model(local_only=True)`; `message.send` refuses earlier with `-32018`).

A hosted provider can also fail with an answer. `failure_of` (`models/errors.py`) reads it by `status_code` or by type, without importing a provider SDK:

| Failure | Read from |
|---|---|
| `rate_limited` | 429 |
| `server_error` | 500 to 599 |
| `auth` | 401, 403 |
| `no_credit` | 402, or a 4xx whose body says `quota`, `credit` or `billing` |
| `unreachable` | a failed connect, or a timeout |
| `other` | anything else; the run fails with the error as it came |

`rate_limited`, `no_credit` and `auth_failed` are `run.failed` codes next to `model_unreachable`. Their hints are `wait a minute and try again`, `add credit at <provider>` and `/login <provider>`.

**Retry and fallback.** In `call_model`, a `rate_limited` or `server_error` call is tried once more after 2 seconds, or after `retry-after` up to 10. A call that already streamed text is never retried. When the retry fails, or at once for `unreachable`, `auth` and `no_credit`, a run on route `auto` asks `next_model` (the step-up's path) with the signal `fallback`. It answers with another model of the same tier, then the tier above, then, from a hosted model, a local one. The failed model is left out; privacy, a spent cap and the paid question are the pick's own, so a more expensive tier needs the yes the session already gave. The run switches `model_profile` for the rest of the run and sends `model.routed` with `reason: "fallback"` and a `detail` such as `deepseek is rate-limited`. A run falls back at most twice, then fails with the last error. A `pinned` or `local` session fails at once with the better message.

**Text already shown.** A call that failed after it streamed text ends as failed, and the reply it was building is closed as `interrupted`. It is never stored as a message. The next call is a new reply with a new id.

**Health.** `ModelRouter.health` remembers a provider that failed for 60 seconds, in memory. `ListedFacts` reads it: a model of that provider is `ready=False` with `why_not_ready` `rate-limited` (or `server is down`, `key rejected`, `out of credit`), so the next turn's pick skips it.

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

**One at a time.** `ServerGate` lets `[ollama] parallel` generations run on a server, and chat goes ahead of titles. A chat call that waits more than a second sends `model.waiting`, and the web and the TUI show `waiting for the local model` until its turn or its first token. Only the call that waits shows it. A title never does.

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
- **A failed download** says why in plain words in `model.pull.done` `error` (a small table in `pulls.py`, for example a Hugging Face repo that lacks a file), with Ollama's own text in `detail`. The parts it fetched stay in Ollama's `blobs` folder; when no model names them and they weigh 0.1 GB or more, `leftover_gb` says so, and **`model.pull_cleanup`** removes exactly those parts (never one a manifest names or a running download fetches). A new download of the same ref forgets the list. `hf.files` checks each size's config file with Hugging Face and sets `problem` only on a 404, so a size that cannot finish is flagged before the download.

### The model list

`model.list` returns `default` (null before one is chosen), this machine's `ram_gb`, `disk_free_gb` in the home folder where Ollama keeps its models, a list of providers with their status (`ready`, `needs_key`, `server_down`, `not_installed` for a local Ollama with no binary, or `unlisted` when nothing uses one yet), and one entry per model ref. Each entry has a `tier`: `local` for Ollama, `budget` for a hosted model whose blended price, `(3 × input + output) / 4` in USD per million tokens, is at or below `[routing] budget_max_price` (default 1.50), and `frontier` for any other hosted model, an unknown price included; a hosted catalog entry may set `tier` to override the rule. Each entry has `think_values`, what the `think` option takes for that model (`off` and `on`, or `low`, `medium`, and `high`, empty when the model cannot think; see ADR-045), and `categories`, from the fixed set general, coding, reasoning, vision, fast, and long-context, in that order. A catalog model has the catalog's own. Any other model gets general, plus vision and reasoning from Ollama's `/api/show` `capabilities` (`vision`, `thinking`) or LiteLLM's `supports_vision` and `supports_reasoning`, plus long-context when its context holds 200,000 tokens or more. A catalog model carries the catalog's `tags`, and one is `recommended`: the largest entry tagged `starter` whose `min_ram_gb` this Mac has (`models/data/catalog.toml`). With no Ollama binary, a catalog model is `not_installed`, one install away, and the picker labels it `install`. `setup` says where the user is, for a first-run screen in the TUI or the browser: `ollama_installed`, `ollama_running`, `keys` (the providers with a key), and `default_status`, the default model's status, `unknown` when golem does not list it, or null with no default.
- **Speed:** an installed local model that golem has timed carries `speed` (`prompt_tps`, `reply_tps`, `samples`). `SpeedBook` (`golem/models/speed.py`) takes the server's own timings of each finished Ollama call (`model.call.completed`, see [tracing](tracing.md)) and keeps the last 20 samples per ref; the figure is their median. A call counts for `prompt_tps` only with at least 200 prompt tokens read in at least 50 ms (a cached prompt reads almost nothing), for `reply_tps` with at least 20 reply tokens, and for the typical cold load only above 500 ms. `first_token_ms(ref, prompt_tokens, cold=)` is the worst-case wait for a first token: prompt tokens over `prompt_tps`, plus the typical load when cold. The book is saved to `cache/speed.json` at most every 30 seconds and on shutdown, and a broken file is ignored.
- **Where entries come from** (`golem/models/discovery.py`):
  - installed Ollama models, from `/api/tags`, with `/api/show` filling in what an older Ollama leaves out;
  - local models to download, from the bundled `catalog.toml`;
  - each keyed provider's own list (Anthropic, OpenAI, Google, xAI, and `<base_url>/models` for DeepSeek and Moonshot), cut down to the hosted models of `catalog.toml`. A dated snapshot such as `gpt-6-luna-2026-05-01` stands for its catalog ref. `model.list` with `show_all: true` also lists the live models LiteLLM marks as chat models that call tools. A model whose LiteLLM `deprecation_date` has come is never listed;
  - profiles and `default_model`, so a configured model is always listed.
- **What an entry carries:** its status (`ready`, `needs_key`, `not_installed`, or `server_down`), the profile names that point at it, context size, tool support, price in USD per million tokens, download size, and whether it fits in memory.
- **Price and context precedence:** the profile, then the provider's own list (Ollama), then LiteLLM (`golem/models/prices.py`).
- **Caching and time limit:** hosted lists are cached for a day under `cache/`. A listing waits at most 2 seconds for the network. A slower fetch keeps running, and its result is used next time, with `stale` set on what was shown meanwhile. `refresh: true` skips the cache.
- **The window of a local model:** Ollama runs a model at its own default window unless `num_ctx` is sent, so the listing's context size is the model's maximum, not the window. golem finds the window from what it sent, then from the window it planned, then from Ollama's `/api/ps`, then from the Modelfile, and shows an estimated one with a leading `≈` ([ADR-043](../adr/043-ollama-context-window.md)).
  - **The plan** (`golem/models/window_plans.py`, [ADR-056](../adr/056-planned-window-and-context-view.md)): with `[context] window = "auto"`, `WindowPlans` runs `plan_window` over the size and maximum discovery already knows and this Mac's memory, with no network call. It gives one number for a model until the settings or what it remembers change. The router applies it inside `chat_model`, when no `num_ctx` is set by a saved option, a session option, or the profile's `ctx`, so a chat, a tool step, and a title call all send the same number and Ollama never reloads for a difference. It adds `keep_alive` with it. The call's `model.call.started` has `window_planned`.
  - **Lowering:** after a call, `/api/ps` says how much of the model is in GPU memory. When a planned window spilled onto the CPU, the plan steps down once and is saved in `cache/windows.json`. The lower number applies from the next call.

| File | What it does |
|---|---|
| `packages/daemon/golem/models/router.py` | `ModelRouter`: names to chat models, keys, and unreachable errors |
| `packages/daemon/golem/models/window_plans.py` | `WindowPlans`: the planned window of each local model, and what is remembered |
| `packages/daemon/golem/models/keys.py` | A provider's key: the environment, then the Keychain |
| `packages/daemon/golem/secrets.py` | The one store for every secret, in the Keychain |
| `packages/daemon/golem/models/ollama.py` | `LocalServer`: start, hold, and stop a local Ollama |
| `packages/daemon/golem/models/install.py` | Installing Ollama with Homebrew |
| `packages/daemon/golem/models/pulls.py`, `registry.py` | Downloads, and sizes from the registry |
| `packages/daemon/golem/models/discovery.py` | `model.list`: every model, with status, price, and size |
| `packages/daemon/golem/models/speed.py` | `SpeedBook`: the typical load, prompt and reply speed of each local model |
| `packages/daemon/golem/models/check_cases.py` | The ten cases of `golem models check`: prompt, offered tools, and a checker of the replies |
| `packages/daemon/golem/models/check.py` | `run_cases` and `CheckManager`: run the cases on one model, stream `model.check.progress` and `model.check.done`, seed `Scores` |
| `packages/daemon/golem/models/scores.py` | `Scores`: tool score, step-ups and retries of each model, from real use |
| `packages/daemon/golem/models/prices.py`, `catalog.py`, `hardware.py` | Prices from LiteLLM, the local catalog, and this Mac's memory |
| `packages/daemon/golem/models/errors.py` | `ModelUnreachable`, `BudgetSpent` and their codes |
| `packages/daemon/golem/models/budget.py` | What the `[budget]` caps leave: `room`, and `Budget.paid_ok` |

## Read more

- Next: [The daemon](./daemon.md), where the agent runs, apart from its windows.
- Before: [The agent loop](./agent-loop.md).
- [Models and API keys](../guide/models.md), the user's guide to the same thing.
- [The overview](../architecture.md): the whole system on one page.
- [Ollama's API](https://github.com/ollama/ollama/blob/main/docs/api.md), for what a local model server answers.
