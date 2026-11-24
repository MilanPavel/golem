# ADR-059: A helper is a headless session with a parent, started for a reason, never by habit

**Date**: 2026-11-19
**Status**: proposed

## Context

[ADR-058](058-child-runs.md) made a helper a child run: the chat graph on its own checkpoint thread, inside the `delegate` tool call of its parent, with its steps in the parent's log. It was built small on purpose, so that Phase 15 (#733) could promote it to a session. Phase 15 needs what a child run cannot do: ask you a question, survive a restart, run beside others, and be opened as a chat. Headless sessions now exist ([ADR-050](050-routines-and-headless-sessions.md)), and they do all four.

What exists today, with the file that does it (paths are under `packages/daemon/golem/` unless noted):

- `delegate` takes `brief` and `agent`, and `agent` can only be `explorer` (`tools/delegate.py`). It runs the helper through `ctx.delegate`, inside the parent's run task.
- `run_child` runs the chat graph on the thread `<session_id>/c/<call_id>` with a fixed read-only tool set, no approvals and four limits (`graphs/child.py`, `ChatRuntime.stream_child` in `graphs/chat.py`). The model is the `explore` role (`models/roles.py`, `explore_role`).
- `tools_node` works in two passes: it decides every call and interrupts for each ask, then runs the calls. A helper's flag `never_ask` turns an ask into a refusal (`graphs/tools_node.py`). `[agents.explorer]` holds the limits (`config.py`).
- A child's `model.call.*` and `tool.*` events go into the parent's log with `parent_call_id` (`_apply_child` in `sessions/runner.py`). The projection gives their `model_calls` rows the role `explore` (`store/projection.py`). The reducer folds them into the `delegate` step (`packages/view/src/chat-state.ts`, `helper.ts`). The trace nests them (`sessions/trace.py`).
- A restart closes the parent's run with `run.failed` and the child's thread is never resumed (`sessions/recovery.py`).
- A session row has `origin`; `routine:<name>` is headless and never asks the paid question (`store/migrations.py`, `sessions/manager.py`). `SessionSummary.pending` is one `PendingItem`, and an approval wins over a consent (`sessions/approvals.py`, `packages/protocol/golem_protocol/commands.py`). The Inbox reads it (`packages/view/src/inbox.ts`).
- `session.list` and `watch` show open sessions (`recent` in `store/records.py`). `run.list` shows every session whose origin is not `user` (`store/routine_runs.py`). A fork copies only `message.completed` events (`SessionManager.fork`).
- Skills come from the project, the user and golem, and a broken file never wins a name (`skills/registry.py`, [ADR-025](025-skill-sources.md)).

The design is on the maintainer's Mac in `golem-docs/mocks/sub-agents`. This ADR records what it settled, so that steps 15.1 to 15.11 build one thing. It supersedes the parts of ADR-058 that make a helper a child run (decisions 1, 2, 6, 7 and 8, and the no-approvals rule of 4). The limits, the read-only tool set and the answer-is-data rule of ADR-058 stay. The dispatcher (slots, a line per model and provider, wait reasons) is Phase 18 and has its own [ADR-060](060-dispatcher-and-engine-profile.md). Memory is Phase 5 and has [ADR-061](061-memory.md). This ADR names them and designs neither.

## Decision

### 1. A helper is a session with a parent

