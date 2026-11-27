# Workflows

Design of Phase 3 ([#18](https://github.com/MilanPavel/golem/issues/18)). The decision is in [ADR-062](../adr/062-workflows.md). This page is the shape of the thing: the words, the API, the storage, the events, and the order of work.

Paths below start with `D/` for `packages/daemon/golem/`.

## What a workflow is

A chat is great once. A workflow is for when the same job comes back: every Monday, on every new invoice, for each outdated package. Your Python decides the order. Models and helpers do the fuzzy steps. golem keeps the rest: every step saved, restarts survived, reviews that wait for days, real-world actions that happen once.

| Word | Who decides what happens next | File | Exists |
|---|---|---|---|
| Skill | The model, following written instructions | `SKILL.md` | Yes, Phase 2 |
| Helper | The lead model starts it with `delegate`; a child session with a brief | `agents/*.md` | Yes, Phase 15 |
| Routine | A trigger: a time, a new file, later a webhook | `routines.toml` | Yes, Phase 4 |
| Workflow | Your code; models and helpers do the steps | `workflows/*.py` | No: this design |

How the layers sit:

| Layer | What | Exists |
|---|---|---|
| Workflow run | Rows in `workflow_runs` and `workflow_steps` | New |
| Headless session | One per run, `origin="workflow:<name>"` | Yes (4.0) |
| Helper | Each `run.agent` is a child session of that session | Yes (ADR-059) |
| Dispatcher | Every model call waits here. `run.llm` takes the `job` role | Yes (ADR-060) |

## The API

The only module user code imports is `golem.workflow` (`D/workflow/__init__.py`).

| Name | Meaning |
|---|---|
| `@workflow(inputs=)` | Marks an async function as a workflow. `trigger=` is still accepted but never used; a routine is the only "when". |
| `Run` | The object each workflow receives. |
| `run.step(name, fn, *args, key=)` | A plain function. The result is saved. |
| `run.parallel(...)` | Steps or agents at once. |
| `run.agent(type, brief=, gets=, worktree=, budget=)` | A helper. |
| `run.review(draft, ask=)` | Waits for you. Returns what you approved. |
| `run.notify(text)` | Tells you. |
| `run.llm(...)` | One model call through a dispatcher `job` slot. |
| `run.tool(...)` | One tool, through the permission engine. |
| `run.skill(...)` | One skill in the run's headless session. |

Rules:

- `key=` means "do this once". A finished keyed step never runs again. A crash between the action and saving its result leaves the step "may have run". On retry, the key goes to the receiver as an idempotency key.
- Step keys are unique within a run and stable across restarts. A repeated key fails the run.
- The model is written in the file (3.13.7): `@workflow(model=)` is the default and `model=` on a step overrides it; with neither, golem's default model is used. The old wish words (`cheapest`, `stronger`) still work. `type` names an agent file. See ADR-062, amended 2026-11-27.
- `gets=` hands earlier results over as they are (saved artifacts), without retelling them.
- `worktree=` needs copies (15.10). Until then, Check fails it with "copies arrive with 15.10".

### Example: `upgrade_dependencies`

```python
# workflows/upgrade_dependencies.py
from golem.workflow import Run, workflow
from .packages import list_outdated, open_pull_request

# A routine (`weekly mon 06:00`) starts it.
@workflow()
async def upgrade_dependencies(run: Run) -> None:
    outdated = await run.step("list outdated", list_outdated, run.repo)
    if not outdated:
        return
    upgrades = await run.parallel(
        run.agent("worker",
                  brief=f"Upgrade {p.name} to {p.latest}. Fix what breaks. Run the tests.",
                  worktree=f"upgrade/{p.name}", budget="$0.50")
        for p in outdated
    )
    notes = await run.agent("reviewer", gets=[u.diff for u in upgrades],
                            brief="Check each diff. One line per package.")
    green = [u for u in upgrades if u.tests_passed]
    await run.notify(f"{len(green)} ready, {len(upgrades) - len(green)} need you")
    approved = await run.review(green, notes, ask="Open these pull requests?")
    for u in approved:
        await run.step(f"PR {u.package}", open_pull_request, u,
                       key=f"pr:{u.package}:{u.version}")
```

The outline of the same file, read from the code by fixed rules:

| # | Step in plain words | Kind |
|---|---|---|
| 1 | List the outdated packages | code |
| 2 | For each package, at the same time: a worker upgrades it in its own copy, up to $0.50 | agents |
| 3 | A reviewer checks every diff | agent |
| 4 | You are told how many are ready | notify |
| 5 | You are asked: open these pull requests? | review |
| 6 | For each approved one, a pull request is opened, exactly once | code, keyed |

## Run lifecycle

| State | Meaning |
|---|---|
| `queued` | Asked for, not started. |
| `running` | The code is running a step. |
| `waiting` | A `run.review` waits for you. Nothing is held: no task, slot or model. |
| `done` | The function returned. |
| `failed` | A step raised and nothing handled it. |
| `cancelled` | You stopped it. |
| `interrupted` | The daemon stopped. The run continues on the next start (3.3). |

| Step state | Meaning |
|---|---|
| `pending`, `running`, `done`, `failed`, `skipped` | As the words say. |
| `waiting` | A review step that waits for your answer. |

Flow:

1. `workflow.start` (a person, or a routine) makes a `workflow_runs` row. The headless session `workflow:<name>` is made later, the first time a step needs one (an agent, a skill, a tool that reads the session); a run of plain steps has none.
2. The engine calls the function. Each `run.*` call becomes a `workflow_steps` row, keyed by its step key.
3. A step that is already `done` returns its saved result and does not run.
4. After a restart, the engine calls the function again from the top. Finished steps return saved results. Running agents continue from their last saved turn (`reconcile_helpers`, `resume_helper`).
5. A review step writes a `workflow_reviews` row in the `PendingItem` shape and stops. The answer resumes the run.

A workflow file that changes while a run is open is versioning (3.7, stage F).

## Storage

New tables in `D/store/migrations.py`, accessed through `D/store/workflow_runs.py`. Columns are a first sketch; ticket A.2 fixes them.

| Table | Holds | Main columns |
|---|---|---|
| `workflow_runs` | One row per run | `workflow_run_id`, `workflow`, `session_id`, `state`, `inputs`, `trigger`, `started_at`, `ended_at`, `error` |
| `workflow_steps` | One row per step | `workflow_run_id`, `step_key`, `name`, `kind`, `state`, `result`, `helper_session_id`, `cost`, `started_at`, `ended_at` |
| `workflow_reviews` | One row per `run.review` | `workflow_run_id`, `step_key`, `pending` (a `PendingItem`), `answer`, `answered_at` |

The engine is golem's own step journal in `workflow_steps` (ADR-062, section "Engine"). A `run.agent` row saves its child `session_id` as soon as the helper starts, so after a restart the step re-attaches to the child instead of starting a second one.

## Events and commands

Names on the wire never use `run.*` (ADR-050). The id is `workflow_run_id`.

| Kind | Name | Ticket |
|---|---|---|
| Command | `workflow.list`, `workflow.get`, `workflow.start`, `workflow.status`, `workflow.cancel`, `workflow.resume` | A.1 |
| Command | `workflow.resume`, `workflow.review.answer` | B |
| Command | `workflow.check`, `workflow.outline` | E |
| Event | `workflow.run.started`, `workflow.run.waiting`, `workflow.run.done`, `workflow.run.failed`, `workflow.run.cancelled` | A.1 |
| Event | `workflow.step.started`, `workflow.step.done`, `workflow.step.failed`, `workflow.step.waiting` | A.1 |

The exact list of events is fixed by A.1. Each protocol ticket takes the next minor version just before it ships (now 2.155).

## How helpers are used

In a chat, the lead model calls `delegate`. In a workflow, your code calls `run.agent`. After that the machinery is the same: the same child session, agent file, limits, questions, card and slots.

| Workflow file | What golem does | State |
|---|---|---|
| `run.agent("worker", brief=...)` | One helper, a child session of the run's headless session, from `agents/worker.md` (15.1, 15.2) | Built |
| No `model=` | The agent's wish (`cheapest` or `stronger`), resolved by routing (15.3, Phase 9) | Built |
| `model="local"` | A wish for this one step (a model name works too, 3.13.7) | Built |
| `budget="$0.50"` | Helper limits: calls, working time, cost (15.6, `D/sessions/helper_limits.py`) | In progress |
| The helper asks you | A pending item in the run's session, shown in Runs, Inbox and on the phone (15.5) | Built |
| `run.parallel(run.agent(...) for ...)` | One batch. The dispatcher decides how many run at once (15.8, 18.2) | 15.8 open |
| `worktree="upgrade/httpx"` | A copy under `~/.golem/copies`, the helper writes only there and returns a diff (15.10) | Not built |
| `gets=[...]` | Earlier results handed over as saved artifacts | New |
| `fix.diff`, `fix.apply` | The worker's change set. Applying goes through Phase 16, so undo works | After 15.10 |
| The helper card, Open, Stop | The same card and panel as in a chat (15.7, 15.12) | Built |
| Resume after a restart | Helpers: `reconcile_helpers`, `resume_helper`. The workflow: saved steps (3.3) | 3.3 new |
| Settings › Agents "Use helpers" | Does not apply. "Ask me first" is the Run dialog, shown on manual runs and skipped for routine runs | Decided |

### The seam

`D/workflows/agents.py` holds `WorkflowHelpers.start(run, step_key, specs)`. It resolves agent files, wishes and limits, then calls `SessionManager.start_helper(parent=<run's session>, call_id="wf:<step key>", ...)` and waits with `helper_results`. It never touches dispatcher internals. Ticket A.6 first moves the part of `start_helpers` that does not need the chat graph's state into a function that both paths call. When 15.8 and 15.10 change, only this file follows.

### What can start when

| When | What works |
|---|---|
| Now | A single `run.agent` on the run's headless session, read-only or writing in the project folder (with the permission engine), steps one after another. Enough for `pr_digest`, `triage_issue`, `release_notes`. |
| After 15.8 | `run.parallel` of agents as one batch with positions and wait reasons. Before that, agents start one by one and the dispatcher still overlaps their model calls. |
| After 15.10 | `worktree=`: workers in copies and diffs to review. |

### Local, cloud, mixed

| Setup | Upgrade workflow | The editor shows |
|---|---|---|
| Local only | Workers and reviewer on local models, slots decide how many at once, $0 | The model on this machine and its slots. A pinned paid model is a Check warning. |
| Cloud only | Workers on the cheapest hosted model, reviewer on the stronger. Provider caps decide how many at once | An estimate that is never $0. |
| Mixed | Workers local, reviewer hosted. A stuck worker may step up if its file allows | Both chips. The Run dialog lists what is paid. |

Each agent-step ticket states its behaviour and has a test for local-only and cloud-only.

## Check and Try

| | Check | Try |
|---|---|---|
| Model used | None | Only for the steps that run |
| What it does | Reads file, outline, agent files, inputs, trust. Reports what will not work | Runs in a copy of the project, from a chosen step, using the last run's saved results for earlier steps |
| Stops before | Nothing runs | Every `run.review` and every step that touches the world (`key=` steps, `run.notify`) |

## Trust and broken files

- Files load only from trusted folders (`trusted_folders`, same rule as agent files).
- Each file is imported in a short-lived subprocess to list and check it, so a crash or hang at import never reaches the daemon. A run is an asyncio task in the daemon; an exception fails the run or the step, never the daemon. Sync functions run in a worker thread.
- A broken file is listed as "broken" with its traceback. A fixed file loads again without a restart (hot reload).

## Stages

Tickets are split one stage at a time, because Phase 15 and 18 keep moving. Each stage ends with something that works.

| Stage | Steps | You can | Depends on |
|---|---|---|---|
| 0 Design | 3.0 (#739): ADR-062, this page, engine spike | Read one ADR; stage A tickets exist | None |
| A Skeleton | 3.1 (#11) registry and `golem workflow run`; 3.2 (#12) `workflow_runs`, `workflow_steps`, events, `run.step`, `run.parallel` of plain steps | Run a code-only workflow from the CLI and see its steps | 0 |
| B Durable and patient | 3.3 (#13) resume after `kill -9`; 3.4 (#14) `run.review` and `run.notify`; 3.5 (#15) `key=` | Survives a restart, waits for you, posts once | A |
| C Agents | 3.6 (#16) `run.agent` (single agent first); 3.8 (#740) `run.llm`, `run.tool`, `run.skill` | The upgrade workflow, agents one after another | A, B; 15.2 (built) |
| C2 Agents at once, in copies | `run.parallel` of agents via 15.8's batch; `worktree=` via 15.10 | Five upgraders at once, each in a copy | 15.8 (#1216), 15.10 (#1218) |
| D Seen and triggered | 3.9 (#741) Workflows page and run detail on `StepsList`; Inspector Steps (R1, mostly 15.7); TUI `/workflows`, `/runs`; 4.8 (#794) routines start workflows | Schedule it Monday 06:00; watch it in web and TUI | B (C for agent rows) |
| E Authoring | 3.10 (#1224) make from chat; 3.11 (#1225) editor, cut 1 (outline, code, ask golem, check), cut 2 (fields, try from step, outline in words) | Edit, check, try | D; Phase 16 change set |
| F Later | 3.7 (#17) versioning; 4.5 (#84) hook `start_workflow`; bundled starters | None yet | B |

Milestones:

| Milestone | Stages |
|---|---|
| M4 | 0, A, B, C (single agent), D (with 4.8): the PR digest end to end |
| M5 | C2, E, 3.7 |

Bundled starters: `pr_digest`, `upgrade_dependencies`, `flaky_test_hunt`, `invoices_to_sheet`.

## Stage A, split

| Ticket | What | Files | After |
|---|---|---|---|
| A.1 | Protocol: commands `workflow.list`, `get`, `start`, `status`, `cancel`; events `workflow.run.*`, `workflow.step.*`; codegen; vectors. One minor bump | `golem_protocol/{commands,events,methods,version}.py` | 3.0 merged |
| A.2 | Storage: `workflow_runs`, `workflow_steps`: migration and store | `D/store/migrations.py`, `D/store/workflow_runs.py` | 3.0 |
| A.3 | Public API skeleton: `@workflow`, `Run`, `run.step`, `run.parallel` (plain steps) | `D/workflow/__init__.py`, `D/workflows/engine.py` | A.2 |
| A.4 | Registry: find files, trust, import in isolation, "broken" with traceback, hot reload | `D/workflows/registry.py` | 3.0 |
| A.5 | Server and CLI: handlers, `golem workflow list` and `run` with live steps | `D/server/workflows.py`, `packages/cli/src/workflows-*.ts` | A.1, A.3, A.4 |
| A.6 | Seam: split `start_helpers` so its graph-free part is callable, no behaviour change | `D/sessions/manager.py` | Coordinate with 15.8; after 15.8.1 is merged |
| A.7 | Outline from code (AST, fixed rules) | `D/workflows/outline.py` | A.3 |
| A.8 | Guide page and an example workflow | `docs/guide/workflows.md`, `examples/` | A.5 |

A.2, A.4 and A.7 touch no shared file, so they can run while 15.x is busy in `manager.py`. A.6 is the only ticket that touches helper code.

## Keeping out of the way of Phase 15 and 18

| Rule | Why |
|---|---|
| New code lives in its own modules: `D/workflow/` (the public API) and `D/workflows/` (registry, engine, outline, check, agents) | Few merge fights |
| Shared files get only small, additive edits: `D/sessions/manager.py` (one entry point to start a helper under a workflow session), `D/store/migrations.py`, `golem_protocol/methods.py` | Same |
| Protocol bumps: each Workflows ticket rebases and takes the next minor version just before it ships. Never stack Workflows protocol PRs on 15/18 PRs | The version number is the hot spot |
| `run.agent` calls the helper API only through `start_helper` and `helper_results` | When 15.8 and 15.10 change, only C2 follows |
| Every stage's first ticket re-reads ADR-059, ADR-060 and the open 15/18 PRs before it is split | They keep moving |
| One implementation lane for Workflows. The other lane stays with 15/18 | Mac load, review load |

## Where the code goes

| Path | Holds |
|---|---|
| `D/workflow/__init__.py` | The public API: `workflow`, `Run`, `schedule` |
| `D/workflows/registry.py` | Find files, trust, isolated import, "broken", hot reload |
| `D/workflows/engine.py` | Run, save each step, resume, try from a step |
| `D/workflows/outline.py` | Code to outline (AST, fixed rules) |
| `D/workflows/check.py` | Checks that run no model |
| `D/workflows/agents.py` | `run.agent` to `start_helper` (the seam) |
| `D/store/workflow_runs.py` | `workflow_runs`, `workflow_steps`, `workflow_reviews` |
| `D/server/workflows.py` | The `workflow.*` handlers |
| `packages/view/src/workflows.ts` | Outline and run rows. Reuses `steps-list.ts` and `runs.ts` |
| `packages/web/src/features/workflows/` | Library, editor, Run dialog (replaces the `WorkflowsInProgress` placeholder) |
| `packages/tui/src/workflows-*.ts` | `/workflows` |

## Risks

See [ADR-062](../adr/062-workflows.md), section "Risks".

## Mocks

The agreed look and flow are on the maintainer's Mac in `golem-docs/mocks/workflows/`: `index.html` (the idea and the example), `helpers.html` (helpers), `editor.html` (the editor), `runs.html` (runs), `plan.html` (stages and risks).
