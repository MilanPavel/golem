# ADR-058: A helper is a child run on its own thread, with its steps in the parent's log

**Date**: 2026-11-15
**Status**: accepted

## Context

A small local model is good at a narrow job with a short context and bad at a long chat (`docs/vision/sub-agents.md`). One broad question ("what is this repo") filled 29.7K of a 32K window with file contents. Step 9.7 (#866) hands such a job to a helper that starts with an empty context and returns a short answer. Phase 15 (#733) plans full sub-agents later: agent files, approvals that bubble up, parallel workers, child sessions.

The vision says a child is "a session of its own, linked to its parent". A full child session needs headless sessions (4.0, [ADR-050](050-routines-and-headless-sessions.md)), which are not built. This step needs something smaller that does not close that door. The tickets that depend on this ADR are #911 (the `delegate` tool), #912 (chat and trace), #913 (limits and cost) and #914 (the prompt line).

What exists today:

- `open_chat` and `ChatRuntime` in `golem/graphs/chat.py` compile one chat graph. `ChatRuntime.stream` runs it on a thread whose id is the session id ([ADR-002](002-langgraph-boundary.md)). The checkpoint is the model's memory ([ADR-006](006-checkpoint-continuity.md)).
- The stream yields facts (`golem/graphs/adapter.py`). `run_turn` and `_apply` in `golem/sessions/runner.py` turn them into events and keep per-run bookkeeping in `_Progress`.
- `tools_node` in `golem/graphs/tools_node.py` decides every call with the permission policy. A call that asks calls `interrupt()` ([ADR-013](013-approvals.md)).
- The reducer in `packages/view/src/chat-state.ts` draws `tool.*` events under the assistant message named by `message_id`.
- The trace is built from the log by `build_trace` in `golem/sessions/trace.py` ([ADR-041](041-session-trace.md)).

## Decision

1. **What a child is now.** A *child run*: the same chat graph, run on its own checkpoint thread `<session_id>/c/<call_id>`, started by the `delegate` tool inside the parent's run. `<call_id>` is the id of the `delegate` call. Its message history is its own and begins with the brief. It is not a row in `sessions`, and `session.list` does not show it. Nothing lists the thread, and `session.inspect` on the parent does not include it. A child shares the parent's graph, router, tool registry and policy; only the thread, the tool scope and the limits differ. Phase 15 may later promote a child run to a session. The thread id, the `parent_call_id` on its events and the unchanged graph are chosen so that promotion is a migration, not a rewrite: the thread becomes a session's thread, and the events get a session of their own.

2. **Events.** A child's `model.call.started`, `model.call.completed`, `tool.requested`, `tool.started`, `tool.completed` and `tool.failed` are stored in the **parent's** session log, in the parent's run. Each gets a new optional field `parent_call_id`, the `delegate` call's id. The protocol minor version rises.
   - No `message.*` events are emitted for a child. Its text is not part of the transcript, and no `run.*` events either: the child has no run of its own. Its final answer is the `delegate` tool's result.
   - The runner keeps child bookkeeping apart from `_Progress` (open message, call index, pending calls), keyed by the parent call id. A child's call index counts the child's calls, and the parent's `MAX_MODEL_CALLS` counts only the parent's.
   - A child's `message_id` and `message_ids` name messages in the child's thread, not the parent's. Reading a child call's context (`trace.span`) reads the thread `<session_id>/c/<parent_call_id>`.
   - Child calls carry `cost_usd` and usage like any call and roll up into the run. A usage row of a child call has the role `explore`.

3. **Old clients.** An event with `parent_call_id` must not be drawn as a top-level step.
   - The shared reducer in `packages/view` folds such events under the `delegate` step they belong to (`child` on the step). Both web and TUI use that reducer.
   - A client older than the version that adds the field would draw them flat. That is acceptable for one release, because clients and daemon ship together ([ADR-020](020-safe-upgrades.md)).
   - The trace builder nests child spans under the `delegate` tool span. The parent's context series (`inputSeries`) does not include child calls, because they are a different context.

4. **Tools and rules.**
   - A child's tools are a fixed read-only set: `read_file`, `list_dir`, `glob`, `grep`, `git_log`, `git_diff`, `git_status`, `read_artifact`. These are the registry's names today (`READ_ONLY_TOOLS` in `golem/tools/fs.py`, the git tools in `golem/tools/shell.py`, `golem/tools/artifacts.py`). The set is a subset of the parent's scope. No shell, no writes, no web, no MCP, no skills, no `todo_write`.
   - A child cannot call `delegate` (depth 1). The tool is left out of the child's scope.
   - A call outside the scope gets the existing "unknown tool" error result, which the child's model can read.
   - A child never asks for approval. `tools_node` gets a run flag, set in the graph's `configurable` like the permission mode, that turns an `ask` into a refused call with a message the model can read (for example "a helper cannot ask for approval: this path needs it"). The `deny` rules of the policy still apply. The child gets none of the session's `allowed_tools`, so an allowance the user gave the parent is not extended to it.
   - The `delegate` call itself is read-only for the permission layer, so it needs no approval. What it returns is data, like any tool result.
   - Approvals that bubble up are Phase 15 (15.3).

5. **Limits.**
   - Model calls: 15 by default. Past the limit the child makes one last call without tools, asking for the answer from what it knows.
   - Wall time: 5 minutes by default.
   - Size of the returned answer: 6,000 characters by default, cut.
   - Hitting a limit ends the child with what it has. The tool result's first line names the reason: `explorer finished: <reason>` when it is not `done`. The reasons are `done`, `calls`, `time`, `budget`, `tokens` and `cancelled`. The limits are the `[agents.explorer]` settings (#913); `budget` is a spent cap in `[budget]`, and `tokens` is input tokens past 8 times the window.

6. **Cancellation and restart.**
   - The child runs inside the `delegate` tool call, in the parent's run task. Cancelling the parent's run cancels the child with it ([ADR-008](008-cancellation.md)). Child tool calls still open are failed with the cancel message, like the parent's. The `delegate` call is then unanswered in the parent's checkpoint, and the existing rule for unanswered calls gives it a cancelled result on the next turn (`answer_dangling`).
   - A daemon restart in the middle of a child: the parent's run is closed by recovery (`golem/sessions/recovery.py`), its open calls fail, and the `delegate` call is unanswered, so it is reported as cancelled on the next turn. The child's thread stays in `checkpoints.db` and is not resumed in this step.
   - An approval in the parent while a child runs cannot happen: the parent waits on the tool.

7. **Model.** The `explore` role of [ADR-055](055-model-routing.md) (`for_role` in `golem/models/roles.py`). On a local session that is the same model with the same options, so nothing reloads. The gate (`ServerGate`) serialises parent and child. The parent's model call has ended before the tool runs, so the child's calls take the slot one at a time and do not deadlock. A local-only session stays local.

8. **Cost and trace.** Child calls carry cost like any call and roll up into the run's totals and the turn's footer. In the trace they are spans under the `delegate` tool span: tool span, the child's model spans, their tool spans. A child's model span opens the same detail as any other, with its own context meter against its own window.

## Alternatives Considered

### Alternative 1: A full child session now

- **Pros**: matches the vision, resumes after a restart, has its own chat to open.
- **Cons**: needs headless sessions (4.0), which are not built. It adds a row in `sessions`, a list filter, attach rules and cleanup.
- **Why not**: more surface than one read-only helper needs. The child run keeps the door open.

### Alternative 2: A separate graph for helpers

- **Pros**: a loop shaped for the job, with no flags.
- **Cons**: two loops to maintain: prompts, tools, retries, cancel, usage.
- **Why not**: the chat graph already does all of it, so one flag and one scope are cheaper.

### Alternative 3: Plain function calls with no checkpoint

- **Pros**: simplest to write.
- **Cons**: no trace, no cost, and nothing to promote or resume later.
- **Why not**: the trace and the cost are the point of keeping a helper visible.

### Alternative 4: Child events in their own log

- **Pros**: the parent's log stays small.
- **Cons**: the parent's trace and its cost need a join, and every reader of the log must know about a second log.
- **Why not**: one field on events already in the parent's log gives the same grouping with no join.

## Consequences

### Positive

- The parent's context holds the brief and a short answer, not the files.
- Cost, usage and the trace include a helper with no new store.
- The graph, router and tools are reused, so a helper gets every fix of the chat loop.
- Promoting a child run to a session (#733, 15.2) is a migration: give the thread a session row and move its events. #733 needs no change for that. Its line "its events go to the same log, so a restart resumes it" holds once the child is a session. The wording of 15.2, "a child is a session linked to its parent", is the target of the promotion.

### Negative

- No approvals, no writes, no parallel helpers, and a child is not resumed after a restart (Phase 15: 15.3, 15.5, 15.2).
- Child events add to the parent's log. A turn with a helper has more events.
- Child threads stay in `checkpoints.db`. A fork copies only the parent's thread, so a forked session has helper events in its log with no thread behind them. Cleanup of child threads is left to Phase 15.
- A client older than the field draws child steps flat for one release.

### Risks

- A model may delegate when it should not, or never. #914 adds a short prompt line for small windows and measures it.
- A helper's answer is data. A parent that treats it as an instruction would let a read file steer it. The result is marked as the output of a tool, and carries no permission.
