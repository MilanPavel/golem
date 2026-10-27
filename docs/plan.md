# Golem — plan

> Name: `golem`, after the clay servant of the Prague legend — brought to life to do work on its maker's behalf.

## Read this first

Golem is a background program on your computer (macOS today, Linux and Windows in Phase 8), the **daemon**, that talks to language models for you. You talk to it through a chat screen in the terminal, the **TUI**. Closing the screen does not stop the work. Open it again and the conversation is still there, including an answer that kept streaming while you were away.

This file is about what comes next. How the existing pieces are built is in [architecture.md](architecture.md), and why they are built that way is in the [ADRs](adr/README.md).

### Next, in order

| Phase | What you get | Milestone |
|---|---|---|
| 1. First run and terminal UX | Ollama started and installed for you, a clearer input field, select to copy, and the state in the terminal tab | M3 — Smooth first run |
| 2. Skills | Claude Code compatible `SKILL.md` skills | M4 — Skilled |
| 3. Flows | Durable workflows written in Python, resumable after a crash | M5 — Works alone |
| 4. Triggers | Schedules, file watchers, and notifications | M5 — Works alone |
| 5. Memory | Long-term memory that you can see and edit | M6 — Remembers |
| 6. Evals and hardening | Tracing, eval suites, crash tests, backups, a security pass | M6 — Remembers |
| 7. TUI polish | A render cache for long sessions, themes, and search in the transcript | Later |
| 8. Platforms | One interface for everything OS-specific, then Linux and Windows | Later |
| 9. Model routing and long sessions | Token and cost display, a cheap profile for small jobs, budgets, escalation, compaction | Later |

What is built is in [architecture.md](architecture.md) and the ADRs, and how to install, run, and release it is in [sre.md](sre.md). The first-run and terminal work is next, then the rest of skills.

```mermaid
flowchart LR
  p1[1 First run and terminal UX] --> p2[2 Skills] --> p3[3 Flows] --> p4[4 Triggers] --> p5[5 Memory] --> p6[6 Evals and hardening] --> p7[7 TUI polish] --> p8[8 Platforms] --> p9[9 Model routing and long sessions]
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

JSON-RPC 2.0, one JSON object per line, over `~/.golem/run/golem.sock`. Protocol 2.23 is on the wire today (see [architecture.md](architecture.md#what-is-on-the-wire-today)). The phases below add the rest.

| Group | New events | Phase |
|---|---|---|
| Models | `code`, `provider`, and `hint` on `run.failed` | 1.1 |
| Models | the `model.server` notification (`starting`, `ready`, `failed`), and the local server in `daemon.status` | 1.2 |
| Models | `usage.reported` (tokens, cost) | 9.1 |
| System | `warning`, `error` | 9.4 |
| Skills | `skill.activated`, `skill.deactivated` | 2.3 |
| Runs and flows | `run.step.started`, `run.step.completed`, `run.interrupted` | 3.2, 3.4 |

New commands: `session.set_skills` (2.3), `skill.trust | untrust` (2.6), `flow.list | start | status` (3.1), and `daemon.shutdown` (8.1).

Rules:

- A breaking change bumps `protocol_major`, and the daemon refuses a mismatched client with a clear error.
- Events are append-only facts. Clients derive all UI state from them, so replaying equals rebuilding.
- Every event is stored before it is sent. `message.delta` is coalesced into `message.completed` in the log.

---

## Phase 1 — First run and terminal UX

A new user picks a local model and gets an answer, even with no Ollama on the Mac. The screen feels like a modern terminal app: an input field with a hint row, select to copy, and the state in the terminal tab. It is tracked by [#62](https://github.com/MilanPavel/golem/issues/62). Each step is one PR, and each of its tickets is one commit in it.

Choices that hold for the whole phase:

- **Never a dead end.** Every failure says what to do next, and the TUI offers that step where it can.
- **Never install anything without asking.** A user who only uses hosted models never sees an Ollama question.
- **OS-specific code goes behind one small function from the start**, so 8.1 only moves it. That covers the Ollama binary, Homebrew, and the clipboard.
- **The TUI runs `brew install`, not the daemon.** It needs the user's terminal and `PATH`, and launchd gives the daemon neither.

```mermaid
flowchart LR
  s1[1.1 Local model down] --> s2[1.2 Start Ollama on demand] --> s3[1.3 Install Ollama from the picker]
  s4[1.4 Status in the tab] --> s5[1.5 Composer and hint row] --> s6[1.6 Select to copy]
