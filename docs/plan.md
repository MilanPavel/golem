# Golem — Personal Agent Control Center — Implementation Plan

A phased plan for building a terminal-operated agent ("the golem"): a long-running Python daemon that runs chats and flows against local and remote LLMs, with an Ink TUI as its primary client. LangGraph is the execution engine for both conversational agents and durable flows.

> Name: `golem`, after the clay servant of the Prague legend — brought to life to do work on its maker's behalf.
> Version note: LangGraph is on the 1.2.x line as of mid-2026 (checkpoint libs 4.x). APIs referenced here (`StateGraph`, `interrupt`, `Command`, checkpointers, Functional API) are stable since 1.0, but pin versions and check the changelog before each phase.

---

## 0. Goals, non-goals, principles

### Goals

- One golem, many front-ends. Chat, flows and triggers all run in one daemon, and the TUI is a client.
- Durable by default: anything longer than one turn survives crashes, reboots and closed terminals.
- Local-first, remote when worth it. Explicit, observable routing between local models (36 GB Mac) and remote APIs, with budget caps.
- Safe autonomy: every side effect passes one permission layer, and approvals work while the TUI is detached.
- Extensible through open formats: MCP for capabilities, Agent Skills (`SKILL.md`) for know-how, plain Python for flows.

### Non-goals (for v1)

- Multi-user, auth, or remote hosting. It is a single user on a single machine.
- LangGraph Platform / LangGraph Server. Everything runs in-process, with no hosted dependency.
- A web UI. Design the protocol so one is possible later, but don't build it.

### Principles

1. **The protocol is the contract.** LangGraph, LangChain and provider message types never leak to clients.
2. **LangGraph runs graphs; the daemon owns everything else.** Sessions, permissions, the skill registry, the router policy, the event log and the protocol are yours. That keeps LangGraph replaceable at the edges.
3. **Keep graph state small.** State is checkpointed every superstep. Store big things (tool outputs, files, transcripts) in your own DB and keep IDs in state.
4. **Every phase ships something usable.** No phase ends in a broken build.
5. **Decisions get written down.** Keep a short ADR (`docs/adr/NNN-*.md`) per non-obvious choice.

---

## 1. Target architecture

```
 ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
 │   Ink TUI    │  │ Headless CLI │  │   Triggers   │
 │ chat/approve │  │ golem run …  │  │ cron/watch   │
 └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
        └────────── JSON-RPC 2.0 over Unix socket ───────────┘
                               │
 ┌─────────────────────────────▼──────────────────────────────┐
 │                 golem daemon (Python, asyncio)             │
 │                                                            │
 │  Protocol server ── Session manager ── Event log (SQLite)  │
 │         │                  │                               │
 │         ▼                  ▼                               │
 │  ┌─────────────── LangGraph runtime ───────────────┐       │
 │  │  Agent graph (Graph API)  Flows (Functional API)│       │
 │  │  Checkpointer: AsyncSqliteSaver   Store: memory │       │
 │  └───────┬─────────────────┬───────────────┬───────┘       │
 │          ▼                 ▼               ▼               │
 │    Model router     Tool + permission   Skill registry     │
 │    (policy, budget)  engine (+sandbox)   (SKILL.md)        │
 └──────────┬─────────────────┬───────────────────────────────┘
            ▼                 ▼
   Local: MLX / Ollama   MCP servers, shell, fs, git
   Remote: Anthropic, OpenAI, …
```

### Process model

- **`golem-daemon`** runs as a launchd user agent (`~/Library/LaunchAgents/dev.golem.daemon.plist`). It is started on login and restarted on crash.
- **Socket:** `~/.golem/run/golem.sock` with mode `0600`. Unix-socket permissions are your auth.
- **Data dir:** `~/.golem/` holds the following:
  - `golem.db` — the event log, sessions, runs, costs and the artifact index.
  - `checkpoints.db` — the LangGraph checkpointer. It is kept separate so it can be wiped or migrated independently.
  - `memory.db` — the long-term store and vectors.
  - `skills/`, `flows/`, `config.toml`, `logs/`.
- **Clients** are stateless. They attach, replay the needed events, and stream.

