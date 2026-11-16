# ADR-055: golem picks a model by fixed rules: three tiers, a route mode per session, and caps on spending

**Date**: 2026-11-14
**Status**: accepted
**Deciders**: Milan Pavel

## Context

Today a session has one model, set by the user ([models](../architecture/models.md)). `ModelRouter` only turns a name into a chat model. It does not choose.

The goal of the product is that the cheapest model that can do a job does it, and that this model is free and on this Mac ([vision](../vision/core.md)). A choice like this touches two things people care about: money and privacy. A wrong pick costs real money, or sends a private folder to a hosted provider. So the rules have to be written down, easy to test, and visible to the user. The tickets that build routing, caps and step-up need one place that fixes the names, events and settings.

## Decision

### 1. Three tiers

| Tier | Which models |
|---|---|
| `local` | Provider `ollama` |
| `budget` | A hosted model whose blended price is at or below `[routing] budget_max_price` |
| `frontier` | A hosted model above that price, or with no known price |

- The blended price is `(3 × input + output) / 4`, in USD per million tokens. Input counts three times because a chat sends much more than it receives.
- `budget_max_price` defaults to 1.50.
- A catalog entry may set `tier`. That value wins over the price.
- A hosted model with no known price is `frontier`. golem never guesses that an unknown model is cheap.

### 2. A route mode per session

| Mode | Meaning |
|---|---|
| `pinned` | One model, the session's own, as before |
| `local` | Hosted models are never used |
| `auto` | Local first; a hosted model only when a rule below allows it |

`[routing] mode` is the mode of a new session. It stays `pinned` until the end-to-end checks of routing pass. The user can change the mode of a session at any time.

### 3. The pick is a pure function with a fixed order

`pick` takes the mode, the session's model, the candidates, the traits and the policy, and returns a choice: a model (or none), a reason, a short detail, and the rejected candidates with why. It reads no clock, no file and no network.

| # | Rule | `reason` |
|---|---|---|
| 1 | Mode `pinned`: the session's model | `pinned` |
| 2 | Mode `local`, or a local-only folder: drop every hosted model | `privacy` |
| 3 | Drop models that cannot do the call: no tools, no vision for an image, provider not ready, or the prompt estimate plus the reply reserve is above the window | `fit` |
| 4 | Drop paid models when a cap is spent or the user has not agreed | `budget` |
| 5 | Take the cheapest left. Ties go to the faster model, then to the better tool-call score | `cheapest` |

- The order is the rule. A later rule only works on what the earlier rules left.
- Privacy is never overridden. No later rule, no step-up, no fallback and no "try again on a stronger model" can add a hosted model back into a local session or a local-only folder. If nothing local passes, the run fails and says why.

### 4. Traits are facts

The inputs to a pick are facts golem already has:

- the estimated prompt tokens,
- whether the call needs tools,
- whether it has an image,
- whether the folder is local-only,
- how much money has been spent.

No model call is made to classify a request. golem does not try to judge "how hard is this prompt".

### 5. The event `model.routed`

`model.routed` is a new run-scoped event. Its data:

| Field | Meaning |
|---|---|
| `model_profile` | The profile that will run |
| `provider`, `model` | What that profile resolves to |
| `tier` | `local`, `budget` or `frontier` |
| `reason` | `pinned`, `privacy`, `fit`, `budget`, `cheapest`, `escalated`, `fallback` or `user` |
| `detail` | One short sentence a person can read |
| `rejected` | A list of `ref`, `tier`, `why` for each candidate that was dropped |

`model.selected` keeps its meaning: the session's own model changed, by the user. A pick for one turn does not change the session's model.

`escalated` and `fallback` come from stepping up and from a failing provider (below). `user` comes from the user asking for a stronger model for one answer. A pinned session makes no choice, so the runner does not need to emit the event for it.

### 6. Stepping up inside a run

A run may move to a stronger model, but only on objective signals counted inside that run:

- tool calls with invalid arguments or to an unknown tool, twice in a row,
- a tool call written as text that golem could not read,
- the same tool call with the same arguments three times,
- an empty reply with no tool call,
- a reply cut at the length limit.

The rules for stepping up:

- It goes one tier at a time.
- It happens at most once per run.
- It holds until the run ends. The next turn picks from the bottom again.
- It only happens in a session on `auto`. It never happens on `local` or `pinned`.
- It follows the same rules as a pick: privacy, fit, consent and caps still apply.
- When the next model is paid and the session has no yes yet, a struggle asks the paid question in the middle of the run, once, and the run waits for the answer like a tool approval. A prompt that does not fit and a failing provider do not ask.
- The stronger model sees the failed calls and their errors. Nothing is removed from history.