```

The Ollama track (1.1 to 1.3) and the TUI track (1.4 to 1.6) do not depend on each other.

### 1.1 A local model that is down says so — [#56](https://github.com/MilanPavel/golem/issues/56)

- **Goal:** a stopped or missing Ollama is never a raw httpx error.
- **You can:** send to a local model with Ollama stopped, and read `Ollama isn't running · /model to switch` with the fix, instead of `All connection attempts failed`.
- **Build:**
  - The runner turns an `httpx.ConnectError` or `ConnectTimeout` from an Ollama model call into a failure with `code: "model_unreachable"`, the provider, and a hint. Today any exception becomes `run.failed` with `str(exc)` ([runner.py](../packages/daemon/golem/sessions/runner.py)).
  - The hint comes from `_down_hint` and `_ollama_installed` in [pulls.py](../packages/daemon/golem/models/pulls.py), moved to a shared `golem/models/ollama.py`: `ollama serve` when it is installed, `brew install ollama` when it is not.
  - `run.failed` gains optional `code`, `provider`, and `hint`. A protocol minor bump, and `just gen`.
  - The banner shows the message and the hint. For `model_unreachable` it adds `/model to switch`, and the model in the status line turns red until the next answer or a model change.
- **Done when:** with Ollama stopped, a message to a local model shows the new banner, and `/model` switches to a hosted model in two keys.

### 1.2 Start Ollama on demand — [#57](https://github.com/MilanPavel/golem/issues/57)

- **Goal:** an installed Ollama is running when you need it, and not otherwise.
- **You can:** reboot, open golem, send to a local model, and get an answer without starting anything.
- **Build:**
  - A `LocalServer` in `golem/models/ollama.py`. `ensure_running()` asks `GET /api/tags`. When nothing answers and the binary exists, it starts `ollama serve`, logs to `~/.golem/logs/ollama.log`, and waits for it to answer, with a timeout and a clear error. The binary is found by its known paths, because the daemon has no `PATH` under launchd.
  - It runs before a local model call, and when `model.list` looks for local models.
  - A `model.server` notification (`starting`, `ready`, `failed`). The meter shows `starting ollama` while it waits.
  - A server that is already running, for example from `brew services start ollama` or the Ollama app, is used as it is. The daemon stops only a server it started itself: when the daemon stops, and after it has been idle for `ollama.idle_stop_minutes` (default 30).
  - `daemon.status` reports the local server: who started it, its PID, and its memory use.
  - An ADR on who owns the Ollama process and when it stops.
  - `golem doctor` drops the manual start step.
- **Done when:** after `brew services stop ollama`, the first local request starts Ollama and answers, and the server stops after the idle time.
- **Watch out:**
  - Two daemons, for example a dev build next to the installed one, must not both start a server. Use a lock file.
  - On 36 GB, a large chat model, an embedding model, and an IDE are tight. Prefer one resident chat model.

### 1.3 Install Ollama from the model picker — [#58](https://github.com/MilanPavel/golem/issues/58)

- **Goal:** a new user never installs Ollama by hand.
- **You can:** choose a local model on a Mac without Ollama, answer one question, and chat.
- **Build:**
  - When the provider binary is missing, the model picker asks once: "Ollama isn't installed. Run `brew install ollama` now?" The 1.1 banner for a missing Ollama offers the same question.
  - Yes runs `brew install ollama` from the TUI and shows its output in a band. Then the existing pull downloads the model, 1.2 starts the server, and the message is sent.
  - Without Homebrew, the picker shows the download link from ollama.com and the `/model` hint.
  - `docs/install.md` and `golem doctor` drop the manual install step.
- **Done when:** on a Mac without Ollama, choosing a local model in the picker installs Ollama after one question, downloads the model, and answers.

### 1.4 Status in the terminal tab — [#59](https://github.com/MilanPavel/golem/issues/59)

- **Goal:** you can see from another tab whether golem is working or needs you.
- **You can:** glance at the tab and see idle, working, waiting for your approval, an error, or disconnected.
- **Build:**
  - A pure `windowTitle({ title, phase, approval, error, connection })` in [window-title.ts](../packages/tui/src/window-title.ts). It puts a state mark before `golem — <title>`: `✳` when idle, a spinner frame while working (at most one change a second, so the tab does not flicker), `!` for an approval, and `✗` for an error. The phase comes from `meterPhase` in [progress.ts](../packages/tui/src/progress.ts).
  - OSC `9;4` progress while a run is working, cleared when it ends. Terminals that know it show a tab or dock indicator, and the others ignore it.
  - First, record what Claude Code writes to the terminal (`script -q /tmp/cc.log claude`), to learn which sequence makes the `Idle` subtitle and the coloured dot in the tab, and match it.
  - Unit tests in `window-title.test.ts`.
