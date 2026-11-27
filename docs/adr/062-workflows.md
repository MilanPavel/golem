# ADR-062: Workflows on `golem.workflow`: your code decides the order, golem keeps every step

**Date**: 2026-11-24
**Status**: proposed
**Deciders**: Milan Pavel

## Context

Phase 3 ([#18](https://github.com/MilanPavel/golem/issues/18)) was written before Phases 4, 15 and 18 existed in their current form. Most of what Workflows needs is built now. The design is in [../design/workflows.md](../design/workflows.md).

What exists, with the file that does it (paths are under `packages/daemon/golem/` unless noted):

- A run with no client: `SessionManager.create(..., origin=...)` in `sessions/manager.py`, started for routines by `SessionLauncher` in `server/routine_launch.py` ([ADR-050](050-routines-and-headless-sessions.md)).
- Triggers: `routines.py` (the schedule) and `routine_scheduler.py` (`trusted_folders`, the scheduler).
- Finding you: `Notifier` in `notify/notifier.py`.
- Agent steps: `start_helper`, `start_helpers` and `helper_results` in `sessions/manager.py`, and agent files in `agents/registry.py` ([ADR-059](059-helpers-are-child-sessions.md)).
- Concurrency: `Dispatcher.hold` and `job_slot` in `models/dispatcher.py` ([ADR-060](060-dispatcher-and-engine-profile.md)).
- Checkpoints: the `AsyncSqliteSaver` wrapper in `store/checkpoints.py`. The Functional API is not used yet ([ADR-002](002-langgraph-boundary.md), [ADR-006](006-checkpoint-continuity.md)).
- A run view meant for workflows: `packages/view/src/steps-list.ts` and `packages/view/src/runs.ts`.
- A `PendingItem` shape that the Inbox reads (`packages/protocol/golem_protocol/commands.py`).

Nothing for workflows exists in code. The protocol is at 2.155 (`packages/protocol/golem_protocol/version.py`).

Four gaps need a decision before code:

- `run.agent` has no parent session. A helper needs a `parent_session_id` and a `parent_call_id`.
- A review step must wait for days. Chat approvals are derived from the event log, so they cannot be reused as they are.
- A workflow file is user code. It must not crash or trick the daemon.
- The engine: who saves the steps, and who decides what runs again after a restart.

## Decision

### A workflow is Python

A workflow is one `.py` file in `workflows/` of a project, or in the user's workflows folder. It imports only `golem.workflow`.

```python
@workflow(trigger=schedule("mon 06:00"), inputs={"package": str})
async def upgrade_dependencies(run: Run) -> None: ...
```

| Call | What it does |
|---|---|
| `run.step(name, fn, *args, key=)` | A plain function. The result is saved. |
| `run.parallel(...)` | Several steps or agents at once. |
| `run.agent(type, brief=, gets=, worktree=, budget=)` | A helper, as an agent file says. |
| `run.review(draft, ask=)` | Waits for you. |
| `run.notify(text)` | Tells you through the Notifier. |
| `run.llm(...)` | One model call, no tools. |
| `run.tool(...)` | One tool, through the permission engine. |
| `run.skill(...)` | One skill, as `/skill` in a headless session. |

`key=` means "do this once": a finished step with a key never runs again, across retries and restarts. A real-world action (a pull request, an email) carries one. One gap remains, which no engine can close: a crash after the action happened but before golem saved its result. Then the step is left "may have run", and on retry golem passes the key to the receiver as an idempotency key, so the receiver can drop the second copy (spike, 2026-11-24).

### A run owns a headless session only when a step needs one

- A workflow run gets a headless session, `origin="workflow:<name>"`, made through `SessionManager.create`, the first time a step needs one: an agent, a skill, a tool that reads the session (`SESSION_TOOLS`), or a tool output big enough to keep as an artifact. A run of plain steps has none. One lock makes parallel steps share one session. It is titled `<workflow> · run of <date>`, `workflow_runs.session_id` is set, and `workflow.run.updated` tells clients.
- Notifications and reviews belong to the run (`workflow_run_id`), not to the session. `run.list` lists a run that has no session; its key is `workflow_run_id`.
- A session with an `origin` that starts with `workflow:` is never in `session.list`. It opens by its id, from "Open chat" on a step.
- Each `run.agent` is a helper of that session. It is an ADR-059 child session with `parent_call_id` set to the step key (`wf:<step key>`).
- Helpers start only through `start_helper` and `helper_results`, and only from one place: `D/workflows/agents.py` (the seam). Workflow code never reaches into dispatcher or session internals.
- ADR-059 does not change. A small refactor moves the part of `start_helpers` that does not need the chat graph's state into a function that both paths call (ticket A.6).

### No model names in workflow files

An agent file says what it wishes (`cheapest`, `stronger`). Routing picks the real model on the run's machine ([ADR-055](055-model-routing.md)). A `model=` argument is a wish for one step, never a model name. `run.llm` takes a dispatcher `job` slot, the same as a title or a summary ([ADR-060](060-dispatcher-and-engine-profile.md)). The same file runs free in a local-only folder and works on a cloud-only laptop. Each agent-step ticket has a local-only and a cloud-only test.

### A review is its own row, in a shape the Inbox knows

`run.review` writes its own persisted row (`workflow_reviews`). The row reuses the `PendingItem` shape, so the Inbox and "Needs you" read it unchanged. It waits without holding a task, a slot or a model. The answer that counts is the one you give, even days later.

### The outline comes from the code, never from a model

The outline (the plain-words list of steps) is built from the file by fixed AST rules. A call that the rules do not know shows as a grey `code` step. The editor, the TUI and the check all read the same outline, so it cannot drift from the code.

### Check and Try

- **Check** runs no model. It reads the file, the outline, the agent files, the inputs and the trust state, and reports what will not work.
- **Try** runs a copy of the workflow from a chosen step. Earlier steps come from the last run's saved results. It stops before every `run.review` and every step that touches the world (a step with a `key=`, `run.notify`).

### Names on the wire

`run.*` is already the word for an agent turn on the wire ([ADR-050](050-routines-and-headless-sessions.md)), so it never appears there.

| Kind | Names |
|---|---|
| Id | `workflow_run_id` |
| Commands | `workflow.list`, `workflow.get`, `workflow.start`, `workflow.status`, `workflow.cancel`, `workflow.resume` |
| Events | `workflow.run.*`, `workflow.step.*` |

Later tickets add `workflow.resume`, `workflow.review.answer`, `workflow.check` and `workflow.outline`. Each ticket takes the next minor protocol version just before it ships.

### Untrusted code

- A workflow file loads only from a trusted folder (`trusted_folders` in `routine_scheduler.py`, the same rule as agent files).
- Finding and checking files imports them in a short-lived subprocess, so an import that crashes, hangs or calls `sys.exit` never reaches the daemon.
- A run executes in the daemon as an asyncio task. An exception in workflow code fails that run (or that step), never the daemon. Plain (sync) functions run in a worker thread, so they cannot block the event loop.
- A broken file is a visible state, "broken", with its traceback. It never silently disappears from the list.

### Engine

The engine saves each step, resumes after a restart, and does Try from a step. There are two ways to build it. A spike (a 3-step workflow with one `run.parallel`, killed with `kill -9` mid-run and resumed, written both ways) settles it.

| | A: LangGraph Functional API (`@entrypoint`, `@task`) | B: own step journal in `workflow_steps` |
|---|---|---|
| Saving | Task results go into the checkpoint. | One row per step: key, input hash, result, status. |
| Resume | LangGraph replays the function and returns saved task results. | golem replays the function and returns saved rows. |
| Replay rules | Workflow code must be deterministic between tasks. LangGraph's rules apply, and golem cannot change them. | The same rule, but golem writes it down and checks it. |
| Version pin | Ties workflow storage to the LangGraph version ([ADR-002](002-langgraph-boundary.md)). | None. |
| Try from a step | Needs a second thread and copied checkpoints. | Copy rows up to the step, then run. |
| Outline, "waiting", per-step cost | Read from checkpoints with extra code. | Plain columns, easy to query and to show. |
| Agent steps | They already checkpoint through their helper sessions. A second record of the same fact. | The row points at the helper session. One record. |
| Work to build | Less at the start. | More at the start (about one ticket). |
| Fit with [ADR-006](006-checkpoint-continuity.md) | The checkpoint is the memory. Fits, if workflows are graphs. | The checkpoint stays the chat's memory. Workflows get their own journal. |

**Engine decision:** B, golem's own step journal (spike, 2026-11-24).

Both passed the same tests: a review answered from a new process, `kill -9` mid-`run.parallel`, and a kill between a side effect and its saved result. Each finished step ran once and its result was reused. They did not differ on crashes. B wins because the run view, the `workflow.step.*` events, the Inbox and the agent steps all need a table of steps anyway:

- With A, golem would still write `workflow_steps` for the UI and still save each helper's session id itself, so a restart re-attaches to the child session instead of starting a second one. A would be a second, version-pinned store holding the same facts.
- A puts multi-day workflow state in `checkpoints.db`. That file would stop being something we can delete or rebuild after a LangGraph upgrade ([ADR-006](006-checkpoint-continuity.md)). It also puts workflow behaviour inside LangGraph, outside `golem/graphs/` ([ADR-002](002-langgraph-boundary.md)).
- A matches tasks by call order and allows one waiting `interrupt()` at a time. B matches by step key, and several reviews can wait at once, each in its own row.

The rules B puts on workflow code (written in the guide, enforced at run time):

- Step keys must be unique within a run and stable across restarts. A repeated key fails the run with a clear error. It never silently returns the earlier result.
- After a restart the function runs again from the top. Code outside steps runs again, and finished steps return their saved results.
- Results are saved as JSON.

LangGraph stays where it is: the chat loop and helper child sessions.

Whichever wins, the public API, the wire names and the tables the editor reads (`workflow_runs`, `workflow_steps`) are the same. The decision changes only `D/workflows/engine.py` and the migration.

### Decided answers (2026-11-24)

The user accepted the recommendations.

| # | Question | Answer |
|---|---|---|
| Q2 | Does Settings › Agents "Use helpers" apply to workflows? | No. A workflow asks for helpers in code. "Ask me first" becomes the Run dialog: shown on manual runs, skipped for routine runs. |
| Q3 | Milestones | M4 = stages 0–B, C (single agent) and D (with 4.8). M5 = C2, E and 3.7. |
| Q4 | Bundled starters | `pr_digest`, `upgrade_dependencies`, `flaky_test_hunt`, `invoices_to_sheet` (one non-code example). |
| Q5 | Name for "hand these results over as they are" | Keep `gets=`. |

Also decided on 2026-11-23, from the Phase 3 plan:

| # | Decision |
|---|---|
| W1 | Inspector Steps (R1) and Runs (R2) are the only ways into run views. |
| W2 | The editor has three panes and no canvas. |
| W3 | Chats appear in Runs only when "from chats" is ticked. |
| W4 | 3.10 (make from chat) and 3.11 (editor) are planned now and get their tickets later. |

Other decisions of 2026-11-23: start now, engine first; Workflows gets one implementation lane (raised to parallel waves of at most two agents on 2026-11-24); tickets are split one stage at a time.

## Alternatives Considered

### Alternative 1: A graph or YAML file instead of Python

- **Pros**: Easy to draw and to check.
- **Cons**: Loops, conditions and "for each package" turn into a small language.
- **Why not**: Users already know Python. The outline reads the code, so the picture is still there.

### Alternative 2: A second kind of sub-agent for workflows

- **Pros**: No refactor of helper code.
- **Cons**: Two sets of limits, cards, questions and slots to keep the same.
- **Why not**: `run.agent` is `delegate` with code as the lead. What works for a helper in a chat works in a workflow the same day.

### Alternative 3: Build the outline with a model

- **Pros**: It could describe any code.
- **Cons**: It can be wrong, costs money and drifts from the file.
- **Why not**: Fixed AST rules are free, always right for what they know, and honest (a grey `code` step) about what they do not.

### Alternative 4: Reuse chat approvals for `run.review`

- **Pros**: No new table.
- **Cons**: Chat approvals come from the event log of a live run. A review must wait days with no run.
- **Why not**: A new row with the same `PendingItem` shape gives both.

### Alternative 5: Put model names in the file

- **Pros**: Predictable.
- **Cons**: Breaks on a machine without that model, and breaks the local-only and cloud-only promise.
- **Why not**: Routing already decides ([ADR-055](055-model-routing.md)).

## Consequences

### Positive

- A workflow is a thin layer on built parts: headless sessions, helpers, the dispatcher, the Notifier.
- It survives a restart, waits for you, and acts once.
- One seam (`D/workflows/agents.py`) is all that follows Phase 15 and 18 changes.
- The outline cannot drift from the code.

### Negative

- A new place for user code to fail. Isolation and the "broken" state cost work.
- A workflow step and its helper are two records of one fact (a step row and a child session), joined by `parent_call_id`.
- Until 15.8 and 15.10 land, `run.parallel` of agents starts them one by one, and `worktree=` fails Check with "copies arrive with 15.10".

### Risks

| Risk | Handling |
|---|---|
| 15 and 18 change under us | One seam (`D/workflows/agents.py` plus A.6). Each stage's split re-reads ADR-059 and ADR-060 and the open 15/18 PRs first. |
| Protocol version collisions | Never stack Workflows protocol PRs on 15/18 PRs. Rebase and take the next minor version just before shipping. |
| User code crashes the daemon | Import and run in isolation. A broken workflow is a state with a traceback (A.4). |
| Exactly-once is wrong | Keyed steps get a dedicated `kill -9` test between "done" and "saved" (stage B). |
| Outline drifts from the code | AST rules only, never a model. Unknown code is a grey `code` step. |
| Mac overload in tests | At most two agents at once. Targeted tests per ticket. CI runs the full check. |
| Heavy local models in tests | Fake models in all tests. No live eval on a large local model without asking. |

## References

- [Design: Workflows](../design/workflows.md)
- [ADR-002](002-langgraph-boundary.md), [ADR-006](006-checkpoint-continuity.md), [ADR-050](050-routines-and-headless-sessions.md), [ADR-055](055-model-routing.md), [ADR-059](059-helpers-are-child-sessions.md), [ADR-060](060-dispatcher-and-engine-profile.md)
- [Vision: Workflows](../vision/workflows.md)
- Mocks (on the maintainer's Mac): `golem-docs/mocks/workflows/`
