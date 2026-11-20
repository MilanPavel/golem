# Routing and context

**This is a plan.** None of it is built yet. The work is tracked in [Phase 9 (#110)](https://github.com/MilanPavel/golem/issues/110); look there for what has landed. The choices behind this page are recorded in two ADRs: ADR-055 ([#869](https://github.com/MilanPavel/golem/issues/869): tiers, route modes, the paid question, budgets) and ADR-056 ([#870](https://github.com/MilanPavel/golem/issues/870): the planned window, and the view of the history).

### The idea

**The cheapest model that can do a job does it.** Ideally that model is free and on your Mac.

golem sorts models into three tiers:

| Tier | What it is |
|---|---|
| `local` | Runs on this Mac. Free |
| `budget` | A cheap hosted model |
| `frontier` | The best hosted model, and the most expensive |

Why local first:

- **Free.** A local call costs nothing.
- **Private.** Your chat never leaves the Mac.
- **Offline.** It works without a network.

golem goes up a tier only when a job needs it, and it tells you when it does.

### How golem picks

Before each call, golem applies five rules, in this order. The first rule that decides wins; the later ones only trim the list.

| Order | Rule | Example |
|---|---|---|
| 1 | **Pin** | The session is `pinned` to one model, or a workflow or agent file names one. golem uses it |
| 2 | **Privacy** | The session is `local`, or its folder is in `local_only`. Every hosted model is dropped, always |
| 3 | **Fit** | The model has no tool calling, or the prompt plus the reply reserve is bigger than its window. It is dropped |
| 4 | **Budget** | A cap is spent, or you have not agreed to paid models. Paid models are dropped |
| 5 | **Cheapest** | Of what is left, golem takes the cheapest |

A session has one of three route modes: `pinned` (one model, as today), `local` (never leaves this Mac), and `auto` (local first, step up when needed).

#### When a paid model is really needed

Almost never. golem steps up only in these cases:

1. **It does not fit.** After clearing and summarising, the prompt is still bigger than the local window.
2. **The local model struggles.** golem looks at what the model just did, not at a guess about the answer. The signals are: invalid tool arguments or an unknown tool, twice; a tool call written as text that golem could not read; the same call three times; an empty reply; a reply cut off at the length limit.
3. **No local model can.** The job needs vision or tool calling, and none of your models has it.
4. **You ask.** You choose "try again on a stronger model" under an answer.

golem goes up one tier at a time, at most once per run, and stays there until the run ends. The next turn starts at the bottom again. There is no trained router: just rules you can read.

### Money

- **The paid question.** The first time golem wants a paid model in a session, it asks. It names the model, the reason, and the estimated cost. If you allow it for the session, later steps up happen without asking, inside your caps. The setting is `[routing] paid`: `ask`, `always_ask`, or `never`.
- **Caps.** `[budget] daily_usd` and `session_usd`. When a cap is spent, golem stays on the local model (`over = "local"`) or asks you (`over = "ask"`).
- **What each answer costs.** Tokens and cost show under every answer, so you see what was spent as it happens. A cost is saved at the price of that day, so old numbers do not change when prices do.
- **`/cost`.** Spend and tokens for today, this week and this session, then by model.

### A small window that lasts

A context window is the number of tokens a model can read in one call. Everything you want it to know, the chat, the tool results and the system prompt, has to fit. [Context](../architecture/context.md) explains how it works today.

A local model has a small window, and a long session fills it. golem keeps it useful with a ladder. It starts at the top and goes down only when the rung above was not enough.

| Rung | What golem does | Costs |
|---|---|---|
| 1. Check | Estimates the prompt before sending. A prompt that would be cut is never sent | Nothing |
| 2. Plan the window | Picks one window for each local model that fits your memory, and sends the same number on every call | A model reload, when it changes |
| 3. Size tool results | A big window allows a big tool result; a small one does not | Nothing |
| 4. Clear | At `clear_at` full, replaces old tool results with one line each, down to `clear_to` | Nothing |
| 5. Summarise | At `compact_at` full, summarises the old turns and keeps the last `keep_turns` | One model call |
| 6. Step up | Sends the turn to a model with a bigger window, with your consent | Paid |
| 7. Delegate | A helper reads in its own fresh window and returns a short answer | Local calls |

Clearing comes before summarising because it is free and keeps the facts that matter, while a summary costs a call and can lose detail.

The settings are in `[context]`: `window`, `reply_reserve`, `clear_at`, `clear_to`, `compact_at` and `keep_turns`.

### Nothing is deleted

The transcript and the stored history stay whole. golem does not remove a message to make room. It builds what it sends from a view of the history, with old tool results cleared and old turns summarised. You can still scroll back to everything, and the trace shows exactly what was sent.

### Seeing it work

Each answer ends with its time, the model, why golem moved, tokens and cost:

```
✓ 2m 04s · ↑ deepseek-chat (did not fit in 32K) · 41.2K tok · $0.012
```

When golem clears or summarises, it says so in one quiet line:

```
golem cleared 12 old tool results · ctx 71% → 38%
summarised 9 earlier turns with qwen3:8b · ctx 84% → 31%
```

The terminal status line gains the route, a context bar and the session cost. The bar turns amber from 80%. The web UI shows the same in the composer: a route chip and a context chip.

```
qwen3:8b · auto · ctx ▇▇▇▁▁▁▁▁ 38% · $0.03
```

The paid question appears above the input, in the terminal as a band and in the web UI as a card:

```
 Use a paid model for this?
 This turn does not fit qwen3:8b's 32K window, even after clearing old results.
 deepseek-chat · budget · ≈ $0.02 for this turn
 Session cap $0.50 · today $0.42 of $2.00
 Stay local: golem summarises the chat and continues on qwen3:8b.
  a  allow for this session   o  once   l  stay local
```

`/route` shows the route, the ladder, the caps and what was spent:

```
route: auto

ladder
  local     qwen3:8b        ready · free
  budget    deepseek-chat   ready · $0.28 / M in
  frontier  a hosted model  needs key

caps
  today    $0.42 of $2.00
  session  $0.03 of $0.50

p pinned · l local · a auto · esc close
```

`/cost` shows the spend:

```
cost
                 in      out      cost
today          212.4K   14.1K     $0.42
this week        3.3M  149.7K     $2.10
this session    102.4K    5.4K     $0.03

by model (this week)
qwen3:8b      local      1.62M   96.0K     $0.00
deepseek-chat budget     1.10M   24.3K     $0.52

saved ≈ $3.40 by running locally
```

In the web UI, spend is under Settings, Usage. The reason for a pick is in the trace, as a table of the models golem considered and why each was kept or dropped. The routing settings are under Settings, Routing, and in `config.toml`. The context chip opens a popover with the actions: clear, summarise, grow the window, use a larger model.

### Replaying recorded sessions

`golem eval routing` answers "what would my work have cost on `auto`?" from the sessions already stored on this Mac. It does not call a model. Each session's events say how big every model call was (the system text, the tools, each message), how many tokens came back and what it cost. The command goes through those calls again and runs golem's decisions on them: which model the pick chooses, which tool results are cleared, when old turns are summarised, whether the prompt fits, and whether a struggle of a local model would have sent the run to a stronger one. A summary adds the cost of its own call.

It prints three scenarios and what really happened:

```text
14 days · 37 sessions · 1,912 model calls
                  cost    cut prompts  step-ups  peak ctx
pinned frontier   $41.20  0            –         9%
pinned local      $0.00   212          –         100%
auto              $1.84   0            23        78%
as it really ran  $0.00   187
```

The numbers above only show the shape of the report. Run the command to get the real ones. `--days` sets how far back to look and `--session <id>` replays one session.

When a session started helpers, the report lists each one under the table: the agent, its wish, the model it ran on and why (as recorded), and the model `pick_helper` gives now on the models that are ready, so a local-only and a cloud-only setup each show their own picks. A pick that is paid, in a chat that has not agreed, says "asks first". A folder that stays local is not in the events, so the list does not apply it.

What it cannot say:

- A stronger model would have made different calls, with fewer retries or a shorter way to the answer. The report estimates cost and cut prompts, not quality.
- Tokens are estimated from characters with the ratio the session itself showed, so another model's tokenizer can differ.
- A call recorded before sizes were stored, and a call that failed, are left out. The report counts them.
- It holds counts and money, never message text.

### What comes later

- **Plan on a big model, work on a local one.** A big model writes a short plan, which costs a few cents. A local model carries it out. The big model may check the result.
- **Helpers in parallel.** A helper with a fresh window is the first step toward [sub-agents](./sub-agents.md), where golem splits a big job into small ones.

For status, see [Phase 9 (#110)](https://github.com/MilanPavel/golem/issues/110).

---