- **Done when:** the tab shows idle, working, and approval correctly, and the original title is back after exit.

### 1.5 A composer with a hint row — [#60](https://github.com/MilanPavel/golem/issues/60)

- **Goal:** the input looks like an input field, and short-lived hints have their own place.
- **You can:** type after `❯` between two thin rules, see a dim placeholder in an empty draft, and see hints on the right above the input.
- **Build:**
  - `layoutComposer` in [chrome.ts](../packages/tui/src/chrome.ts) gets the `❯ ` prefix and a placeholder. A dim `─` rule above and below replaces the dark background. The colours get names in [theme.ts](../packages/tui/src/theme.ts), ready for 7.2.
  - `frameBudget` gets the two rule rows and a hint row. On a short window the rules give their rows back before the composer shrinks.
  - A hint is text with an end time, right-aligned above the top rule. The exit hint, `/copy` results, and `copied N chars to clipboard` (1.6) move there. Errors stay in the banner on the left.
  - Tests in `chrome.test.ts` for the layout and the order in which bands give rows back.
- **Done when:** the composer looks right at 80 and 200 columns, and a short window still leaves the chat one row.
- **Watch out:** "Image in clipboard · ctrl+v to paste" waits for image input. A hint for something golem cannot do yet would only mislead.

### 1.6 Select to copy — [#61](https://github.com/MilanPavel/golem/issues/61)

- **Goal:** selecting text copies it, and the mouse wheel still scrolls.
- **You can:** drag over the transcript, see the selection, let go, and find the text on the clipboard, with `copied N chars to clipboard` in the hint row.
- **Build:**
  - [screen.ts](../packages/tui/src/screen.ts) turns on `?1002h`, so the terminal reports a drag. `bindPointer` reports press, drag, and release with their cell, not only the wheel.
  - A pure `selection.ts`: the start and end of a selection, in transcript rows and columns (the wrapped rows that are painted, plus the scroll offset). `selectedText` joins the rows and trims trailing spaces. Unit tests.
  - The transcript draws the selection inverse. A click, Esc, or new output clears it. Dragging past the top or bottom edge scrolls.
  - A `clipboard.ts` that writes OSC 52 first, then falls back to `pbcopy`. `/copy` uses it too. 8.1 adds the other systems to it.
- **Done when:** dragging across two wrapped lines copies exactly the text you see, the wheel still scrolls, and Option-drag still selects the terminal's way.
- **Watch out:**
  - The scrollbar column and the composer are not part of the selection.
  - In tmux, OSC 52 needs `set-clipboard on`. The `pbcopy` fallback covers the rest.

---

## Phase 2 — Skills

