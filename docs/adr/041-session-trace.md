# ADR-041: golem records a trace of each session and shows it in the browser

**Date**: 2026-11-07
**Status**: accepted

## Context

When an answer is slow, costly, or wrong, the first question is what happened: what the model was sent, what it replied, which tools ran, and how long each step took. Tools like LangSmith answer this with a *trace*. A trace is a tree of spans, each with its time, tokens, input, and output.

golem has no such view. `/debug` in the TUI shows the last 50 wire frames, and `session.inspect` shows the model's state as it is now. Neither shows the history of each model call. Most of what a trace needs is never stored:

- **The system prompt and the tool schemas.** They are rebuilt for every model call and thrown away (`call_model` in `graphs/chat.py`). They can't be rebuilt later, because skill files, pins, and config change.
- **A record of each model call.** No event marks a model call, so its model, tokens, stop reason, latency, and time to the first token are lost. The provider's usage is in the reply, but nothing keeps it. `stream_usage` is not set for OpenAI-style providers.
- **A tool's run time.** It exists only as the gap between two events' `ts`. That is when each event was stored, not when the tool ran.
- **A way to read a session as a trace.** `session.attach` replays raw events, and `EventLog.for_run` is not exposed.

What is already there is enough to join a tree together:

| Fact | Where it is |
|---|---|
| Each run is one user turn | `run_id` on every event |
| The history, with an id for each message | The LangGraph checkpoint |
| The reply that asked for a tool | `message_id` on `tool.requested` |
| The wait for approval | `approval.needed` → `approval.resolved` |
| The full output of a large tool result | The `artifacts` table |