A provider that fails (unreachable, rate-limited, a server error) is replaced by the next candidate of the same tier, then by the next tier. The event has the reason `fallback`.

### 7. The paid question

The first paid model in a session asks, through the approval path ([ADR-013](013-approvals.md)). The answer is "once", "for this session", or "stay local".

`[routing] paid` sets how often it asks:

| Value | Meaning |
|---|---|
| `ask` | Ask once; "for this session" is remembered |
| `always_ask` | Ask before every paid call; nothing is remembered |
| `never` | Paid models are never used |

"Allow for this session" is stored on the session, like the session's allowed tools ([ADR-047](047-permission-modes.md)). It does not outlive the session and it is not a permission rule.

### 8. Budgets

```toml
[budget]
daily_usd = 2.0
session_usd = 0.5
over = "local"   # local | ask
```

- A cap that is not set means no cap.
- The caps are checked before every paid call.
- Over a cap, `local` means the pick drops paid models and the turn runs locally; `ask` means the user is asked first.
- The cost of a call is fixed when the call ends, at that moment's price, and stored. History does not change when a price changes.
- The cost shown is an estimate. It comes from the price list that ships with golem, or from the price a profile sets.

### 9. Roles

```toml
[routing.roles]
titles = "session"
summarise = "session"
explore = "session"
```

Each role is `"session"` or a model name. `"session"` means:

- On a local session, the same local model with the same options, so Ollama does not unload or reload anything.
- On a hosted session, the cheapest ready model of the budget tier, else the session's model.

Roles are for small internal jobs. The chat itself follows the route mode.

## Alternatives Considered

### Alternative 1: A trained router that predicts the model from the prompt

This is the RouteLLM approach.

- **Pros**: can save money without any rule written by hand.
- **Cons**: needs labelled data for each user and each set of models. A wrong pick is silent: the user sees a bad answer, not a reason.
- **Why not**: golem has no such data, model sets differ for every user, and every choice must come with a reason the user can read.

### Alternative 2: A classifier call on a small model before every turn

- **Pros**: can use the meaning of the prompt.
- **Cons**: adds a call and a wait to every turn. On a local Mac the wait is long, and a second model may unload the chat model. A small model judges difficulty badly.
- **Why not**: it slows every turn to improve a guess. Facts and a step-up on failure cost nothing when things go well.

### Alternative 3: Always try local first, then check the answer with a second call

This is the AutoMix approach.

- **Pros**: catches a bad local answer before the user sees it.
- **Cons**: doubles the calls on a slow local model, and the check itself can be wrong.
- **Why not**: too slow for a chat. A step-up on objective signals catches the clear failures at no extra cost.

### Alternative 4: A hosted gateway that routes for us

- **Pros**: no routing code to keep.
- **Cons**: another company sees all the traffic, including private folders.
- **Why not**: golem removed hosted gateway providers for this reason, and it keeps what a person sends under their control.

## Consequences

### Positive

- Every choice has a reason on the wire, so the user can see why a model was picked.
- The rules are a table. They can be tested as a table, with no model and no network.
- Privacy comes before everything else, and nothing later can undo it.
- Money is bounded by the caps, and the first paid call always asks.

### Negative

- The rules do not know that a request is hard. A local model has to fail first, and only then does golem step up.
- A step-up pays for the failed local calls in time.
- Settings grow: `[routing]`, `[routing.roles]` and `[budget]`.

### Risks

- Prices in the bundled list go stale. The cost shown is an estimate, and the docs and the UI say so. A profile can set its own price.
- A model with a wrong or missing price lands in the wrong tier. A catalog entry can set `tier` to fix this.
- The caps read spend from a table of finished calls. A call that is still running is not counted until it ends, so one call can go a little over a cap.

## References

- [ADR-013: Approvals](013-approvals.md)
- [ADR-041: Session trace](041-session-trace.md)
- [ADR-043: Ollama context window](043-ollama-context-window.md)
- [ADR-047: Permission modes](047-permission-modes.md)
- [Models](../architecture/models.md)
- Surveys on routing between models: [arXiv 2603.04445](https://arxiv.org/abs/2603.04445), [arXiv 2502.00409](https://arxiv.org/abs/2502.00409)
- RouteLLM: [arXiv 2406.18665](https://arxiv.org/abs/2406.18665)
- AutoMix: [arXiv 2310.12963](https://arxiv.org/abs/2310.12963)
- SWE-Router: [arXiv 2607.00053](https://arxiv.org/abs/2607.00053)