Agent Skills (`SKILL.md`) compatible with Claude Code, loaded by progressive disclosure. The details and the use cases are in the milestone, tracked by [#10](https://github.com/MilanPavel/golem/issues/10). Each step is one PR, and each of its tickets is one commit in it. This section keeps the why.

A skill becomes active in one of three ways:

| Way | Who | Where the body goes | How long |
|---|---|---|---|
| **Invoke** `/ship fix the mcp restart` | You | The turn's user message, arguments substituted | That turn |
| **Pin** `/skill pin <name>` | You | The system prompt, re-read every model call | Until unpinned. Survives a restart, and a fork copies it |
| **Load** `load_skill(name)` | The model | A tool result in history | The rest of the session |

Choices that hold for the whole phase:

- **The daemon owns the registry, and graph state holds only skill names.** Bodies are read from disk when the prompt is built.
- **The system prompt is built per model call and never checkpointed.** golem has none today, so 2.3 adds it.
- **`allowed-tools` pre-approves, as in Claude Code, but only for a trusted skill**, and a deny rule always wins. The earlier plan said it only narrows.
- **A skill from an untrusted project works like a user skill.** Only its scripts and `` !`cmd` `` always ask, and its `allowed-tools` is ignored until the project is trusted ([ADR-012](adr/012-permission-rules.md)).
- **`~/.claude/skills` and `<project>/.claude/skills` are read by default.** Legacy `.claude/commands/*.md` is not.
- **Invoking comes before pinning.** It is the most-used Claude Code feature, and it needs no system prompt.

The registry, `/skills`, and `golem skills` are built ([#4](https://github.com/MilanPavel/golem/issues/4)).

```mermaid
flowchart LR
  s2[2.2 Invoke /name] --> s3[2.3 Pin + system prompt] --> s4[2.4 Model-driven loading]
  s4 --> s5[2.5 Embeddings]
  s4 --> s6[2.6 Trust] --> s7[2.7 Self-authored]
```

### 2.2 Invoke a skill with `/name` — [#21](https://github.com/MilanPavel/golem/issues/21)

- **Goal:** you can run a skill once, with arguments, the way Claude Code does.
- **You can:** `/ship fix the mcp restart`.
- **Build:** body expansion (`$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, …), `message.send` with a skill, `/name` in the composer, a collapsed transcript line, and skill folders as read roots for the read tools and the sandbox.
- **Done when:** `/ship` in golem on this repo behaves like `/ship` in Claude Code.

### 2.3 Pinned skills and the system prompt — [#5](https://github.com/MilanPavel/golem/issues/5)

- **Goal:** you can turn a skill on for the whole session.
- **You can:** `/skill pin <name>`, `/skill unpin <name>`, and see active skills in the status line and the system prompt in `/debug model`.
- **Build:** a system prompt builder, `active_skills` in graph state with `session.set_skills`, `skill.activated` and `skill.deactivated`, handling of a pinned skill that is edited or deleted, and a fork that copies pins.
- **Done when:** a pinned skill changes the answer, and is still pinned after `kill -9` and a reattach.

### 2.4 Model-driven loading — [#6](https://github.com/MilanPavel/golem/issues/6)

- **Goal:** the model picks up a skill when it needs one.
- **You can:** ask for a task a skill covers, and see it activate on its own.
- **Build:** an index of descriptions in the system prompt, within a size budget and without `disable-model-invocation` skills, and a `load_skill(name)` tool.
- **Done when:** an existing Claude Code skill that reads a reference file works unchanged, triggered by the model.

### 2.5 Pre-selection by embeddings — [#7](https://github.com/MilanPavel/golem/issues/7)

- **Goal:** local models, which are bad at picking from a long list, still get the right skill.
- **You can:** use skills reliably on a local model.
- **Build:** embeddings through the router, and a `select_skills` node before `call_model`, on per profile.
- **Done when:** the hand-check list from 2.4 scores better or equal on a local model. The skill-trigger eval (6.2) replaces it later.

### 2.6 Trust and scoped permissions — [#8](https://github.com/MilanPavel/golem/issues/8)

- **Goal:** a skill can pre-approve only what you trusted, and never past a deny rule.
- **You can:** see which skills are trusted, and approve a skill's script once.
- **Build:** a trust store keyed by a hash of the skill folder, approvals for scripts, `allowed-tools`, and `` !`cmd` `` dynamic context.
- **Done when:** editing a trusted skill's script triggers a new approval.

### 2.7 Self-authored skills — [#9](https://github.com/MilanPavel/golem/issues/9)

- **Goal:** golem can turn a repeated task into a skill.
- **You can:** ask golem to write or improve a skill, review the draft, and accept it.
- **Build:** bundled skills (with a skill-authoring skill), a `propose_skill` tool that writes into `~/.golem/skills/_proposed/`, and edits to a skill shown as a diff.
- **Done when:** a proposed skill is accepted and then triggers in a new session.

Later phases pick up the rest: `model:` frontmatter (9.3), `context: fork` (3.6), and compaction (9.5), which keeps pinned skills for free because they live in the system prompt.

---

## Phase 3 — Flows

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

### 3.1 Registry and `golem run`

- **Goal:** golem can find and run a flow.
- **You can:** `golem run hello --name x` for a flow with no LLM calls.
- **Build:**
  - Discover flows in `flows/` and `~/.golem/flows/`. Metadata: name, input schema, schedule, model profile, allowed tools, concurrency limit.
  - `flow.list` and `flow.start`. A run uses `thread_id = run_id`, and the `runs` table gains inputs, outputs, and error.
  - `golem runs` lists runs.
- **Done when:** a trivial flow runs from the CLI, and its result is in `golem runs`.

### 3.2 Step events and the runs view

- **Goal:** you can watch a flow work.
- **You can:** open `/runs` in the TUI and see each step's status and duration.
- **Build:** a stream writer inside tasks, mapped to `run.step.started` and `run.step.completed`. A runs view in the TUI, and `golem runs show <id>`.
- **Done when:** a three-step flow shows three steps, live.

### 3.3 Resume after a restart

- **Goal:** a crash does not lose a flow.
- **You can:** kill the daemon mid-flow and see the run continue after it restarts.
- **Build:**
  - On start, find runs in `running` and resume them from their checkpoint, with a policy per flow: `resume`, `fail`, or `ask`.
  - Completed tasks are not re-run. Side-effecting flows use the strongest checkpoint durability mode.
  - `golem runs resume <id>`.
- **Done when:** after `kill -9` mid-flow, the run finishes without repeating completed steps.
- **Watch out:** code in the entrypoint body re-runs on resume, so keep it pure.

### 3.4 Review interrupts

- **Goal:** a flow can stop and wait for you, for days if needed.
- **You can:** review a draft in the TUI and approve or edit it.
- **Build:** `interrupt()` in a flow emits `run.interrupted`, and answering reuses the approval band ([ADR-013](adr/013-approvals.md)) with an editable text field, like editing a call's arguments. Pending reviews show in `/runs`.
- **Done when:** a flow waits overnight on a review and finishes after you answer.

### 3.5 Idempotency and retries

- **Goal:** no step does a real-world action twice.
- **You can:** trust a flow that posts somewhere to post once.
- **Build:**
  - Every side-effecting task gets an idempotency key from `(run_id, step_name, args_hash)`, and external writes check it first.
  - A retry policy per task with backoff for transient errors. The final failure emits `run.failed` with the step and the error.
- **Done when:** a crash test between "write" and "checkpoint" produces exactly one write.

### 3.6 An agent as a step

- **Goal:** deterministic flows can contain agentic steps.
- **You can:** write a flow step that says "fix this" and let the agent do it with a restricted tool set.
- **Build:** a task invokes the agent graph on its own thread (`thread_id = f"{run_id}:{step}"`) with the flow's allowed tools. `/runs` can jump into that thread.
- **Done when:** a flow step runs a tool-using agent, and its tool calls go through the permission engine.

### 3.7 Flow versioning

- **Goal:** changing a flow's code does not corrupt runs in flight.
- **You can:** edit a flow while an old run waits on a review.
- **Build:** `@flow(version=2)`. Resume refuses a mismatched version unless the flow declares compatibility.
- **Done when:** a version bump with a waiting run gives a clear message, not a broken resume.

---

## Phase 4 — Triggers and notifications

The golem acts without you sitting in the terminal.

### 4.1 Notifications

- **Goal:** you hear about what needs you.
- **You can:** get a macOS notification for `approval.needed` and `run.failed`, and click it to open the TUI on that session or run.
- **Build:** notifications through `terminal-notifier` or `osascript`. `run.completed` notifications are opt-in per flow. A `golem open <id>` deep link.
- **Done when:** an approval in a detached session produces a notification that opens the right screen.

### 4.2 Scheduler

- **Goal:** flows run on a schedule.
- **You can:** have `pr-digest` run every weekday at 9:00.
- **Build:** APScheduler (async) with schedules from flow metadata, and a missed-run policy per flow.
- **Done when:** a scheduled flow runs at 9:00, needs approval, notifies you, and you approve from a TUI opened later.

### 4.3 File watchers

- **Goal:** files arriving can start work.
- **You can:** say "on a new PDF in `~/Downloads`, run `file-receipt`".
- **Build:** `watchfiles` rules in config, debounced, each starting a flow with the path as input.
- **Done when:** dropping a file starts exactly one run.

### 4.4 Pause and quiet hours

- **Goal:** golem stays quiet when you want it to.
- **You can:** `golem pause` and `golem resume`, and set quiet hours.
- **Build:** a global pause that holds triggers (not running chats), and quiet hours that delay notifications. The TUI status line shows `paused`.
- **Done when:** a scheduled run during pause waits and runs once after resume.

### 4.5 Hook endpoint (optional)

- **Goal:** git hooks, Raycast, and Shortcuts can start flows.
- **You can:** start a flow from a keyboard shortcut.
- **Build:** a localhost-only HTTP endpoint with a token from the Keychain.
- **Done when:** a Shortcut starts a flow, and a request without the token is refused.

---

## Phase 5 — Memory

Useful long-term memory that you can inspect and edit, and that never surprises you.

### 5.1 Explicit memory and a browser

- **Goal:** golem can remember what you tell it to.
- **You can:** say "remember that I prefer pnpm", and see it later in `/memory`.
- **Build:** a SQLite-backed `BaseStore` in `memory.db`, with namespaces such as `("user","prefs")` and `("project", <name>)`. `remember` and `recall` tools. A TUI browser to view, edit, delete, and export.
- **Done when:** every stored item is visible and deletable, and a new session uses a remembered preference.

### 5.2 Semantic recall

- **Goal:** relevant memories show up without being asked for.
- **You can:** get answers that use what you said weeks ago.
- **Build:** a `recall` node before `call_model`, using `sqlite-vec` and a local embedding model, limited to relevant namespaces, with a token cap.
- **Done when:** the repeat-task eval (6.2) improves with memory on.

### 5.3 Confirmed extraction

- **Goal:** golem proposes what to remember, and you decide.
- **You can:** accept or reject proposed memories at the end of a session.
- **Build:** an end-of-session node that proposes memories. They need confirmation in the TUI by default.
- **Done when:** nothing is stored without a confirmation unless the namespace is configured otherwise.

### 5.4 Searchable session summaries

- **Goal:** you can ask what you decided last week.
- **You can:** ask "what did we decide about the protocol bump?" and get the answer with a link to the session.
- **Build:** compaction summaries (9.5) and session titles are indexed in the memory store.
- **Done when:** a question about an old session finds it.

---

## Phase 6 — Evals and hardening

This runs alongside the other phases. It gets a dedicated pass after Phase 4.

### 6.1 Tracing

- **Goal:** you can answer what happened, why, and what it cost.
- **Build:** OpenTelemetry spans per run, node or task, model call, and tool call. Export to self-hosted Langfuse, or to JSONL for zero infrastructure. A cost dashboard in the TUI by model and by flow.
- **Done when:** one slow answer can be broken down into its spans.

### 6.2 Eval harness

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

### 6.3 Replay

- **Goal:** debug a run without paying for it again.
- **Build:** record a run's model and tool I/O, and replay it deterministically.
- **Done when:** a recorded run replays to the same events.

### 6.4 Hardening

- Crash tests: `kill -9` at random points in flows, then check there are no duplicate side effects and runs resume.
- A nightly backup of `~/.golem/*.db` with the SQLite backup API.
- Performance: daemon start under 1 s, first-token latency per profile, and TUI rendering with 10 streams.
- Security review: socket permissions, which programs the Keychain trusts with the golem items (only the signed daemon, see [ADR-021](adr/021-release-signing.md)), that no key reaches a log, the event log, or the wire view, sandbox profile coverage, policy defaults (shell has no network by default), skill and MCP trust, and prompt injection through `web_fetch`, files, and MCP output. Content never auto-approves anything.
- Upgrade discipline: pinned LangGraph and LangChain versions, a smoke suite before each bump, and the changelogs read.

---

## Phase 7 — TUI polish

A long session is already usable. These steps wait until scrolling feels slow, or until themes and search start to matter.

### 7.1 Render cache

- **Goal:** a long session stays smooth.
- **You can:** scroll and stream in a session with hundreds of messages without the screen lagging.
- **Build:**
  - Cache the wrapped rows of each finished message, keyed by message id, text length, and width.
  - Only the streaming message is re-wrapped on each paint. A resize clears the cache.
- **Done when:** a test session with 500 messages paints in under 16 ms per tick on your machine.

### 7.2 Themes

- **Goal:** the screen is readable on a light terminal as well as a dark one.
- **You can:** run `/theme light`, `/theme dark`, or `/theme auto`, and have the choice remembered.
- **Build:**
  - Turn the color constants in [theme.ts](../packages/tui/src/theme.ts) into a `Theme` object with named roles (accent, user background, user text, dim, warning, error), and one dark and one light palette.
  - Components read colors from the theme in a React context, never from constants.
  - `auto` picks a palette from `COLORFGBG` when the terminal sets it, and otherwise uses dark.
  - The choice is saved in `~/.golem/tui.json`.
- **Done when:** both palettes look right in a light and a dark terminal, and no component imports a color constant directly.

### 7.3 Search in the transcript

- **Goal:** find something said earlier without scrolling for it.
- **You can:** press Ctrl-F, type a word, and jump between matches with Enter and Shift-Enter (or Ctrl-N and Ctrl-P).
- **Build:**
  - A search bar takes the composer row while it is open. It shows `3/12` for the current match and the total.
  - Matches are found in the message text, then mapped to wrapped rows through the render cache (7.1), so a match scrolls into view in the right place.
  - Matches are highlighted in the transcript. The current one has a stronger color from the theme (7.2).
  - Search is case-insensitive unless the query has a capital letter. Esc closes it and returns to where you were scrolled.
  - Finding matches and mapping them to rows are pure functions, with unit tests.
- **Done when:** in a 500-message session, Ctrl-F finds a word from the first message and scrolls it into view, and Esc puts the view back.
- **Watch out:** a match inside a streaming message moves as text arrives. Search finished messages only, and say so in the bar while a reply is streaming.

---

## Phase 8 — Platforms

golem installs with `brew install` on macOS, upgrades without losing data, and `golem doctor` says what is wrong. This phase puts everything that depends on the operating system behind one interface, proves it on Linux, then adds Windows. Each platform gets the same archive as macOS:

```
golem-<version>-<os>-<arch>.tar.gz   (.zip on Windows)
├─ bin/golem                 # one executable: the CLI and the TUI
└─ libexec/golem-daemon/     # the daemon with its own Python, no system Python needed
```

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

### 8.1 Platform seams

- **Goal:** everything that depends on the operating system sits behind one small interface, so Linux and Windows are additions, not rewrites.
- **You can:** nothing new yet. This step makes the next three cheap.
- **Build:** a `platform` module in the daemon and one in `@golem/client`, each with one implementation per OS:
  - **Endpoint:** where the daemon listens (`unix:` path or `pipe:` name). `resolveSocketPath` becomes `resolveEndpoint`.
  - **Service manager:** launchd, systemd user units, or Task Scheduler, behind `golem daemon install|uninstall|start|stop|restart|logs`. The `Platform` protocol in `golem/doctor.py` folds into it, so `golem doctor` checks whichever service the OS uses, and its Ollama fix stops assuming Homebrew.
  - **Paths:** `~/.golem` on macOS and Linux, `%LOCALAPPDATA%\golem` on Windows, and `GOLEM_HOME` everywhere.
  - **Clipboard:** `clipboard.ts` (1.6) already writes OSC 52, then falls back to `pbcopy`. Add `wl-copy` or `xclip`, and `clip.exe`.
  - **Local model server (1.2, 1.3):** the Ollama binary paths and `brew install` become per-OS.
  - **Notifications (4.1):** `terminal-notifier`, `notify-send`, or Windows toasts.
  - **Sandbox** ([ADR-014](adr/014-shell-sandbox.md)): a capability, `sandbox-exec` or none. `daemon.status` reports it. Without a sandbox, a shell rule that says `allow` is treated as `ask`, and the TUI shows `no sandbox`.
  - **Stopping the daemon:** a `daemon.shutdown` request, so stopping does not depend on Unix signals.
- **Done when:** no code outside the `platform` modules checks the OS, and the tests run against a fake platform.

### 8.2 Linux

- **Goal:** prove the seams on the easiest second platform.
- **You can:** install golem on Linux with the same Homebrew formula, or by unpacking the archive.
- **Build:**
  - `linux-x64` and `linux-arm64` archives in the release matrix. CI runs the tests and `just smoke-dist` on Ubuntu.
  - A systemd user unit, written by `golem daemon install`.
  - No sandbox at first. `bubblewrap` can come later behind the same capability.
- **Done when:** on a fresh Ubuntu VM, install, chat, log out and back in, and reattach all work.

### 8.3 Windows: transport and service

- **Goal:** the daemon runs on Windows and the TUI can reach it.
- **You can:** run the daemon and the TUI on Windows 11, from the archive.
- **Build:**
  - Python's asyncio has no Unix socket server on Windows. The daemon serves a named pipe, `\\.\pipe\golem-<user>`, readable only by the current user. Node's `net.connect` already accepts that path, so the client only changes in `resolveEndpoint`.
  - A Task Scheduler task that starts the daemon at logon and restarts it on failure, written by `golem daemon install`.
  - The pid lock uses a Windows file lock.
  - CI runs the tests on `windows-latest`.
- **Done when:** on Windows 11, `golem daemon install`, chat, reboot, and reattach all work.
- **Watch out:** the named pipe server in asyncio is not a public API. If it proves fragile, the fallback is loopback TCP with a random port and a token in a file only you can read. That choice gets an ADR.

### 8.4 Windows: packaging

- **Goal:** installing on Windows is one command, like on a Mac.
- **You can:** run `scoop install golem`.
- **Build:**
  - A `windows-x64` zip in the release matrix, and a Scoop bucket updated by the release workflow. A winget manifest comes later.
  - Check the TUI in Windows Terminal: the alternate screen, the mouse wheel, and colors.
  - The shell tool runs without a sandbox (8.1), and the approval modal says so.
- **Done when:** on a clean Windows 11 machine, `scoop install golem`, `golem daemon install`, and `golem` give a working chat.

---

## Phase 9 — Model routing and long sessions

These steps were the second half of the model work, after `/model`. Tools and approvals exist now, and routing, escalation, and compaction matter most once the agent runs long, tool-heavy tasks every day.

### 9.1 Tokens and cost

- **Goal:** you always know what a session has cost.
- **You can:** see tokens and cost per answer, and `/cost` for today, this week, and this session.
- **Build:**
  - `usage.reported` per model call, and a `costs` table. Prices come from `model.list`, and a profile's `price` overrides them.
  - The meter shows tokens while writing. The finished answer shows `1.2k tok · $0.004` next to its duration.
  - `/cost` prints a short table.
- **Done when:** the cost of a day of use matches the provider's dashboard within a few percent.

### 9.2 Cheap profile and structured outputs

- **Goal:** small jobs (titles, classification) stop using the expensive model.
- **You can:** set `titles = "qwen"` (a profile or a ref) and never pay a remote call for a title again.
- **Build:**
  - Task-to-profile settings for internal jobs, starting with titles ([titles.py](../packages/daemon/golem/sessions/titles.py)).
  - Structured outputs for anything parsed, with `with_structured_output`, or grammar-constrained decoding where the local server supports it.
- **Done when:** titles come from the cheap profile, and a malformed structured answer is retried, not crashed on.

### 9.3 Router and budgets

- **Goal:** the right model is picked automatically, and spending has a ceiling.
- **You can:** set daily and per-session caps, and see why a model was picked.
- **Build:**
  - `router.pick(profile_hint, task_traits)`, with traits `needs_tools`, `est_tokens`, `privacy` (`local_only`), and `difficulty`. Policy order:
    1. Session or flow pin.
    2. Privacy constraint.
    3. Budget remaining.
    4. Traits.
  - `model.selected` carries the reason, and the TUI shows it in the answer footer.
  - Over a cap, the router forces local, or asks for approval ([ADR-013](adr/013-approvals.md)).
- **Done when:** a day of mixed use stays under budget, and each routing choice is visible.

### 9.4 Escalation

- **Goal:** a weak local model does not stall a task.
- **You can:** start on a local model and let golem step up when it fails.
- **Build:** a node wrapper that retries once on a remote profile after N invalid tool calls or failed structured outputs, and logs the escalation as a `warning` event.
- **Done when:** a recorded failing local tool call escalates once and succeeds.

### 9.5 Compaction and context gauge

- **Goal:** long sessions keep working.
- **You can:** see how full the context is in the status line (`ctx 62%`), and keep chatting past the limit.
- **Build:**
  - Token counting per profile, against the context size from `model.list` (for Ollama, the `num_ctx` actually sent).
  - A `compact` node that runs over a threshold. It summarizes old turns with the cheap profile and keeps pinned items: the system prompt, active skills, the last N turns, and open todos. It replaces history in state with `RemoveMessage`.
  - The screen keeps the full transcript. The model tab in `/debug` shows the compacted one, as [ADR-006](adr/006-checkpoint-continuity.md) intends.
  - `session.fork` may need a `before` bound on history reads here ([ADR-010](adr/010-fork.md)).
- **Done when:** a 200-turn session keeps working after compaction.

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

Built-in defaults, then `~/.golem/config.toml`, then `<project>/.golem/config.toml`, then session overrides. Everything is validated by Pydantic, and `golem config show --resolved` prints the settings and the tool rules for the current folder ([ADR-012](adr/012-permission-rules.md)). The tool rules come from the session folder's `.golem/policy.toml`, not its `config.toml`.

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
| macOS-only code spreads before Phase 8 | A costly Windows port | New OS-specific code goes behind a small function from the start, so 8.1 only moves it |

## Open questions

Each one gets an ADR when it is decided.

1. ACP or AG-UI compatibility for the protocol: adopt it, mirror it, or ignore it?
2. Are memory writes always confirmed, or auto-saved for some namespaces? (Needed by 5.3.)
3. Flows in Python only, or also a YAML format for simple ones? (Recommendation: Python only until it hurts.)
4. Windows transport: a named pipe or loopback TCP with a token file? (Needed by 8.3. Named pipe first, TCP if asyncio's pipe server proves fragile.)
5. `bun build --compile` or Node's single executable feature for `bin/golem`? Decided in [ADR-019](adr/019-single-binary.md): bun.