### Tech stack (verify versions at each phase)

| Concern | Choice | Notes |
|---|---|---|
| Python tooling | `uv`, `ruff`, `pyright` (strict), `pytest` + `pytest-asyncio` | Python 3.12+ |
| Agent runtime | `langgraph` 1.2.x, `langgraph-checkpoint-sqlite` | Graph API for agents, Functional API for flows |
| Model clients | `langchain-core` chat models: `langchain-anthropic`, `langchain-openai` | Local servers expose OpenAI-compatible APIs, so one client covers MLX, Ollama and LM Studio |
| Local inference | `mlx-lm` server or Ollama | MLX is usually faster on Apple Silicon; Ollama is easier to manage |
| MCP | `langchain-mcp-adapters` or the official `mcp` SDK | Adapters convert MCP tools into LangChain tools |
| Schemas | Pydantic v2 → JSON Schema → TS types (`json-schema-to-typescript`) | Single source of truth |
| Storage | SQLite (WAL) via `aiosqlite`; `sqlite-vec` later | |
| Scheduling | APScheduler (async) + `watchfiles` | Phase 9 |
| Observability | OpenTelemetry → Langfuse (self-hosted) or plain JSONL traces | Phase 11 |
| TUI | Ink + React, TypeScript, `pnpm` | Reuse the existing Command Center components |

---

## 2. Where LangGraph fits (and where it doesn't)

Getting this boundary right is the most important design decision after the protocol.

### Use LangGraph for

| Need | LangGraph feature |
|---|---|
| Agent loop (model → tools → model) | `StateGraph` with a conditional edge from the model node |
| Persistence and resume | Checkpointer (`AsyncSqliteSaver`), keyed by `thread_id` |
| Human approval | `interrupt(payload)` inside a node, resumed with `Command(resume=value)` |
| Streaming tokens and progress | `astream(..., stream_mode=["messages", "updates", "custom"])` and `get_stream_writer()` |
| Durable deterministic flows | Functional API: `@entrypoint` + `@task`, where task results are persisted and not re-run on resume |
| Parallel fan-out | `Send` (Graph API), or calling multiple `@task`s and awaiting them (Functional API) |
| Reuse (agent as a step in a flow) | Subgraphs / calling a compiled graph from a task |
| Retries | Per-node retry policy (`RetryPolicy`) |
| Time travel / fork a conversation | `get_state_history()`, then invoke from an earlier checkpoint |
| Long-term memory | `BaseStore` with namespaces (Phase 10) |

### Keep outside LangGraph

- **Protocol and event log.** LangGraph stream chunks go through an adapter that turns them into your typed events, and only those events are persisted and sent to clients.
- **Permission engine.** It is called from inside the tool node, but it is your code with your config.
- **Model router policy.** The graph calls `router.pick(task_profile)`, and the policy lives in your module.
- **Skill registry, session metadata, cost accounting, triggers.**

### Two graph styles, deliberately

- **Agent graph (Graph API).** The model decides control flow. It is a single reusable graph, parameterized per session by model profile, enabled tools and active skills.
- **Flows (Functional API).** Your code decides control flow. Flows are Python functions decorated with `@entrypoint`, where each side-effecting or expensive step is a `@task`. This is the "flows are plain code" principle and LangGraph durability at the same time.

### Pitfalls to design around from day one

- **Resume re-executes the interrupted node from its start.** Anything before `interrupt()` in that node runs again, so put side effects after the interrupt or in a separate node or task.
- **State schema evolution.** Adding fields with defaults is safe. Renaming or retyping breaks old checkpoints. Version your state (`schema_version: int`) and treat checkpoints as disposable for chats, with the event log as the real history. For flows, accept that in-flight runs may need to finish on the old code.
- **Checkpoint growth.** Every superstep writes state. Large tool outputs go to an artifact table, and state holds `artifact_id` plus a short summary.
- **Message-type lock-in.** LangChain `BaseMessage`s live only inside graph state. Convert them at the adapter boundary.

---

## 3. Repository layout

