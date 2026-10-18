# Golem — plan

> Name: `golem`, after the clay servant of the Prague legend — brought to life to do work on its maker's behalf.

## Read this first

Golem is a background program on your computer (macOS today, Linux and Windows from Phase 4), the **daemon**, that talks to language models for you. You talk to it through a chat screen in the terminal, the **TUI**. Closing the screen does not stop the work. Open it again and the conversation is still there, including an answer that kept streaming while you were away.

This file is about what comes next. How the existing pieces are built is in [architecture.md](architecture.md), and why they are built that way is in the [ADRs](adr/README.md).

### Works today

- Streaming chat with named model profiles and `provider/model` refs: Ollama through its native API, Anthropic, OpenAI, and OpenAI-compatible hosts such as OpenRouter.
- API keys in the macOS Keychain, through `golem auth` or `/login` in the TUI.
- `/model` picks from installed, downloadable, and hosted models with prices and RAM fit, and switches a session mid-conversation. `golem models` prints the same list.
- Sessions, runs, and every event are stored in `~/.golem/golem.db`. They survive a daemon restart and a crash.
- Detach and reattach. Close the TUI mid-answer, reopen it, and see the text so far plus the rest. Any number of screens can follow one session.
- Ctrl-C cancels the answer and keeps what it said. Pressing it twice exits.
- Automatic titles, a live switcher (`/sessions`), `/new`, `/title <name>`, and `/fork`.
- A debug panel (`/debug`) that shows the wire and the conversation the model sees.
- Slash commands with suggestions, a line editor, recalling a sent message with Up, copy and export, and closing a session from the switcher.
- It runs from a checkout of this repository (`just golem daemon install`, then `just tui`). Phase 4 makes it installable.

### Next, in order

| Phase | What you get | Milestone |
|---|---|---|
| 1. Models and cost | Several model profiles, `/model`, token and cost display, budgets, long sessions | M1 — Thinks cheaply |
| 2. Tools and approvals | The agent reads and edits files and runs commands, and asks first | M2 — Acts |
| 3. MCP | MCP servers as tool providers, under the same permissions | M2 — Acts |
| 4. Install and platforms | `brew install`, safe upgrades, `golem doctor`, then Linux and Windows | M3 — Installable |
| 5. Skills | Claude Code compatible `SKILL.md` skills | M4 — Skilled |
| 6. Flows | Durable workflows written in Python, resumable after a crash | M5 — Works alone |
| 7. Triggers | Schedules, file watchers, and notifications | M5 — Works alone |
| 8. Memory | Long-term memory that you can see and edit | M6 — Remembers |
| 9. Evals and hardening | Tracing, eval suites, crash tests, backups, a security pass | M6 — Remembers |
| 10. TUI polish | A render cache for long sessions, themes, and search in the transcript | Later |

```mermaid
flowchart LR
  p1[1 Models and cost] --> p2[2 Tools and approvals] --> p3[3 MCP] --> p4[4 Install and platforms] --> p5[5 Skills] --> p6[6 Flows] --> p7[7 Triggers] --> p8[8 Memory] --> p9[9 Evals and hardening] --> p10[10 TUI polish]
```

### How to read a phase

A phase is split into numbered steps (1.1, 1.2, …). A step is small enough for an evening or a weekend, and it leaves golem working and usable. Do the steps top to bottom unless a step says otherwise.

Every step has the same parts:

- **Goal** — the one thing the step is for.
- **You can** — what you can do afterwards that you could not do before.
- **Build** — the work.
- **Done when** — the check that ends the step.
- **Watch out** — only where there is a known trap.

A step that changes the wire bumps the protocol minor version and regenerates the TypeScript types (`just check` fails if they drift). A non-obvious choice gets an ADR in `docs/adr/`.

---

## Ground rules

These hold for every phase.

1. **The protocol is the contract.** LangGraph, LangChain, and provider message types never reach a client.
2. **LangGraph runs graphs, the daemon owns the rest.** Sessions, permissions, skills, router policy, the event log, and the protocol are golem code.
3. **Graph state stays small.** It is checkpointed every superstep. Big things (tool output, files, transcripts) go into golem's own tables, and state holds their IDs.
4. **Every step ships something usable.** No step ends in a broken build.
5. **Decisions get written down.** One short ADR per non-obvious choice.

### Where LangGraph fits

| Use LangGraph for | Feature |
|---|---|
| The agent loop (model, then tools, then model) | `StateGraph` with a conditional edge |
| Persistence and resume | `AsyncSqliteSaver`, keyed by `thread_id` |
| Human approval | `interrupt(payload)` in a node, resumed with `Command(resume=value)` |
| Streaming tokens and progress | `astream(..., stream_mode=["messages", "updates", "custom"])` and `get_stream_writer()` |
| Durable deterministic flows | Functional API: `@entrypoint` and `@task` |
| Retries | `RetryPolicy` per node or task |
| Long-term memory | `BaseStore` with namespaces |

Keep outside LangGraph: the protocol and the event log, the permission engine, the router policy, the skill registry, cost accounting, and triggers. The graph calls into them. They are not graph features.

Agents use the Graph API, where the model decides control flow. Flows use the Functional API, where your code decides control flow.

### Pitfalls to design around

- **Resume re-runs the interrupted node from its start.** Anything before `interrupt()` in that node runs again. Put side effects after the interrupt, or in their own node or task.
- **State schema changes.** Adding a field with a default is safe. Renaming or retyping breaks old checkpoints. Chat checkpoints are disposable, because the event log is the real history. In-flight flows may have to finish on the old code.
- **Checkpoint growth.** Large tool output goes to an artifact table, and state keeps `artifact_id` plus a short summary.
- **Message types leaking out.** LangChain `BaseMessage`s live only in graph state, and the stream adapter converts them to protocol events.

### Protocol, what is left to add

