---
title: Helpers
description: What a helper is, when golem starts one, the agents that come with golem and your own, what helpers cost, how a worker's changes reach your folder, and what differs with local models only, cloud models only or both.
---

# Helpers

A **helper** is a second agent that golem starts for one job and that gives back one answer. golem does the work in the chat by default. A helper is for the few jobs where that goes wrong: the reading would fill the window, several jobs can run at once, or another model fits the job better.

This page is about using helpers. For how they are built, see [How helpers work](../architecture/helpers.md). To check the numbers behind "when" on your own Mac, see [Measure](./measure.md).

## What a helper is

A helper is a **child session**. It has its own chat, its own model and its own steps, and it belongs to the chat that started it, the **lead**. It is not a row in your session list. In the lead's chat it shows as a card: what it was asked, which model it runs on, the steps it takes, and its answer. Open the card to read its chat. You can also continue it as a chat of your own ("Continue as chat"); that makes a new, ordinary chat and leaves the helper and the lead as they were.

What a helper does is bounded:

- It starts with an empty context. It gets a brief, not your chat.
- It has its own limits: model calls, working time, and optionally cost and tokens.
- It never has more rights than the lead. Its tools, folders and permission mode are the lead's or fewer. A helper cannot start helpers.
- What it returns is data for the lead. It is never an instruction about permissions.
- It never writes memory. It may propose; you or the lead decide.

When the lead starts helpers, it **waits** for them. Nothing runs in the lead meanwhile and it holds no model, so a waiting lead costs nothing. When the helpers have ended, the lead goes on with their answers.

## When golem uses helpers

The lead decides, not golem. The lead is told when a helper can fit, in a short note in its prompt, and it chooses. Settings › Agents › Rules has the control **Use helpers**:

| Setting | `[agents] use_helpers` | What happens |
|---|---|---|
| **When needed** | `when_needed` (default) | The lead is told the reasons below and decides. golem asks nothing |
| **Ask me first** | `ask` | Every `delegate` call waits for your yes or no before a helper starts. A no tells the model to do the work in the chat |
| **Never** | `never` | The model is not offered helpers at all, and golem does not nudge it |

A change applies to the next message, with no restart. "When needed" is advice to the model, not a rule: a model may start a helper when it should not, or work alone when a helper would have been better. That is what [Measure](./measure.md) is for.

There are three reasons, and the lead says which one applied:

| Reason | Means |
|---|---|
| **It would not fit** | The reading is too big for the window, or would crowd out the task |
| **Jobs that can run at once** | Several independent jobs, each big enough to be worth its own helper |
| **A different model** | One hard question goes to a stronger model, or a large read goes to a cheaper one |

A chain of steps with a fixed order (find, then fix, then check) is not a reason. The lead does that itself, or you write a [workflow](./workflows.md).