```
golem/
├─ packages/
│  ├─ protocol/            # Pydantic models = source of truth
│  │  ├─ golem_protocol/   #   events.py, commands.py, version.py
│  │  └─ gen/              #   generated JSON Schema + TS types
│  ├─ daemon/              # Python package `golem`
│  │  └─ golem/
│  │     ├─ server/        #   socket server, JSON-RPC dispatch
│  │     ├─ sessions/      #   session manager, event log, replay
│  │     ├─ graphs/        #   agent graph, nodes, state
│  │     ├─ flows/         #   flow registry, built-in flows
│  │     ├─ models/        #   router, profiles, budgets, token counting
│  │     ├─ tools/         #   built-ins, permission engine, sandbox
│  │     ├─ mcp/           #   MCP supervisor
│  │     ├─ skills/        #   registry, selection, loader
│  │     ├─ memory/        #   store, embeddings
│  │     ├─ triggers/      #   scheduler, watchers
│  │     └─ obs/           #   tracing, cost ledger
│  └─ tui/                 # Ink app
│     └─ src/ (client/, views/, components/, state/)
├─ flows/                  # user flows (also loadable from ~/.golem/flows)
├─ skills/                 # bundled skills
├─ evals/                  # eval sets + harness
├─ docs/adr/
└─ justfile                # dev tasks: gen, test, run, lint
```

---

## 4. Protocol (draft v1)

JSON-RPC 2.0 framed as newline-delimited JSON over the Unix socket.

### Envelope for server → client events (JSON-RPC notifications)

```json
{"jsonrpc":"2.0","method":"event","params":{
  "seq": 1842, "session_id":"s_01J…", "run_id":"r_01J…",
  "ts":"2026-10-01T09:12:03.120Z", "type":"message.delta",
  "data":{"message_id":"m_…","text":"Hel"}}}
```

`seq` is a monotonic per-session sequence, used for replay (`attach(session_id, after_seq)`).

### Event types (v1)

| Group | Events |
|---|---|
| Session | `session.created`, `session.updated`, `session.closed` |
| Messages | `message.started`, `message.delta`, `message.completed` |
| Tools | `tool.requested`, `tool.started`, `tool.output` (chunked), `tool.completed`, `tool.failed` |
| Approval | `approval.needed`, `approval.resolved` |
| Runs/flows | `run.started`, `run.step.started`, `run.step.completed`, `run.interrupted`, `run.completed`, `run.failed`, `run.cancelled` |
| Models | `model.selected` (with reason), `usage.reported` (tokens, cost) |
| Skills | `skill.activated`, `skill.deactivated` |
| System | `daemon.status`, `mcp.server.status`, `warning`, `error` |

### Commands (client → server requests)

`hello` (negotiate protocol version), `session.create | list | attach | detach | close | fork`, `message.send`, `run.cancel`, `approval.respond`, `flow.list | start | status`, `skill.list | enable | disable | pin`, `config.get`, `daemon.status`.

### Rules

- Breaking changes bump `protocol_major`, and the daemon refuses mismatched clients with a clear error.
- Events are append-only facts. Clients derive all UI state from them, so replay equals reconstruction.
- The persisted event log equals the stream. Coalesce `message.delta` into `message.completed` when persisting, to keep the DB small.

---

## 5. Phases

Each phase lists its goal, deliverables, LangGraph specifics, exit criteria, and the traps to watch for. Rough effort assumes side-project time.

---

### Phase 0 — Foundations (≈ 1 weekend)

**Goal:** a monorepo that builds, lints, tests and generates types.

**Deliverables:**
- `uv` workspace for `protocol` + `daemon`, and a `pnpm` workspace for `tui`.
- `ruff`, `pyright --strict`, `pytest`, `eslint`/`tsc`, plus a `just` recipe for each.
- `just gen`: Pydantic → JSON Schema → TS types, with a CI check that generated files are up to date.
- `~/.golem` path resolution, `config.toml` loading with Pydantic Settings, and structured logging (JSON to file, pretty to stderr).
- ADR-001 (process split), ADR-002 (LangGraph boundary), ADR-003 (protocol).

**Exit criteria:** CI is green, and `just gen` produces TS types for a dummy `Ping` event.

---

### Phase 1 — Daemon skeleton + protocol (≈ 1–2 weekends)

