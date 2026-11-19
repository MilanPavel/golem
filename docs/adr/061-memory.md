# ADR-061: golem keeps long-term memory in `memory.db`, recalls it inside a small budget, and never sends it somewhere less private than the chat

**Date**: 2026-11-19
**Status**: proposed

## Context

Phase 5 (#90) had four steps written before routing, helpers and the context view existed. They described a store, a `recall` step before every model call, and extraction at the end of a session. That design changes the start of the prompt on every turn, needs a second local model, and says nothing about where a memory may be sent. This ADR is step 5.0 (#1220). It replaces that design and fixes the names the tickets of 5.1 to 5.7 use.

What exists today, checked in the code:

| # | Fact | Where |
|---|---|---|
| E1 | `GolemPaths.memory_file` points to `<home>/memory.db`. Nothing opens it | `packages/daemon/golem/paths.py` |
| E2 | `Database.open` applies the migrations of `golem.db` only, and copies the file to `<file>.bak-<schema>` before an upgrade | `golem/store/database.py`, `golem/store/migrations.py`, `golem/store/backup.py` |
| E3 | SQLite 3.47.1 in the project's Python 3.12 has FTS5, with the `porter` tokenizer | checked with `CREATE VIRTUAL TABLE … USING fts5`. The packaged daemon is not checked yet |
| E4 | The system prompt is a list of sections, built for each call and never stored. The sections are: pinned skills, skill index, MCP, delegate, cite, plan first | `golem/graphs/prompt.py`, `golem/server/app.py`, ADR-031 |
| E5 | A call sends `[system message] + view(history)`, plus a last request on the final call. Both extras are sent and never stored | `_outgoing` in `golem/graphs/chat.py` |
| E6 | `PromptContext.window` carries the model's window. The skill index has a character budget, `[skills] index_budget` (4000) | `golem/graphs/prompt.py`, `golem/config.py` |
| E7 | The context breakdown has six parts: `system`, `tools`, `user`, `assistant`, `tool_results`, `summary` | `golem/sessions/context.py`, `TraceContextPart.key` in `golem_protocol/commands.py` |
| E8 | Clearing and summarising turn the history into a view. A cleared `recall` result would be stubbed like any tool result | `golem/graphs/context_view.py`, ADR-056 |
| E9 | A folder is local only by the user's `[routing] local_only` list or a project's `[routing] local_only = true`. `is_local_only` is pure. A session also has a route: `pinned`, `local` or `auto` | `golem/models/privacy.py`, `golem/models/project_privacy.py`, `golem/sessions/manager.py`, ADR-055 |
| E10 | A tool is a `Tool` in `default_registry`. `ToolContext` has no way to reach a store. `read_only` and `internal` tools run without asking | `golem/tools/__init__.py`, `golem/tools/registry.py` |
| E11 | A helper is a child run with `CHILD_PROMPT` as its whole system prompt and a fixed read-only tool set | `golem/graphs/child.py`, ADR-058 |
| E12 | golem does not read `AGENTS.md` or `CLAUDE.md` into the prompt | no loader under `golem/` |
| E13 | Every daemon method is listed with its access in one table. A client's reducer ignores events it does not know. The protocol is at 2.113 | `golem_protocol/methods.py`, `golem_protocol/version.py`, `packages/view/src/chat-state.ts` |

So the daemon has a file name for memory and nothing else. The prompt has a place for a small fixed block (E4, E6). It has no place for text that changes each turn without breaking the cache (E5).

Helpers are child sessions in [ADR-059](059-helpers-are-child-sessions.md), and the dispatcher is in [ADR-060](060-dispatcher-and-engine-profile.md). This ADR refers to them and does not design them.

## Decision

### 1. Kinds, scopes, and what is a memory

1. **Three kinds of memory.** *Working* is the chat, held in the checkpoint ([ADR-006](006-checkpoint-continuity.md)) and shortened only by golem's view ([ADR-056](056-planned-window-and-context-view.md)). *Shared within a run* is a helper's answer and the artifacts it points to (ADR-059). *Long-term* lives in `memory.db`. Only long-term is this phase.
2. **A fact is a memory. A procedure is a skill** ([ADR-025](025-skill-sources.md)). "We use pnpm" is a memory. "How we open a pull request" is a skill. A memory is at most 2000 characters. A longer text is refused with a hint to write a skill.
3. **Three scopes.**

   | Scope | Holds | Key |
   |---|---|---|
   | `you` | Preferences and facts about you | none |
   | `project` | Conventions and notes about the code | the project folder |
   | `history` | One searchable summary per session, helpers' answers included | the session |

   The project folder is the nearest folder at or above the session folder that has `.git` or `.golem`, else the session folder, as a real path.

### 2. Where it is stored

4. **One SQLite file, `memory.db`**, opened by a new store module with its own migrations. It is the only copy. A memory is not a file in the project, so a repository never carries it.
5. **`Database.open` takes the migrations as an argument.** `golem.db` passes its own. The upgrade rules of [ADR-020](020-safe-upgrades.md) then hold for `memory.db`: a copy first, and a newer file is refused with a way back.
6. **Tables.**
   - `memories` has one row per memory.
   - `memory_sources` has one row per source file of a note.
   - `memory_fts` is an FTS5 table over `title` and `text`, kept by triggers, with `porter unicode61 remove_diacritics 2`.
7. **The record.**

   | Field | Meaning |
   |---|---|
   | `id` | `m_` and a random hex id |
   | `scope` | `you`, `project` or `history` |
   | `folder` | The project folder for `project`, else null |
   | `session_id` | The session it came from, and for `history` the session it summarises |
   | `title` | The first line of the text, at most 120 characters, or what the writer gave |
   | `text` | The memory, at most 2000 characters |
   | `author` | `you`, `lead` (the model of the session) or `helper` (an agent in `agent`) |
   | `agent`, `call_id` | The helper's agent name and the call that ran it, for `helper` |
   | `state` | `proposed`, `kept` or `stale` |
   | `kept_by` | `you` or `auto`. Null while `proposed` |
   | `privacy` | `chat` (may go where the chat goes) or `local` (local models only) |
   | `always` | 1 when the memory is in the fixed block of every chat. Only `you` can set it |
   | `uses`, `last_used_at` | How often a recall returned it |
   | `created_at`, `updated_at` | ISO times |

   A source row has `memory_id`, `path` (relative to the folder when inside it, else absolute), `sha256`, `size`, `mtime_ns` and `checked_at`. A note has at most 20 sources.
8. **The user can read, edit and delete every memory.** The browser (section 9) lists every row, including `proposed` and `stale` ones, and each row can be edited, exported and deleted. `memory.db` is also a plain SQLite file with the schema above. If FTS5 is missing from the packaged Python, search falls back to `LIKE` over `title` and `text`. Nothing else changes.
9. **Where the browser lives.** Web: a section "Memory" in Settings (`packages/web/src/features/settings/sections.ts`). TUI: `/memory`, in the manner of `/skills`. Both read the same `memory.*` methods (section 8).

### 3. Who may write

10. **Writes by author.**

    | Who | How | Result |
    |---|---|---|
    | You, in the browser | `memory.write` | `kept`, author `you`, `kept_by` `you` |
    | You, in the chat ("remember that I prefer pnpm") | the model calls `remember` with your exact words in `quote` | `kept`, author `you`. Only if `quote` appears in your latest message of this run (a pure check, spaces and case ignored) |
    | The model, any other case | `remember` without a matching `quote` | `proposed`, author `lead` |
    | golem, from a helper's answer | the daemon, not the helper | `proposed`, author `helper` |
    | golem, at the end of a session | the `summarise` role ([ADR-055](055-model-routing.md)) | `proposed`, author `lead`, at most 5 |
    | golem, a session's summary | the daemon, step 5.4 | `kept`, author `lead`, `kept_by` `auto` |

    A summary is a copy of what the session already holds, not a new claim, so it needs no yes. The row says it was automatic.
11. **A helper never writes memory.** Its tools do not include `remember`, and what it returns is data. golem makes a proposal from a helper's answer: the text is the answer cut to 600 characters, and the sources are the files the helper read, hashed when the proposal is made. Only you can keep it. A sentence planted in a file a helper read cannot become a memory without you.
12. **A proposal is confirmed by you.** It is drawn on the helper's line (or at the end of the session in Quiet): Keep, Edit, No. "No" deletes the row. Ignoring it is "No": a proposal nobody decided is deleted when its session has been idle for 24 hours. Keep sets `kept`, `kept_by` `you`.
13. **A note with sources may be kept without asking, per project.** `[memory] auto_keep` lists folders. For a proposal from a helper or the lead that has at least one source, in such a folder, golem sets `kept` with `kept_by` `auto`. It is a setting of the user's file only: a project file cannot turn it on ([ADR-012](012-permission-rules.md)), and the browser cannot change it, because it widens trust ([ADR-037](037-browser-manages-mcp-and-config.md)). It is off by default. A fact without sources is always confirmed. This answers the question on #90: writes are always confirmed, except a note with sources in a folder you listed.
14. **`always` is yours.** A memory in the fixed block (section 5) must have author `you`, or have been kept by you. What you say explicitly is `always` while there are fewer than 5 such lines, so it is in every chat. After that it is found through the index.

### 4. Where it may go: the privacy check

15. **The rule.** A memory never goes to a less private place than the chat it was recalled in. It goes to a local model always. It goes to a hosted model only when the chat is not private and the memory is not set to local.
16. **`may_use` is a pure function** in `golem/memory/privacy.py`. No file, no clock, no network.

    ```python
    def may_use(memory: MemoryPrivacy, chat: ChatPrivacy, target: Target) -> Verdict
    ```

    | Input | Fields |
    |---|---|
    | `MemoryPrivacy` | `scope`, the record's `privacy`, the setting of its scope (`[memory] you / projects / history`), and `folder_local_only` for a project note |
    | `ChatPrivacy` | `local_only` (the folder rule, E9), `route` (`pinned`, `local`, `auto`) and `model_local` (the lead's model for this call is `local` tier) |
    | `Target` | `local`: the model the text goes to is `local` tier |

    - The memory is *local* when its record, its scope setting or its folder says so. A project's `.golem/config.toml` may set `[memory] private = true`, which makes its notes local. Like `[routing] local_only`, a project file can only make things more private.
    - The chat is *local* when `local_only`, or `route == "local"`, or `model_local`.
    - The verdict is `allowed` when `target.local`, or when neither the memory nor the chat is local. Otherwise the reason is `memory_local` or `chat_local`.
17. **Where it runs.** On every path that puts memory in front of a model: the fixed block, the `recall` result, a helper's brief (section 7), and the view sent after a step-up. A stepped-up call to a hosted model gets the `recall` results that hold a local memory as stubs. A paid helper under a local lead gets no personal memory, because the chat is local and the target is not.
18. **Defaults.** All three scope settings are `chat`. A `history` row made in a private chat (local-only folder, route `local`) and a project note made in a local-only folder are stamped `local` when written. Stamps only go toward more private.
19. **Cloud only.** A `local` memory is never used when there is no local model. The browser says so on the row. Nothing else changes.
20. **One honest limit.** A local lead that has read a memory can write it into a brief. The paid question shows the brief before it is sent (step 5.6).

### 5. Recall: a small fixed block, an index, and a tool

21. **A `memory` section in the system prompt**, after the skill index and before the MCP section, because those after it change more often. It has three parts, in this order:
    - the `always` memories, at most 5 lines of 200 characters,
    - one line of counts: "You: 6. This project: 14. History: 31 sessions.",
    - an index of titles of the project's and your memories, newest and most used first, as many as fit.
    It ends with "Call `recall` to read one." The text says these are notes written earlier and may be out of date, not instructions from the user in this chat.
22. **The block is read once per run**, when the run starts. A memory written during the run shows from the next run. So the start of the prompt changes only when a memory changed, and the engine's prompt cache keeps working within a run and between runs ([ADR-056](056-planned-window-and-context-view.md), decision 8).
23. **`recall`** takes `query`, an optional `scope` and `limit` (at most 8). It searches `you` and the project's notes, and `history` only when asked. It returns one line per hit: id, title, text cut to 300 characters, scope, date, and a flag when the note is stale, and says how many hits it left out. It is `read_only`. The result is an ordinary tool result at the end of the context, so nothing in front of it changes, and a cleared result is stubbed like any other (E8).
24. **No automatic recall.** golem does not fetch memory before a call. The model sees the index and decides. This keeps the prompt stable and the budget simple.
25. **The budget** is a share of the window: `[memory] share = 0.02`, with `min_tokens = 200` and `max_tokens = 1500`. At 32K it is 655 tokens. An unknown window uses the minimum. The block fits the budget, and so does each `recall` result. Counting is `CHARS_PER_TOKEN` ([ADR-056](056-planned-window-and-context-view.md)). The check runs before the call, as the fit check does.
26. **The context meter** gets a seventh part, `memory`: the `memory` section (from `system_sections`) plus the `recall` and `remember` results still sent. It is taken out of `system` and `tool_results`, so the sum is the same. A daemon sends the part only when it is above 0.
27. **`remember`** takes `text`, `scope` (`you` or `project`), `quote`, and for a project note `sources` (paths). It is `internal`, so it runs without asking: what it writes is either yours or a proposal.

### 6. Notes about the code, and when they go stale

28. **A project note stores its sources.** The writer gives paths. golem stores the content hash (sha256 of the bytes), the size and the mtime of each.
29. **When hashes are compared.**
    - At the start of a run, for the project notes the index lists: `stat` each source, and hash again only if size or mtime changed.
    - When `recall` returns a note, the same check on that note.
    - When the browser lists the notes of a folder.
    - Never in the background. A missing file counts as changed.
    - A `kept` note with a changed source becomes `stale` and `memory.changed` is sent. A stale note is still returned. Its line says "may be out of date: `app/client.py` changed", and the index marks it.
30. **A stale note is not deleted or rewritten by golem.** You accept it as current (`memory.update` with `accept_sources`, which hashes again), edit it, or delete it. Step 5.5 adds the narrow re-check: the lead reads the changed files, or a helper does with the note as its brief, and proposes an edited note.
31. **Limit.** The hash is taken when the proposal is made, not when the helper read the file. A file changed in between is missed once.

### 7. What a helper gets

32. **A `memory` section in the helper's prompt**, built by golem. It holds the project's `always` memories and the project notes that match the brief by word search, inside `[memory] helper_share = 0.01` of the helper's window (minimum 150 tokens). It holds nothing from `you` unless the agent file of ADR-059 asks for it.
33. **`may_use` runs with the helper's model as the target** and the lead's chat as the chat. A paid helper under a local lead gets no memory that is local-only, and no personal memory. A paid helper under a cloud lead gets what its brief needs, as the lead does.
34. **Helpers have no `remember` and no `recall`.** They get what golem puts in the prompt. The brief shown in the paid question lists what was added from memory.
35. **A helper's answer is searchable** with its session's summary (step 5.4).

### 8. The wire

36. **Methods**, all access `browser`, added to `METHOD_ACCESS`.

    | Method | Does |
    |---|---|
    | `memory.list` | Rows, filtered by `scope`, `folder`, `state`, and `query` (word search). Returns counts too |
    | `memory.get` | One row with its sources |
    | `memory.write` | Makes a `kept` memory by you |
    | `memory.update` | Edits `text`, `privacy`, `always`, `folder`, or `accept_sources` |
    | `memory.resolve` | Keep or reject a proposal, with an optional edited text |
    | `memory.delete` | Deletes rows, their sources and their search entries. No trash |
    | `memory.check` | Compares the hashes of a note and returns the changed paths |
    | `memory.extract` | Asks the `summarise` role for up to 5 proposals from a session, at its end |
    | `memory.settings` | Reads `[memory]`, and sets the privacy of a scope. `auto_keep` is read only |
    | `memory.export` | Returns `markdown` or `json` for a scope or a folder |

37. **Session events**, in the log of the session where they happen. They carry ids and a title cut to 120 characters, not the whole text. A client reads the text with `memory.get`.

    | Event | Data |
    |---|---|
    | `memory.recalled` | `how` (`block` or `tool`), `ids`, `tokens`, `budget`, `trimmed`, `stale_ids` |
    | `memory.proposed` | `memory_id`, `title`, `scope`, `author`, `agent`, `call_id`, `source_count` |
    | `memory.resolved` | `memory_id`, `decision` (`kept`, `rejected`, `auto`) |

    `memory.proposed` and `memory.resolved` name the helper's `call_id`, so the reducer can draw them under the helper's line.
38. **One notification**, `memory.changed`, to every connection: `id`, `change` (`created`, `updated`, `deleted`, `stale`, `resolved`), `scope`, `folder`. The browser refreshes on it, as the skill list does on `skill.registry.changed`.
39. **The version rises by one minor** for each ticket that changes the protocol, and `just gen` regenerates the TypeScript. Tickets that change the protocol do not run side by side.
40. **An old client** ignores the events (E13) and the notification, and has no browser. A new client on an older daemon gets "method not found" and shows that golem needs an update. The `memory` context part is sent only when it is above 0, so a client sees it only when memory is in use.

### 9. Deleting and exporting

41. **Delete is a delete.** The row, its sources and its FTS entry go.
42. **What stays.** A deleted memory may still be in the log and the checkpoint of a chat that recalled it, as a `recall` result. That is chat history. It goes when you delete the chat. The events hold only a title.
43. **Export** is `memory.export`. Markdown has one section per memory, with scope, author, state and sources. JSON has every field. Deleting `memory.db` wipes all memory, and the daemon makes a new empty file at the next start.
44. **Serve mode.** A separate space per app user ([vision](../vision/core.md)) is not designed here.

### 10. It works both ways

45. **No step needs an embedding model.** Search is FTS5. Word search needs no local model and no hosted one.
46. **The three setups.**

    | Setup | What happens |
    |---|---|
    | Local only | All of it works. `local` memories are usable. Extraction and summaries use the `summarise` role, which is the session's local model |
    | Mixed | `may_use` decides on each path. A local chat keeps its memory off paid models |
    | Cloud only | Nothing asks for Ollama. `local` memories are unused and the browser says so. Extraction and summaries use the role's hosted model, as titles do |

47. **Acceptance rule.** A ticket that touches a model says what it does in each setup and has a test for local only and one for cloud only.
48. **Vectors are later.** If the eval of 5.7 shows that word search is not enough, an embedding model is added as a job of the dispatcher (ADR-060). It never goes before a chat.

### Decided here, to confirm

| # | Question | Decision |
|---|---|---|
| M1 | Word search or vectors first | Word search (FTS5). Vectors only if the eval of 5.7 asks for them |
| M2 | Is a note with sources kept without asking | Yes, per project, if you list the folder in `[memory] auto_keep`. Off by default. Everything else is confirmed |
| M3 | First use | Notes about the code, with sources that go stale. Preferences and decisions use the same store |
| M4 | Where the browser lives | In Settings, as a section "Memory", and `/memory` in the TUI. Not a rail entry |

## Alternatives Considered

### Alternative 1: A `recall` step before every model call, with vectors

This was the text of #87.

- **Pros**: the model need not ask. Meaning matches words that differ.
- **Cons**: it puts text at the start of the prompt that changes each turn, so the model server's cache never hits. It needs a second local model beside the chat model, and none at all in a cloud-only setup.
- **Why not**: both costs fall on the small window and the Mac this phase exists to protect.

### Alternative 2: Memory as Markdown files

Files in `~/.golem/memory/` and in the project, like skills.

- **Pros**: you can edit them in an editor, and a project can share them in git.
- **Cons**: state, hashes, search, and per-record privacy need an index beside the files. A note with a path to your code would be committed by accident. A repository could ship a memory that reads like yours.
- **Why not**: one SQLite file with an export gives the same reading and editing, without those risks.

### Alternative 3: A table in `golem.db`

- **Pros**: one file, no second migration list.
- **Cons**: `golem.db` is the log of every session, and its backup copies are large. Your memory is small and valuable, and you may want to copy or delete it alone.
- **Why not**: `memory.db` is already named in `GolemPaths` (E1), and a separate file makes export and wipe plain.

### Alternative 4: `remember` always asks

- **Pros**: no text of yours can be written by a model in your name.
- **Cons**: "remember that I prefer pnpm" would open a dialog for words you just typed.
- **Why not**: the `quote` check keeps what you typed and still proposes everything else.

## Consequences

### Positive

- Every memory is a row you can see, edit, export and delete, with who wrote it and why it is trusted.
- The prompt changes only when memory changes, so the cache works.
- Privacy is a function with a table of cases. It is tested with no model.
- It works with no local model and with no hosted model.

### Negative

- The model has to call `recall`. A small model may not.
- A second file with its own migrations.
- A title of each proposal is in the event log, and a recalled text is in the checkpoint.
- Moving a project folder loses its notes until you set `folder` in the browser.

### Risks

- FTS5 may be missing from the packaged Python. The fallback is slower and unranked. 5.1 adds a check to the dist smoke test.
- Word search misses a note worded differently. The eval of 5.7 decides whether that matters.
- A model can still write a wrong memory in a confirmed proposal. You see the text before you keep it.

## References

- [ADR-006: Checkpoint continuity](006-checkpoint-continuity.md)
- [ADR-012: Tool rules](012-permission-rules.md)
- [ADR-020: Safe upgrades](020-safe-upgrades.md)
- [ADR-025: Skill sources](025-skill-sources.md)
- [ADR-031: The system prompt](031-system-prompt.md)
- [ADR-037: The browser manages MCP and config](037-browser-manages-mcp-and-config.md)
- [ADR-055: Model routing](055-model-routing.md)
- [ADR-056: The planned window and the context view](056-planned-window-and-context-view.md)
- [ADR-058: Child runs](058-child-runs.md)
- [ADR-059: Helpers are child sessions](059-helpers-are-child-sessions.md)
- [ADR-060: The dispatcher and the engine profile](060-dispatcher-and-engine-profile.md)
- [Context](../architecture/context.md)
- [Skills](../architecture/skills.md)
