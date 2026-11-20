---
title: Memory
description: Tell golem to remember something, keep a note away from paid models, and see, edit, delete and export every note.
---

# Memory

golem can keep short notes between chats, such as "I prefer pnpm" or "tests run with `just test`". The notes live in one file on your Mac, `~/.golem/memory.db`. You can read, edit, delete and export every one of them.

## Tell golem to remember

Say it in a chat:

```text
Remember that I prefer pnpm.
```

golem keeps the note when it is your own words. Each note has a scope:

| Scope | Holds | Used in |
|---|---|---|
| You | Preferences and facts about you | Every folder |
| This project | Notes about the code | The project you chat in. A project is the nearest folder with `.git` or `.golem` |
| History | A summary of each session | Not built yet. The tab stays empty |

A note is one fact, at most 2000 characters. For a longer text, write a [skill](./skills.md).

If the model decides on its own that something is worth keeping, golem only proposes the note. A proposal shows as "waiting for you". Keeping a proposal is not built yet (ticket 5.3.1), so for now you can edit or delete it, and golem does not use it.

## In every chat

A note about you that you ask for is marked **in every chat**. golem puts up to 5 of them into the start of every chat, so the model knows them without looking. Each is cut to 200 characters. The 6th and later notes are not in every chat. The model finds them with its `recall` tool.

Notes about a project are never put in every chat on their own. The model finds them with `recall`. You can switch **in every chat** on or off on a note in the web page, or press `p` in the terminal.

The start of every chat also says how many notes there are, such as `You: 6. This project: 14. History: 0 sessions.`

## Keep a note away from paid models

A note never goes somewhere less private than the chat it is used in. A model on this Mac, such as one run by Ollama, may always read a note. A paid model, such as one from Anthropic or OpenAI, may read it only when both are true:

- the note is **may be sent to a paid model**, and
- the chat is not private: its folder is not in your local-only list, and its route is not `local`.

| Where | How |
|---|---|
| One note | Switch off **may be sent to a paid model** on its row. The row then says "local models only" |
| A whole scope | Switch it off at the top of the You, This project or History tab. This writes `you`, `projects` or `history` in `[memory]` of `config.toml` |
| A whole project | Put `[memory]` with `private = true` in the project's `.golem/config.toml` |
| A local-only folder | A project note made there is local models only from the start |

When a paid model would have read a note you kept local, it sees `a local note was read here and is not sent to this model` instead. A summary that golem makes of a long chat is made from that text, so it never holds the note.

If you have no local model, a note set to local is not used at all, and its row says "not used: no local model is set up". Notes that may go to a paid model work the same with local models only, cloud models only, or both.

## See, edit, delete, export

### In the web app

Open Settings, then Memory. The tabs You, This project and History show a count each, and the box above them searches the words of every note.

Each row shows the title, who wrote it ("you said", "golem proposed"), its state, and its text. You can:

- **Edit** the text and save. A note is at most 2000 characters.
- **Delete** it. golem asks first. There is no trash. A chat that already used the note keeps its own copy in its history.
- Switch **in every chat** and **may be sent to a paid model**.
- **Export Markdown** or **Export JSON** for the tab. The file has every note of that scope, with its author, state and sources. For This project it has the notes of every project.

### In the terminal

Type `/memory`.

| Key | Does |
|---|---|
| `←` `→` or Tab | Change tab |
| `↑` `↓` | Move. Past the last row, the next page loads |
| `/` | Search. Enter runs it, Esc clears it |
| `e` | Edit the text in `$EDITOR` |
| `d`, then `y` | Delete. Any other key cancels |
| `p` | Switch in every chat |
| `x` | Export the tab |
| `k` | Keep a proposal. Not built yet: it says so |
| Esc | Close |

The This project tab shows the notes of this chat's project. `x` writes `golem-memory-<tab>.md` into the folder of the chat, such as `golem-memory-you.md`. Only you can read the file, and golem never writes over a file that is already there. Move it away and export again.

You can also open `~/.golem/memory.db` with any SQLite tool. Deleting that file removes all memory, and golem makes a new empty one when it starts.

Not built yet: exporting a single note, and a "changed since" mark for the files a note came from.

## Turn memory off

Set this in `~/.golem/config.toml`:

```toml
[memory]
enabled = false
```

golem then opens no memory file, adds nothing to the prompt, and gives the model no `recall` or `remember` tool. The Memory page and `/memory` say that memory is off. Your notes stay in `memory.db` until you turn it on again or delete the file. [Settings](./settings.md#memory) lists every key.

## Read more

- [Settings](./settings.md#memory), the `[memory]` keys.
- [Memory](../architecture/memory.md), how it works inside.