**Goal:** a daemon that the TUI connects to, talks to, and reconnects to.

**Deliverables:**
- An asyncio Unix-socket server with NDJSON framing and a JSON-RPC dispatcher with typed handlers.
- `hello` version negotiation, `daemon.status`, heartbeat pings, and graceful shutdown on SIGTERM that drains running tasks.
- A launchd plist plus `golem daemon install | start | stop | logs`.
- TUI: connection manager with auto-reconnect and backoff, and a status bar showing connected / reconnecting.
- Headless CLI entry (`golem status`) using the same client library. Ship the client as a small TS package shared by the TUI and CLI.

**Exit criteria:** killing the daemon makes the TUI show "reconnecting", and it recovers automatically when launchd restarts the daemon.

**Watch out:** stale socket files after a crash. Unlink them on startup if no process holds the lock (use a PID lockfile).

---

### Phase 2 — Chat graph v1 + minimal TUI chat (≈ 2 weekends)

**Goal:** streaming chat with one remote model, persisted with a LangGraph checkpointer.

**Deliverables:**
- An agent `State` (TypedDict or Pydantic) holding `messages` (with the `add_messages` reducer), `session_id`, `model_profile` and `schema_version`.
- Graph: `START → call_model → END`. No tools yet.
- `AsyncSqliteSaver`, with `thread_id = session_id`.
- A stream adapter that maps `stream_mode="messages"` chunks to `message.delta` and `updates` to `message.completed`.
- Session manager: `session.create`, `message.send`. Each send runs the graph in its own `asyncio.Task` that is registered under `run_id`.
- TUI: chat view, input box, streaming render with deltas batched about every 16 ms, and a markdown render of completed messages.

**Sketch:**

```python
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

class AgentState(MessagesState):
    session_id: str
    model_profile: str
    schema_version: int

async def call_model(state: AgentState, config):
    model = router.chat_model(state["model_profile"])
    return {"messages": [await model.ainvoke(state["messages"])]}

builder = StateGraph(AgentState)
builder.add_node("call_model", call_model)
builder.add_edge(START, "call_model")
builder.add_edge("call_model", END)

async with AsyncSqliteSaver.from_conn_string(str(paths.checkpoints_db)) as saver:
    graph = builder.compile(checkpointer=saver)
    cfg = {"configurable": {"thread_id": session_id}}
    async for mode, chunk in graph.astream(inp, cfg, stream_mode=["messages", "updates"]):
        await adapter.emit(session_id, run_id, mode, chunk)
```

**Exit criteria:** a multi-turn chat streams in the TUI, and restarting the daemon and continuing the session keeps context.

**Watch out:** don't let the adapter know about specific providers. It sees LangChain message chunks only.

---

### Phase 3 — Sessions, event log, reattach, cancellation (≈ 1–2 weekends)

**Goal:** sessions behave like tmux. You can detach, reattach, run several in parallel, and cancel cleanly.

**Deliverables:**
- An `events` table (`session_id`, `seq`, `ts`, `type`, `run_id`, `data` JSON) plus `sessions` and `runs` tables.
- `session.attach(after_seq)`, which replays from the DB and then switches to live streaming without gaps. Subscribe first, buffer, replay, then flush.
- `run.cancel`: cancel the `asyncio.Task`. The checkpoint stays at the last completed superstep, and you emit `run.cancelled`.
- Ctrl-C in the TUI sends `run.cancel` (a second Ctrl-C exits the TUI).
- `session.fork(at_message_id)` using `get_state_history()`, then writing a new thread from that checkpoint.
- TUI: a session switcher (list with live status), titles generated by a cheap model after the first exchange.

**Exit criteria:** start a long answer, close the TUI, reopen it, attach, and see the full message so far plus the live remainder. Cancel works mid-stream.

**Watch out:** two histories exist, the checkpoint (model context) and the event log (UI history). They will diverge after compaction (Phase 6), and that's intended. Document it in an ADR.

---

### Phase 4 — Tools, permissions, human-in-the-loop (≈ 2–3 weekends)

**Goal:** the agent can act, and nothing happens without passing policy.

