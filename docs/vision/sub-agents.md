# Sub-agents

![A parent golem hands three sub-agents a brief each, shown as swimlanes: an explorer and a worker on local models, a reviewer on a hosted one. The worker asks for an approval, which bubbles up; three summaries and a diff come back](../images/vision-subagents.svg)

### The idea

A workflow is code deciding what happens next. A helper is the *model* deciding: in the middle of a task, golem hands a part of it to another agent with a short brief, waits for the answer, and goes on.

This matters more for golem than for most agents. **A small local model is good at a narrow job with a short context, and bad at a long chat.** A helper turns one wide task into short, narrow ones. "Read these call sites and list what changed" is a job an 8B model does well. "Upgrade every dependency and fix what breaks" is not.

The two fit together: a workflow step can be a helper (`run.agent`), and a chat that went well can become a workflow.

### Fold by default

golem does the work in the chat. It starts a helper only for one of three reasons, and the card says which:

1. **The window.** The reading does not fit, or would crowd out the task.
2. **Independent jobs that can truly run at once.** One per package, one per folder.
3. **A different model fits better.** One hard question to a stronger model, or a large read on a cheaper one.

There are no chains of helpers (find, fix, check). After the explorers answer, the lead makes the fix itself, because it understands the task. A reviewer with a fresh window may check the result. Settings has "Use helpers: When needed, Ask me first, Never", and with "Never" everything still works, in one window.

### How it works

- **A tool.** The model calls `delegate` with one brief, or a batch of independent ones. A batch has no order. Order belongs to the lead or to a workflow.
- **A session with a parent.** A helper is a headless session, linked to its lead and hidden from the session list. It starts from the brief, parks when it asks you, resumes after a restart, and can be opened read-only. It is the same session a workflow step starts.
- **Agent types are files.** An agent is a markdown file (`agents/*.md`) with the shape and sources of a skill: name, model wish, tools, limits, and the prompt as body. golem ships four: **explorer** (reads), **worker** (one change in a copy of your folder), **reviewer** (reads a diff it did not write) and **advisor** (one hard question, no tools). The same files are what [serve mode](./serve-mode.md#serve-mode-the-agent-behind-your-app) deploys.
- **References back, not a transcript.** A helper's answer names files and lines, and stores large output as an artifact. The lead reads the real thing.
- **A model by wish.** An agent file says `cheapest`, `same`, `stronger`, a tier or a model, and golem turns it into a model on your Mac or your accounts. An empty tier never breaks it: it falls back to the nearest tier, then to the lead's model.

### The rules

Seven things never bend ([ADR-059](../adr/059-helpers-are-child-sessions.md)):

1. A run holds no model slot while it waits.
2. Every wait has a named reason and an event.
3. A helper never has more tools, folders or allowances than its lead.
4. Only golem shortens a context, never the engine.
5. Privacy is never overridden: no wish, step-up or memory brings a hosted model or personal memory into a local-only chat.
6. A helper never writes memory. It proposes.
7. Nothing requires a local model and nothing requires a hosted one.

A helper's answer is data, never an instruction about permissions. Every helper has limits (calls, working time, cost), and stopping at one says why and how far it got. Working time does not count waiting for you, for a slot or for a provider.

### Local, mixed, cloud

golem allows local models and does not require them. Each setup has a stated behaviour, and each ticket has a test for local only and for cloud only.

| | Local only | Mixed | Cloud only |
|---|---|---|---|
| Usual reason | the window | the window; one call to a stronger model | at once; a cheaper reader |
| `cheapest` | the loaded model | a local model | the cheapest hosted model |
| `stronger` | the same model, fresh window | one paid call | the next tier up |
| The paid question | never | before the first paid call | none: caps and an estimate |
| The card shows | window saved | both | cost first |

### Asking you

A helper's question is an ordinary pending item. It shows above the lead's composer, in the Inbox grouped under the lead, and in the terminal. The same question from several helpers is asked once, with a count. You answer once, for this time, for this helper, or for every helper of the batch. When the question is the paid one, it shows exactly what is sent: the brief, not the chat.

### Seeing it work

You see as much as you want, and nothing new sits in the top bar.

- **Quiet:** one grey line, "used 2 helpers".
- **Normal:** one card for the batch, a row for each helper with what it read and what it saved. The right column is always a state or a wait reason.
- **Verbose:** the model each helper got and why.
- **A helper's chat** opens read-only from its name. **Continue as chat** turns a finished helper into a chat of your own: a fork with its messages, no lead, and the normal tools and prompt of a chat. **How it ran** is the Steps tab of the Inspector, and **Runs** in the rail lists the same steps full width. In the terminal a tree sits under the turn.
- A worker's diff comes back in the Changes tab, one block for each worker, to view, apply, discard or try again on a stronger model. Nothing in your folder changes until you apply. If a file changed in your folder since the worker's copy was made, the apply stops and names the file. Undo of an apply rewinds your folder to before it, so later changes are undone too.

### Somewhere else

Today every helper runs on your Mac, and a worker edits a git copy of your folder. A helper does not have to stay there. The same helper could start in a container, on a machine you own over `ssh`, or on a rented GPU with a bigger open model, and come back **as a diff you review**, never as a write to your files. Your Keychain and your other chats never cross. A forgotten GPU is the main risk to money, so every remote helper has a time limit and stops when idle. This is later work, and none of it is built.

### Where it is built

Phase 15 (#733) built helpers: the four agent types, parking, questions, workers in copies, and Measure. How it works is in [Helpers](../architecture/helpers.md), and the design record is [ADR-059](../adr/059-helpers-are-child-sessions.md). Phase 18 (#1198, ADR-060) builds the dispatcher that decides how many run at once and why anything waits. Phase 5 (#90, ADR-061) builds the memory a helper may be given and may propose to. Helpers on other machines are later.