A helper is a normal headless session ([ADR-050](050-routines-and-headless-sessions.md)): its own log, checkpoint thread, runs and pending items. It is the same thing `run.agent` starts in a workflow (step 3.6, #16). It parks on a question, resumes, survives a restart and can be opened read-only.

- **Origin** is `agent:<type>`. `session.create` still accepts only `user` and `cli`; only daemon code makes a helper.
- **Columns.** One migration, appended, adds to `sessions`: `parent_session_id`, `root_session_id`, `parent_call_id` (the `delegate` call), `helper_index` (0 for a single helper) and `agent` (the type). It adds `runs.wait_reason`. A unique index on `(parent_session_id, parent_call_id, helper_index)` makes starting a helper idempotent. All are NULL for a session that is not a helper. `schema_version` is not touched.
- **They come from the event.** `session.created` gains `parent` (`session_id`, `call_id`, `index`) and `agent`, the resolved agent file as it was at the start (name, source, tools, limits, wish). The projection fills the columns, as it does for `origin`. Like a pinned skill ([ADR-032](032-pinned-skills.md)), a helper keeps the agent it started with, so editing a file does not change a parked helper.
- **Depth is 1.** The root of a helper is its lead. A helper's tool scope never has `delegate`, and the daemon refuses to start a helper for a session that has a parent.
- **Hidden.** `recent`, `watch` and `run.list` leave out sessions with a parent. Its chat opens by id (`session.attach`), read-only: `session.send` to a helper session is refused.
- **Old data.** The 058 threads (`<id>/c/<call_id>`) are not migrated. They never had a session row, never resumed, and their runs are over. Old events keep `parent_call_id` and old logs keep drawing as they do (section 11).

### 2. Fold by default

golem does the work in the chat. It starts a helper for one of three reasons, and says which one applied:

1. **The window.** The reading does not fit, or would crowd out the task.
2. **Independent jobs that can truly run at once.**
3. **A different model fits better:** one hard question to a stronger model, or a large read on a cheaper one.

There are no chains of helpers (find, fix, check). Anything with a fixed order is a lead's decision or a workflow. A procedure is a skill the lead loads, not an agent. Thresholds are a share of the window plus a price, not a token count, and the eval of 15.4 (#1212) sets them. Since step 15.14 you can measure them on your own Mac (Settings › Agents › Measure, `golem eval helpers`): the daemon runs the measurement as one job, and "Use these numbers" writes the result to `[agents.delegate]`. The numbers shape what golem suggests to the model; they never gate a helper. **Open, decided by that eval:** whether a cloud lead hands large sweeps to a cheaper cloud model by default, or only with "save money" on.

### 3. `delegate` starts one helper or a batch

- `delegate` takes `brief` and `agent`, or `batch`, a list of `{agent, brief, label}`. A batch has no order and no plan graph. More than `[agents] max_per_batch` is refused with a message the model can read.
- Results travel as references. A helper's answer names files and lines. A final answer longer than `answer_chars` is stored as an artifact of the helper's session, and the result names its id. `read_artifact` in the lead reads the artifacts of its own helpers (`artifacts` rows are keyed by session, so the lookup follows `root_session_id`).
- What a helper returns is data. It is never an instruction about permissions ([ADR-058](058-child-runs.md), decision 4).
- A batch result is one section per helper, in the order of the call, each starting with `<agent> finished: <reason>` when it did not end `done`.

### 4. Agent types are files

An agent type is `agents/<name>.md`: a header (name, description, model wish, tools, limits, whether it may ask you) and the prompt as body. It has the shape and the three sources of a skill (project, user, bundled; project wins; a broken file never wins) and the trust rule of project skills: a project agent runs only in a trusted project. golem ships four:

| Type | For reason | Does | Tools | Wish | Asks you |
|---|---|---|---|---|---|
| `explorer` | window | reads and searches, returns paths and lines | read-only | `cheapest` | never |
| `worker` | at once | one of several independent changes, in a copy of the folder | read, write, shell | `cheapest` | yes |
| `reviewer` | fresh eyes | reads a diff it did not write | read-only and the diff | `stronger` | never |
| `advisor` | model | answers one hard question from a brief | none | `stronger` | never |

`agents.list {cwd?}` returns each type with its source, wish, tools, limits, errors, shadowed copies and `used` and `finished` counts for 30 days (counted from `helper.ended`). `agents.get {name, cwd?}` adds the prompt. `agent.registry.changed` mirrors `skill.registry.changed`. The explorer of 9.7 becomes the bundled `explorer.md`. Limits come from the file, and `[agents.<type>]` in `config.toml` overrides them; `[agents.explorer]` keeps working.

The wish of a bundled type is changed in `config.toml`, not in a copy of its file: `agents.set_wish` writes `[agents.<name>] model = "<wish>"` (comments and other keys kept), and the registry applies the key over the bundled file's wish when it builds a view, so `agents.list`, `resolves_to` and a helper's start all read the same value while the prompt, tools and limits stay the bundled ones of the running release. A file of the same name in the user's or the project's `agents` folder still wins over the bundled type, and `set_wish` then edits that file. A copy written by an earlier version keeps working and is not migrated. Your own files are written by `agents.save` (the text, checked by the registry's parser first), `agents.copy` (a bundled file, unchanged) and `agents.delete`, all inside `~/.golem/agents`.

### 5. A helper's model is a wish

The agent file names a wish: `cheapest`, `same`, `stronger`, a tier, or a model. A pure `pick_helper(wish, lead, candidates, traits)` in `models/pick.py` turns it into a model. It reads no clock and no file, and **it never fails on an empty tier**: the wished tier, then the nearest tier you have, then the lead's model. Its result says which and why.

| Wish | Becomes |
|---|---|
| `cheapest` | the cheapest ready model with tools at or below the lead's tier; a loaded local model first |
| `same` | the lead's model |
| `stronger` | the tier above the lead's. From the top tier, or with local models only: the lead's model with a fresh window |
| a tier or a model | that, when it is ready and allowed |

- Privacy comes first and no wish overrides it. In a local-only folder or a `local` route every helper is local, and a paid wish becomes the same local model with a fresh window ([ADR-055](055-model-routing.md), rule 2).
- The paid question is asked at the first paid call of a chat, worded for a helper: what is sent (the brief, not the chat), what is not, and the cost. It is the helper session's own consent item. A chat that is already paid is not asked. A "no" becomes the local fresh-window answer.
- A cloud-only setup gets caps and an estimate before a large batch (15.6) instead of the question.
- The helper session is pinned to its picked model. `model.routed` in its log records the pick. A helper on the lead's own model starts with the lead's options.
- The lead may name the model of one helper: `delegate` takes an optional `model` (a tier, a profile name or `provider/model`). The part after the slash also works alone, with case, hyphens and dots ignored: `gpt6-luna` names `openai/gpt-6-luna`. If two models fit, it names none. It is the wish of that one helper, in place of the agent's wish and of `[roles] explore`, and goes through the same `pick_helper`, so privacy, the paid question and the spent cap hold. A name that is unknown, or that the rules refuse, never fails the call: the helper runs on what the pick gives, and its `pick_reason` names the asked model and why ("gpt6-luna is not set up, so the lead's model"). `helper.started.wish` is that call's wish. The tool description lists the models the lead may name, read from the settings and the cached model list, with no call, so it is the same text until they change. It lists the tiers, then a few local models, then the hosted ones that are ready, cheapest first.
- The `explore` role of `models/roles.py` is retired when 15.3 lands. `[roles] explore` is read as the wish of `explorer` until then.

### 6. Where the events live

The helper's session log has everything a session has: `session.created`, the brief as the user's `message.completed`, `model.routed`, `message.*`, `model.call.*`, `tool.*`, `approval.*`, `route.consent.*`, `run.*` and `session.completed`. The lead's log gets only summaries, all with the `delegate` call's id as `call_id`:

| Event | When | Fields |
|---|---|---|
| `helper.started` | a helper session is made | `call_id`, `index`, `helper_id`, `agent`, `label`, `model`, `wish`, `pick_reason` |
| `helper.step` | a tool call of the helper starts or ends | `call_id`, `index`, `step_id`, `name`, `args` (path, pattern, query, ref only), `status`, `calls`, `summary` (when the call ended) |
| `helper.state` | a helper queues, runs, waits or goes on | `call_id`, `index`, `state` (`queued`, `running`, `waiting`), `reason` |
| `helper.wait` | the lead parks or goes on | `call_id`, `state` (`parked`, `resumed`), `helper_ids` |
| `helper.ended` | a helper's run ends | `call_id`, `index`, `stopped`, `model_calls`, `tokens`, `answer_tokens`, `cost_usd`, `duration_ms`, `working_ms` |

- When `[agents] at_once` helpers of the lead already run, a new helper is stored with `helper.state` `queued` and the reason `team`, has no run, and starts when a turn frees. A helper on a paid model that a spent `[budget]` cap holds back is stored the same way, with `helper.state` `waiting`, the reason `budget`, and `spent_usd` and `cap_usd`; it starts when the cap allows it, and a helper behind it may start first. The event carries no sentence: the view words it. A queued helper is stopped by `helper.stop` and ends `cancelled` with its lead. A restart ends one that never started, as any helper with no run. The slots of the model itself are Phase 18.
- A wait reason is one of the seven words of ADR-060, which owns the list: `you` (an approval or the paid question) and `team` (a lead waits for its helpers) now; `slot`, `load`, `provider`, `budget` and `stalled` as Phase 18 and 15.6 land. Every wait has one and an event (invariant 2).
- `helper.step` is thin on purpose: the card shows what ran, and the helper's own log has the detail. `summary` is the tool's own one-line summary (such as `3 lines`), set when the call ends, cut to 200 characters; it is never the preview or the output, and the step still has no cost, no tokens and no output. `helper.ended` carries the cost, because the lead's footer sums its own log.
- `parent_call_id` stays on the event models and on old events, marked legacy. A new helper writes none. Removing a field is a break, so it stays.

### 7. How `delegate` waits

The lead **parks**. It does not hold its run task while a helper works.

1. In the decision pass of `tools_node`, a permitted `delegate` call starts its helpers through the manager, or finds them by the unique index. The manager stores `helper.started` and starts each helper's run, outside the lead's task. It also stores `tool.started` for the call, so the step looks as it did in 9.7.
2. If any helper has not ended, the node calls `interrupt()`. The lead's run ends, the projection marks it `waiting` with `wait_reason = team` (from `helper.wait`), and no task and no model slot is held (invariant 1).
3. When a helper's run ends, the manager stores `helper.ended` in the lead's log. When the last helper of a call has ended, it resumes the lead with a plain wake.
4. The resumed node starts again from the top, as for an approval. Pass 1 finds every helper already there and ended and does not interrupt. Pass 2 builds the result from the helpers' logs. Nothing ran before the last answer, so nothing repeats.

At startup, after recovery, a reconcile pass finds each lead waiting on helpers, writes any `helper.ended` that a crash lost, and resumes a lead whose helpers have all ended. The lead's summary shows `running`, not `waiting`, while it waits on helpers: nothing is asked of you, and an older client knows only the four statuses.

### 8. A helper asks you

- A helper's approval and its paid question are ordinary pending items of its own session. You answer with the commands that exist (`approval.respond`, the consent answer) addressed to the helper's id. An agent file with `asks: never` turns an ask into a refusal, as `never_ask` does today.
- **The pending list.** `SessionSummary` gains `pending_items: list[PendingItem]`. For a lead it holds its own items and those of its helpers, each with a new `helper` field (`session_id`, `agent`, `label`, `index`) and a `count` for the same question from several helpers, which is asked once. `pending` stays and is the oldest item, so an older client works. The Inbox (Phase 17) reads `pending_items` and groups by lead for free, because helpers are not rows in the list. A helper's events also publish its lead's summary.
- **Ask me first** (`[agents] use_helpers = "ask"`). Before a `delegate` call starts its helpers, the lead parks like for an approval: `approval.needed` with the tool `delegate` and the source `use_helpers` is stored, and the lead's `pending_items` holds a `batch` item (`call_id`, `helper_count`, `agents`), never `pending`. `helpers.respond {session_id, call_id, run}` answers it, and the log gets `approval.resolved` (`allow` or `deny`). A yes starts the helpers as usual. A no gives the call a result that tells the model to do the work in the chat. Cancel, restart and cleanup are those of an approval. An older client sees an approval of `delegate` and may answer it with `approval.respond`, where any yes runs the helpers and writes no rule. `never` leaves `delegate` out of the lead's tools, and the setting is read at each model call, so a change applies to the next message.
- **Scopes:** once; this helper (`allow_session` in the helper's session, which ends with it); all helpers of this batch (`approval.respond` gets an optional `scope: "batch"`, which allows the same call in each unfinished helper of the call and answers those asking it). "Always" stays in Tool rules.
- **Never more than the lead.** A helper starts with its lead's allowances cut to its agent's tools, the lead's `deny` rules, its folders or fewer, and its permission mode. A worker's folder is a copy, so it writes less. What you allow a helper by answering is yours to give: it lives in that helper's session and never reaches the lead.
- A helper that waits for you holds no slot: its run is parked like any session's.
- A notification for a helper's question names the lead's chat and is held back by the lead's attach state ([ADR-050](050-routines-and-headless-sessions.md), the notifier).

### 9. Stop, cancel, restart, close, fork

| Event | What happens |
|---|---|
| `helper.stop {session_id}` | the helper's run is cancelled. Its result is `stopped: cancelled` and the lead goes on and decides |
| the lead's run is cancelled, or fails | its running helpers are cancelled first. The `delegate` call gets a cancelled result on the next turn (`answer_dangling`) |
| the lead is waiting and you cancel | as above, through `_cancel_waiting` |
| a restart | a helper's `running` run is resumed from its checkpoint (a new `ChatRuntime` entry that streams with no input); recovery still closes a `running` lead run. Helpers of a lead whose run was closed are cancelled. A parked helper and a parked lead stay parked |
| `session.close` of the lead | its helpers are cancelled and closed; their logs stay readable |
| `session.fork` of a lead | copies messages only, so a fork owns no helper. The original keeps them |
| `session.fork` of a helper ("Continue as chat") | the new session has the helper's messages (brief, steps, answer) and its model and folder. It is an ordinary chat: origin `user`, no `parent_session_id`, `root_session_id`, `parent_call_id`, `helper_index` or `agent`, and `forked_from` is the helper. It gets the normal prompt, tools and permission mode of a chat in that folder, is listed and writable, and is never trimmed since it has no parent. The helper and its lead are unchanged. `at_message_id` is optional: without it the fork ends at the last completed message. A trimmed helper is refused with `invalid params` ("This helper's steps were removed, so it cannot be continued."). A helper of a `local` lead continues on route `local`, and a local-only folder covers the new chat. The paid answer does not carry over: `paid_ok` starts false |

The 058 rule that cancelling the parent cancels the child ([ADR-008](008-cancellation.md)) holds: the manager does it, since the helper no longer runs in the lead's task.

**A finished helper is trimmed.** A helper keeps its steps for `[agents] keep_days` (7) from the end of its last run, and `keep_problem_days` (30) when it failed, was cancelled or asked you something (its log holds `approval.needed` or `route.consent.needed`). 0 keeps for ever. A job reads the settings again on every pass, runs at start and then once an hour, and trims at most 20 helpers a pass. The trim of one helper is one transaction in `golem.db`: it removes every event except `session.created`, the brief (the first user `message.completed`), the final answer (the last assistant `message.completed`) and `session.completed`, then appends `session.trimmed {removed}` with the next `seq` and sets `sessions.trimmed_at` (`SessionSummary.trimmed_at`). The checkpoint thread lives in `checkpoints.db`, so it is removed first: a crash between the two leaves an untrimmed helper that the next pass trims again. The session row, its runs, its `model_calls`, its artifacts and the lead's log stay, so cost totals and the lead's replay do not change. A helper with a run open, a helper whose lead waits for its helpers, and a session with no parent are never trimmed. Attaching to a trimmed helper replays the receipt events.

### 10. Limits, clocks, cost

- Per helper: model calls, **working time**, cost, tokens; per message: how many helpers and their total cost; and how many run at once (Phase 18). `stopped` is `done`, `calls`, `time`, `budget`, `tokens`, `cancelled` or `failed` (a model call that failed). A helper that stops writes why and what it covered into its answer.
- **Working time excludes waiting** for you, for a slot and for a provider. The clock runs while the run is `running` and no wait is open, and it is rebuilt from the events after a restart. `run_child`'s `asyncio.timeout` is replaced by it.
- **Cost rolls up by root.** A helper's calls are `model_calls` rows of its own session, with role `helper` (old `explore` rows read as `helper`). A lead's usage sums `COALESCE(root_session_id, session_id)`. The view's cost for a message adds `helper.ended.cost_usd`.
- The trace of a lead nests each helper's own trace under its `delegate` span. `trace.span` reads the helper's thread, which is its session id.

### 11. Protocol and old clients

- Minor bumps, in separate steps: `session.created` fields; the `helper.*` events; `agents.list`, `agents.get`, `agent.registry.changed`; `helper.stop`; `pending_items` and the `PendingItem` fields; `scope` on `approval.respond`; `SessionSummary.parent_session_id` and `agent`.
- An older client drops events and methods it does not know. It draws a helper's `delegate` step with its start and its result and no inner steps, and it never sees a helper in the list. It reads `pending` and `status` as before.
- The reducer keeps folding events with `parent_call_id`, forever, so old logs look as they did. It folds `helper.*` into the same `HelperRun`, so 9.7's card is unchanged on screen.
- Run views are reached through the Inspector's Steps tab and Runs in the rail. There is no Chat/Map switch.

### 12. Seven invariants

1. A run holds no model slot while it waits.
2. Every wait has a named reason and an event.
3. A helper's tools, folders and allowances are its lead's or fewer (section 8 says what an answer may add).
4. Only golem shortens a context, never the engine.
5. Privacy is never overridden: no wish, step-up or memory brings a hosted model or personal memory into a local-only chat.
6. A helper never writes memory. It proposes; the lead or you decide.
7. Nothing requires a local model and nothing requires a hosted one.

### 13. The three setups are an acceptance rule

Every ticket that touches models states its behaviour and has a test for a setup with local models only and one with cloud models only. A mixed setup is the default. The wish table above is the reference: with no local model `cheapest` is the cheapest hosted model and no paid question is asked; with no hosted model `stronger` is the same model in a fresh window.

## Alternatives Considered

### Alternative 1: Keep the child run and wait inside the tool call

- **Pros**: no schema change, no parking.
- **Cons**: a second pending path for approvals, one pending item per session that must become a list anyway, no resume after a restart, a second mechanism for `run.agent`, and several streams inside one run task.
- **Why not**: a session already has every one of these.

### Alternative 2: A session, but `delegate` awaits it in pass 2 of `tools_node`

- **Pros**: the lead's task stays alive, so no wake-up and no reconcile pass.
- **Cons**: the task holds the lead's run through a question or a restart. A replay would re-run the calls before it, since pass 2 has side effects.
- **Why not**: waiting in pass 1 keeps the two-pass rule that nothing has run before the last answer.

### Alternative 3: Helpers listed as rows with a parent filter

- **Pros**: the Inbox and Runs need no aggregation.
- **Cons**: every list client must filter, and a batch of five fills the list.
- **Why not**: hidden helpers plus an aggregated `pending_items` keep `session.list` as it is.

### Alternative 4: Mirror the helper's `tool.*` events in the lead's log

- **Pros**: the reducer and the trace need no change.
- **Cons**: every event is stored twice, and the lead's footer sums model calls that belong to another session.
- **Why not**: five `helper.*` summaries are enough for the card and cost.

### Alternative 5: A model name only, no wish

- **Pros**: nothing to learn.
- **Cons**: an agent file then fails on a Mac without that model, and cannot say "cheapest" or "stronger" across three setups.
- **Why not**: the wish keeps the pick pure and total.

## Consequences

### Positive

- A helper survives a restart, can ask you, shows in the Inbox under its lead and opens as a chat.
- The workflow step `run.agent` and a chat's `delegate` start the same session.
- The lead's context holds a brief and a short answer.
- Every model call stays on one path, so cost and the trace need no join beyond `root_session_id`.

### Negative

- More moving parts: a migration, five events, a parked state and a reconcile pass.
- The lead's log shows a thin summary, and the detail is one hop away.
- Old 058 threads stay in `checkpoints.db`. They are not cleaned.

### Risks

- A resumed helper repeats a call that was in flight. A reader repeats safely. A worker's edit in its copy may fail the second time, and the model sees the error.
- Helpers started before a later approval in the same message are wasted if you deny it. The order is the model's order.
- A model may still delegate when it should not. 15.4 measures it.
- Several helpers on one local model are slower than one, until Phase 18 sets slots (ADR-060).