Phase 13 ([#532](https://github.com/MilanPavel/golem/issues/532)) builds the trace. This ADR fixes the choices its steps depend on.

## Decision

### Spans

A trace has three kinds of span:

| Kind | One of these is | Its id | Its parent |
|---|---|---|---|
| Run | one user turn | `run_id` | none |
| Model call | one assistant reply | the reply's `message_id` | the run |
| Tool call | one tool the model asked for | `call_id` | the model call whose reply asked for it (`tool.requested.message_id`) |

The model call has no id of its own. Each call produces exactly one assistant message, and that message's id already joins the event log and the checkpoint.

### What is recorded

All of it is optional, so older events stay valid. Each step raises the protocol minor version.

1. **`model.call.started` and `model.call.completed`** (13.2).
   - **Started:** `message_id`, `index` (1-based within the run), `profile`, `provider`, `model`.
   - **Completed:** `usage` (`input`, `output`, `cache_read`, `cache_write`, each optional), `stop_reason`, `first_token_ms`, `latency_ms`, `failed`.
   - **Timing:** `call_model` marks the moment the request is sent with a new stream item, `model.request`. The runner times from there with a monotonic clock. Building the prompt and starting MCP servers come before that moment, so they don't count as model time.
   - **Usage:** it comes from LangChain's `usage_metadata` and `response_metadata`. A provider that reports none leaves `usage` empty, never zero.
2. **The exact request** (13.3).
   - A new table, `blobs`, keyed by the sha256 of the text, holds each system prompt and each tool-schema list (canonical JSON).
   - `model.call.started` gains `system_prompt_sha`, `tools_sha`, and `message_ids`: the checkpoint ids of the messages sent, in order.
3. **`duration_ms` on `tool.completed` and `tool.failed`** (13.4). It is measured around the tool's run. `tool.started` is already written after approval, so the wait never counts. A denied call never ran and has none.
4. **The context window and the prompt sections** (13.9). `model.call.started` gains `context_window` (profile `ctx`, then the listed model's `ctx`, then LiteLLM's `max_input_tokens`; `None` when unknown), `num_ctx` (the Ollama option sent, if any) and `system_sections` (`name` and `chars` per non-empty section, in order; the stored prompt is their texts joined with a blank line, so the lengths split it exactly). The window is resolved when the call is made because the profile, the listing and the price book change later. The sections cost a few bytes and save storing the prompt twice. `model.call.started` also has `window_estimated`, see [ADR-043](043-ollama-context-window.md), the ADR of 12.16.1. The window on `model.call.started` is a forecast. `model.call.completed` has `context_window` too, the window the call ran with, read from the model server after the call. It is exact and wins on the span (12.16.9).

### Why hashes and message ids, not a copy of the context

A model call's context is the system prompt, the tools, and the history. The history is already in the checkpoint with stable ids, so storing it again would copy each message once per later call: a session with 25 calls would hold the first message 25 times. The system prompt and the tools rarely change within a session, so storing them by hash keeps about one copy of each per session. A 3,000-token prompt is about 12 KB, stored once, and a list of ids is a few hundred bytes per call.

The checkpoint is the record of what the model saw. golem never rewrites past checkpoint messages. If compaction (Phase 9) ever does, it must keep the ids that traces refer to, or a trace says the message is gone.

### Reading a trace

Two browser methods, added in 13.5:

- **`trace.get {session_id}`:** the tree of spans with summaries only (names, times, tokens, status, a short preview), so a long session stays small.
- **`trace.span {session_id, span_id}`:** one span's full input and output. For a model call that is the system prompt, the tools, the messages in context with where the new part begins, and the reply. For a tool call it is the args, the full result (or its artifact id), and the approval.

The daemon builds the tree in Python from the events, the checkpoint, and the blobs, so the browser does no joining.

The daemon also returns what filled each model call's context. Each part (system prompt, tools, your messages, replies, tool results) is estimated at four characters a token, then scaled so the parts add up to the tokens the provider counted. The split is marked estimated, and a window filled from today's config, for a call recorded without one, is marked estimated too. The daemon does it because it already has the prompt, the tools and the messages, and the web and the TUI then show the same numbers.

### Older sessions

A session from before Phase 13 still has a trace:

- A model span is built for each assistant `message.started` / `message.completed` pair, timed from the events' `ts`, and marked `recorded: false`.
- Its context is every checkpoint message before the reply.
- Tool spans come from the tool events as before.
- Tokens, the stop reason, the system prompt, and the tools show as "not recorded".

### The page

Its own route, `/s/:id/trace`, with finished data and a refresh button. It does not update while a run streams. It is web only; the TUI keeps `/debug`. The design is in [the guide](../guide/web.md#trace-a-session).

### Privacy

Blobs hold prompts, which can hold anything a skill or a pinned file says. They live in `~/.golem/golem.db` next to the events, go into backups with them, and are never sent anywhere. `trace.span` returns them only to a client that may already attach the session.

## Alternatives Considered

### Send traces to LangSmith or Langfuse

- **Pros**: a finished, polished UI, with search and comparisons.
- **Cons**: an account or a server to run, and prompts and code leave the Mac. golem is local first and needs no account.
- **Why not**: the data is already in `golem.db`. An export can be added on top later (plan step 6.1).

### Emit OpenTelemetry spans and use a generic viewer (Jaeger, Phoenix)

- **Pros**: a standard format, and the GenAI semantic conventions exist.
- **Cons**: another process to run and point at. A generic viewer shows attributes, not a context you can read like a chat.
- **Why not now**: the same events can be turned into OTel spans later, without changing what is stored.

### Store a full copy of each request

- **Pros**: the simplest reader, and immune to any later change in the checkpoint.
- **Cons**: the size grows with the square of the number of calls, because each call repeats the whole history.
- **Why not**: the checkpoint already keeps the history with ids. Only the prompt and the tools are missing, and they dedupe well.

### Rebuild the system prompt when reading

- **Pros**: nothing new to store.
- **Cons**: it would show today's prompt, not the one sent. Skill files, pins, and config change.
- **Why not**: a trace must show what was really sent.

### Draw the trace in the TUI too

- **Pros**: one more place to see it.
- **Cons**: a two-pane tree with a waterfall and long context is cramped in a terminal, and `/debug` already covers the quick look.
- **Why not**: the browser is the better screen for reading; the TUI can follow later on the same methods.

## Consequences

### Positive

- Every model call in a new session can be read back exactly: model, tokens, timings, prompt, tools, context, and reply.
- 9.1 (tokens and cost) gets its per-call usage from 13.2, so it adds only prices.
- Older sessions are not left out.

### Negative

- Two more events per model call, one more table, and six protocol minor bumps over Phase 13.
- `trace.span` reads the checkpoint, which is slower than reading events. It is called once per click, not per row.

### Risks

- A provider may change where it reports usage or the stop reason. The adapter reads both LangChain fields and the known names (`stop_reason`, `finish_reason`); a missing value shows as "not recorded", not as zero.
- Unused blobs stay when a session is deleted. Pruning them is left for later, and they are small.

## Addendum

**13.9.9:** The TUI shows the context of the newest model call. `/context` prints the breakdown from `trace.get` and `trace.span`, and the status line shows `ctx N%` from the `model.call.*` events. The tree and the waterfall stay in the browser, and `/debug` stays.
