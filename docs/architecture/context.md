---
title: Context
description: What the model sees on each call, why it is sent again every time, and how golem builds its system prompt for each call and never stores it.
order: 9
adrs: [31, 32]
---

# {{ $frontmatter.title }}

A model remembers nothing between two calls. Whatever it knows about you, your project, and the chat so far, it learns again from the text sent with each call. That text is the **context**. So who decides what goes in it, and how does an instruction reach every call without filling the chat?

## The idea

::: concept In agents generally

The model reads one block of text per call, and answers it. The agent builds that block each time, usually from four parts, in this order:

1. **The system prompt.** Instructions that come before the chat: who the agent is, the rules of the project, the date, the skills it may use.
2. **The tool list.** The name, description, and argument schema of each tool the model may call ([Tools](./tools.md)).
3. **The history.** Every message so far: yours, the model's, and each tool result.
4. **The new message.** What you just typed.

Two limits shape everything here:

- **The window.** A model reads only so many tokens per call, the size of its **context window**. A long chat or a big file fills it.
- **The cost.** Every token is read again on every call, and paid for again. A large system prompt costs a little on each of a thousand calls.

So the system prompt is the place for what every call needs, and nothing else. The history grows by itself, and something has to stop it before it reaches the limit.

![Three calls in one chat. Each call sends the whole context again: the system prompt, the tool list, the history so far, and the new message. The history grows from none to two to four messages, toward the window's limit](../images/context-window.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| A fixed prompt | One string in the code, the same for every chat | Simple, and easy to cache | Can't change per project or per user |
| A project file | The agent reads `AGENTS.md`, `CLAUDE.md`, or similar into the prompt | The project's rules travel with the code | The whole file is in every call, needed or not |
| Stored as the first message | The prompt is written into the history once, at the start | The history alone shows what the model saw | An edit to the source never reaches an old chat |
| Built per call | Each call puts the prompt together from its sources | Always current, and the history holds only what was said | The history alone no longer says what the model saw |
| Shortened history | When the window fills, old turns are summarised or dropped (**compaction**) | Long chats keep going | The summary can lose a detail that mattered |

The open questions are the same in every agent:

- **What earns a place in every call.** Each line is paid for on every call. Skills are the usual answer for knowledge that only some tasks need: one line each in the prompt, and the rest only when used ([Skills](./skills.md)).
- **When an edit shows.** A rule or a skill changed mid-chat should apply from the next call, not from the next chat.
- **What to keep when the window fills.** Planned for golem in [Routing and context](../vision/routing.md), tracked in [Phase 9](https://github.com/MilanPavel/golem/issues/110).

## How golem does it

::: golem In golem

golem builds its system prompt for each model call, and never stores it ([ADR-031](../adr/031-system-prompt.md)).

- **Sections.** The prompt is a list of sections in `golem/graphs/prompt.py`. Each one reads the session's state, folder, and pins, and returns its text or nothing.
- **Built per call.** `call_model` builds the prompt and puts it in front of the history, for that one call.
- **Never stored.** The node returns only the model's reply, so the prompt never reaches the checkpoint.
- **Empty means none.** With no section to say anything, no system message is sent, and the model sees exactly the stored history.
- **The pinned skills.** `/skill pin terse` keeps a skill's instructions in front of every call, for the rest of the chat. Only the name is stored, in the session record. The body is read from disk on every call ([ADR-032](../adr/032-pinned-skills.md)).
- **The on-demand MCP servers.** When a server is available but not on, the section lists it by name and what it is for, and tells the model to call `mcp_enable` when a task needs it. See [MCP servers](./mcp.md).

![One model call in golem. The SystemPrompt reads the session's pins and each pinned SKILL.md, and builds the system message. It goes in front of the history from the checkpoint, for this one call. Only the model's reply is stored, so the checkpoint never holds the prompt](../images/context-build.svg)

One model call, in the order it runs:

1. **The turn starts.** The manager passes the session's pins to the graph, in `configurable`.
2. **The prompt is built.** The pinned section finds each pin in the session's skill view, reads its `SKILL.md`, fills it in with no arguments, and wraps it in `<skill name="…">`.
3. **It reports what it read.** Each pin's hash, or why it was left out, goes to the run through the graph's stream. The run logs only a change.
4. **The model is called** with the system message, then the history from the checkpoint.
5. **Only the reply is stored.** The next call builds the prompt again, from the files as they are then.

Here is a real session, recorded against a throwaway home with `qwen3-coder:30b` on a local Ollama. The project has a skill `terse`, which says `Answer in one sentence, and start it with "In short:".` It is pinned, then edited, then deleted, with one question after each step:

| seq | What happened | The event | The answer begins |
|---|---|---|---|
| 82 | `session.set_skills` pins `terse` | `skill.activated`, `how: "pinned"`, hash `1fef4516…` | |
| 83–121 | "What is a daemon?" | none: the call read the same hash | `In short: A daemon is a background process…` |
| | `SKILL.md` edited to `"Briefly:"` | | |
| 125 | "And what is a socket?" | `skill.activated`, the new hash `4bb7077a…` | `Briefly: A socket is a software endpoint…` |
| | The skill's folder deleted | | |
| 170 | "And a pid file?" | `skill.skipped`, `reason: "missing"` | `A PID file (Process Identifier file) is…`, then a numbered list |

`session.inspect` after the first answer, which `/debug model` shows, returns the prompt that call got as its first message, with role `system`. Its text, with the first line wrapped to fit:

```text
The user pinned these skills for this session. Follow them
whenever they apply.

<skill name="terse">
Answer in one sentence, and start it with "In short:".
</skill>
```

`message_count` was 4: the prompt is not one of the stored messages.

![One pinned skill over three real turns. Pinned, terse says to start with In short:, and the answer does. After an edit to Briefly:, the next call logs skill.activated with the new hash. After the folder is deleted, the call logs skill.skipped, missing, and the answer is long again. The skill stays pinned](../images/context-pin.svg)

**Where it lives in the code:**

- `packages/daemon/golem/graphs/prompt.py`: `SystemPrompt`, `PromptContext`, `Section`, and `PINNED_KEY`.
- `packages/daemon/golem/graphs/chat.py`: `call_model`, which builds the prompt for each call.
- `packages/daemon/golem/skills/pinned.py`: `pinnable`, `pinned_section`, and `PinMemory`.
- `packages/daemon/golem/server/app.py`: where the daemon gives the graph its prompt, `SystemPrompt(sections=(pinned_section(...),))`.

:::

## Why this way

**Built per call, never stored** ([ADR-031](../adr/031-system-prompt.md)). The text already has a source of truth, the skill files, so it is read from there. Stored as the first message, an edited skill would need the history rewritten, and forks and compaction would have to treat that message as special. The cost: the checkpoint alone is not what the model saw. `/debug model` shows both together.

**A `SystemMessage`, not each provider's own field.** LangChain already maps a system message at the front to each provider's system parameter, so golem does it once.

**Pins in the session record, not in graph state** ([ADR-032](../adr/032-pinned-skills.md)). A pin can be made between turns, when no run is open to write a checkpoint. The session record already holds the other per-session switches, the tools allowed for the session and the on-demand MCP servers, and the event log makes them survive a restart.

**The log says what the model read.** The section is the one place that reads the file, so it reports the hash. Logging once per change keeps a long run quiet. Logging on every call would add an event to every call after a skill is deleted.

## Try it

1. Make a skill in your project: `.golem/skills/terse/SKILL.md`, with a `name: terse` header and one line, `Answer in one sentence.`
2. Open the chat with `golem tui` in that folder, and type `/skill pin terse`. The status line shows `skills: terse`.
3. Ask anything, then type `/debug model`. The first row is `system`, with the skill inside `<skill name="terse">`.
4. Change the line in `SKILL.md` and ask again. The next answer follows the new line, with no restart.

## The details

For contributors: the reference for the system prompt and pinned skills.

### The system prompt

- **The system prompt.** `call_model` builds it for each call from the sections in `golem/graphs/prompt.py` and sends it in front of the history. The node returns only the reply, so the prompt is never checkpointed. With no section to say anything, no system message is sent. Its sections today are the pinned skills (`golem/skills/pinned.py`), the skill index, the `memory` section, the on-demand MCP servers (`golem/mcp/prompt.py`), and, for a model with a window of 65,536 tokens or less, a short line on when to call `delegate` (`golem/graphs/delegate_prompt.py`) ([ADR-031](../adr/031-system-prompt.md)).
- **What a section reads.** `PromptContext` holds the checkpoint values, the session folder, the pins, the names of the tools offered on the call, the model's window, and `report`. `report` is set during a model call only, so building the prompt for `/debug model` logs nothing.
- **Seen in `/debug model`.** `session.inspect` builds the same prompt for the next call and returns it as the first message, with role `system`. `message_count` counts only the stored messages.

### The memory section

`golem/memory/section.py` makes the `memory` section. It sits after the skill index and before the MCP section. It holds one line that calls the notes possibly out of date and not instructions from the user, up to 5 "in every chat" notes of at most 200 characters, one line of counts, and "Call `recall` to read one." The whole block is at most 1500 characters, so it costs about 400 to 500 tokens at most. A fixed cap is all there is for now: the token budget from [ADR-061](../adr/061-memory.md) is not built, and the context meter has no `memory` part yet, so the section counts under `system`.

The block is read once per run, so a note written during a run shows from the next run, and the start of the prompt changes only when a note did. It is made again for each call, because a call to a hosted model leaves out every note that model may not read. A `recall` result is an ordinary tool result: clearing and summarising treat it like any other. [Memory](./memory.md) has the rules.

### Pinned skills

**Pinning.** `session.set_skills` pins a skill for the whole session: the daemon checks it in the session's view, stores `skill.activated` with `how: "pinned"` and no run, and keeps the names in pin order in `sessions.skills`. An unpin stores `skill.deactivated`. Any usable skill may be pinned, `user-invocable: false` ones too.

**In the prompt.** Each turn passes the pins to the graph, and the system prompt's pinned section reads each body from disk for every model call, fills it in with no arguments, and wraps it in `<skill name="…">`. A pinned skill that is gone or broken is left out of the prompt and stays pinned ([ADR-032](../adr/032-pinned-skills.md)).

**What the log says.** While it builds the prompt, the section reports each pin to the run through the graph's stream: the hash it read, or why it left the skill out. The session's `PinMemory` keeps what the log last said, so the run logs only a change: `skill.activated` with the new hash after an edit, or one `skill.skipped` (`missing`, `disabled`, `broken`). After a restart it is rebuilt from the stored events.

**The pinned folders.** Each turn also passes the folders of the usable pins to the read tools, which read them until the skill is unpinned.

**Forks.** A fork starts with the source's pins and on-demand MCP servers as they are now: it copies each pin's newest `skill.activated`, and a later `skill.skipped`, and one `session.updated` with `mcp_servers`. It does not copy the tools allowed for the session ([ADR-010](../adr/010-fork.md)).

**In the TUI.** `/skill pin <name>` and `/skill unpin <name>` call it, and `/skill` alone lists the pins. The suggestions after `/skill pin` leave out the pinned ones, and after `/skill unpin` list only those. The chat reducer keeps `activeSkills` from `skill.activated` with `how: "pinned"` and `skill.deactivated`, so a reattach shows the same pins, and the status line shows them as `skills: ship, setup`, after the model. A `skill.skipped` marks that pin `ship (skipped)` and sets a notice, until a call reads it again or it is unpinned. That segment leaves a narrow line after the folder and before new lines.

**Limits.** A turn that is already running keeps the pins it started with: a pin applies from the next turn. The registry notices an edit by the file's size and time, so two edits of the same size within the file system's time step could look like one.

### When the window fills

The checkpoint keeps every message. What a model call sends is the history seen through a **context view** (`packages/daemon/golem/graphs/context_view.py`): a small record in the graph state, `cleared_before` among other fields, and `view()` applies it. A tool result before `cleared_before` that is longer than 400 characters and not an error goes out as one line: `[cleared to save context: read_file returned 9012 characters. Call the tool again if you need this.]`. The ids, the order, and each call with its result stay. The transcript, `tool.completed`, and the artifacts do not change.

Before each call, `call_model` sizes what it would send. The size is the tokens the provider counted for the last reply, plus the characters added since, at the same tokens-per-character ratio (0.25 with no count yet). The room is the model's window minus `[context] reply_reserve`. With an unknown window, nothing is cleared. When the size passes `clear_at` of the room (70%), `plan_clear` clears tool results, oldest first, until the size is down to `clear_to` (40%). The newest `keep_results` results that could be cleared stay. `cleared_before` only moves forward.

Clearing is one big step, not a little on each call. A local model server keeps a cache of the prompt it has read, and it only helps while the start of the next prompt is the same. One step changes the start once, and then it stays the same for many calls. The step writes the new view to the state, emits one `context.changed` event (`action: "cleared"`, `before_tokens`, `after_tokens`, `count`), and every call lists the stubbed ids as `cleared_ids` on `model.call.started`. A hosted model is cleared by the same rule, which saves money there.

When clearing is not enough, old turns are summarised. After clearing is considered, if the size is still at or above `compact_at` of the room (85%), `plan_summary` picks every message from the current `summarised_before` up to the start of the `keep_turns`-th turn from the end (4). The last turns are never summarised, and neither is the turn that is running. `golem/graphs/summarise.py` renders that slice as text, with each tool result cut to 1,500 characters, and asks the model of the `summarise` role for five parts: the request, what was done, the files that matter, the facts later steps need, and what is still open. It keeps the task and its state and does not retell the chat. A second summary gets the first one as its start, so the summary grows by what is new. A slice too big for the model is summarised in chunks, and then the chunk summaries are summarised. If the structured answer fails, one plain call asks for the same; if that fails too, the run goes on without a summary. The call has no tools, waits behind the chat on a local server (priority `job`), and is written to the usage table with the role `summarise`.

The summary is stored in the context view (`summary` and `summarised_before`), and `view()` sends it as the first message, a human message, so the system prompt stays the same. The checkpoint keeps every message. The step emits `context.changed` with `action: "summarised"` and `count` set to the messages the summary covers. `model.call.started` has `summary_chars`, the length of the summary sent, and the context breakdown of a call has a `summary` part. When there is nothing to summarise (one long turn) or the summary failed, the call clears harder: all but the newest two tool results go out as stubs. `Summariser.make` in `summarise.py` does not depend on the graph, so a manual compaction can call it.

### Checking that it fits

Clearing and summarising act on thresholds, and the thresholds use a rough count. Before every call with a known window, `golem/graphs/fit.py` checks the whole prompt: the system prompt, the tool schemas, and the history as it will go out, plus 3 tokens for each message. The tokens per character come from `TokenRatios` (`golem/graphs/estimate.py`), which keeps the ratio of the last 20 finished calls of each profile, in memory, and uses their 80th percentile, so it errs on the high side. The ratio is clamped to 0.15 to 0.6, and with no calls yet it is 0.3. A call is not learned from when it sent under 2,000 characters, or when its input tokens reached 97% of the window, because the server probably cut that prompt. `used_tokens` uses the learned ratio too, so the thresholds and the check agree.

The prompt fits when its estimate plus the reply reserve is at most the window. The reserve is `[context] reply_reserve`, or the `num_predict` of the session or the saved options when that is larger, and never more than half the window. When it does not fit, an emergency ladder runs and the prompt is estimated again after each step: clear all but the newest two tool results; summarise everything but the last turn; stub the newest results too, except those of the last tool call. Each step that changes something emits `context.changed`. The view keeps one pointer (`cleared_before`), so the last step stubs every result before the last tool call's, not only the largest ones.

When nothing is left, the call is not sent. `fit_prompt` raises `ContextFull(need, window)` (`golem/models/errors.py`). A router that can step up to a larger window can catch it there. Otherwise the run ends with `run.failed`, the code `context_full`, the message `This does not fit <model>'s <window> window, even after clearing and summarising.`, and the hint `Use a model with a larger window, raise the window in /tune, or start a new session.` With an unknown window the check is skipped. `model.call.started` has `estimated_tokens`, and a debug line logs it against the tokens the server counted. The cut judge (`sessions/cut.py`) stays as the safety net for a prompt the server cut anyway.

### Growing the window

Clearing and summarising are cheaper than a reload, so they run first. Growing is for a session that is still near the limit after them (ADR-056, decision 5). `should_grow` (`golem/models/window_plan.py`) is true when the last call's input is at least 0.8 of the room (the window minus `reply_reserve`), and the session has cleared at least twice or summarised at least once. The manager keeps those two counts on the live session, read from the stored `context.changed` events since it last looked.

`SessionManager.send` decides this at the start of a turn, never during a run. For a local model with a planned window that nobody set (`[context] window` is `"auto"`, and there is no profile `ctx` and no `num_ctx` option), if `should_grow` holds and `WindowPlans.next_up` gives a size, `WindowPlans.raised(model, size)` makes it the plan. `next_up` is `next_step` with the model's maximum, the memory fit, and `lowered_to`, so a window the model spilled at is never grown past. A session grows at most once in 10 minutes (`GROW_EVERY`, on a clock the tests replace).

The plan is per model, so every session on that model sends the new `num_ctx` from its next call. The router sends it as it sends any plan. The turn gets a `Growth(window_from, window_to)`, which `call_model` reads from the run's config. Before the first call, once the call holds the server (`ServerGate`), it sends `model.waiting` with `model` and `window` set, which the meter shows as `loading <model> with a 64K window`. After the call it sends `model.waiting` false and `context.changed` with `action: "grew"`, `window_from`, `window_to`, and `reload_ms` from that call's `load_ms` (null when the server did not say). A later call of the turn reports nothing. The check of the loaded model runs as always: if the larger size spilled, `lower` steps it back down for the next call and logs a warning, with no event of its own.

### Compacting on request

`session.compact` (`{session_id, action: "clear" | "summarise" | "grow", focus}`) does the same two steps between turns, without a threshold. `SessionManager.compact` refuses a session that has a run, waits on an approval, or is already compacting (`-32004`), and marks the session busy while it works, so a `message.send` meanwhile is refused too. The request does not block the connection's other requests. `ChatRuntime.compact` reads the state, and `golem/graphs/compact.py` plans the change: `clear` is `plan_clear` with `clear_at` and `clear_to` at 0, so everything but the newest `keep_results` results is cleared; `summarise` is `plan_summary` with `keep_turns` (at least 1) and `Summariser.make`, with `focus` added to the instruction as `Keep especially: <focus>`. The new view is written with `aupdate_state`, and `context.changed` is stored with a null `run_id`, because no run owns it (the trace builder skips events without a run). The result is `before_tokens`, `after_tokens`, `count` (results cleared, or turns summarised), `window` (the room, when known) and `model` (the summary model). With nothing to do, the result has `count: 0`, equal tokens, and no event. A failed summary is an error and changes nothing.

`grow` does the decision above without the `should_grow` test and without the 10-minute limit, and the session must be idle. It raises the plan at once and keeps the `Growth` for the next `message.send`, which loads the window and reports it as above. The result has `count: 0`, `window_from`, `window_to`, `window` (the new room) and `model`. It is refused with `-32602` and a reason when the window is set by the user (`the window is set by you`), when this Mac cannot hold a larger one (`this Mac cannot hold a larger window for <model>`), or when the model has no planned window.

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/graphs/prompt.py` | `SystemPrompt`, its sections, and `PromptContext` |
| `packages/daemon/golem/graphs/chat.py` | `call_model`: the prompt in front of the history, for one call |
| `packages/daemon/golem/graphs/estimate.py` | `TokenRatios`: tokens per character learned from finished calls |
| `packages/daemon/golem/graphs/fit.py` | The fit check and its emergency ladder |
| `packages/daemon/golem/models/window_plan.py` | `should_grow`, `next_step`, and the other pure rules of the window |
| `packages/daemon/golem/models/window_plans.py` | `WindowPlans`: the plan of each model, `raised`, `lower`, and `next_up` |
| `packages/daemon/golem/skills/pinned.py` | Which skills may be pinned, the pinned section, and `PinMemory` |
| `packages/daemon/golem/mcp/prompt.py` | The on-demand MCP servers section |
| `packages/daemon/golem/graphs/delegate_prompt.py` | The `delegate` section, for a small window |
| `packages/daemon/golem/server/handlers.py` | `session.set_skills` and `session.inspect` |
| `packages/view/src/commands.ts` | `/skill pin`, `/skill unpin`, and `/skill`, in the command table the TUI uses |

## Read more

- Next: [Skills](./skills.md), how golem finds skills, and runs one by name.
- Before: [Sandboxes](./sandboxes.md).
- [Skills](../guide/skills.md#keep-one-on), the user's guide to pinning.
- [The overview](../architecture.md): the whole system on one page.