How big is "too big" is set by four numbers that are shares of the window and a price ratio, never a count of tokens, so one setting fits a 32K local model and a 1M cloud one. They are in `[agents.delegate]` ([Settings](./settings.md#agentsdelegate)) and shape what golem suggests. They never decide whether a helper may run; "Use helpers" does that.

golem also gives the lead two nudges, each once per message of yours, and only with "Use helpers" not set to Never:

- **Fill nudge.** While the lead is reading and its window is past `fill_share` (85% by default), golem tells it to hand the rest of the reading to an `explorer`. With "Ask me first" there is no nudge, because every helper asks you anyway.
- **Struggle nudge.** When the lead seems stuck (a tool call it keeps getting wrong, the same call again and again, an empty reply, an answer cut off), golem tells it to put one question to the `advisor` before anything else, and to go on with the answer.

## The agents that come with golem

An **agent** is a type of helper. golem ships four. Settings › Agents lists them, with the model each uses now and why, and how often each ran in the last 30 days. `/agents` in the terminal does the same.

| Agent | For | Tools | Model it wishes for | Asks you |
|---|---|---|---|---|
| `explorer` | Reading and searching many files, and returning the paths and lines that matter | Read only | Cheapest | Never |
| `reviewer` | Reading your change with fresh eyes before you call it done. It is handed the lead's diff (`gets: diff`) | Read only | Stronger | Never |
| `advisor` | One hard question, answered from the brief alone | None | Stronger | Never |
| `worker` | One change of several that do not depend on each other, in its own copy of the folder ([below](#workers-and-their-copies)) | Read, write, shell | Cheapest | Yes |

Each agent says what it wishes for, not a fixed model, so it works on any setup. See [the three setups](#the-three-setups). You change the wish of a bundled agent in Settings › Agents or with `w` in `/agents`. golem writes `[agents.<name>] model` for you.

An agent that changes files is **not available** when the chat has no folder or the folder is not a git checkout. The agent list says "not yet" with the reason, and `delegate` refuses it with the same reason, so the model can go on without it.

## Your own agents

An agent is one Markdown file: a header, then the prompt in plain words. It is read the way a [skill](./skills.md) is.

```markdown
---
description: Reads the tests of a change and says what they do not cover. Use it before a pull request.
model: stronger
tools: read_file, grep, git_diff
gets: diff
max-calls: 15
max-seconds: 300
asks: false
---
You read a change and its tests. Say which behaviour the tests do not cover. Do not change anything.
```

Where files live, highest first:

| Where | Notes |
|---|---|
| `.golem/agents/` in the project | Read only when you have trusted the project, because a file picks tools and a prompt |
| `~/.golem/agents/` | Yours, on this machine. Folders in `[agents] extra_dirs` come after it |
| Bundled | The four above. A file of the same name in either place above replaces it |

Save a change and the next helper uses it, with no restart. A helper already running keeps the file it started with. A file with a problem never hides a working one of the same name, and Settings › Agents shows the problem with its line.

The header takes these keys:

| Key | Means |
|---|---|
| `name` | Optional. The file name decides it: lowercase letters, digits and single hyphens. If you write one, it must match |
| `description` | Required. The lead reads it to pick this agent, so say what it is for and when to use it |
| `line` | Optional. A few words (up to 120 characters) the lead's prompt shows for this agent. Left out, the first sentence of `description` is used |
| `model` | The wish: `cheapest` (default), `same`, `stronger`, `local`, `budget`, `frontier`, or a model name |
| `tools` | The tools it may use, as text or a list. Left out means none. A tool must be one of golem's |
| `gets` | What golem hands it at the start. Only `diff` for now: the lead's change set, as an artifact the helper reads with `read_artifact` |
| `max-calls`, `max-seconds`, `max-cost-usd`, `max-tokens` | Limits ([below](#limits-and-costs)) |
| `max-answer-chars` | The most characters of its answer. A longer one is kept as an artifact the lead can read |
| `asks` | `true` if it may ask you a question. Default `false`: an ask becomes a refusal |

In the web app, **+ New agent** writes the file for you from a template, and **Make my own copy** copies a bundled agent so you can change it. The advisor must have no `tools` line. Every key is in [Settings](./settings.md#agents).

## Batches and how many run at once

The lead starts helpers with one `delegate` call, for one helper or for a **batch** of several. A batch has no order and no plan: each helper gets its own brief.

- `[agents] max_per_batch` (default 3) is the most helpers one message of the lead may start. More is refused with a message the model reads, and it sends fewer.
- `[agents] at_once` (default 3) is how many of a lead's helpers run at the same time. The rest wait their turn.
- The advisor has its own limit, `[agents.advisor] max_per_message`, 1 by default.

A helper that waits shows why. The card says:

| Reason | Means |
|---|---|
| **team** | The helper waits for a turn: `at_once` of its lead's helpers already run |
| **budget** | A `[budget]` cap is spent. The card shows the amount spent and the cap. The helper starts when the cap allows it, and the helpers behind it may start first |
| **slot** | Its model runs other calls up to its limit. The card says where it stands in the line |
| **provider** | The provider asked golem to back off. The card shows how long |

A local model runs one call at a time by default, so several helpers on one local model take turns. That is slower than one helper, not broken. See [Talking to models](../architecture/models.md#helpers-and-the-dispatcher). Time spent waiting for a slot, a provider or you does not count against a helper's time limit.

## When a helper asks you

A helper that is allowed to ask you (`asks: true`, such as the worker) can stop for an approval, like the lead can, or for the [paid question](./models.md). The question shows in the lead's chat, in the Inbox and in a notification, and it names the helper that asks. Answer it where you are. A helper that waits for you holds no model and no slot.

A tool approval has three scopes:

| Scope | Allows |
|---|---|
| Once | This one call |
| This helper | The same kind of call for the rest of this helper's run. It ends with the helper |
| All helpers of this batch | The same call in each helper of the batch that has not finished, and answers the ones that already ask it |

"Always" stays in your tool rules, as for any tool. What you allow a helper by answering is yours to give, and it never reaches the lead. If several helpers ask the same question, you see it once with a count.

With **Ask me first**, the question comes before any helper starts: a card lists the helpers it wants to start, each with its agent, label and brief. **Run** (Enter) starts them, and **Do it in the chat** has golem do the work in the chat.

## Limits and costs

Each helper has limits. When one is reached, the helper stops and writes what it found and what it did not cover into its answer. The lead's result starts with `<agent> finished: <reason>`. The reasons:

| Reason | Means |
|---|---|
| `calls` | `max-calls` model calls were used. The default is 15. The helper makes one last call without tools to write its answer |
| `time` | `max-seconds` of working time passed. Waiting for you, a slot or a provider does not count. This stop is hard: the run is cancelled |
| `cost` | The helper spent `max-cost-usd`. A local model has no price, so this never fires on one |
| `tokens` | It used `max-tokens` (input and output), or its calls took in more than 8 times its model's window |
| `budget` | A cap in `[budget]` was spent before one of its paid calls |
| `cancelled` | You or the lead stopped it |
| `failed` | A model call failed |

The order of precedence for a limit is `[agents.<name>]` in `config.toml`, then the agent file, then `[agents]`, then the built-in default. Settings › Agents › Rules has "Limits for every helper" and Edit on each agent.

What a helper costs is counted like any other call. It counts against the same `[budget]` caps as the chat. `golem cost` and Settings › Usage list it as `helper` under "by job", and the lead's cost line includes its helpers.

Before a large batch on a **paid** model, golem shows an **estimate card**. It shows when the estimate is above `[agents] estimate_over` (US$0.25 by default), whatever "Use helpers" says. It names the model, says "About $0.60 of the $2.00 you allow per message", and offers **Start**, **Use a cheaper model** (when there is one) and **Do it in the chat**. The estimate is a guess from the briefs, the limits and the model's price. It decides only whether to ask. It is not a cap. A batch of local helpers costs nothing and shows no card, and neither does a batch where the paid question is asked anyway. `[agents] per_message_cost` (US$1.00 by default) is the amount the card compares with. It is not enforced as a hard cap yet. What stops a helper that spends is its own `max-cost-usd` and the `[budget]` caps.

The lead has a limit too: `[chat] max_model_calls` (25 by default) is the most model calls one message may make. When 3 are left, golem tells the model to wrap up, and the last call has no tools, so the answer comes from what it found. Time the lead spends waiting for helpers is not a model call.

A finished helper keeps its steps for `[agents] keep_days` (7). One that failed, was cancelled or asked you something keeps them for `keep_problem_days` (30). After that only its brief, its answer and its end stay. Its cost, its runs and the lead's chat do not change. 0 keeps them for ever.

## Workers and their copies

A **worker** is a helper that changes files. It never works in your folder. golem makes it a **copy** and the worker edits there, so your folder stays as it is until you decide.

- **A git folder is needed.** The copy is a git worktree of your project at `HEAD`, with your uncommitted changes laid on top. A folder that is not a git checkout gets no worker, with the message "workers need a git folder; this one is not".
- **Where.** `~/.golem/copies/<helper id>`. Ignored folders such as `.venv` and `node_modules` are not copied, so the project's checks install what they need in the copy.
- **What comes back.** When the worker ends, golem takes its diff against the start of the copy and runs the project's checks in the copy, in the shell sandbox. The result is the files it changed with their line counts, and `passed`, `failed` or `none` for the checks. `none` says why: no checks found, checks are off, the sandbox is not available, or a check timed out. See `[coding] checks` in [Settings](./settings.md).

The **Changes** tab of the web app shows a block for each worker, above the files, with its status (Working, Checks pass, Checks fail, Stopped, Applied, Discarded) and its diff stat. The footer says "in copies · nothing in your folder has changed" until you apply.

| Action | What it does |
|---|---|
| **View** | Shows the worker's diff in the diff view |
| **Apply** | Writes the worker's files into your folder as ordinary changes, and removes the copy |
| **Apply the green one** (or "Apply the 3 green") | Applies every worker whose checks passed, one after the other |
| **Try again, stronger** | Runs the same brief again on a stronger model, in a fresh copy, and discards the first |
| **Discard** | Drops the diff and removes the copy |

Some rules for Apply:

- **Conflicts.** If a file the worker changed has changed in your folder since the copy was made, nothing is written. The block says which file: "`src/app.py` changed since the worker copied it". Discard, or try again, or take the change by hand.
- **Not while the lead works.** Apply is refused while the lead has a run going. Wait for it to end.
- **Undo.** An applied worker is a set of changes with the source `helper`, all in one run, so Undo in the Changes tab (or `U` on a file in `/changes`) puts them back. A file that is not UTF-8 text is written but cannot be undone this way.

In the terminal, `/changes` shows the workers above the files. `tab` moves between the workers and the files. With the workers selected, the keys are `↑` `↓` to choose, `v` view, `a` apply, `A` apply the green ones, `r` try again stronger, `x` discard and `esc` back.

**Clean-up.** Applying or discarding removes the copy. Closing the lead removes all of its copies, and so does a golem restart for any copy whose lead is closed or gone. A copy whose lead is still open is kept, because it may hold a diff you have not looked at. A closed worker keeps its copy until you apply or discard it, or close the lead.

## The three setups

Helpers work with local models only, with cloud models only, and with both. Nothing needs a local model and nothing needs a hosted one. The agents ask for a wish, and golem turns it into a model from what you have.

| Wish | Local models only | Cloud models only | Both |
|---|---|---|---|
| `cheapest` | The lead's own loaded model | The cheapest hosted model that can use tools | The cheapest ready model at or below the lead's tier. A loaded local model comes first |
| `same` | The lead's model | The lead's model | The lead's model |
| `stronger` | The lead's model in a fresh window (there is no stronger one) | The tier above the lead's. From the top tier, the lead's model in a fresh window | The tier above the lead's |
| A tier or a model | That one if it is ready, else the nearest tier you have | The same | The same |

What differs:

- **The paid question.** With local models only, a helper never goes to a paid model, so nothing is asked. With both, a helper that would go to a paid model from a local lead asks the paid question at the first paid call of the chat. It says what is sent (the brief, not the chat), what is not, and the cost. A "no" runs the helper on a local model in a fresh window. A chat that is already allowed to use paid models is not asked again. With cloud models only, nothing is asked: you already chose to pay, and the estimate card and the caps guard the cost instead.
- **Privacy comes first.** In a folder marked local only, or a chat on the `local` route, every helper is local, whatever its wish says. A paid wish becomes the same local model with a fresh window.
- **A fresh window is not a stronger model.** A "stronger" helper on a local-only setup is the same model with an empty context. It helps when the lead's window is full. It does not make the model smarter.
- **Speed.** Local helpers take turns on one model by default. Cloud helpers run side by side, up to `at_once`.
- **Naming a model.** The lead may name the model of one helper. The name is only a wish: if it is unknown or not allowed, the helper runs on what the rules give and its card says why.

## Where to look

| What | Where |
|---|---|
| The agents, the rules and the numbers | Settings › Agents (Agents, Rules and Measure tabs), or `/agents` |
| Every key | [Settings](./settings.md#agents) |
| What a helper did | Its card in the chat, then its own chat |
| What helpers cost | `golem cost`, Settings › Usage |
| Whether the numbers fit your Mac | [Measure](./measure.md) |
| How it works inside | [How helpers work](../architecture/helpers.md) |