**Deliverables:**
- Graph: `call_model → (tool_calls?) → tools → call_model`, with a conditional edge back to the model.
- A custom tools node (not the prebuilt one) so permission checks, events and artifact storage wrap every call.
- Built-in tools: `read_file`, `write_file`, `edit_file` (str-replace), `list_dir`, `glob`, `grep`, `shell`, `git_*`, `web_fetch`.
- A permission engine. Policy rules live in `config.toml` and per-project `.golem/policy.toml`:
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
  Decisions are allow / ask / deny, plus "allow for this session" remembered in session metadata.
- Approval via `interrupt()`:
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
  The adapter converts the interrupt into `approval.needed`. `approval.respond` then resumes with `graph.astream(Command(resume=answer), cfg)`.
- Re-execution safety: the permission check is pure, and execution happens after the interrupt. On resume the node restarts, so already-executed calls must be skipped. Track executed `tool_call_id`s in state, or use one tool call per node pass.
- Sandbox: run shell through `sandbox-exec` with a profile that denies network and limits writes to the project directory, plus timeouts, output caps and a process-group kill on cancel.
- Secrets: the macOS Keychain via `keyring`, never in config files.
- Artifacts: large tool output goes to the artifact store, and the message carries a truncated preview plus the ID.
- TUI: an approval modal (allow once / allow for session / deny / edit args), and collapsible tool-call blocks.

**Exit criteria:** "fix the failing test in repo X" works end to end with approvals. An approval can wait while the TUI is closed and be answered after reattaching.

**Watch out:** multiple tool calls in one turn with mixed decisions, and interrupts inside parallel branches. Write tests for both before building the UI.

---

### Phase 5 — MCP integration (≈ 1–2 weekends)

**Goal:** MCP servers are first-class tool providers under the same permission layer.

**Deliverables:**
- An MCP supervisor:
  - Starts stdio servers from config and connects to HTTP ones.
  - Runs health checks and restarts servers with backoff.
  - Emits `mcp.server.status`. Port your Command Center health view onto this.
- Tool namespacing (`mcp.<server>.<tool>`) and policy rules matching on namespace.
- Lazy exposure: don't dump every MCP tool into every prompt. Tools are enabled per session or project, or pulled in by an active skill (Phase 7).
- Conversion through `langchain-mcp-adapters` (or your own thin wrapper), with every call routed through your tools node.

**Exit criteria:** two MCP servers (for example git and a browser) are usable from chat, with health shown in the TUI and a crashed server auto-restarting.

**Watch out:** tool-schema bloat hurts local models badly. Measure prompt tokens per enabled tool set.

---

### Phase 6 — Model router, local models, context management (≈ 2–3 weekends)

**Goal:** right model per step, a cost ceiling, and long sessions that don't collapse.

**Deliverables:**
- **Model profiles** in config:
  ```toml
  [models.local-fast]
  provider = "openai_compat"
  base_url = "http://127.0.0.1:8080/v1"
  model = "<your-local-model>"
  ctx = 32768
  tools = "weak"

  [models.remote-strong]
  provider = "anthropic"
  model = "<current-model>"
  ctx = 200000
  tools = "strong"
  ```
- **Router policy.** `router.pick(profile_hint, task_traits)`, where traits include `needs_tools`, `est_tokens`, `privacy` (`local_only`) and `difficulty`. Emit `model.selected` with the reason. Policy order:
  1. Session or flow pin.
  2. Privacy constraint.
  3. Budget remaining.
  4. Traits.
- **Escalation.** If a local model produces an invalid tool call or fails structured-output validation N times, retry once on a remote model and log the escalation. Implement it as a node wrapper, not inside providers.
- **Structured outputs** for anything parsed (classification, routing, flow step outputs), using `with_structured_output` or grammar-constrained decoding where the local server supports it.
- **Budget ledger.** Usage is reported per call into `costs`, with daily and per-session caps. Over the cap, the router forces local or interrupts with an approval request.
- **Token counting** per profile, plus a `compact` node that runs when the context exceeds a threshold. It summarizes old turns with a cheap model, keeps pinned items (system prompt, active skills, recent N turns, open todos), and replaces history in state using `RemoveMessage`.
- **Local server management (optional).** The daemon can start and stop the MLX or Ollama server on demand and report its memory use.

