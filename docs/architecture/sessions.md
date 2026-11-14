---
title: Sessions
description: Why an agent's work should outlive a closed window, a stopped run, and a crash, and how golem keeps it in an event log and a checkpoint, closes what a crash left open, and forks a chat at one message.
order: 5
adrs: [6, 8, 9, 10, 20]
---

# {{ $frontmatter.title }}

An agent's work often takes longer than a window stays open. You close the terminal, the laptop sleeps, a long answer goes the wrong way and you stop it, or the process crashes. Each time, something has to decide what is kept, and what the model and the screen see next. So where does the work live, if not in the program that is doing it?

## The idea

::: concept In agents generally

A program keeps its state in memory, and memory is gone when the program stops. A chat that should outlive its window has to be written to disk as it happens. Two things need keeping, and they are not the same:

1. **What happened.** Every step the user saw: your message, the answer as it streamed, each tool call, how the run ended. An **event log** keeps these in order, each with a number. A window that opens later reads the log after the last number it has, and draws the same screen.
2. **What the model reads next.** The messages as the model will get them on the next call. A **checkpoint** is that state, saved after each step, so a new process can go on from it.

Three rules make the two useful:

- **Write first, then show.** An event goes to disk before any window gets it. A window can never show what the log doesn't have.
- **Write the end, even an early one.** A cancel or a crash leaves a half-written answer. The agent decides what to keep, and writes it to both, so the screen and the model agree.
- **Never redo a side effect.** A step that resumes after a pause or a crash must not run a command twice.

With both on disk, a chat can also be **forked**: copied up to one message into a new chat, to try another direction while the first one stays as it was.

