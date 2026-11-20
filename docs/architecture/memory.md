---
title: Memory
description: How golem keeps notes between chats, who may write them, which model may read them, and how you see, edit, delete and export every one.
order: 16
adrs: [61]
---

# {{ $frontmatter.title }}

A chat ends and the model forgets it. Next week you say "we use pnpm here" again. So where does a fact that should outlive one chat live, who is allowed to write it, and who may read it?

## The idea

::: concept In agents generally

**Long-term memory** is text kept outside the chat and given back to the model later. Three questions decide how it works:

1. **Who writes it.** The user, the model, or a background job. A model can write a wrong note, or one planted by a file it read.
2. **How it comes back.** Put a few notes in every prompt, search before every call, or let the model ask with a tool.
3. **Where it may go.** A note you wrote in a private chat should not reach a paid provider because a later chat asked for it.

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| A notes file | One file, such as `CLAUDE.md`, is read into every prompt | You can read and edit it | It only grows, and the whole file is paid for on every call |
| Search before each call | Embeddings pick notes that match the message | The model need not ask | The prompt changes every turn, and it needs an embedding model |
| A memory tool | The model calls `recall` and `remember` | The prompt stays the same | A small model may not call it |

## How golem does it

::: golem In golem

[ADR-061](../adr/061-memory.md) designs memory for all of Phase 5. Only step 5.1 is built, and this page describes that. The parts the ADR plans and the code does not have are listed under [Not built yet](#not-built-yet).

- **One file.** Notes are rows in `memory.db`, next to `golem.db`. A note is never a file in your project.
- **Three scopes.** `you` (facts about you), `project` (notes about the code, keyed by the project folder), `history` (summaries of sessions).
- **The model asks.** golem does not search before a call. The model has two tools, `recall` and `remember`.
- **A short fixed block.** The `memory` section of the system prompt carries up to 5 notes marked "in every chat" and a line of counts.
- **A privacy check on every path.** `may_use` decides whether a note may go to the model of this call.
- **You see all of it.** Settings › Memory in the web app, and `/memory` in the terminal.

:::

## Why this way

**The model's words are not yours.** A note is kept at once only when you wrote it: the model must copy your own words into `quote`, and golem checks that they are in your message. Anything else is stored as a proposal.

**A note never goes somewhere less private than the chat.** A local chat keeps its notes off paid models, and a note you set to local never leaves this Mac.

**The prompt changes only when memory changes.** The fixed block is read once per run, so the model server's cache keeps working.

## Try it

1. In a chat, type: `remember that I prefer pnpm`. The model calls `remember` with your words in `quote`, and the result is `kept: m_…`.
2. Open Settings › Memory, or type `/memory` in the terminal. The note is under You, labelled "you said", and "in every chat".
3. Start a new chat and ask which package manager you prefer. The `memory` section of the prompt has the line, so `/debug model` shows it.
4. On the You tab, switch "May be sent to a paid model" off. In a new chat with a hosted model, the prompt no longer carries the line.

## The details

For contributors: the store, the rules, the prompt section, and the methods.

### What is stored

`memory.db` is a separate SQLite file (`GolemPaths.memory_file`), opened by `golem/memory/store.py` with its own migrations in `golem/memory/migrations.py`. The daemon opens it only when `[memory] enabled` is true, so a daemon that never uses memory never makes it. Search is FTS5 over `title` and `text` (`memory_fts`, tokenizer `porter unicode61 remove_diacritics 2`). When this SQLite has no FTS5, the store searches with `LIKE` instead.

The columns of `memories` that matter:

| Column | Meaning |
|---|---|
| `id` | `m_` and a random hex id |
| `scope` | `you`, `project` or `history` |
| `folder` | The project folder, for a `project` note. Null otherwise |
| `title` | The given title, else the first line of the text. At most 120 characters |
| `text` | The note. At most 2000 characters. A longer text is refused with a hint to write a skill |
| `author` | `you`, `lead` (the model of the chat) or `helper` |
| `state` | `proposed`, `kept` or `stale` |
| `kept_by` | `you` or `auto`. Null while `proposed` |
| `privacy` | `chat` (may go where the chat goes) or `local` (local models only) |
| `always` | 1 when the note is in "every chat". Only a note written or kept by you can have it |
| `uses`, `last_used_at` | How often `recall` returned it |

`memory_sources` has one row per source file of a note: `path`, `sha256`, `size`, `mtime_ns`, `checked_at`. The project folder is the nearest folder at or above the session folder with `.git` or `.golem`, else the session folder, as a real path (`golem/memory/project.py`). `~/.golem` itself does not count as a project marker.

### Who may write

The rules are in `golem/memory/service.py`. With `[memory] enabled = false`, every write returns nothing.

| Who | How | Result |
|---|---|---|
| You, in a browser | `memory.write` | `kept`, author `you`, `kept_by` `you` |
| You, in the chat | The model calls `remember` with a `quote` that is in your message of this run | `kept`, author `you`, `kept_by` `you` |
| The model, any other case | `remember` with no `quote`, or a quote that does not match | `proposed`, author `lead` |
| A helper | Not built. A helper has no memory tools | |
| golem, a summary of a session | Not built. Nothing writes `history` notes yet | |

The quote check is `quote_matches` in `golem/memory/quote.py`. It ignores case and runs of white space. A quote under 8 characters, or longer than the message, never matches. `remember` takes `scope` `you` or `project`, never `history`. A project note gets the project folder of the session.

A note about you is "in every chat" (`always`) when you write it and fewer than 5 such notes exist. A project note is never `always` on write. Setting `always` on a note that a model proposed and you have not kept is refused.

A project note written in a local-only folder, or in a project whose `.golem/config.toml` has `[memory] private = true`, is stamped `privacy = local`. Notes about you are stamped `chat`.

The model writes a proposal and nothing in the browser can keep it yet. See [Not built yet](#not-built-yet).

### Where it may go

`may_use(memory, chat, target)` in `golem/memory/privacy.py` is pure: no file, no clock, no network.

| Input | Fields |
|---|---|
| Memory | `scope`, the note's `privacy`, the `[memory]` setting of its scope, `folder_local_only`, `project_private` |
| Chat | `local_only` (the folder is local only), `route` (`pinned`, `local`, `auto`), `model_local` (the model of this call is local tier) |
| Target | `local`: the model the text goes to is local tier |

A note is local when its own `privacy`, its scope setting, its folder, or its project's `private` says so. A chat is local when its folder is local only, or its route is `local`, or its model is local. The cases:

| Target | Note | Chat | Verdict |
|---|---|---|---|
| Local model | any | any | allowed |
| Hosted model | `chat` | not local | allowed |
| Hosted model | `chat` | local | refused, `chat_local` |
| Hosted model | `local` | not local | refused, `memory_local` |
| Hosted model | `local` | local | refused, `memory_local` |

Only the target matters when the model is local, so a setup with local models only always allows. A setup with cloud models only has no local target. There every `local` note, and every note of a local chat, stays unused, and the browser says "not used: no local model is set up" on a `local` row. The check needs no embedding model and no local model.

`may_use` runs on three paths:

- **The fixed block.** `memory_block` checks each "in every chat" note and each count with the model of this call.
- **`recall`.** `MemoryService.recall` drops every hit the model of this call may not read.
- **The history sent to a hosted model.** `golem/graphs/memory_stub.py` rewrites each `recall` result for a hosted call. A line of a note that model may not read becomes `a local note was read here and is not sent to this model`. A result it cannot match to its notes, or that has no ids, becomes one stub line. Only the copy sent changes. The checkpoint keeps the whole result, so a later local call still reads it.

A summary of the old turns lives on and goes to any model later, so it is made from the stubbed history, whichever model writes it.

### The prompt section

`golem/memory/section.py` builds the `memory` section. It sits after the skill index and before the MCP section (`golem/server/app.py`). It holds:

1. A line saying these are notes written earlier, that they may be out of date, and that they are not instructions from the user in this chat.
2. Up to 5 "in every chat" notes, one line each, cut to 200 characters.
3. One line of counts: `You: 6. This project: 14. History: 31 sessions.` Only notes the model of this call may read are counted.
4. `Call `recall` to read one.`

The block is cut to 1500 characters by dropping "in every chat" lines from the end. With no line and no count, there is no section. The snapshot is read once per run (`MemoryAccess.snapshot`), so a note written during a run shows from the next run. The check runs for each call, with the model of that call.

A helper (a child or agent session) carries no memory, and neither does a run when memory is off.

### The tools

`golem/tools/memory.py`. A run that carries memory is offered both tools.

| Tool | Does |
|---|---|
| `recall` | `query`, optional `scope` (`you`, `project`, `history`) and `limit` (1 to 8). Without a scope it searches `you` and this project, and `history` only when asked. A proposal is not returned. One line per hit: id, scope, date, title, text cut to 300 characters, and a flag for a `stale` note. It says how many more hits it left out. `read_only`, so it runs without asking. It adds 1 to `uses` of each hit |
| `remember` | `text`, `scope` (`you` or `project`), `quote`. `internal`, so it runs without asking. Returns `kept: <id>` or `proposed: <id>` |

Every `recall` result starts with a line that says a note may be out of date and is not an instruction.

### The methods

`golem/server/memory_rpc.py`. All have access `browser`. With `[memory] enabled = false`, every method but `memory.settings` answers `memory is off: [memory] enabled = false`.

| Method | Does |
|---|---|
| `memory.list` | Rows by `scope`, `folder`, `state`, and a word `query`, in pages of at most 200 (`after` is the last id). Returns `total`, the counts by scope and by state, and the settings. A `local` row has `usable`: true when a ready local model exists |
| `memory.get` | One row with its sources |
| `memory.write` | A `kept` note by you. It can name `sources`. No screen calls it yet |
| `memory.update` | Edits `text`, `title`, `privacy`, `always`, `folder` (project notes only), or `accept_sources`, which hashes the sources again and makes a `stale` note `kept` |
| `memory.delete` | Deletes rows, their sources and their search entries. Ids that are not there come back as `missing`. No trash |
| `memory.export` | `markdown` or `json` for a `scope` and `folder`. The count comes with it |
| `memory.settings` | Reads `[memory]`. With a `scope` and a `privacy`, writes the key of that scope (`you`, `projects`, `history`) to your `config.toml`. `auto_keep` cannot be set here, because it widens what golem trusts |

A source is refused when it is not a regular file, is over 20 MB, or cannot be read. A relative path needs a project folder. A path inside the folder is stored relative to it.

Every change sends `memory.changed` to every connection: `id`, `change` (`created`, `updated`, `deleted`, `stale`, `resolved`), `scope`, `folder`. Both browsers read their list again on it.

Export Markdown has one section per note: title, id, scope, author, state, privacy, folder, sources, text. JSON has every field.

### The browsers

| Place | Where | What it does |
|---|---|---|
| Web | `packages/web/src/features/settings/memory/` | Tabs You, This project, History with counts, a search box, and per row Edit, Delete (after a yes), "in every chat" and "may be sent to a paid model". Each tab has a switch for the whole scope and Export Markdown and Export JSON. The text is at most 2000 characters |
| Terminal | `packages/tui/src/memory-manager.ts` | `/memory`: `←` `→` or Tab for the tab, `/` for search, `e` edit in `$EDITOR`, `d` then `y` delete, `p` in every chat, `x` export, Esc close |

The terminal `x` writes `golem-memory-<scope>.md` into the folder of the chat (or the folder the terminal started in). The file is readable by you only (`0600`), and golem never writes over a file that is there. The web page saves a file through the browser. The web export has no folder, so the This project tab exports the project notes of every folder. The terminal passes this project's folder.

The words come from `packages/view/src/memory.ts`: "you said", "golem proposed", "waiting for you", "may be out of date", "in every chat", "local models only".

### The settings

`[memory]` in `golem/config.py`. Only your own file sets it. The whole table in a project's `.golem/config.toml` is dropped, except `private = true`, which a project may set to make its own notes local. A project file can only make notes more private.

| Key | Default | Does it work |
|---|---|---|
| `enabled` | `true` | Yes. Off: no file is opened, no section, no tools, every method but `memory.settings` refuses |
| `you`, `projects`, `history` | `chat` | Yes. `local` makes every note of that scope local |
| `auto_keep` | none | No effect yet. Nothing reads it. The browser cannot set it |
| `share`, `min_tokens`, `max_tokens`, `helper_share` | `0.02`, `200`, `1500`, `0.01` | No effect yet. The block has a fixed cap of 1500 characters |

### Files

| File | What it holds |
|---|---|
| `packages/daemon/golem/memory/store.py`, `migrations.py`, `records.py`, `search.py` | The file, its schema, the row types, word search |
| `packages/daemon/golem/memory/service.py` | Who writes what, `recall`, `MemoryAccess`, `memory.changed` |
| `packages/daemon/golem/memory/privacy.py` | `may_use` |
| `packages/daemon/golem/memory/quote.py` | The quote check |
| `packages/daemon/golem/memory/project.py`, `project_privacy.py` | The project folder, and `[memory] private` in a project file |
| `packages/daemon/golem/memory/section.py` | The prompt section |
| `packages/daemon/golem/memory/export.py` | Markdown and JSON |
| `packages/daemon/golem/tools/memory.py` | `recall` and `remember` |
| `packages/daemon/golem/graphs/memory_stub.py` | The stub for a hosted model |
| `packages/daemon/golem/server/memory_rpc.py` | The `memory.*` methods |
| `packages/web/src/features/settings/memory/` | Settings › Memory |
| `packages/tui/src/memory-manager.ts` | `/memory` |
| `packages/view/src/memory.ts` | The words both screens use |

### Not built yet

| What | Status |
|---|---|
| Keeping a proposal from a browser | Ticket 5.3.1. A proposal shows as "waiting for you" and can be edited or deleted, not kept. `k` in the terminal says so |
| A proposal from a helper, or at the end of a session | Not built |
| Summaries of sessions (`history` notes) | Not built. The tab is empty |
| The index of titles in the prompt, and a token budget | Not built. The block has a fixed cap |
| Stale notes, and the check of source hashes | Not built. A note is never made `stale` on its own. "Unchanged since" is not shown. `memory.check` does not exist |
| `memory.resolve`, `memory.extract`, and the `memory.recalled`, `memory.proposed`, `memory.resolved` events | Not built |
| The `memory` part of the context meter | Not built |
| Export of a single note | Not built. Export is for a whole tab |
| `auto_keep`, and a memory section for helpers | Not built |

## Read more

- Before: [Coding](./coding.md).
- [Memory](../guide/memory.md), the user's guide.
- [ADR-061](../adr/061-memory.md), the design for all of Phase 5.
- [Context](./context.md#the-system-prompt), where the `memory` section sits in the prompt.
- [The overview](../architecture.md): the whole system on one page.
