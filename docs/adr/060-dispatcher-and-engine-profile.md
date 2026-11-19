# ADR-060: One dispatcher decides how many model calls run at once, and every wait has a named reason

**Date**: 2026-11-19
**Status**: proposed

## Context

Phase 18 (#1198) makes several model calls run at once, for two chats, for a chat and its helpers ([ADR-058](058-child-runs.md), and the child sessions of [ADR-059](059-helpers-are-child-sessions.md)), and for unattended runs. This record fixes the shape before any step is built, so no ticket has to invent it and none hard-codes Ollama.

What exists today:

- `ServerGate` in `golem/models/gate.py` keeps one line per local server (its base URL). The cap is `[ollama] parallel`, shared by every model on that server. Waiters have two priorities, `chat` and `job`. Only a `chat` call that waits over 1 s tells its caller.
- `_gated` in `golem/graphs/chat.py` holds a slot around `binder.invoke`, one model call. `_retrying` sits inside it. A tool, a helper (`delegate`) and an approval run after the slot is given back.
- `router.ollama_server` (`golem/models/router.py`) returns a server only for a provider of kind `ollama`. A hosted model never goes through the gate: no cap, no order, no named wait.
- `ModelTitles`, the summariser and `CheckManager` take `gate.hold(server, "job" | "chat")`.
- `server/app.py` builds the gate once, from `settings.ollama.parallel`, at start.
- `model.waiting` (`packages/protocol/golem_protocol/events.py`) has `message_id`, `waiting`, `model` and `window`. The chat also sends it while the model reloads for a larger window. `WAITING_FOR_LOCAL_MODEL` in `packages/view/src/chat-state.ts` is its only wording.
- `OllamaSettings.parallel` in `golem/config.py` is an integer from 1 to 8, default 1. `LocalServer._start` in `golem/models/ollama.py` passes `OLLAMA_HOST` and the user's own environment. `OLLAMA_NUM_PARALLEL` is never set, so a higher `parallel` only works when the user also set it.
- `plan_window` (`golem/models/window_plan.py`) and `fit` (`golem/models/hardware.py`) plan for one slot.
- A rate-limited or failing hosted call gets one retry after `retry-after` (at most 10 s), then a fall back to another candidate (`_retrying`, `retry_delay` in `golem/models/errors.py`; [ADR-055](055-model-routing.md)).
- `golem models check` is `packages/cli/src/models-check.ts`. It calls `models.check`, which runs tool-call cases in `golem/models/check.py`. It does not measure speed at several calls at once.
- `local.get` and `local.set` do not exist. `PROTOCOL_MINOR` is 113.

The Ollama facts behind the design (slots fixed at load, a window per slot, a reload when either changes) are Ollama's rules, not every engine's. Other engines differ in exactly this part.

## Decision

### 1. The dispatcher

`ServerGate` becomes `Dispatcher` in `golem/models/dispatcher.py`. It stays one small module with no engine code in it. It has four parts: lines, an order, wait reasons and a watchdog (7).

| Line | Key | Capacity |
|---|---|---|
| local model | `local:<engine>:<server url>:<model>` | the engine profile's slots for that model (3) |
| hosted provider | `provider:<provider name>` | `[providers.<name>] at_once`, default 4 |
| heavy shell command | `shell` | 1 |

- A line is made on its first call. A setup with no local model has no local line, and the dispatcher never asks an engine anything.
- A server also has a cap on calls across its models: `max_loaded × slots`. `max_loaded` is a profile field. It is 1 until step 18.9. A call for a model that is not loaded, on a server already at `max_loaded`, waits until a loaded model has no running call.
- A provider line is by provider, not by model, because a rate limit belongs to the account.

### 2. The interface

```python
@dataclass(frozen=True)
class Call:
    line: LineKey
    session_id: str | None
    role: Literal["chat", "helper", "job"]
    label: str                      # how a holder is named: a session title, "a helper of X", "a title job"
    arrived: float | None = None    # kept by a retry, so it does not lose its place

async with dispatcher.hold(call, on_wait=notice) as grant: ...
dispatcher.set_slots(line, n)       # a new count, live
dispatcher.refused(line, retry_after=None)   # a provider refused: back off
dispatcher.snapshot() -> list[LineState]     # for the Activity panel
```

- `hold` returns when the call has a slot. `grant.waited` is the seconds it waited. Leaving the block gives the slot back.
- `on_wait(Wait | None)` gets a `Wait` (reason, position, holder, line, retry in) after 1 s of waiting, again when the position changes (at most once a second), and `None` when the call has its turn. A wait of 1 s or less calls nothing. The caller writes the `model.waiting` event. The dispatcher sends nothing itself.
- Cancel while waiting: the task is cancelled ([ADR-008](008-cancellation.md)), the waiter leaves the queue, `on_wait(None)` is called, and a slot handed over in the same instant passes to the next waiter. `ServerGate._acquire` already does this.
- The order needs one fact about the session. `Dispatcher(rank_of=…)` takes a function from a call to its class (5). It is the only place that knows what a helper or a routine is.
- `set_slots` applies to the next grant. A running call keeps its slot, so a lower count takes effect as calls end.

### 3. The rule that rules out deadlock

**A slot is held for one model call.** It is taken before the request and given back when the stream ends. It is never held across a tool, a helper or a question.

- `_retrying` moves outside the grant. A refused call gives its slot back, waits out the backoff, and takes a slot again with its old `arrived`.
- A run holds at most one grant at a time, and never waits for anything else while it holds one. It cannot wait for a slot that its own waiting helper needs.
- The shell line follows the same rule. A grant covers one command, and the command waits for nothing.
- A batch of helpers is admitted call by call. Nothing in the dispatcher knows what a batch is.

### 4. The engine profile

A profile says how an engine runs calls at once and what a context costs there. It is data, in `golem/models/engine.py`. A reader of an engine's state is a method on the engine, not a field.

| Field | Values | Ollama |
|---|---|---|
| `id` | a name | `ollama` |
| `at_once` | `slots`, `serial`, `batch` | `slots` (`OLLAMA_NUM_PARALLEL`) |
| `max_slots` | integer | 8 (`OllamaSettings.parallel` is at most 8) |
| `max_loaded` | integer | 1 until 18.9 |
| `capacity` | `slots_x_window`, `pool_tokens`, `memory` | `slots_x_window` (`fit` and `kv_gb`) |
| `window` | `fixed_at_load`, `dynamic` | `fixed_at_load` (`num_ctx`; a change reloads, ADR-056) |
| `queue` | `golem`, `engine` | `golem` |
| `prefix_cache` | `per_slot`, `shared`, `file`, `none` | `per_slot` |
| `reload_on` | any of `window`, `slots` | `window`, `slots` |
| `tools` | `native`, `parsed`, `none` | `native`, and golem reads a call written as text (`text_tool_calls`) |
| `structured` | true or false | true (`golem/models/structured.py`) |
| `owns_server` | true or false | true when golem started it (`LocalServer.owner`) |

- Ollama is the only instance. `provider.kind == "ollama"` selects it. Step 18.14 adds a kind if the MLX spike (18.12) says so. vLLM and MLC-LLM have no step.
- The dispatcher reads the profile like this. `queue = "golem"` makes a line with `slots` calls at once. `at_once = "serial"` makes it 1. `queue = "engine"` admits up to the cap and does not serialise, so a batching engine keeps its advantage. No profile of that kind exists yet; this is the one rule kept for it.
- The engine reads its state without blocking a caller. For Ollama that is `/api/ps` (loaded models, `size`, `size_vram`). A failed read returns nothing and never fails a call.

### 5. The order, and aging

Every waiting call has a class. A lower class goes first.

| Class | Who |
|---|---|
| 0 | a chat you look at: its session has an attached connection |
| 1 | a helper whose lead is class 0 |
| 2 | any other chat, and the helpers of one |
| 3 | an unattended run: a session whose origin is `routine:*` (and later a workflow), and its helpers |
| 4 | a job: a title, a summary, a model check |

- When a slot frees, the dispatcher picks the waiter with the lowest effective class, then the earliest `arrived`. The class is read at that moment, so switching chats re-orders the line.
- Aging: `effective = max(0, class − floor(waited / 60 s))`. A job that has waited 4 minutes ties with a chat and goes first because it arrived first.
- A call that has a slot is never taken away. The test uses a fake clock.
- A call for a loaded model goes before a swap, inside the same effective class.

### 6. Wait reasons and `model.waiting`

Every wait has one reason, and a wait over 1 s has an event. The reasons are fixed:

| Reason | Meaning | Emitted by |
|---|---|---|
| `slot` | no free slot on a local or shell line | the dispatcher, written by the chat graph (the tool runner for `shell`) |
| `load` | the model is loading, or reloading for a larger window | the chat graph, from the engine's state and the window growth it already reports |
| `provider` | a provider line is full or backing off | the dispatcher, written by the chat graph |
| `team` | a lead waits for its helpers, or a helper waits because its batch is over its own limit at once | the session manager and the batch tool (Phase 15, ADR-059) |
| `budget` | a spend cap holds the call and asks | the runner, with the paid question |
| `you` | the run waits for your answer | the runner, with the approval |
| `stalled` | the watchdog stopped a call, or flagged a team | the watchdog (7) |

`model.waiting` keeps `message_id`, `waiting`, `model` and `window`, and gains optional fields:

| Field | Meaning |
|---|---|
| `reason` | one of the seven above. A daemon that sends `waiting` always sends it |
| `line` | `qwen3:14b`, `anthropic`, `shell` |
| `position` | 1 is next. For `slot` and `provider` only |
| `holder` | the label of the call that will free a slot first, or null |
| `retry_in_ms` | `provider` only: the backoff left |
| `silent_ms`, `scope`, `will_retry` | `stalled` only: how long, `call` or `team`, and whether a retry follows |

- `load` is sent when the load is expected to take over 1 s, or the first token has not come in 1 s after a load. `you` and `budget` are sent at once, since a person is the cause.
- A new event is sent when the reason or the position changes, at most once a second. `waiting: false` ends a wait.
- A shell wait uses `model.waiting` with `line: "shell"` and the `message_id` of the message that asked for the command. No new event type.
- The Activity panel (18.7) reads `activity.get`, which returns `snapshot()`: for each line its slots, who holds each (label and session id), who waits and why. `activity.changed` sends the whole snapshot at most four times a second.

### 7. The watchdog

A call is silent when no chunk has arrived: no text, no reasoning, no tool-call piece.

- Between chunks the limit is `[watchdog] silent_seconds`, default 45.
- Before the first chunk of a local call it is `max(45 s, 2 × first_token_ms)`, up to 10 minutes. `first_token_ms` comes from `SpeedBook` (`golem/models/speed.py`), because a 32K prompt can take minutes to read. Before the first chunk of a hosted call it is 90 s.
- On a stall the call is cancelled, `model.waiting` with `stalled` is sent with `will_retry: true`, and the call is tried once more with its old `arrived`. A second silence fails the call with the code `stalled`, which ends the run or the helper with that reason.
- A server golem owns is restarted only if it also fails a health probe (2 s). A looping model on a healthy server is not a reason to cut every other call. An external server is never restarted.
- A team is flagged with `scope: "team"` when nothing in its run tree has moved for 120 s: no chunk, no tool start or end, no open wait of any reason. A tool that is running is not a stall. The flag offers Stop and Retry.
- The same watchdog covers hosted calls.

### 8. Slots, windows and who cuts a context

- **`[ollama] parallel`** takes `"auto"` (the default) or 1 to 8. The profile's `slots` is what it resolves to.
- `auto` is the largest k up to 4 for which `fit(size, ram, window, slots=k)` says `fits`. When `golem models check --parallel` (18.8) has numbers for the model, `auto` is the count with the best total speed that still leaves the lead its window.
- **Only golem shortens a context, never the engine.** Slots divide the window plan (18.3); they never make the engine truncate. `plan_window` and `fit` take `slots`, and the cache is `num_ctx × slots`. The ladder of [ADR-056](056-planned-window-and-context-view.md) stays in charge.
- golem sets `OLLAMA_NUM_PARALLEL` when it starts a server it owns. When the value changes it restarts that server between calls, never during one.
- An external server is never restarted. golem probes it with two small calls at once. If they overlap, the setting applies. If not, the line has one slot and the screen shows the line to run.
- golem never lets a call queue inside the engine. The order lives in one place.

### 9. The provider line and rate limits

- The cap is `[providers.<name>] at_once`, default 4.
- A refusal (`failure_of` says `rate_limited`) calls `refused`. The line backs off until `max(retry-after, 2 s × 2^(n−1))`, at most 60 s, with `n` the refusals in a row. A success resets `n`. New calls wait with `provider` and `retry_in_ms`. The refused call retries up to three times through the line, then fails as today and falls back ([ADR-055](055-model-routing.md)).
- Step 18.10 adds pacing before a refusal. After each call the line reads the provider's remaining-requests and remaining-tokens headers (`anthropic-ratelimit-*`, `x-ratelimit-*`), and holds calls until the reset when the next call would not fit.

### 10. Zero local lines, and three setups

- With no local model the dispatcher has provider lines and `shell`, and nothing starts or looks for Ollama. A local model counts as set up when a profile, the default, a role or the ladder resolves to a model of an engine.
- Hosted calls go through a provider line with a cap. A rate limit is a `provider` wait with a reason, never a hang.
- **Every ticket of Phase 18 states its behaviour for local models only, mixed, and cloud models only, and has a test for local-only and for cloud-only.** A test with no local line must pass without an Ollama binary.

### 11. What a client sees

- `local.get` returns `engines`: one entry per local engine in use, empty with no local model. An entry has the profile, the server (URL, owner `golem` or `external`, running or unknown, from the last known state, never a wait on the engine, and `setup_line`, the line to run on an external server that does not overlap), `at_once` (the setting, what `auto` chose and why, memory per slot, the window each slot gets, measured speeds, whether the overlap probe passed), `start` and `idle_stop_minutes`. It answers while the engine does not.
- `local.set` takes `engine` and any of `at_once`, `start`, `idle_stop_minutes`. It writes `[ollama]` and applies it live. It returns the new entry. Both are `browser` tier, like `routing.get`.
- The minor version rises twice: once for `model.waiting` (18.4), once for `local.get` and `local.set` (18.6a). A change in the wire also needs `just gen`.
- A client older than 18.4 ignores the new fields and shows `waiting for the local model` for any wait, also a hosted one. Clients and the daemon ship together ([ADR-020](020-safe-upgrades.md)), so this lasts one release. It never calls `local.*`. A new client on an old daemon gets "method not found" and hides Settings › Local models.
- With `engines` empty, Settings › Local models and its `/local` command are not shown.

### Decided here, to confirm

The design pages list these as open. The pages give no recommendation in writing, so these are the picks this record makes. The reviewer should confirm or change them.

| Q | Pick |
|---|---|
| Q7 | A section Settings › Local models of its own, not a card in Context |
| Q8 | `auto` is the default. Without a measurement it uses the fit rule |
| Q9 | For an Ollama golem did not start: probe it and show the line to run. Never restart it |
| Q10 | A helper uses the lead's model until 18.9 is proven. A second model only when it fits beside the first |
| Q11 | No battery rule in the first cut. A person who wants 1 sets 1 |
| Q16 | Yes: this record is step 18.0 and 18.1–18.6 are reviewed against the profile |
| Q17 | The MLX spike (18.12) runs early, in stage 2 |
| Q18 | A server you host is a third class, allowed per folder, and not allowed in a local-only folder by default. 18.13 decides the wire |
| Q19 | Only the noted rule in 4: no serialising in front of a batching engine. No vLLM profile now |

## Alternatives Considered

### Alternative 1: Keep `ServerGate` and add a second gate for hosted calls

- **Pros**: no rename, smaller first change.
- **Cons**: two modules with two orders and two sets of reasons. A run that waits on both has no single place to look.
- **Why not**: one order and one list of reasons is the point.

### Alternative 2: Let Ollama queue, with `OLLAMA_NUM_PARALLEL` and `OLLAMA_MAX_QUEUE`

- **Pros**: less golem code.
- **Cons**: Ollama queues in arrival order. The chat you look at no longer goes first, and golem cannot say who holds the model.
- **Why not**: order and reasons are lost inside the engine.

### Alternative 3: A call keeps its slot across a tool or a helper

- **Pros**: a lead keeps its prompt cache warm.
- **Cons**: a lead that waits for its helper's slot while holding its own can deadlock.
- **Why not**: one rule, a slot per call, rules out the whole class. What it costs in lost prompt cache is something 18.8 measures.

### Alternative 4: Age a waiter once, not every 60 s

- **Pros**: simpler to explain.
- **Cons**: a job under a steady stream of chats can still wait for ever.
- **Why not**: aging every 60 s guarantees a turn.

### Alternative 5: A fixed time limit with no estimate before the first token

- **Pros**: one number.
- **Cons**: a 32K prompt on a local model can take over 3 minutes to its first token (ADR-056, G5). 45 s would cut real work.
- **Why not**: the watchdog uses the speed golem has measured, and a floor of 45 s.

### Alternative 6: A `Pool` profile for vLLM in the first version

- **Pros**: the design would fit a hosted serve mode from the start.
- **Cons**: serve mode has no ticket. The shape would be guessed.
- **Why not**: the profile has `queue = "engine"` and one rule. A real second profile adds the rest.

## Consequences

### Positive

- Two chats, or a chat and its helpers, run on one model at once, and the order is the same on every engine and every provider.
- Every wait says why. A hosted rate limit is a short named wait, not a hang.
- A cloud-only setup gets the same order, limits and watchdog and never meets Ollama.
- Tickets are written against the profile, so a second engine adds an instance, not a rewrite.

### Negative

- Hosted calls now wait on a cap that did not exist. A cap set too low slows a batch.
- `model.waiting` carries more fields. Old clients show the old words for new waits.
- The watchdog can cut a slow but healthy call. `[watchdog] silent_seconds` is the way out.

### Risks

- The gain from two Ollama slots on one Mac may be small, about 1.3× in the estimate. Step 18.8 is built first so the numbers decide how much slot work is worth.
- `KV_GB_PER_1K_TOKENS` is 0.06 GB for every model (`golem/models/hardware.py`). For a 14B model with grouped-query attention the real figure is about 0.16, so `auto` would choose too many slots. 18.3 reads the real size from `/api/ps` after a load, or the constant is raised, before `auto` is the default.
- Helpers started in the same instant may all miss a provider's prompt cache, because the first call writes the entry. Verify per provider (18.10). If so, the dispatcher starts one call a moment ahead.
- Whether a provider's rate-limit headers reach golem through the LangChain clients is not checked. 18.10 begins with that check.
- A hosted model that thinks silently for over 90 s trips the watchdog. The limit is a setting.

## References

- [ADR-008: Cancellation](008-cancellation.md)
- [ADR-055: Model routing](055-model-routing.md)
- [ADR-056: Planned window and context view](056-planned-window-and-context-view.md)
- [ADR-058: Child runs](058-child-runs.md), replaced by child sessions in ADR-059
- [ADR-061: Memory](061-memory.md)
- [Models](../architecture/models.md), section "One at a time"
- Design pages (on the maintainer's Mac): `golem-docs/mocks/sub-agents/parallel.html`, `engines.html`