![What survives. A window draws the events and the agent runs each turn, but both live in a process. Each turn is written first to two files on disk: the event log, what was shown, numbered, and the checkpoint, what the model reads next. The window closes and the agent keeps writing. Then the agent crashes. A new process reads the checkpoint, and a new window reads the log after the last number it had](../images/sessions-stores.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| In memory only | The chat lives in the process. Closing it ends the chat | Simple | Nothing survives a close or a crash |
| A transcript file | Each message is appended to a file per chat, often JSON lines. Resuming reads it back | Easy to read, easy to copy | One file is both the screen and the model's memory, so a partial answer or a shortened history changes both |
| A message table | Messages in a database, read back as the history | Search, lists, and sharing | The steps between messages, such as a stream or a pause, are not kept |
| A checkpoint per step | The agent's whole state is saved after each step, as in LangGraph's checkpointers or a durable-execution engine | A crash resumes from the last step, and a pause can wait for days | The state is the model's view. It does not say what the screen showed |
| Event sourcing | An append-only log is the source, and the tables are derived from it | Replay, audit, and any number of windows | Each new kind of fact is a new event type, and old logs must stay readable |

The open problems are the same in every agent:

- **The half-finished step.** A crash during a tool call leaves no record of whether it finished. Running it again may do it twice.
- **The partial answer.** Dropped, the screen and the model disagree about what was said. Kept, the model sees an answer cut off mid-sentence.
- **Upgrades.** The next version of the agent must read the files this one wrote, and an older one must not break a newer file.
- **Long histories.** A fork near the start of a long chat, or a history shortened by compaction, must still cut at the state the model really had.

## How golem does it

::: golem In golem

golem keeps both records, in two SQLite files under `~/.golem`. `golem.db` is an event log in the event-sourcing style, and `checkpoints.db` is LangGraph's checkpoint per step ([ADR-006](../adr/006-checkpoint-continuity.md)).

- **A session** is one chat, with an id and a project folder. **A run** is one answer in it, from your message to the model's last word.
- **The event log.** Every event gets the session's next `seq`, and is written to `golem.db` before it goes to any socket (`SessionLog._emit`). The `sessions` and `runs` tables are written in the same transaction, from the events. The live token stream, `message.delta`, is deleted once its `message.completed` is written.
- **The checkpoint.** LangGraph saves the chat's messages after each node. The thread id is the session id, so the next `message.send` goes on from it, after a restart too.
- **The daemon outlives the window.** Closing the TUI does not stop a run. It finishes, and is drawn from the log at the next attach.
- **Every early end has one shape.** A cancel, a shutdown, and a crash all end the open answer with `message.completed` and `interrupted: true`, then the run's end. `close_reply` writes the same partial text into the checkpoint ([ADR-008](../adr/008-cancellation.md)).
- **A crash is closed at the next start.** A run still `running` in `golem.db` lost its task. `recover_runs` writes the end it never wrote.
- **A fork is cut at one message id**, in the checkpoint history and the log at once ([ADR-010](../adr/010-fork.md)).

![Three ways a run stops early in golem, and the one end they share. Ctrl-C sends run.cancel: seq 125 is message.completed with interrupted true and the text so far, and seq 126 is run.cancelled with the reason user. golem daemon stop drains every run the same way, with the reason shutdown. After kill -9 nothing runs for 12 seconds, and at the next start recovery writes seq 865, the same interrupted message, and seq 866, run.failed. In every case the checkpoint gets the same text, so go on continues it](../images/sessions-ends.svg)

Here is a real session, recorded against a throwaway home with `qwen3.5:4b` on a local Ollama. It asks for a story, cancels it, says "go on", asks for a second story, and kills the daemon with `kill -9` halfway through it. Then it starts the daemon again, and forks the session at the cancelled answer:

| seq | What happened | The event |
|---|---|---|
| 2–4 | "Tell me a story of about 600 words about a clay golem…" | `message.completed` (you), `run.started`, `message.started` |
| 5–124 | The answer streams | `message.delta`, one per chunk |
| 125 | `run.cancel` after the 120th chunk | `message.completed`, `interrupted: true`, 563 characters, ending `His hands were rough, shaped like` |
| 126 | | `run.cancelled`, `reason: "user"` |
| 127–763 | "go on" | the answer starts `**Chapter Three: The Watched Hours**`, then `run.completed` |
| 764–864 | "Tell me a second story… in winter" | the answer streams. The last chunk, seq 864, is at 15:58:03.6 |
| | `kill -9` on the daemon, then a new daemon 12 seconds later | its log: `closed 1 run(s) left open by a stopped daemon` |
| 865 | Recovery, before the socket listens | `message.completed`, `interrupted: true`, 434 characters, ending `a white barrier between the freezing` |
| 866 | | `run.failed`, `"the daemon stopped during this run"` |

`session.inspect` after the restart reads the checkpoint: `message_count` 6, and the last assistant message is the same 434 characters. The model's memory and the screen stopped at the same word.

At the end, `golem.db` held 24 rows of the 1 035 numbers given out: the deltas were deleted as each answer completed, which is why `seq` skips.

The fork, `session.fork` at `m_fd51…`, the cancelled answer, made a new session. Its log starts with `session.created` and `forked_from`, then the two messages up to the cut, with new numbers and their old `run_id`. Asked "What was the golem called, and where did the story stop?", it answered:

```text
**The Golem's Name:** Terrafol (from "terra" meaning
earth/earth and "fol" suggesting leaf/foliated form)

**Where the Story Stopped:** The story cut off
mid-sentence in Paragraph 2, right at: "...His hands
were rough, shaped like [the rest of the paragraph was
cut off]."
```

The source session kept its six messages, and `session.list` listed both, the fork with `forked_from`.

![A fork in golem, from the real session above. The source has a story, the interrupted reply m_fd51 that ends with shaped like, go on, Chapter Three, a second story, and a reply cut by a crash. session.fork cuts at m_fd51. The fork's log starts with session.created and forked_from, then copies the two messages up to the cut with new seq numbers and the same run_id. Its checkpoint is the one whose last message is m_fd51. Asked what the golem was called, the fork answers Terrafol, and that the story stopped at shaped like](../images/sessions-fork.svg)

**Where it lives in the code:**

- `packages/daemon/golem/sessions/log.py`: `SessionLog`, which numbers each event, stores it, and only then publishes it.
- `packages/daemon/golem/store/events.py` and `store/projection.py`: the `events` table, and the `sessions` and `runs` rows written from it.
- `packages/daemon/golem/sessions/runner.py`: one run's task, and what it closes when it is cancelled.
- `packages/daemon/golem/sessions/interrupted.py`: `close_reply`, the partial answer in the log and the checkpoint.
- `packages/daemon/golem/sessions/recovery.py`: `recover_runs`, called from `golem/server/app.py` at the start.
- `packages/daemon/golem/sessions/manager.py`: `SessionManager.cancel`, `cancel_all`, and `fork`.
- `packages/daemon/golem/graphs/chat.py`: `ChatRuntime.fork` and `answer_dangling`.

:::

## Why this way

**Two stores, on purpose** ([ADR-006](../adr/006-checkpoint-continuity.md)). The screen needs what was shown, in order, with the stream and the pauses. The model needs its messages. One store for both would make the screen read graph state, or the model read events. The cost: the two can differ, so every early end writes both.

**Written before it is sent.** A window reads the same log after a reconnect, so replay is not a special mode. `seq` comes from the log, so it survives a restart.

**A cancel keeps what it said** ([ADR-008](../adr/008-cancellation.md)). The words you saw stay on the screen, and the model sees them, so "go on" and "no, shorter" make sense. A flag on `message.completed`, not a new event, keeps one end for every message. Cancelling the task, not a flag checked between steps, stops the HTTP stream at once.

**Recovery at the start.** A crash leaves no task to finish the run, and no chance to write its end. The next daemon is the first one that can, so it does, before it listens.

**A fork reads the checkpoint history** ([ADR-010](../adr/010-fork.md)). Trimming today's message list would break once compaction shortens it. The checkpoint at the cut is the state the model really had. Copying only the completed messages, with their old `run_id`, keeps the fork's log short and says where each message came from.

**An upgrade copies first** ([ADR-020](../adr/020-safe-upgrades.md)). Before a migration, or a new LangGraph opening `checkpoints.db`, the file is copied. A daemon too old for a file leaves it alone and says which golem wrote it.

**The session list has its own message** ([ADR-009](../adr/009-session-list.md)). `/sessions` watches every session through `session.summary`, without attaching to each one.

## Try it

1. Open the chat with `golem tui`, and ask for something long, such as a story of 600 words.
2. Press Ctrl-C while it streams. The answer ends with `· interrupted`. Type `go on`: the next answer continues the story.
3. Type `/fork`. golem switches to a copy of the chat up to the newest finished message. `/sessions` lists both.
4. Ask for another long answer, and quit the TUI with Ctrl-C twice while it streams. Open `golem tui` again: the answer has finished, drawn from the log.
5. To see recovery, ask for one more long answer and run `kill -9 $(cat ~/.golem/run/golem.pid)` in another terminal. launchd starts the daemon again. The answer ends with `· interrupted`, and the run with `the daemon stopped during this run`.

## The details

For contributors: the reference for the files on disk, the event log, an early end, recovery, and fork.

### Files on disk

The daemon keeps its files under one home directory. `resolve_paths` picks it: a function argument, otherwise `GOLEM_HOME`, otherwise `~/.golem`.

| Path | Role | Status |
|---|---|---|
| `run/golem.sock` | The socket clients connect to | Built |
| `run/golem.pid` | The lockfile. The daemon holds a flock on it and writes its pid | Built |
| `run/last-error` | Why the last start failed, then the next step, on two lines. A start that listens removes it | Built |
| `checkpoints.db` | Model memory for a chat. The thread id is the session id. Separate so it can be wiped without deleting the event log | Built |
| `config.toml` | Settings for this user | Built |
| `logs/golem.jsonl` | The daemon's own log, one JSON object per line | Built |
| `cache/` | Hosted model lists (`models-<provider>.json`) and LiteLLM's prices (`litellm-prices.json`), each refreshed after a day. Safe to delete | Built |
| `golem.db` | The event log, the `sessions` and `runs` tables derived from it, and `artifacts`, the long tool output. Costs later | Built |
| `memory.db` | Long-term memory | Planned |
| `skills/` | Skills you added on this machine, one folder each | Built |
| `flows/` | Flows you added on this machine | Planned |

The settings in `config.toml` are in the [Settings](../guide/settings.md).

### The event log

In `golem.db`, `events` is the source. `sessions` and `runs` are written in the same transaction as the event they follow: `session.created` adds a session with its project folder (`cwd`), `run.started` opens a run, `approval.needed` marks it `waiting` and `approval.resolved` marks it running again, and `run.completed`, `run.failed`, or `run.cancelled` closes it. An `approval.resolved` with `allow_session` adds the tool to `sessions.allowed_tools`. `session.updated` sets the title, or the folder of a session that had none. `session.closed` records `closed_at`, which hides the session from `session.list`; the events stay. `artifacts` is not derived from events: the `tools` node writes a row for each long tool output, by session. Each model call also leaves `model.call.started` and `model.call.completed` in the log, and [Tracing](./tracing.md) reads them back, with the checkpoint, as a tree of spans.

### Migrations and backups

The schema version is SQLite's `user_version`. Each numbered migration in `golem/store/migrations.py` runs once, in its own transaction, with a row in `schema_version` (the schema, the golem version that applied it, and when). Before the first pending migration, `golem/store/backup.py` copies the file to `golem.db.bak-<schema>` with SQLite's backup API, under a temporary name until the copy is complete, with the original's permissions. A file from a newer daemon is refused and left as it is; the error names the golem version that `schema_version` says wrote it, and `golem.db.bak-<schema>` when this daemon's schema has a copy. `library_versions` holds the LangGraph package versions that last opened `checkpoints.db`. `golem/store/checkpoints.py` compares them at start and, when they differ, copies that file to `checkpoints.db.bak-<langgraph version>` and records the new versions before LangGraph's saver opens it.

### A run with no window

If you quit the TUI halfway through, the daemon still finishes the run and saves the checkpoint. The next message in that session continues from it.

### Cancel

If you press Ctrl-C while the answer streams, the TUI sends `run.cancel`. The daemon cancels the run task. Each tool call still open gets `tool.failed`. The answer gets a `message.completed` with the text streamed so far and `interrupted: true`, then `run.cancelled` with the reason `user`. The same partial text is written into the checkpoint, so "go on" continues from it ([ADR-008](../adr/008-cancellation.md)). Stopping the daemon does the same for every open run, with the reason `shutdown`.

A run stopped between a reply and its tool results leaves tool calls without a result in the checkpoint, and providers refuse that history. Before the next turn streams, each such call gets a result that says it was cancelled.

- **The reply.** `run.cancel` answers once `run.cancelled` is in the log. `cancelled` is false for a run that had already ended, and an id the daemon never ran is `-32006`.
- **No half-written event.** Every emit is shielded, so a cancel cannot leave an event half-written. `send` waits until the run task is inside its handler before it returns `run_id`, so even a cancel sent at once ends in `run.cancelled`.
- **A run waiting for an approval** has no task. `run.cancel` fails its open calls with `cancelled before it was approved`, then logs `run.cancelled` ([Permissions](./permissions.md#approvals)).
- **A cancel before the first token** leaves a user message with no reply in the checkpoint, and the next call sees two user messages in a row. The providers in use accept that.
- **In the TUI**, Ctrl-C while a run is in progress sends `run.cancel`. Otherwise the first press shows "Ctrl-C again to exit" for two seconds, and a second press exits (`packages/tui/src/interrupt.ts`). An interrupted reply ends with `· interrupted`.

### Crash recovery

If the daemon dies halfway through, the run has no task left to finish it. At the next start the daemon closes it: each open tool call gets `tool.failed`, the open answer gets a `message.completed` with the text streamed so far and `interrupted: true`, then `run.failed`. The same partial text is written into the checkpoint, so the model's next turn sees what the screen showed.

A step that stops to ask you a question runs again from its first line when you answer. The side effect goes after that stop, or in its own step, so a resume does not do it twice.

- **What it reads.** `open_turn` walks the run's events: the open tool calls, the user and assistant message ids, and the deltas so far, which are still in the log because the message never completed.
- **When.** `recover_runs` runs in `golem/server/app.py` before the socket listens, so no client sees a run that is open with no task. A run it cannot close is logged and stays open for the next start.
- **The message.** `run.failed` carries `the daemon stopped during this run` (`STOPPED_MESSAGE`).
- **A reply the model had finished.** `close_reply` first looks for the message in the checkpoint. A reply already there was finished by the model, so it completes with the checkpoint's text and is not marked.

### Fork

`session.fork {session_id, at_message_id}` returns the new session's id. It does not attach the caller: the client attaches, as it does after `session.create` ([ADR-010](../adr/010-fork.md)).

1. **The log is checked first.** The cut message must have a `message.completed` in the source's log.
2. **The checkpoint.** `ChatRuntime.fork` walks `aget_state_history` for the source thread, newest first, and takes the first checkpoint whose last message has that id. It writes those values to the new thread with `aupdate_state(..., as_node="call_model")`.
3. **The log.** The fork's `session.created` carries `forked_from {session_id, message_id}`, and the `sessions` row stores the same two columns. Then the source's `message.completed` events up to and including the cut are copied, with new `seq` numbers and their original `run_id`.
4. **The switches.** The fork starts with the source's pins and on-demand MCP servers as they are now, not as they were at the cut. It does not copy the tools allowed for the session, so a fork can't keep an approval past the session it was given in.

- **Errors.** A message with no completed event, or no checkpoint ending at it, is `-32007`. A session from before the event log has an empty log, so it cannot be forked. An interrupted reply with no text was never written to the checkpoint, so it cannot be a cut either.
- **Where it cuts.** Forking at an assistant message keeps that reply. Forking at a user message keeps the question and drops its answer, so the next send on the fork adds a second user message after it.
- **A running source.** The fork reads checkpoints that are already written, and the open turn is not copied.
- **Cost.** `aget_state_history` reads from newest to oldest, so forking near the start of a long session reads most of its history.
- **In the TUI**, `/fork` cuts at the newest finished message on the screen and switches to the new session. A message picker is not built.

### The session list

`session.list {watch: true}` returns the list and marks the connection as a watcher until it closes. After every stored event except `message.delta`, `SessionLog` sends that session's `session.summary` to every watcher, inside the per-session lock, so one session's summaries arrive in order ([ADR-009](../adr/009-session-list.md)). A session gets a title once, after its first completed run, as a `session.updated` in its own log. `/sessions` in the TUI is that list.

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/sessions/log.py` | `SessionLog`: number, store, then publish each event, and send summaries to watchers |
| `packages/daemon/golem/sessions/manager.py` | Sessions and runs: `send`, `cancel`, `cancel_all`, `fork`, `rename`, `close` |
| `packages/daemon/golem/sessions/runner.py` | One run's task, and what it closes on a cancel |
| `packages/daemon/golem/sessions/interrupted.py` | `close_reply`: the partial answer in the log and the checkpoint |
| `packages/daemon/golem/sessions/recovery.py` | `recover_runs`: the runs a stopped daemon left open |
| `packages/daemon/golem/graphs/chat.py` | `ChatRuntime.fork`, `answer_dangling`, and `message_text` |
| `packages/daemon/golem/store/events.py` | The `events` table |
| `packages/daemon/golem/store/projection.py` | The `sessions` and `runs` rows written from the events |
| `packages/daemon/golem/store/migrations.py`, `store/backup.py` | The schema's migrations, and the copy before them |
| `packages/daemon/golem/store/checkpoints.py` | `open_checkpoints`: the LangGraph versions, and the copy when they change |

## Read more

- Next: [Tools](./tools.md), what happens when the reply asks for a tool.
- Before: [The protocol](./protocol.md).
- [The overview](../architecture.md): the whole system on one page.