**Exit criteria:** a day of mixed usage stays under budget, routing decisions are visible in the TUI, and a 200-turn session keeps working after compaction.

**Watch out:** on 36 GB, a large local model plus an embedding model plus your IDE is tight. Budget RAM explicitly, and prefer one resident chat model.

---

### Phase 7 — Skills (≈ 1–2 weekends)

**Goal:** Agent Skills (`SKILL.md`) support compatible with Claude Code, built on progressive disclosure.

**Deliverables:**
- **Registry.**
  - Scans `~/.golem/skills`, `<project>/.golem/skills`, and optionally `~/.claude/skills`.
  - Parses and validates frontmatter (`name`, `description`, optional `allowed-tools`, plus your extension `model`).
  - Hot-reloads with `watchfiles`.
  - Precedence on name collision: project, then user, then bundled.
- **Graph state:** `active_skills: list[str]`, with a reducer that dedupes. Compaction always preserves active skill bodies, or re-injects them.
- **Selection** before `call_model`, in a `select_skills` node:
  - **Pinned:** user `/skill x`.
  - **Router pre-selection:** embed the user turn and take the top-k descriptions above a threshold. This is essential for local models.
  - **Model-driven:** the index of the selected candidates goes into the system prompt, and a `load_skill(name)` tool loads the body (or the model reads it with `read_file`).
- **Bundled files:** relative paths resolve inside the skill directory, and scripts run through the normal tools node and permission engine.
- **Scoped permissions:** while a skill is active, `allowed-tools` can narrow the tool set. It never widens global policy.
- **Trust:** first execution of a script from a skill not yet trusted triggers approval. Store a content hash per trusted skill, and re-prompt when it changes.
- **Skill hints:** `model: remote` in frontmatter makes the router escalate while the skill is active.
- **TUI:** a skills panel (list, source, trust state, active in session) and `/skill` slash commands.
- **Self-authoring:** a `propose_skill` tool writes a draft into `~/.golem/skills/_proposed/`, and the user approves a move into place.

**Exit criteria:** an existing Claude Code skill works unchanged, and the trigger-accuracy eval (Phase 11) passes for your top 10 skills on both a local and a remote model.

---

### Phase 8 — Flow engine (≈ 2–3 weekends)

**Goal:** durable, inspectable, resumable workflows written as Python.

**Flow definition (Functional API):**

