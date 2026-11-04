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
- **What to keep when the window fills.** Planned for golem in [Phase 9](../plan.md).

## How golem does it

::: golem In golem

golem builds its system prompt for each model call, and never stores it ([ADR-031](../adr/031-system-prompt.md)).

- **Sections.** The prompt is a list of sections in `golem/graphs/prompt.py`. Each one reads the session's state, folder, and pins, and returns its text or nothing.
- **Built per call.** `call_model` builds the prompt and puts it in front of the history, for that one call.
- **Never stored.** The node returns only the model's reply, so the prompt never reaches the checkpoint.
- **Empty means none.** With no section to say anything, no system message is sent, and the model sees exactly the stored history.
- **One section today: the pinned skills.** `/skill pin terse` keeps a skill's instructions in front of every call, for the rest of the chat. Only the name is stored, in the session record. The body is read from disk on every call ([ADR-032](../adr/032-pinned-skills.md)).

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
2. Open the chat with `golem` in that folder, and type `/skill pin terse`. The status line shows `skills: terse`.
3. Ask anything, then type `/debug model`. The first row is `system`, with the skill inside `<skill name="terse">`.
4. Change the line in `SKILL.md` and ask again. The next answer follows the new line, with no restart.

## The details

For contributors: the reference for the system prompt and pinned skills.

### The system prompt

- **The system prompt.** `call_model` builds it for each call from the sections in `golem/graphs/prompt.py` and sends it in front of the history. The node returns only the reply, so the prompt is never checkpointed. With no section to say anything, no system message is sent. Its one section today holds the pinned skills (`golem/skills/pinned.py`) ([ADR-031](../adr/031-system-prompt.md)).
- **What a section reads.** `PromptContext` holds the checkpoint values, the session folder, the pins, and `report`. `report` is set during a model call only, so building the prompt for `/debug model` logs nothing.
- **Seen in `/debug model`.** `session.inspect` builds the same prompt for the next call and returns it as the first message, with role `system`. `message_count` counts only the stored messages.

### Pinned skills

**Pinning.** `session.set_skills` pins a skill for the whole session: the daemon checks it in the session's view, stores `skill.activated` with `how: "pinned"` and no run, and keeps the names in pin order in `sessions.skills`. An unpin stores `skill.deactivated`. Any usable skill may be pinned, `user-invocable: false` ones too.

**In the prompt.** Each turn passes the pins to the graph, and the system prompt's pinned section reads each body from disk for every model call, fills it in with no arguments, and wraps it in `<skill name="…">`. A pinned skill that is gone or broken is left out of the prompt and stays pinned ([ADR-032](../adr/032-pinned-skills.md)).

**What the log says.** While it builds the prompt, the section reports each pin to the run through the graph's stream: the hash it read, or why it left the skill out. The session's `PinMemory` keeps what the log last said, so the run logs only a change: `skill.activated` with the new hash after an edit, or one `skill.skipped` (`missing`, `disabled`, `broken`). After a restart it is rebuilt from the stored events.

**The pinned folders.** Each turn also passes the folders of the usable pins to the read tools, which read them until the skill is unpinned.

**Forks.** A fork starts with the source's pins and on-demand MCP servers as they are now: it copies each pin's newest `skill.activated`, and a later `skill.skipped`, and one `session.updated` with `mcp_servers`. It does not copy the tools allowed for the session ([ADR-010](../adr/010-fork.md)).

**In the TUI.** `/skill pin <name>` and `/skill unpin <name>` call it, and `/skill` alone lists the pins. The suggestions after `/skill pin` leave out the pinned ones, and after `/skill unpin` list only those. The chat reducer keeps `activeSkills` from `skill.activated` with `how: "pinned"` and `skill.deactivated`, so a reattach shows the same pins, and the status line shows them as `skills: ship, setup`, after the model. A `skill.skipped` marks that pin `ship (skipped)` and sets a notice, until a call reads it again or it is unpinned. That segment leaves a narrow line after the folder and before new lines.

**Limits.** A turn that is already running keeps the pins it started with: a pin applies from the next turn. The registry notices an edit by the file's size and time, so two edits of the same size within the file system's time step could look like one.

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/graphs/prompt.py` | `SystemPrompt`, its sections, and `PromptContext` |
| `packages/daemon/golem/graphs/chat.py` | `call_model`: the prompt in front of the history, for one call |
| `packages/daemon/golem/skills/pinned.py` | Which skills may be pinned, the pinned section, and `PinMemory` |
| `packages/daemon/golem/server/handlers.py` | `session.set_skills` and `session.inspect` |
| `packages/view/src/commands.ts` | `/skill pin`, `/skill unpin`, and `/skill`, in the command table the TUI uses |

## Read more

- Next: [Skills](./skills.md), how golem finds skills, and runs one by name.
- Before: [Sandboxes](./sandboxes.md).
- [Skills](../guide/skills.md#keep-one-on), the user's guide to pinning.
- [The overview](../architecture.md): the whole system on one page.
