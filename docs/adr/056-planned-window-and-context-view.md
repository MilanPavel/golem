# ADR-056: golem plans the window of a local model, and sends a view of the history, never a shorter history

**Date**: 2026-11-14
**Status**: accepted

## Context

[ADR-043](043-ollama-context-window.md) says golem never sends a `num_ctx` nobody asked for. That kept golem simple, but a real session showed what it costs.

Facts, in addition to F1 to F5 of ADR-043:

| # | Fact | Source |
|---|---|---|
| G1 | Ollama's default window depends on memory: under 24 GiB it is 4K, from 24 to 48 GiB 32K, from 48 GiB 256K | docs.ollama.com/context-length |
| G2 | Ollama advises at least 64,000 tokens for agents and coding tools | same page |
| G3 | `/api/ps` returns `size` and `size_vram` for each loaded model. `size_vram < size` means part of the model is on the CPU | docs.ollama.com/api/ps |
| G4 | Memory grows with `OLLAMA_NUM_PARALLEL` times the context length | docs.ollama.com/faq |
| G5 | In a real golem session, 13 file reads were 29.7K of a 32K window, the last call waited 3m25s for its first token, and the start of the chat was cut | the session behind Phase 9 |
| G6 | Replacing old tool output with a stub matched LLM summaries on solve rate and halved the cost on SWE-bench Verified. Tool output was about 84% of the context | arXiv 2508.21433 |

So the window is unknown before the first call (F1). It depends on the Mac and not on the job (G1). It is often below what an agent needs (G2). When it fills, Ollama cuts the start of the prompt without an error (F5, G5). And golem never trims the history: one tool result of up to about 16,000 characters stays in every later prompt.

## Decision

### The window

1. **`[context] window`** is `"auto"` (the default), `"ollama"`, or a number. With `"auto"`, golem plans a window for each local model and sends it as `num_ctx` on every call to that model. A `num_ctx` that someone set (session option, saved option, profile `ctx`) wins over the plan. `"ollama"` is the behaviour of ADR-043. A number is used as it is, capped at the model's maximum when that is known.
2. **The plan** is the largest of 8192, 16384, 32768 and 65536 that is at or below the model's maximum and that the machine holds. "Holds" is `fit()` in `models/hardware.py`: the model's size on disk, plus the cache for the window, plus 1 GB, compared with the memory. The rule, exactly:
   1. If the model's size or the machine's memory is unknown, there is no plan. golem sends nothing and Ollama decides, as before.
   2. The candidates are the steps at or below the model's maximum (no known maximum counts as 65536), and at or below a lowered value (see 3) when there is one.
   3. `a` is the largest candidate for which `fit()` says `fits` (the sum is within 50% of the memory).
   4. If `a` is at least 32768, the plan is `a`.
   5. Otherwise `b` is the largest candidate at or below 32768 for which `fit()` says `fits` or `tight` (within 75%). The plan is `b` if there is one, else `a`, else none.

   In words: prefer a window that leaves half the memory free, and accept a tighter fit only to reach 32K, which an agent needs.
