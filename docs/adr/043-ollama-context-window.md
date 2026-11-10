# ADR-043: golem finds the context window of a local model from what Ollama says, and never sends a `num_ctx` nobody asked for

**Date**: 2026-11-09
**Status**: accepted

## Context

Ollama runs a model at its own default context window unless the call sends `num_ctx`. golem sends `num_ctx` only when someone set it: a session override, a saved option, or a profile `ctx`. Otherwise the model runs at Ollama's default, which is usually far below the model's maximum.

The listing's `context_length` (`<arch>.context_length` from `/api/show`) is that maximum, not the default. So for a local model with no profile `ctx`, golem cannot tell how full the context is. The trace page's context meter, the chat's `ctx` chip, the TUI status line, and `/context` all say "window unknown". Hosted models are fine: their window comes from the model listing or LiteLLM's price book.

## Decision

golem finds the window of a local model from these sources, in this order of trust:

1. **Sent by golem** (exact, always known when set): the session's `num_ctx` override, else the `num_ctx` saved for the model (step 12.6), else the profile's `ctx`. This is the order `ModelRouter.chat_model` sends them in: it sets the profile's `ctx` first, and then `ollama_options` overwrites it with the saved value and the session override.
2. **Loaded in Ollama** (see "Changed by 12.16.9": this source no longer counts as exact before the call): `context_length` of the model in Ollama's `/api/ps`.
3. **The model's Modelfile** (estimated): the `num_ctx` line in the `parameters` of `/api/show`. It is known as soon as the model is installed.
4. **Unknown**: as today.

Also:

- A window from source 2 or 3 is *estimated*, and every screen shows it with a leading `≈`, the same way a window filled from today's config already is (`window_estimated` in `TraceContext`, `context_window_estimated` on a model span).
- The window is worked out when the call is made and recorded on `model.call.started`, as [ADR-041](041-session-trace.md) already says for `context_window`.
- golem still never sends a `num_ctx` that nobody asked for.
- golem does not read Ollama's server settings (`OLLAMA_CONTEXT_LENGTH`) and does not guess a default number.

## Changed by 12.16.9

Measured on 2026-11-10, Ollama 0.40.14, `llama3.2:3b`, a Mac with 36 GB:

| # | Fact |
|---|---|
| F1 | A request without `num_ctx` loads the model at 32768 (`/api/ps` `context_length`). That is not 4096 and not the model's maximum (131072). Ollama picks it from the machine's memory or `OLLAMA_CONTEXT_LENGTH`, so golem cannot know it before a load. |
| F2 | Ollama reloads the model whenever a request's `num_ctx` differs from the loaded one. The loaded value is only the window of a request made the same way. |
| F3 | After a call with `keep_alive: 0`, `/api/ps` is empty. |
| F4 | `prompt_eval_count` counts the prompt after any cut, so it is never above the window the call ran with. |
| F5 | There is no `/api/tokenize`, and no field in the reply says the prompt was cut. |

What follows:

- **The window after the call is the truth.** `call_model` reads `/api/ps` once after each call and the window the call ran with goes out on `model.call.completed` as `context_window`: exact, `None` when it could not be read. The window on `model.call.started` is a forecast.
- **"Loaded" only counts for a request made the same way.** golem keeps `default_ctx`, the window Ollama gave a model the last time golem sent no `num_ctx`. A load made for a session that sent `num_ctx` never sets it. The forecast order is now: the sent `num_ctx`, the profile `ctx`, the Modelfile's `num_ctx` (estimated), `default_ctx` (estimated), unknown.
- **An estimated window is never shown below the input tokens.** Then the window is unknown and the hint says so. An exact window below them is kept and logged, as it would be a bug.
- **No fixed `num_ctx` default.** `/tune` and the web Tune view say `set by Ollama when it loads` until the Modelfile or a call says the number, then `model default 32768 · from Ollama` or `· from the Modelfile`.
- Whether `/api/ps` `context_length` is per request or per slot with `OLLAMA_NUM_PARALLEL` above 1 is not settled here.
- 12.16.10 ([#625](https://github.com/MilanPavel/golem/issues/625)) uses the exact window to say when Ollama cut a prompt that did not fit, and how sure golem is. See [Tracing](../architecture/tracing.md).

## Alternatives Considered

### Alternative 1: Show the model's maximum from the listing

- **Pros**: always known, and nothing new to read.
- **Cons**: wrong for a run at Ollama's default.
- **Why not**: the bar would say 3% full while the model is truncating.

### Alternative 2: Always send `num_ctx` (the model's maximum, capped by memory)

- **Pros**: the window would always be known, and exact.
- **Cons**: it changes behaviour for everyone, costs memory for every session, and can fail to load a large model on a small Mac.
- **Why not**: it is a choice for the user, not a default. The tuning steps (12.7.3 and 12.8.2 have a memory gauge) are where the user makes it.

### Alternative 3: Hard-code Ollama's current default (for example 4096)

- **Pros**: always known, with no extra reads.
- **Cons**: the default differs by Ollama version and by the machine's memory.
- **Why not**: the number would be wrong without saying so.

## Consequences

### Positive

- A local model's context bar works after the first answer.
- Nothing about what golem sends to Ollama changes.

### Negative

- Before the first call to a model that has no Modelfile `num_ctx`, and no `num_ctx` set by anyone, the window is still unknown.
- A window from source 2 or 3 is an estimate, so the screens show `≈`.

### Risks

- Ollama may change what `/api/ps` or `/api/show` return. Both reads tolerate a missing field and fall back to the next source.