JSON-RPC 2.0, one JSON object per line, over `~/.golem/run/golem.sock`. Protocol 2.8 is on the wire today (see [architecture.md](architecture.md#what-is-on-the-wire-today)). The phases below add the rest.

| Group | New events | Phase |
|---|---|---|
| Tools | `tool.requested`, `tool.started`, `tool.output` (chunked), `tool.completed`, `tool.failed` | 2.1 |
| Approval | `approval.needed`, `approval.resolved` | 2.3 |
| Todos | `todos.updated` | 2.7 |
| System | `mcp.server.status`, `warning`, `error` | 3.1 |
| Models | `model.selected` (with reason), `usage.reported` (tokens, cost) | 1.4, 1.6 |
| Downloads | `model.pull.progress`, `model.pull.done` (daemon-wide, not stored) | 1.5 |
| Skills | `skill.activated`, `skill.deactivated` | 5.2 |
| Runs and flows | `run.step.started`, `run.step.completed`, `run.interrupted` | 6.2, 6.4 |

New commands: `approval.respond` (2.3), `mcp.list` (3.1), `auth.set` and `auth.remove` (1.2), `model.list` (1.3), `session.set_model` and `model.set_default` (1.4), `model.pull | pull_cancel | delete` (1.5), `skill.list | pin | unpin` (5.1, 5.2), `flow.list | start | status` (6.1), `config.get` (when a step needs it).

Rules:

- A breaking change bumps `protocol_major`, and the daemon refuses a mismatched client with a clear error.
- Events are append-only facts. Clients derive all UI state from them, so replaying equals rebuilding.
- Every event is stored before it is sent. `message.delta` is coalesced into `message.completed` in the log.

---

## Phase 1 — Models and cost

Setting up a model comes first: local and hosted models under one naming scheme, keys in the Keychain, and a `/model` picker that finds what you have and can download what you don't. Then this phase shows what each call costs, and picks the right model per step.

### How choosing a model works

- **A model is a ref, `provider/model-id`.** For example `ollama/qwen3:8b`, `anthropic/<id>`, or `openrouter/qwen/qwen3-235b-a22b`. A ref splits on its first `/`.
- **A profile is a short name for a ref, with overrides.** It lives in `[models.<name>]`. A ref works anywhere a profile does, so a model you never configured can still be used.
- **Each session remembers its own model.** `/model` changes it only for that session. A new session starts on `default_model`.
- **Where the lists come from:**

  | Models | Source | Kept by hand? |
  |---|---|---|
  | Installed local models | Ollama `/api/tags` and `/api/show` | No |
  | Local models to download | `local-catalog.toml`, about 10 entries with size and RAM fit | Yes, the only list |
  | Any other Ollama model | `/model pull <name>`, sized from the registry manifest | No |
  | OpenRouter | `/api/v1/models`, with prices and context | No |
  | Anthropic, OpenAI | Their `/v1/models`, once a key is present | No |
  | Prices and context sizes | LiteLLM's `model_prices_and_context_window.json`, cached and bundled | No |

```toml
# ~/.golem/config.toml
default_model = "qwen"

[models.qwen]
model = "ollama/qwen3:8b"
ctx = 32768                        # sent to Ollama as num_ctx

[models.sonnet]
model = "anthropic/<id>"
```

Ollama's OpenAI-compatible endpoint runs with a small default context window and takes no `num_ctx`, so golem talks to Ollama through its native API. `openai_compat` stays for LM Studio, vLLM, llama.cpp, and hosted providers. The reasons are in ADR-011 (to be written).

### 1.1 Providers, profiles, and refs (built)

- **Goal:** several models configured, each under a short name, local and hosted alike.
- **You can:** add `[models.qwen]` and `[models.sonnet]`, set `default_model`, and have new sessions start on it without restarting the daemon.
- **Build:**
  - `default_model`, `[models.<name>]` (`model`, `ctx`), and `[providers.<name>]` (`kind`, `base_url`, `api_key_env`) in [config.py](../packages/daemon/golem/config.py).
  - [router.py](../packages/daemon/golem/models/router.py) resolves a profile or a ref. Built-in providers: `anthropic`, `openai`, `ollama` (native, through `langchain-ollama`), and the `openai_compat` presets `openrouter`, `groq`, `together`, and `lmstudio`. A new provider name is `openai_compat` and needs `base_url`.
  - The flat settings load as a profile named after `model_profile` (default `remote`), so stored sessions keep resolving. An empty or Ollama `model_base_url` maps to the native `ollama` provider.
  - The router re-reads `config.toml` when it changes. A file that no longer validates keeps the last good models.
  - Every resolvable session reports its own provider and model id, not only the default one.
- **Done when:** a session on `ollama/...` and a session on `anthropic/...` both chat, and an old flat config still works.

### 1.2 Keys in the Keychain (built)

- **Goal:** no API key in an environment variable or `launchctl setenv`.
- **You can:** run `golem auth set anthropic` once, or type `/login anthropic` in the TUI, and use Anthropic from the background service.
- **Build:**
  - `keyring`, with service `golem` and the provider name as the account ([keys.py](../packages/daemon/golem/models/keys.py)). Lookup order: the provider's `api_key_env` variable, then the Keychain, read at call time and cached in the daemon.
  - `auth.set`, `auth.remove`, and `auth.list` on the wire (protocol 2.6). The daemon is the only writer, so the Keychain item belongs to its Python and launchd reads it without a prompt.
  - `golem auth set|remove|list`, over the socket. `set` reads a hidden prompt on a terminal, or stdin from a pipe.
  - `/login <provider>` opens a masked prompt that is separate from the draft, and sends `auth.set`. `/logout <provider>` removes the key. The key never enters the draft or message recall, `/debug wire` shows `[redacted]`, and the daemon log names only the provider.
- **Done when:** a remote model works under launchd with no key in the environment, and a missing key shows `needs key: /login anthropic`.
- **Watch out:**
  - The Keychain trusts the program that wrote the item, and from a checkout that program is uv's shared, ad-hoc signed Python interpreter, not golem. Any script run with that same interpreter, including another project's dependencies, can read the keys without a prompt. Until 4.3 fixes this, run other projects on a different Python version than golem's.
  - The Keychain asks again when the interpreter changes, for example after a uv Python upgrade.

### 1.3 Discovery and `model.list` (built)

- **Goal:** golem knows which models you can use, what they cost, and which ones fit on this machine.
- **You can:** `ollama pull` a model in a terminal and see it in `golem models` without editing config or restarting.
- **Build:**
  - Discovery from the sources in the table above ([discovery.py](../packages/daemon/golem/models/discovery.py)). A hosted provider is asked only once it has a key, and a keyless one (LM Studio, a custom server) only once a profile uses it.
  - Hosted lists are cached for 24 h under `~/.golem/cache/`. A failed fetch keeps the last cache and marks those entries `stale`, and `model.list` never waits on the network for more than 2 s.
  - Prices and context sizes, in order: profile override (`ctx`, `price`), live provider data (Ollama, OpenRouter), then LiteLLM ([prices.py](../packages/daemon/golem/models/prices.py), bundled trimmed copy refreshed with `just prices`). Ollama models cost $0. A model with no known price shows `?`.
  - RAM fit: a pure function `fit(size_gb, ram_gb, ctx)` that returns `fits` (within half of RAM), `tight` (within three quarters), or `too_big`. It adds a KV-cache estimate for the profile's `ctx`, or 8k, not the model's maximum.
  - `model.list` (protocol 2.7) returns the default, `ram_gb`, provider statuses, and one entry per model: ref, label, provider, source, status (`ready`, `needs_key`, `not_installed`, `server_down`), ctx, tools, price, size, fit, `stale`, and the profiles that alias it. `pulling` comes with 1.5.
  - `golem models [--refresh]` prints the list.
- **Done when:** a fresh `ollama pull` shows up in `model.list`, and a newly released Anthropic model appears with its LiteLLM price and no golem release.
- **Watch out:** LiteLLM's key naming is not consistent across providers. A table-driven test over real keys from the bundled copy catches mapping drift.

### 1.4 `/model` and switching (built, except `golem config migrate`)

- **Goal:** switching models is one command, and a first start needs no config at all.
- **You can:** open `/model`, pick Sonnet in the middle of a conversation, and get the next answer from it with the same history.
- **Build:**
  - `session.set_model` and `model.set_default` (protocol 2.8). The latter writes `default_model` with `tomlkit`, which keeps comments ([config_edit.py](../packages/daemon/golem/config_edit.py)).
  - A `model.selected` session event (`model_profile`, `model_provider`, `model_name`, `reason`). The projection updates `sessions.model_profile`, and each turn passes the session's current model into graph state, so a switch applies from the next run.
  - A picker in place of the transcript, like the session switcher ([model-picker.ts](../packages/tui/src/model-picker.ts)):
    - Groups: profiles, installed, download, then one group per provider. Provider notes at the bottom say which ones need `/login`.
    - Enter uses a model for this session, `d` also makes it the default, typing filters, and Ctrl-R refreshes.
    - A model that cannot run says why (`needs key: /login anthropic`, `ollama pull …`, `ollama serve`).
    - `/model <name>` switches directly, with suggestions from `model.list`.
  - First start without a default: with exactly one ready model, golem uses it, saves it as the default, and says so. Otherwise the picker opens with "Pick a model to start". Esc still closes it, so `/login` stays reachable.
  - The header shows the model the session switched to. For a ref it shows only the model name.
  - Not done: `golem config migrate`, which would rewrite the flat settings as a profile. It is optional, and the flat settings keep working.
- **Done when:** switching from a local to a remote model mid-session works, and the model tab in `/debug` shows one conversation across both.
- **Watch out:** switching providers mid-history is safe for plain text. Tool-call messages are not, so 2.1 adds a cross-provider test.

### 1.5 Download from the picker

- **Goal:** trying a new local model takes no terminal.
- **You can:** pick a model you don't have, see `5.2 GB · fits`, confirm, and watch it download.
- **Build:**
  - `model.pull`, `model.pull_cancel`, and `model.delete` over Ollama's `/api/pull` and `/api/delete`.
  - `model.pull.progress` and `model.pull.done` go to every connection and are not stored, because they are not session facts. This is the first notification outside a session.
  - A pull continues after the TUI closes, and `model.list` shows `pulling 42%` after reattaching.
  - Free disk space is checked first. A `too_big` model needs a second confirmation. Missing Ollama says `brew install ollama`, and a stopped one says `ollama serve`.
  - `/model pull <name>` takes any Ollama name. Before downloading, golem reads its size from the registry manifest and shows the RAM fit, the same way the catalog does.
  - `just catalog` keeps [local-catalog.toml](../packages/daemon/golem/models/data/local-catalog.toml) current. It checks every entry against the Ollama registry and rewrites `size_gb`. It also probes the next version numbers of each family (for example `qwen3.9` and `qwen4` when the catalog has `qwen3.8`) and prints the tags it finds, so a newer release is noticed. Editing the list stays a human choice.
- **Done when:** choosing a catalog model you don't have downloads it with a progress bar, and the session continues on it, and `just catalog` reports a family's newer version.
- **Watch out:** Ollama has no official API for browsing its library, so the catalog only learns about a new model through `just catalog` or by hand. The registry manifest gives sizes but not tool support for newer models, whose chat format is built into Ollama. Tool support of an installed model comes from Ollama.

### 1.6 Tokens and cost

- **Goal:** you always know what a session has cost.
- **You can:** see tokens and cost per answer, and `/cost` for today, this week, and this session.
- **Build:**
  - `usage.reported` per model call, and a `costs` table. Prices come from 1.3, and a profile's `price` overrides them.
  - The meter shows tokens while writing. The finished answer shows `1.2k tok · $0.004` next to its duration.
  - `/cost` prints a short table.
- **Done when:** the cost of a day of use matches the provider's dashboard within a few percent.

### 1.7 Cheap profile and structured outputs

- **Goal:** small jobs (titles, classification) stop using the expensive model.
- **You can:** set `titles = "qwen"` (a profile or a ref) and never pay a remote call for a title again.
- **Build:**
  - Task-to-profile settings for internal jobs, starting with titles ([titles.py](../packages/daemon/golem/sessions/titles.py)).
  - Structured outputs for anything parsed, with `with_structured_output`, or grammar-constrained decoding where the local server supports it.
- **Done when:** titles come from the cheap profile, and a malformed structured answer is retried, not crashed on.

### 1.8 Router and budgets

- **Goal:** the right model is picked automatically, and spending has a ceiling.
- **You can:** set daily and per-session caps, and see why a model was picked.
- **Build:**
  - `router.pick(profile_hint, task_traits)`, with traits `needs_tools`, `est_tokens`, `privacy` (`local_only`), and `difficulty`. Policy order:
    1. Session or flow pin.
    2. Privacy constraint.
    3. Budget remaining.
    4. Traits.
  - `model.selected` carries the reason, and the TUI shows it in the answer footer.
  - Over a cap, the router forces local, or asks for approval (2.3).
- **Done when:** a day of mixed use stays under budget, and each routing choice is visible.

### 1.9 Escalation

- **Goal:** a weak local model does not stall a task.
- **You can:** start on a local model and let golem step up when it fails.
- **Build:** a node wrapper that retries once on a remote profile after N invalid tool calls or failed structured outputs, and logs the escalation as a `warning` event.
- **Done when:** a recorded failing local tool call escalates once and succeeds.

### 1.10 Compaction and context gauge

- **Goal:** long sessions keep working.
- **You can:** see how full the context is in the status line (`ctx 62%`), and keep chatting past the limit.
- **Build:**
  - Token counting per profile, against the context size from 1.3 (for Ollama, the `num_ctx` actually sent).
  - A `compact` node that runs over a threshold. It summarizes old turns with the cheap profile and keeps pinned items: the system prompt, active skills, the last N turns, and open todos. It replaces history in state with `RemoveMessage`.
  - The screen keeps the full transcript. The model tab in `/debug` shows the compacted one, as [ADR-006](adr/006-checkpoint-continuity.md) intends.
  - `session.fork` may need a `before` bound on history reads here ([ADR-010](adr/010-fork.md)).
- **Done when:** a 200-turn session keeps working after compaction.

### 1.11 Local server management (optional)

- **Goal:** the local model is running when you need it, and not otherwise.
- **You can:** forget about starting Ollama.
- **Build:** the daemon starts and stops the local server on demand, and `daemon.status` reports its memory use.
- **Done when:** the first local request after a reboot works without a manual start.
- **Watch out:** on 36 GB, a large chat model, an embedding model, and an IDE are tight. Prefer one resident chat model.

---

## Phase 2 — Tools and approvals

The agent can act, and nothing happens without passing policy. Start read-only, then add permissions, then approvals, then write and execute.

### 2.1 Tool loop with read-only tools

- **Goal:** the model can look at your files.
- **You can:** ask "what does `connect.ts` do?" and watch golem read it.
- **Build:**
  - The graph becomes `call_model → (tool calls?) → tools → call_model`, with a conditional edge back to the model.
  - A custom tools node, not the prebuilt one, so events, permission checks, and artifact storage wrap every call.
  - A project folder per session: `session.create` gains `cwd`, and the TUI sends its working directory.
  - Tools: `read_file`, `list_dir`, `glob`, `grep`. They are allowed only inside the project folder.
  - `tool.requested`, `tool.started`, `tool.completed`, and `tool.failed` events.
  - TUI: a collapsed one-line block per tool call (`read_file packages/client/src/connect.ts ✓`). Enter on a selected block expands it.
- **Done when:** a question about a file in the project folder is answered from its contents, and reading `/etc/hosts` is refused.
- **Watch out:** `/model` (1.4) can switch providers mid-session. A history with tool calls from Ollama must still work on Anthropic and the other way round, so write that test with the tools node.

### 2.2 Permission engine

- **Goal:** one place decides whether a tool call may run.
- **You can:** write rules in `~/.golem/config.toml` and `<project>/.golem/policy.toml`.
- **Build:**
  - Rules with `tool`, an optional `match` or `path` glob, and `action` (allow, ask, deny). The first match wins, project rules first.
    ```toml
    [[rule]]
    tool = "shell"
    match = "git status|git diff*|ls*"
    action = "allow"

    [[rule]]
    tool = "write_file"
    path = "~/code/**"
    action = "ask"

    [[rule]]
    tool = "*"
    action = "ask"   # default
    ```
  - `permissions.check(call, session_ctx)` is a pure function that returns a decision with a reason.
  - Until 2.3 lands, `ask` behaves as deny with a clear message to the model.
- **Done when:** table-driven tests cover the policy matrix, and the read-only tools from 2.1 go through the engine.

### 2.3 Approvals

- **Goal:** golem asks before doing anything that is not allowed outright, and waits for you even if the TUI is closed.
- **You can:** approve or deny a tool call from a modal, or choose "allow for this session".
- **Build:**
  - The tools node calls `interrupt()` on `ask`:
    ```python
    from langgraph.types import interrupt, Command

    async def tools_node(state, config):
        results = []
        for call in last_ai_message(state).tool_calls:
            decision = permissions.check(call, session_ctx(config))
            if decision.action == "ask":
                answer = interrupt({"kind": "approval", "call": call, "reason": decision.reason})
                decision = decision.resolve(answer)   # allow / deny / allow_session
            results.append(await execute(call) if decision.allowed else denied_msg(call))
        return {"messages": results}
    ```
  - The adapter turns the interrupt into `approval.needed`. `approval.respond` resumes with `graph.astream(Command(resume=answer), cfg)` and emits `approval.resolved`.
  - Resume re-runs the node, so record executed `tool_call_id`s in state and skip them.
  - "Allow for this session" is stored in session metadata.
  - TUI: a modal with allow once, allow for session, and deny. A pending approval shows in the switcher.
- **Done when:** an approval survives closing the TUI and restarting the daemon, and is answered after reattaching.
- **Watch out:** several tool calls in one turn with mixed decisions. Write that test before the modal.

### 2.4 Shell, sandboxed

- **Goal:** golem can run commands without being able to wreck the machine.
- **You can:** ask golem to run the tests and explain the failures.
- **Build:**
  - `shell` runs through `sandbox-exec`, with a profile that denies network and limits writes to the project folder.
  - Timeouts, output caps, and a process-group kill on cancel.
  - `tool.output` streams chunks, so long commands show progress in the tool block.
  - `git_status`, `git_diff`, and `git_log` helpers with structured output.
- **Done when:** "why does `just check` fail?" is answered from a real run, and Ctrl-C kills a running `sleep 100`.

### 2.5 Write tools

- **Goal:** golem can change files, and you see exactly what changes before it happens.
- **You can:** ask for an edit, review the diff, and approve it.
- **Build:**
  - `write_file` and `edit_file` (exact string replace, failing if the old text is not unique).
  - The approval payload carries a unified diff, and the modal shows it with scroll.
  - "Edit arguments" in the modal, for small fixes to the model's proposal.
- **Done when:** "fix the failing test in repo X" works end to end with approvals: golem runs the test, edits the file, and runs the test again.

### 2.6 Artifacts, web, and secrets

- **Goal:** big outputs and outside content do not bloat state or leak secrets.
- **You can:** fetch a web page into the conversation, and keep every token out of config files.
- **Build:**
  - An `artifacts` table. Output over a size limit is stored there, and the message carries a preview plus the ID.
  - `web_fetch`, under policy, returning cleaned text. Its content is data and can never approve anything.
  - Other secrets (MCP server tokens, the hook token from 7.5) use the same Keychain store as provider keys (1.2).
- **Done when:** a 5 MB tool output leaves the checkpoint small, and no API key is in any file under `~/.golem`.

### 2.7 Agent todo list

- **Goal:** on a multi-step task, you can see the agent's plan and where it is.
- **You can:** watch a checklist update as golem works through "add a flag, wire it up, write a test".
- **Build:**
  - A `todo_write` tool that replaces the session's todo list (id, text, status: pending, in progress, done). It needs no approval, because it has no side effect outside golem.
  - The list lives in graph state, small by design, and each change emits `todos.updated`.
  - TUI: a todo band above the composer, one row per item, collapsed to `todos 2/5` when rows are short. `/todos` toggles it.
  - Compaction (1.10) keeps open todos.
- **Done when:** a three-step task shows its list, ticks items off in order, and the list is still there after reattaching.

---

## Phase 3 — MCP

MCP servers become tool providers, under the same permission engine.

### 3.1 One stdio server

- **Goal:** golem can use an MCP server.
- **You can:** configure one stdio server (for example git) and use its tools in chat. `/mcp` shows its status.
- **Build:**
  - An MCP supervisor that starts stdio servers from config, through `langchain-mcp-adapters` or the `mcp` SDK.
  - Every MCP call goes through the tools node from 2.1.
  - `mcp.server.status` events, `mcp.list`, and `/mcp` in the TUI.
- **Done when:** a tool from the server runs from chat after an approval.

### 3.2 Namespaces and scoping

- **Goal:** many servers without flooding every prompt.
- **You can:** enable a server for one session or one project, and write policy rules for it.
- **Build:**
  - Tool names become `mcp.<server>.<tool>`, and policy rules can match on them.
  - Servers are enabled per session (`/mcp enable <name>`) or per project config. Nothing is on by default.
- **Done when:** two servers are configured, only the enabled one's tools reach the model.

### 3.3 Health and HTTP servers

- **Goal:** servers stay up, and their cost in prompt tokens is visible.
- **You can:** connect HTTP servers, and see a crashed server come back on its own.
- **Build:**
  - HTTP transport. Health checks, and restart with backoff.
  - The TUI status line shows a red marker when an enabled server is down.
  - `/mcp` shows how many prompt tokens each server's tool schemas cost.
- **Done when:** killing a server process makes it restart, and the TUI shows the outage and the recovery.
- **Watch out:** tool-schema bloat hurts local models badly.

---

## Phase 4 — Install and platforms

Today golem runs only from a checkout of this repository. `golem daemon …` looks for the repository root and calls `uv run python -m golem daemon`, the TUI starts through `tsx`, and the launchd job points into the checkout. This phase makes golem something you install with `brew install`, upgrade without losing data, and, at the end of the phase, run on Linux and Windows.

The shape of a release:

```
golem-<version>-<os>-<arch>.tar.gz   (.zip on Windows)
├─ bin/golem                 # one executable: the CLI and the TUI
└─ libexec/golem-daemon/     # the daemon with its own Python, no system Python needed
```

GitHub Actions builds one archive per platform on each version tag. Homebrew (and later Scoop) only downloads an archive. Nothing is compiled on your machine.

```mermaid
flowchart LR
  tag[Version tag] --> ci[GitHub Actions matrix]
  ci --> mac[darwin-arm64 archive]
  ci --> linux[linux-x64 archive]
  ci --> win[windows-x64 archive]
  mac --> brew[Homebrew tap]
  linux --> brew
  win --> scoop[Scoop bucket]
```

Steps 4.1 to 4.7 are macOS only and end with `brew install`. Steps 4.8 to 4.11 add the platform seams, prove them on Linux, then add Windows.

### 4.1 One version, no repository needed

- **Goal:** golem runs from any folder on disk, not only from the checkout.
- **You can:** copy a built tree somewhere else and use it, with `golem daemon install` pointing launchd at that copy.
- **Build:**
  - One version for the whole project, taken from the git tag and stamped into the Python package, the CLI, and the TUI at build time. The header already shows it.
  - The CLI finds the daemon in this order: `GOLEM_DAEMON` if set, then `../libexec/golem-daemon/` next to its own executable, then the checkout (`uv run`), which keeps development working.
  - `golem daemon install` writes the launchd plist with the absolute path it found, not `uv run`. Running it again after a move or an upgrade rewrites the plist.
- **Done when:** a built tree outside the repository installs the launchd job, survives a reboot, and chats.

### 4.2 One `golem` executable

- **Goal:** the CLI and the TUI are one file with no Node install needed.
- **You can:** type `golem` to open the TUI, and `golem status`, `golem daemon …`, or `golem --version` for the rest.
- **Build:**
  - Merge the CLI and TUI entry points. No arguments opens the TUI.
  - Compile with `bun build --compile`. If that fails, fall back to Node's single executable application feature.
  - `just dist` builds `bin/golem` for the current platform.
- **Done when:** `bin/golem` runs on a Mac without Node or pnpm installed.
- **Watch out:** Ink's layout engine ships as WebAssembly, and some dependencies are ESM only. Try the compile on day one, before the rest of the step.

### 4.3 Self-contained daemon

- **Goal:** the daemon runs without uv or a system Python.
- **You can:** start `libexec/golem-daemon/golem-daemon` on a Mac that has never seen Python.
- **Build:**
  - PyInstaller in one-folder mode (one-file mode unpacks on every start, which is slow). The fallback is a standalone Python build with a ready-made virtual environment.
  - `just smoke-dist` starts the built daemon with a temporary `GOLEM_HOME`, sends `hello`, runs one chat against a fake model, and stops it.
- **Done when:** `just smoke-dist` passes, and the daemon from the archive starts in under 1 s.
- **Watch out:**
  - LangChain and Pydantic import some modules dynamically, and PyInstaller misses them. The smoke test is what catches it, so it runs in CI from the start.
  - Keychain trust. The daemon executable must be golem's own binary, not a shared Python, so only golem is trusted to read the stored keys (1.2). Keys stored by a checkout's Python move over once: the new daemon reads them after one Always Allow, then rewrites each item so it owns it.

### 4.4 Migrations and safe upgrades

- **Goal:** a new release never breaks the data of an old one.
- **You can:** upgrade golem and keep every session.
- **Build:**
  - Numbered SQL migrations for `golem.db`, with the current version in a `schema_version` table. This moves forward from 9.4, because installed users need it first.
  - Before migrating, the daemon copies the database to `golem.db.bak-<version>` with the SQLite backup API.
  - The daemon refuses to start on a database newer than it knows, and says which version it needs.
  - `checkpoints.db` is backed up before a LangGraph upgrade. Chats can survive losing it, because the event log is the real history ([ADR-006](adr/006-checkpoint-continuity.md)).
  - `golem daemon restart`. Its version mismatch with the TUI already shows as a yellow notice, and the notice now says to run it.
- **Done when:** a test upgrades a database made by the previous release and every session is still there.

### 4.5 Release pipeline

- **Goal:** a version tag produces a downloadable release with no manual steps.
- **You can:** push `v0.1.0` and get a GitHub release with the macOS archive and its checksum.
- **Build:**
  - A GitHub Actions workflow on `v*` tags: `just check`, `just dist`, `just smoke-dist`, then upload `golem-<version>-darwin-arm64.tar.gz` and a `sha256` file.
  - Code signing with a stable identity, a self-signed certificate at first and Developer ID later. An ad-hoc signature changes with every build, so the Keychain would ask again after each upgrade (1.2). Notarization only matters for direct downloads, so it waits until someone needs it.
- **Done when:** a tag produces a release, and the archive from it passes `just smoke-dist` on a clean runner.

### 4.6 Homebrew tap

- **Goal:** `brew install` is the way to get golem on a Mac.
- **You can:** run `brew install <you>/golem/golem`, then `golem daemon install`, then `golem`.
- **Build:**
  - A `homebrew-golem` tap repository with a `golem.rb` formula that downloads the release archive and installs `bin/` and `libexec/`. `brew test` runs `golem --version`.
  - The release workflow (4.5) opens a pull request to the tap with the new version and checksum.
  - The formula has no `service` block. `golem daemon install` stays the one owner of the launchd job, so a non-brew install works the same way. The formula's caveats print the command.
  - `golem daemon install` points at the stable `opt` path (`$(brew --prefix)/opt/golem/...`), so `brew upgrade` does not leave the plist on an old version folder.
- **Done when:** on a clean macOS user account, install, chat, `brew upgrade` plus `golem daemon restart`, and `brew uninstall` plus `golem daemon uninstall` all work, and only `~/.golem` is left.
- **Watch out:** if both `brew services` and `golem daemon install` started the daemon, the second copy would fail on the pid lock and launchd would keep restarting it. One owner prevents that.

### 4.7 `golem doctor`

- **Goal:** when something is wrong after an install, one command says what.
- **You can:** run `golem doctor` and get a checklist with a fix for each failure.
- **Build:** checks that the daemon executable was found, that the service is installed and points at it, that the running daemon has the same version, socket permissions, that the config is valid, that each model profile is reachable (Ollama up, API key present in the credential store), and free disk space.
- **Done when:** each check has a test with a fake platform, and a stopped Ollama shows as one failed line with a fix.

### 4.8 Platform seams

- **Goal:** everything that depends on the operating system sits behind one small interface, so Linux and Windows are additions, not rewrites.
- **You can:** nothing new yet. This step makes the next three cheap.
- **Build:** a `platform` module in the daemon and one in `@golem/client`, each with one implementation per OS:
  - **Endpoint:** where the daemon listens (`unix:` path or `pipe:` name). `resolveSocketPath` becomes `resolveEndpoint`.
  - **Service manager:** launchd, systemd user units, or Task Scheduler, behind `golem daemon install|uninstall|start|stop|restart|logs`.
  - **Paths:** `~/.golem` on macOS and Linux, `%LOCALAPPDATA%\golem` on Windows, and `GOLEM_HOME` everywhere.
  - **Clipboard:** OSC 52 first, which works in most terminals on all three systems, then `pbcopy`, `wl-copy` or `xclip`, or `clip.exe`. `/copy` already uses `pbcopy`.
  - **Notifications (7.1):** `terminal-notifier`, `notify-send`, or Windows toasts.
  - **Sandbox (2.4):** a capability, `sandbox-exec` or none. `daemon.status` reports it. Without a sandbox, a shell rule that says `allow` is treated as `ask`, and the TUI shows `no sandbox`.
  - **Stopping the daemon:** a `daemon.shutdown` request, so stopping does not depend on Unix signals.
- **Done when:** no code outside the `platform` modules checks the OS, and the tests run against a fake platform.

### 4.9 Linux

- **Goal:** prove the seams on the easiest second platform.
- **You can:** install golem on Linux with the same Homebrew formula, or by unpacking the archive.
- **Build:**
  - `linux-x64` and `linux-arm64` archives in the release matrix. CI runs the tests and `just smoke-dist` on Ubuntu.
  - A systemd user unit, written by `golem daemon install`.
  - No sandbox at first. `bubblewrap` can come later behind the same capability.
- **Done when:** on a fresh Ubuntu VM, install, chat, log out and back in, and reattach all work.

### 4.10 Windows: transport and service

- **Goal:** the daemon runs on Windows and the TUI can reach it.
- **You can:** run the daemon and the TUI on Windows 11, from the archive.
- **Build:**
  - Python's asyncio has no Unix socket server on Windows. The daemon serves a named pipe, `\\.\pipe\golem-<user>`, readable only by the current user. Node's `net.connect` already accepts that path, so the client only changes in `resolveEndpoint`.
  - A Task Scheduler task that starts the daemon at logon and restarts it on failure, written by `golem daemon install`.
  - The pid lock uses a Windows file lock.
  - CI runs the tests on `windows-latest`.
- **Done when:** on Windows 11, `golem daemon install`, chat, reboot, and reattach all work.
- **Watch out:** the named pipe server in asyncio is not a public API. If it proves fragile, the fallback is loopback TCP with a random port and a token in a file only you can read. That choice gets an ADR.

### 4.11 Windows: packaging

- **Goal:** installing on Windows is one command, like on a Mac.
- **You can:** run `scoop install golem`.
- **Build:**
  - A `windows-x64` zip in the release matrix, and a Scoop bucket updated by the release workflow. A winget manifest comes later.
  - Check the TUI in Windows Terminal: the alternate screen, the mouse wheel, and colors.
  - The shell tool runs without a sandbox (4.8), and the approval modal says so.
- **Done when:** on a clean Windows 11 machine, `scoop install golem`, `golem daemon install`, and `golem` give a working chat.

---

## Phase 5 — Skills

Agent Skills (`SKILL.md`) compatible with Claude Code, loaded by progressive disclosure.

### 5.1 Registry and `/skills`

- **Goal:** golem knows which skills exist.
- **You can:** run `/skills` and see each skill with its source and description.
- **Build:**
  - Scan `~/.golem/skills`, `<project>/.golem/skills`, and optionally `~/.claude/skills`. On a name collision, project wins, then user, then bundled.
  - Parse and validate frontmatter: `name`, `description`, optional `allowed-tools`, and golem's own `model`.
  - Hot reload with `watchfiles`. `skill.list` on the wire.
- **Done when:** an existing Claude Code skill shows up, and editing it updates the list without a restart.

### 5.2 Pinned skills

- **Goal:** you can turn a skill on by hand.
- **You can:** `/skill <name>` (with suggestions) and `/skill off <name>`.
- **Build:**
  - `active_skills: list[str]` in graph state, with a deduping reducer.
  - Active skill bodies go into the system prompt. Compaction (1.10) always keeps them.
  - `skill.activated` and `skill.deactivated`. The header shows active skills.
- **Done when:** a pinned skill changes the answer in the expected way.

### 5.3 Model-driven loading

- **Goal:** the model picks up a skill when it needs one.
- **You can:** ask for a task a skill covers, and see it activate on its own.
- **Build:** a short index of skill descriptions in the system prompt, and a `load_skill(name)` tool. Files bundled with a skill resolve inside its folder.
- **Done when:** an existing Claude Code skill works unchanged, triggered by the model.

### 5.4 Pre-selection by embeddings

- **Goal:** local models, which are bad at picking from a long list, still get the right skill.
- **You can:** use skills reliably on a local model.
- **Build:** a `select_skills` node before `call_model` that embeds the user turn and puts only the top-k descriptions above a threshold into the index.
- **Done when:** the skill-trigger eval (9.2) passes for your top 10 skills on a local and a remote model.

### 5.5 Trust and scoped permissions

- **Goal:** a skill can never widen what golem is allowed to do.
- **You can:** see which skills are trusted, and approve a skill's script once.
- **Build:**
  - The first run of a script from an untrusted skill needs approval. A content hash is stored per trusted skill, and a change asks again.
  - `allowed-tools` narrows the tool set while the skill is active. It never widens global policy.
  - `model: remote` in frontmatter makes the router escalate while the skill is active.
- **Done when:** editing a trusted skill's script triggers a new approval.

### 5.6 Self-authored skills

- **Goal:** golem can turn a repeated task into a skill.
- **You can:** ask golem to write a skill, review the draft, and accept it.
- **Build:** a `propose_skill` tool that writes into `~/.golem/skills/_proposed/`. Accepting moves it into place.
- **Done when:** a proposed skill is accepted and then triggers in a new session.

---

## Phase 6 — Flows

Durable, inspectable, resumable workflows written as plain Python with the Functional API.

```python
from langgraph.func import entrypoint, task
from golem.flows import flow

@task
async def fetch_prs(repo: str) -> list[dict]: ...

@task
async def summarize(pr: dict) -> str:            # LLM call, through the router
    ...

@task
async def post_digest(text: str) -> str:         # side effect: idempotency key
    ...

@flow(name="pr-digest", schedule="0 9 * * 1-5", inputs={"repo": str})
@entrypoint(checkpointer=CHECKPOINTER)
async def pr_digest(inputs: dict) -> dict:
    prs = await fetch_prs(inputs["repo"])
    summaries = [await f for f in [summarize(p) for p in prs]]   # parallel
    approved = interrupt({"kind": "review", "draft": "\n".join(summaries)})
    url = await post_digest(approved["text"])
    return {"url": url}
```

The exact `@entrypoint` and `@task` signatures change between versions, so check the docs. The structure is the point.

### 6.1 Registry and `golem run`

- **Goal:** golem can find and run a flow.
- **You can:** `golem run hello --name x` for a flow with no LLM calls.
- **Build:**
  - Discover flows in `flows/` and `~/.golem/flows/`. Metadata: name, input schema, schedule, model profile, allowed tools, concurrency limit.
  - `flow.list` and `flow.start`. A run uses `thread_id = run_id`, and the `runs` table gains inputs, outputs, and error.
  - `golem runs` lists runs.
- **Done when:** a trivial flow runs from the CLI, and its result is in `golem runs`.

### 6.2 Step events and the runs view

- **Goal:** you can watch a flow work.
- **You can:** open `/runs` in the TUI and see each step's status and duration.
- **Build:** a stream writer inside tasks, mapped to `run.step.started` and `run.step.completed`. A runs view in the TUI, and `golem runs show <id>`.
- **Done when:** a three-step flow shows three steps, live.

### 6.3 Resume after a restart

- **Goal:** a crash does not lose a flow.
- **You can:** kill the daemon mid-flow and see the run continue after it restarts.
- **Build:**
  - On start, find runs in `running` and resume them from their checkpoint, with a policy per flow: `resume`, `fail`, or `ask`.
  - Completed tasks are not re-run. Side-effecting flows use the strongest checkpoint durability mode.
  - `golem runs resume <id>`.
- **Done when:** after `kill -9` mid-flow, the run finishes without repeating completed steps.
- **Watch out:** code in the entrypoint body re-runs on resume, so keep it pure.

### 6.4 Review interrupts

- **Goal:** a flow can stop and wait for you, for days if needed.
- **You can:** review a draft in the TUI and approve or edit it.
- **Build:** `interrupt()` in a flow emits `run.interrupted`, and answering reuses the approval modal from 2.3 with an editable text field. Pending reviews show in `/runs`.
- **Done when:** a flow waits overnight on a review and finishes after you answer.

### 6.5 Idempotency and retries

- **Goal:** no step does a real-world action twice.
- **You can:** trust a flow that posts somewhere to post once.
- **Build:**
  - Every side-effecting task gets an idempotency key from `(run_id, step_name, args_hash)`, and external writes check it first.
  - A retry policy per task with backoff for transient errors. The final failure emits `run.failed` with the step and the error.
- **Done when:** a crash test between "write" and "checkpoint" produces exactly one write.

### 6.6 An agent as a step

- **Goal:** deterministic flows can contain agentic steps.
- **You can:** write a flow step that says "fix this" and let the agent do it with a restricted tool set.
- **Build:** a task invokes the agent graph on its own thread (`thread_id = f"{run_id}:{step}"`) with the flow's allowed tools. `/runs` can jump into that thread.
- **Done when:** a flow step runs a tool-using agent, and its tool calls go through the permission engine.

### 6.7 Flow versioning

- **Goal:** changing a flow's code does not corrupt runs in flight.
- **You can:** edit a flow while an old run waits on a review.
- **Build:** `@flow(version=2)`. Resume refuses a mismatched version unless the flow declares compatibility.
- **Done when:** a version bump with a waiting run gives a clear message, not a broken resume.

---

## Phase 7 — Triggers and notifications

The golem acts without you sitting in the terminal.

### 7.1 Notifications

- **Goal:** you hear about what needs you.
- **You can:** get a macOS notification for `approval.needed` and `run.failed`, and click it to open the TUI on that session or run.
- **Build:** notifications through `terminal-notifier` or `osascript`. `run.completed` notifications are opt-in per flow. A `golem open <id>` deep link.
- **Done when:** an approval in a detached session produces a notification that opens the right screen.

### 7.2 Scheduler

- **Goal:** flows run on a schedule.
- **You can:** have `pr-digest` run every weekday at 9:00.
- **Build:** APScheduler (async) with schedules from flow metadata, and a missed-run policy per flow.
- **Done when:** a scheduled flow runs at 9:00, needs approval, notifies you, and you approve from a TUI opened later.

### 7.3 File watchers

- **Goal:** files arriving can start work.
- **You can:** say "on a new PDF in `~/Downloads`, run `file-receipt`".
- **Build:** `watchfiles` rules in config, debounced, each starting a flow with the path as input.
- **Done when:** dropping a file starts exactly one run.

### 7.4 Pause and quiet hours

- **Goal:** golem stays quiet when you want it to.
- **You can:** `golem pause` and `golem resume`, and set quiet hours.
- **Build:** a global pause that holds triggers (not running chats), and quiet hours that delay notifications. The TUI status line shows `paused`.
- **Done when:** a scheduled run during pause waits and runs once after resume.

### 7.5 Hook endpoint (optional)

- **Goal:** git hooks, Raycast, and Shortcuts can start flows.
- **You can:** start a flow from a keyboard shortcut.
- **Build:** a localhost-only HTTP endpoint with a token from the Keychain.
- **Done when:** a Shortcut starts a flow, and a request without the token is refused.

---

## Phase 8 — Memory

Useful long-term memory that you can inspect and edit, and that never surprises you.

### 8.1 Explicit memory and a browser

- **Goal:** golem can remember what you tell it to.
- **You can:** say "remember that I prefer pnpm", and see it later in `/memory`.
- **Build:** a SQLite-backed `BaseStore` in `memory.db`, with namespaces such as `("user","prefs")` and `("project", <name>)`. `remember` and `recall` tools. A TUI browser to view, edit, delete, and export.
- **Done when:** every stored item is visible and deletable, and a new session uses a remembered preference.

### 8.2 Semantic recall

- **Goal:** relevant memories show up without being asked for.
- **You can:** get answers that use what you said weeks ago.
- **Build:** a `recall` node before `call_model`, using `sqlite-vec` and a local embedding model, limited to relevant namespaces, with a token cap.
- **Done when:** the repeat-task eval (9.2) improves with memory on.

### 8.3 Confirmed extraction

- **Goal:** golem proposes what to remember, and you decide.
- **You can:** accept or reject proposed memories at the end of a session.
- **Build:** an end-of-session node that proposes memories. They need confirmation in the TUI by default.
- **Done when:** nothing is stored without a confirmation unless the namespace is configured otherwise.

### 8.4 Searchable session summaries

- **Goal:** you can ask what you decided last week.
- **You can:** ask "what did we decide about the protocol bump?" and get the answer with a link to the session.
- **Build:** compaction summaries (1.10) and session titles are indexed in the memory store.
- **Done when:** a question about an old session finds it.

---

## Phase 9 — Evals and hardening

This runs alongside the other phases. It gets a dedicated pass after Phase 7.

### 9.1 Tracing

- **Goal:** you can answer what happened, why, and what it cost.
- **Build:** OpenTelemetry spans per run, node or task, model call, and tool call. Export to self-hosted Langfuse, or to JSONL for zero infrastructure. A cost dashboard in the TUI by model and by flow.
- **Done when:** one slow answer can be broken down into its spans.

### 9.2 Eval harness

- **Goal:** prove that a change did not make things worse.
- **Build:** `evals/`, run with `just eval` (`pytest -m eval`):

  | Suite | What it checks |
  |---|---|
  | Routing | Inputs → expected profile |
  | Skill triggering | Prompts → expected skill or none, precision and recall per model |
  | Tool-call validity | Local-model tool-call success rate per tool set |
  | Flow goldens | Recorded inputs → expected step outputs, with fake LLMs and recorded tool I/O |
  | Agent tasks | Real tasks in throwaway git repos, LLM-judged plus deterministic checks |

- **Done when:** a model swap or prompt change produces a comparable scorecard diff.

### 9.3 Replay

- **Goal:** debug a run without paying for it again.
- **Build:** record a run's model and tool I/O, and replay it deterministically.
- **Done when:** a recorded run replays to the same events.

### 9.4 Hardening

- Crash tests: `kill -9` at random points in flows, then check there are no duplicate side effects and runs resume.
- A nightly backup of `~/.golem/*.db` with the SQLite backup API.
- Performance: daemon start under 1 s, first-token latency per profile, and TUI rendering with 10 streams.
- Security review: socket permissions, which programs the Keychain trusts with the golem items (only the signed daemon, see 1.2 and 4.3), that no key reaches a log, the event log, or the wire view, sandbox profile coverage, policy defaults (shell has no network by default), skill and MCP trust, and prompt injection through `web_fetch`, files, and MCP output. Content never auto-approves anything.
- Upgrade discipline: pinned LangGraph and LangChain versions, a smoke suite before each bump, and the changelogs read.

---

## Phase 10 — TUI polish

A long session is already usable. These steps wait until scrolling feels slow, or until themes and search start to matter.

### 10.1 Render cache

- **Goal:** a long session stays smooth.
- **You can:** scroll and stream in a session with hundreds of messages without the screen lagging.
- **Build:**
  - Cache the wrapped rows of each finished message, keyed by message id, text length, and width.
  - Only the streaming message is re-wrapped on each paint. A resize clears the cache.
- **Done when:** a test session with 500 messages paints in under 16 ms per tick on your machine.

### 10.2 Themes

- **Goal:** the screen is readable on a light terminal as well as a dark one.
- **You can:** run `/theme light`, `/theme dark`, or `/theme auto`, and have the choice remembered.
- **Build:**
  - Turn the color constants in [theme.ts](../packages/tui/src/theme.ts) into a `Theme` object with named roles (accent, user background, user text, dim, warning, error), and one dark and one light palette.
  - Components read colors from the theme in a React context, never from constants.
  - `auto` picks a palette from `COLORFGBG` when the terminal sets it, and otherwise uses dark.
  - The choice is saved in `~/.golem/tui.json`.
- **Done when:** both palettes look right in a light and a dark terminal, and no component imports a color constant directly.

### 10.3 Search in the transcript

- **Goal:** find something said earlier without scrolling for it.
- **You can:** press Ctrl-F, type a word, and jump between matches with Enter and Shift-Enter (or Ctrl-N and Ctrl-P).
- **Build:**
  - A search bar takes the composer row while it is open. It shows `3/12` for the current match and the total.
  - Matches are found in the message text, then mapped to wrapped rows through the render cache (10.1), so a match scrolls into view in the right place.
  - Matches are highlighted in the transcript. The current one has a stronger color from the theme (10.2).
  - Search is case-insensitive unless the query has a capital letter. Esc closes it and returns to where you were scrolled.
  - Finding matches and mapping them to rows are pure functions, with unit tests.
- **Done when:** in a 500-message session, Ctrl-F finds a word from the first message and scrolls it into view, and Esc puts the view back.
- **Watch out:** a match inside a streaming message moves as text arrives. Search finished messages only, and say so in the bar while a reply is streaming.

---

## Cross-cutting

### Testing

| Layer | Approach |
|---|---|
| Protocol | Schema round-trip tests, generated TS compiles, contract tests from recorded event streams |
| Graph nodes | Unit tests with fake chat models |
| Graphs and flows | In-memory checkpointer, with interrupt and resume paths tested explicitly |
| Permissions | Table-driven tests over the policy matrix |
| Daemon | Integration tests over a real socket in a temporary `GOLEM_HOME` |
| TUI | Pure functions: reducer, layout, commands, suggestions, line editing. Ink 8 has no working `ink-testing-library` |

### Configuration

Built-in defaults, then `~/.golem/config.toml`, then `<project>/.golem/config.toml`, then session overrides. Everything is validated by Pydantic, and `golem config show --resolved` prints the result (added with the first step that needs project config, 2.2).

### Concurrency

- One asyncio loop runs all graph executions as tasks.
- A semaphore per model profile, sized for local servers that handle one or two generations at a time.
- CPU-heavy work (embeddings, parsing) goes to a thread or process pool.
- SQLite in WAL mode, with one writer connection per database.

### Security

- The socket is readable only by your user.
- Every side effect passes the permission engine, with no bypass for flows, skills, or MCP.
- Shell is sandboxed by default, and network is denied unless a rule allows it. Where no sandbox exists (Windows, Linux at first), every shell command needs approval.
- Secrets live in the OS credential store (the macOS Keychain, Windows Credential Manager, or the Secret Service on Linux).
- Content from tools and the web is data, never instructions about permissions.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| LangGraph API churn | Rework | A thin adapter boundary, pinned versions, a smoke suite before upgrades |
| Local models are unreliable with tools | A flaky agent | Pre-selected skills and tools, structured outputs, escalation, the tool-validity eval |
| Checkpoint schema breaks | Lost sessions or runs | `schema_version`, additive changes only, the event log as the real history, flow versioning |
| Duplicate side effects on resume | Real-world damage | Effects after interrupts, idempotency keys, crash tests |
| Remote cost creep | Money | Hard budget caps, the router forced to local over the cap |
| Scope explosion | Never finishing | Small steps with exit checks, daily use of what already ships |
| Prompt injection through tools or MCP | Unsafe actions | No auto-approve from content, the sandbox, minimal default permissions |
| A frozen daemon misses a dynamic import | A release that does not start | `just smoke-dist` on every platform in CI, before upload |
| macOS-only code spreads before Phase 4 | A costly Windows port | New OS-specific code goes behind a small function from the start, so 4.8 only moves it |

## Open questions

Each one gets an ADR when it is decided.

1. ACP or AG-UI compatibility for the protocol: adopt it, mirror it, or ignore it?
2. Are memory writes always confirmed, or auto-saved for some namespaces? (Needed by 8.3.)
3. Flows in Python only, or also a YAML format for simple ones? (Recommendation: Python only until it hurts.)
4. Windows transport: a named pipe or loopback TCP with a token file? (Needed by 4.10. Named pipe first, TCP if asyncio's pipe server proves fragile.)
5. `bun build --compile` or Node's single executable feature for `bin/golem`? (Needed by 4.2. Decided by a one-day spike.)