3. **Verify after the load.** After a load, golem reads `/api/ps`. If `size_vram` is below `size`, part of the model runs on the CPU. golem plans one step lower for that model and keeps the lower value in `cache/`. The reason: `fit()` uses one rate for every model, so it is an estimate, and the check on the real load is what makes the plan safe.
4. **One window per model, sent always.** Internal jobs (the title, a summary, and the like) on the same model send the same number. A different number reloads the model (F2).
5. **Grow, never shrink.** Between turns, when the last call used 80% of the room or more and clearing or summarising has already run, golem moves up one step, when the machine holds it (`fit()` says `fits` or `tight`, and the model's maximum allows; the steps for growing go up to 131072). Never during a run, never down by choice, never back and forth. A step down happens only through 3.
6. **A reply reserve.** `[context] reply_reserve` tokens (default 4096) are kept free for the answer. "Full" and every threshold below are measured against the window minus the reserve. When `num_predict` is set above the reserve, it is the reserve for that call, up to half the window.
7. **A check before sending.** golem estimates the prompt in tokens, with a characters-per-token ratio learned per model from earlier calls (the characters it sent against the tokens the provider counted). A prompt that would not fit is not sent as it is. The ladder runs.

### The view

8. **The ladder**, in this order:
   1. **Clear** old tool results.
   2. **Summarise** old turns.
   3. **Grow** the window (5), between turns.
   4. **Step up** to a model with a larger window. That is routing, and it goes through the paid question of the routing ADR (ADR-055).

   If nothing helps, the call is not sent and the run fails with a clear message. Ollama never cuts a prompt silently.

   Thresholds, as settings of `[context]`:

   | Setting | Default | Meaning |
   |---|---|---|
   | `clear_at` | 0.70 | Clearing starts when the prompt estimate passes this share of the room |
   | `clear_to` | 0.40 | Clearing stops when the estimate is under this share |
   | `compact_at` | 0.85 | Summarising starts when, after clearing, the estimate is still above this share |
   | `keep_turns` | 4 | The last turns that are never summarised |
   | `keep_results` | 4 | The newest tool results that are never cleared |

   Clearing is one big step, not a little on every call, so the start of the prompt stays the same for many calls and the model server's cache keeps working.
9. **A view, not a deletion.** Graph state gets one field, `context_view`, with `cleared_before` (tool results before this message id are sent as a stub), `summary` (the text that stands for every message before `summarised_before`) and `summarised_before` (the id of the first message still sent in full). `call_model` sends `view(messages, context_view)`, a pure function. The checkpoint keeps every message, so the transcript, the message ids and the trace are untouched. A stub keeps the tool call and says the result was cleared, so the model can call the tool again. Forks copy the view with the history ([ADR-010](010-fork.md)).
10. **`context.changed`** is a new run-scoped event. Its `action` is `cleared`, `summarised` or `grew`. It carries the tokens before and after, and a `count` (results cleared or messages summarised). For `grew` it also carries the old and the new window (`window_from`, `window_to`) and the reload time (`reload_ms`). A manual `/compact` may send it with no run.
11. **The trace shows what was sent.** `model.call.started` lists the ids of the messages sent as stubs (`cleared_ids`) and says whether a summary was sent (`summary_chars`). It also says whether golem planned the window (`window_planned`). See [ADR-041](041-session-trace.md).

A planned window is exact, so screens show it without `≈`: it is a `num_ctx` that golem sent. golem still does not read `OLLAMA_CONTEXT_LENGTH` or `OLLAMA_NUM_PARALLEL`.

## Alternatives Considered

### Alternative 1: Keep ADR-043 and only compact

- **Pros**: nothing about what golem sends to Ollama changes.
- **Cons**: the window stays unknown before the first call, and stays at Ollama's default (G1), often too small for an agent (G2).
- **Why not**: compacting against a window golem does not know is guessing.

### Alternative 2: Always send the model's maximum

- **Pros**: the window is always known.
- **Cons**: it can fail to load, or spill to the CPU (ADR-043, alternative 2).
- **Why not**: a large window that does not fit the machine is slower than a small one.

### Alternative 3: `RemoveMessage` to delete old messages from the checkpoint

- **Pros**: the stored history is short.
- **Cons**: forks and the trace lose history, and it cannot be undone. This was the first text of step 9.5.
- **Why not**: golem should send less, not forget.

### Alternative 4: Summarise first

- **Pros**: one mechanism.
- **Cons**: one extra model call every time, and a summary loses detail that clearing keeps reachable. The tool call stays, so the model can read the file again.
- **Why not**: the cheap step goes first (G6).

### Alternative 5: Clear a little on every call

- **Pros**: the prompt never passes a limit.
- **Cons**: the start of the prompt changes on every call, so the model server's cache never hits.
- **Why not**: one big step keeps the cache.

## Consequences

### Positive

- A local model has an exact window from the first call.
- Ollama never cuts a prompt silently.
- Long sessions keep working, and the transcript on screen is the same with and without clearing.

### Negative

- golem now changes how much memory a local model uses.
- The estimate before sending can be off by some percent, so the reply reserve also absorbs that.
- The model reloads when the window grows. The `context.changed` event says how long it took.

### Risks

- A wrong plan slows the machine. The `size_vram` check (3) and `window = "ollama"` are the ways out.
- `OLLAMA_NUM_PARALLEL` above 1 multiplies the memory (G4). golem does not read it, so the `size_vram` check is the only guard.