```python
from langgraph.func import entrypoint, task
from golem.flows import flow, FlowContext

@task
async def fetch_prs(repo: str) -> list[dict]: ...

@task
async def summarize(pr: dict) -> str:            # LLM call, routed via router
    ...

@task
async def post_digest(text: str) -> str:         # side effect: idempotency key!
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

The exact `@entrypoint` / `@task` signatures (including how futures are awaited) differ between versions, so check the current docs. The structure is the point.

**Deliverables:**
- **Flow registry:** discovers flows in `flows/` and `~/.golem/flows/`. Metadata includes name, input schema, schedule, model profile, allowed tools and concurrency limit.
- **Run model:** `thread_id = run_id`. A `runs` table tracks status, inputs, outputs, error and timing. Step events come from a custom stream writer inside tasks, mapped to `run.step.*`.
- **Durability:**
  - Completed tasks are not re-executed on resume.
  - On daemon start, find runs in `running` state and resume them from their checkpoint, with a policy per flow: `resume` / `fail` / `ask`.
  - Choose the checkpoint durability mode per flow. Use the strongest for side-effecting flows.
- **Idempotency:** every side-effecting task takes an idempotency key derived from `(run_id, step_name, args_hash)`, and external writes check it before acting.
- **Retries:** a per-task retry policy with backoff for transient errors (rate limits, network). The final failure emits `run.failed` with the step and error.
- **Agent-as-step:** a task can invoke the agent graph on a fresh thread (`thread_id = f"{run_id}:{step}"`) with a restricted tool set. This is how "agentic" steps live inside deterministic flows.
- **Graph API flows** for cases where you really want explicit branching or cyclic structure. They are allowed, but the Functional API is the default.
- **CLI:** `golem run <flow> --repo x`, `golem runs`, `golem runs show <id>`, `golem runs resume <id>`.
- **TUI:** a runs view with a step timeline (status, duration, model, cost), pending reviews, and a jump into an agent sub-thread.

**Exit criteria:**
- Kill the daemon mid-flow, restart it, and the run resumes without repeating completed steps or side effects.
- A flow waits days on a review interrupt without issues.

**Watch out:**
- Changing a flow's code while runs are in flight. Version flows (`@flow(version=2)`) and refuse to resume a run on a mismatched version unless the flow declares compatibility.
- Non-determinism before a `@task`. Code in the entrypoint body re-runs on resume, so keep it pure.

---

### Phase 9 — Triggers, background operation, notifications (≈ 1 weekend)

**Goal:** the golem acts without you sitting in the terminal.

**Deliverables:**
- **Scheduler:** APScheduler with a SQLite job store (or schedules derived from flow metadata at startup), with missed-run policy per flow.
- **Watchers:** `watchfiles` rules in config, for example "on a new file in `~/Downloads/*.pdf`, run the `file-receipt` flow".
- **Hooks (optional):** a localhost-only HTTP endpoint for git hooks and Raycast or Shortcuts.
- **Notifications:** macOS notifications (`osascript` or `terminal-notifier`) for `approval.needed`, `run.failed` and `run.completed` (opt-in per flow). Clicking one opens the TUI attached to the run.
- **Quiet hours** and a global pause switch (`golem pause`).

**Exit criteria:** a scheduled flow runs at 9:00, needs approval, notifies you, and you approve from a TUI opened later.

---

### Phase 10 — Memory (≈ 1–2 weekends)

**Goal:** useful long-term memory that you can inspect and edit, and that never surprises you.

**Deliverables:**
- **Store:** a LangGraph `BaseStore` (SQLite-backed) with namespaces such as `("user","prefs")`, `("project", <name>)` and `("episodes",)`.
- **Write path:**
  - A `remember` tool, used explicitly.
  - An end-of-session extraction node, which proposes memories and needs confirmation in the TUI by default.
- **Read path:** a `recall` node before `call_model` that does semantic search (`sqlite-vec` plus a local embedding model) restricted to relevant namespaces, with token-capped injection.
- **Session summaries** (from compaction) are indexed so you can ask what you decided about X last week.
- **TUI:** a memory browser to view, edit, delete and export entries.

**Exit criteria:** memory measurably improves a repeat task (eval in Phase 11), and every stored item is visible and deletable.

---

### Phase 11 — Observability and evals (runs alongside, formalized here)

**Goal:** you can answer what happened, why, and what it cost, and prove that changes didn't regress anything.

**Deliverables:**
- **Tracing:**
  - OpenTelemetry spans per run → node/task → model call → tool call.
  - Export to self-hosted Langfuse, or JSONL for zero infrastructure.
  - LangSmith also works with LangGraph out of the box if you accept a hosted service.
- **Cost dashboard in the TUI:** today, this week, by model and by flow.
- **Eval harness** (`evals/`, run with `pytest -m eval`). Each suite pairs a dataset, a target and a metric:

  | Suite | What it checks |
  |---|---|
  | Routing | Inputs → expected profile |
  | Skill triggering | Prompts → expected skill or none, with precision and recall per model |
  | Tool-call validity | Local-model tool-call success rate per tool set |
  | Flow goldens | Recorded inputs → expected step outputs, with fake LLMs and recorded tool I/O |
  | Agent tasks | A small set of real tasks in throwaway git repos, LLM-judged plus deterministic checks |

- **Replay:** record a run's model and tool I/O and replay it deterministically to debug or to test adapter changes.

**Exit criteria:** `just eval` gives a scorecard, and a model swap or prompt change produces a comparable diff.

---

### Phase 12 — Hardening (ongoing; dedicate a pass after Phase 9)

- Crash tests: kill -9 at random points during flows, then assert there are no duplicate side effects and runs resume.
- DB migrations for your own tables (Alembic or a simple numbered SQL migrator). Checkpoint DB upgrades follow LangGraph's notes, so back up before upgrading.
- Backup: nightly copy of `~/.golem/*.db` using the SQLite backup API.
- Performance: daemon startup under 1 s, first token latency per profile, and TUI render under load (10 concurrent streams).
- Security review:
  - Socket permissions.
  - Sandbox profile coverage.
  - Policy defaults (deny network for shell by default).
  - Skill and MCP trust.
  - Prompt-injection surfaces: web_fetch, file contents and MCP outputs are untrusted data. Never let them auto-approve anything.
- Upgrade discipline: pin LangGraph and LangChain versions, keep a smoke-test suite that runs before bumping, and read the changelogs.

---

## 6. Cross-cutting concerns

### Testing strategy

| Layer | Approach |
|---|---|
| Protocol | Schema round-trip tests; generated TS compiles; contract tests from recorded event streams |
| Graph nodes | Unit tests with fake chat models (`GenericFakeChatModel` or your own) |
| Graphs/flows | Run with an in-memory checkpointer; test interrupt → resume paths explicitly |
| Permissions | Table-driven tests over the policy matrix |
| Daemon | Integration tests over a real socket in a temp `~/.golem` |
| TUI | `ink-testing-library` for components; a fake daemon replaying recorded events |

### Configuration layering

The built-in defaults are overridden by `~/.golem/config.toml`, then `<project>/.golem/config.toml`, then session overrides. Everything is validated by Pydantic and inspectable via `golem config show --resolved`.

### Concurrency model

- One asyncio event loop runs all graph executions as tasks.
- A semaphore per model profile, sized for local servers that only handle one or two concurrent generations.
- CPU-heavy work (embeddings, parsing) goes to a thread or process pool.
- SQLite runs in WAL mode with a single writer connection per DB, wrapped by an async queue.

### Security model, summarized

- The socket is accessible only by your user.
- Every side effect passes the permission engine, with no bypass for flows, skills or MCP.
- The sandbox is on by default for shell, and network is denied unless a rule allows it.
- Secrets live in the Keychain.
- Content from tools and the web is data, never instructions about permissions.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LangGraph API churn | Rework | Keep the adapter boundary thin, pin versions, run a smoke suite before upgrades |
| Local models are unreliable with tools | Flaky agent | Pre-select skills and tools, use structured outputs, escalate to remote, track the tool-validity eval |
| Checkpoint/state schema breaks | Lost sessions/runs | `schema_version`, additive changes only, event log as the real history, flow versioning |
| Duplicate side effects on resume | Real-world damage | Effects after interrupts, idempotency keys, crash tests |
| Remote cost creep | Money | Budget ledger with hard caps, router forced to local over the cap |
| Scope explosion | Never finishing | Phase exit criteria, a strict non-goals list, daily use of the tool from Phase 2 |
| Prompt injection via tools/MCP | Unsafe actions | No auto-approve from content, sandbox, minimal default permissions |

---

## 8. Milestones

| Milestone | Phases | What you can do |
|---|---|---|
| M1 — Talks | 0–3 | Persistent multi-session chat in the TUI, detach/reattach, cancel |
| M2 — Acts | 4–5 | Coding and ops tasks with approvals, MCP tools |
| M3 — Thinks cheaply | 6–7 | Local-first routing, budgets, long sessions, skills |
| M4 — Works alone | 8–9 | Scheduled durable flows, notifications, approvals while detached |
| M5 — Remembers and proves itself | 10–12 | Memory, evals, hardening |

Start using it daily at M1, and replace the matching Claude Code workflows one at a time from M2 onward. That way your real usage drives the priorities.

---

## 9. Open questions to decide early (write ADRs)

1. Pydantic or TypedDict for graph state? Pydantic gives validation, while TypedDict is lighter and has fewer serialization surprises.
2. MLX server vs. Ollama as the default local runtime. Benchmark your models on your Mac.
3. LangChain chat-model clients vs. a custom thin provider layer underneath LangGraph.
4. ACP / AG-UI compatibility for the protocol: adopt it, mirror it, or ignore it?
5. Are memory writes always confirmed, or auto-saved for some namespaces?
6. Flow definitions: Python only, or also a YAML DSL for simple ones? (Recommendation: Python only until it hurts.)
