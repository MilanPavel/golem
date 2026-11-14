---
title: Skills
description: How an agent learns a job it is not trained for without filling every call, and how golem finds skills, picks the one a name means, and runs it.
order: 10
adrs: [25, 30]
---

# {{ $frontmatter.title }}

A model knows a lot in general and nothing about how your team writes release notes, reviews a diff, or ships a change. You can paste the steps into the chat each time, or put every recipe into the system prompt and pay for all of them on every call. So how does an agent keep many jobs at hand, and read one only when it is needed?

## The idea

::: concept In agents generally

A **skill** is a written recipe for one job: a short name and a one-line description, then the instructions, and any files the instructions need, such as a style guide or a script. It is a folder of text, so it can be read, reviewed, and shared like code.

The trick is to reveal it in steps, which is called **progressive disclosure**:

1. **The index.** Every call carries one line per skill: its name and what it is for. Fifty skills cost fifty short lines.
2. **The body.** When a skill is used, its instructions are read into the chat, once.
3. **The files.** A file next to the body is read only when the body says to read it, or a script is run only when it says to run it.

Somebody has to decide that a skill is needed. There are three ways, and agents mix them:

- **You name it.** `/release-notes 0.4.0` runs that skill now, with your words filled in.
- **You keep it on.** A pinned skill is in the system prompt of every call, for the whole chat ([Context](./context.md)).
- **The model picks it.** It reads the index, decides a skill fits, and asks for its body with a tool call.

![Progressive disclosure in three levels. The index, one line per skill, goes into every call. When the model picks release-notes, its body is read. The body says to read references/style.md, so that one file is read, and scripts/changelog.sh never is](../images/skills-levels.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| Everything in the system prompt | Every recipe goes into one big instructions file | Nothing to choose | Every call pays for every recipe, and they crowd each other |
| Saved prompts | Named templates you run with a slash command | You decide, so it is never wrong | Only what you remember to run |
| Skills with an index | A `SKILL.md` per folder; one line each in the prompt, the body on use. The [Agent Skills](https://agentskills.io) format, used by Claude Code and others | Many skills for little context | The model has to notice that one fits |
| Retrieval | Embeddings pick the few skills that look closest to the message | Scales to hundreds | A miss is silent, and it needs an embedding model |

Every version also has to answer:

- **Which copy wins.** The same name can exist in the project and in your home folder.
- **What a skill may do.** A skill is text from somewhere: a project you cloned, or a folder you copied. Its instructions should not grant it more than the rules do.
- **When an edit shows.** A skill you are writing should update without a restart.

## How golem does it

::: golem In golem

golem reads the Agent Skills format, so a skill written for another agent works unchanged ([ADR-025](../adr/025-skill-sources.md)). The daemon owns the skills, as it owns sessions and rules:

- **Found per folder.** Each session has its own project folder, so each one sees its own list: the project's skills first, then yours, then golem's own.
- **The first working one wins a name.** A broken skill never wins, and every skill that lost stays in the list, with the reason.
- **Kept current.** Every two seconds the daemon checks whether a `SKILL.md` or `config.toml` changed, and tells every client.
- **Run by name.** `/release-notes 0.4.0` gets the skill's body, with `0.4.0` filled in, as your message. The skill's folder then becomes readable for the session ([ADR-030](../adr/030-skill-read-roots.md)).
- **Pinned.** `/skill pin terse` puts the body in the system prompt ([Context](./context.md)). The model picking a skill itself is the next step.

![The skills one project folder sees, from a real skill.list. The project's folders come first: release-notes and terse win, and Notes is broken because its name must be lowercase. The user's own release-notes is shadowed by the project's. Golem bundles none yet](../images/skills-sources.svg)

Here is a real run, recorded against a throwaway home with `qwen3-coder:30b` on a local Ollama. The project's `.golem/skills/release-notes/SKILL.md` has `name: release-notes` and `argument-hint: <version>` in its header, and this body:

```markdown
Write the release notes for version $ARGUMENTS.

First read ${GOLEM_SKILL_DIR}/references/style.md and follow it. Then read
CHANGES.txt in the project folder, and write the notes in your answer.
```

`message.send` with `skill: {name: "release-notes", args: "0.4.0"}` gives these events. Paths are shortened to start at the project folder:

| seq | Event | What it says |
|---|---|---|
| 2 | `skill.activated` | `how: "invoked"`, `source: "project"`, and the `SKILL.md` hash |
| 3 | `message.completed`, the user's | The body, filled in: `Write the release notes for version 0.4.0.` and the skill's real folder in place of `${GOLEM_SKILL_DIR}` |
| 43 | `tool.requested` | `read_file` of `proj/.golem/skills/release-notes/references/style.md`, an absolute path in the skill's folder |
| 45 | `tool.completed` | `5 lines`: the style guide |
| 71 | `tool.requested` | `read_file` of `CHANGES.txt` |
| 127 | `message.completed` | `# Release Notes 0.4.0`, then three lines, `Added …` and `Fixed …` |

`read_file` took the absolute path because the skill ran in this session. Before that run, the same path is outside the project folder and is refused.

**Where it lives in the code:**

- `packages/daemon/golem/skills/registry.py`: `SkillRegistry`, its `view` and `check`, and the sources.
- `packages/daemon/golem/skills/parse.py`: `parse_skill` and `read_body`.
- `packages/daemon/golem/skills/invoke.py` and `expand.py`: `invoke`, which runs a skill by name, and `expand`, which fills in its body.
- `packages/daemon/golem/server/handlers.py`: `skill.list`.

:::

## Why this way

**The Agent Skills format, read loosely** ([ADR-025](../adr/025-skill-sources.md)). Skills you already wrote for Claude Code work here. Where Claude Code accepts a file the format would refuse, such as one with no header, golem accepts it too.

**The project first, and a broken skill never wins.** A project's skill is the most specific for that folder. But a typo in a project's copy should not hide your working one, so only a valid skill can win a name.

**A skill is text, so trust plays no part in finding it.** Listing and reading a skill is like reading any file in the project. What a skill may *do* goes through the same rules and approvals as any tool call.

**Polling, not a file watcher.** Every two seconds, compare a stamp per file. It works the same on every file system, and golem already reloads rules, models, and MCP servers this way.

**A skill's folder is readable once it runs, never writable** ([ADR-030](../adr/030-skill-read-roots.md)). A skill's body often says "read `references/…`" or "run `scripts/…`". So the read tools accept its folder from the moment the session runs it, and nothing writes there.

## Try it

1. Make `.golem/skills/release-notes/SKILL.md` in your project, as in the run above.
2. Open the chat with `golem tui` in that folder and type `/skills`. The skill is listed under the project. Open it for its details.
3. Type `/rel` and see it in the suggestions, with `<version>`. Run `/release-notes 0.4.0`. Ctrl-O shows the filled-in body under your line.
4. Break the header, for example `name: Release_Notes`, and run `golem skills check .golem/skills/release-notes` in a shell. It prints the error and exits with 1.

## The details

For contributors: the reference for finding, checking, listing, and running skills. Pinning is in [Context](./context.md#pinned-skills).

A skill is a folder with a `SKILL.md`: a short YAML header (`name`, `description`) and then the instructions, in markdown. Scripts and reference notes can sit next to it. Golem reads the [Agent Skills](https://agentskills.io) format that Claude Code uses, so a skill written for another agent works here unchanged. [Skills](../guide/skills.md) says how to write one and where to put it.

### The idea: cheap until it is used

A model's context is small, and most skills are not needed in most turns. So a skill reaches the model in three levels, each only when it is needed. This is what the Agent Skills format calls progressive disclosure:

| Level | What the model sees | When | Status |
|---|---|---|---|
| 1. Index | One line per skill: its `name` and `description` | Every model call | Planned (2.4) |
| 2. Body | The instructions in `SKILL.md` | When the skill is used | Built for `/name` and pins. The model loading one is planned (2.4) |
| 3. Files | `references/`, script output | When the body says to read or run them | Built (2.2) |

A skill can be used in three ways, and all three need the registry below:

| Way | Who decides | Where the body goes | Status |
|---|---|---|---|
| `/ship fix the mcp restart` | You | Your message, with your words filled in | Built |
| `/skill pin ship` | You | The system prompt, until you unpin it | Built |
| `load_skill("ship")` | The model | A tool result | Planned (2.4) |

The daemon owns the skills, as it owns sessions and rules. Graph state will hold only skill names, never bodies, so checkpoints stay small. A skill can never do more than the rules allow: whatever it asks for goes through the same permission check and approvals as any tool call (2.6).

### Running one by name

**In the daemon.** `message.send` with `skill` runs one by name: `golem/skills/invoke.py` finds it in the session's view, reads its body from disk, and fills it in with `golem/skills/expand.py`. The run logs `skill.activated`, then the user message with the filled-in body as its `text` and the skill's name and arguments as `skill`. A skill the session cannot run is error `-32013`, and no turn starts.

**The placeholders.** `$ARGUMENTS` is the whole argument string, as typed, and `$ARGUMENTS[N]` and `$N` are one argument, counted from 0, after a shell-style split; a missing one is empty. `${GOLEM_SKILL_DIR}` and `${CLAUDE_SKILL_DIR}` are the skill's folder, and `${GOLEM_SESSION_ID}` and `${CLAUDE_SESSION_ID}` the session. `\$` is a literal `$`. When arguments are given but the body uses none of these forms, `ARGUMENTS: <args>` is appended (`golem/skills/expand.py`).

**In the TUI.** `/name` runs a skill when no command has that name, and `/skill run <name> [args]` always does. The arguments are the rest of the line, with their spacing and quotes kept. The `/` suggestions list the skills you can run, with their `argument-hint`, from the same `skill.list` that `/skills` shows. Skills with `user-invocable: false` are not listed and not run (`packages/view/src/commands.ts`).

**In the transcript.** The transcript draws a user message that has `skill` as the typed line, `/ship fix the mcp restart  ◆ skill`, and Ctrl-O shows the filled-in body under it (`packages/tui/src/layout-chat.ts`). A reattach replays the same event, so it draws the same line. `/debug model` still shows the full text the model got.

**The skill's folder.** Each run of a skill adds its folder to the graph state (`skill_folders`), so it survives a restart and a fork copies it. The read tools take an absolute path inside one of those folders, and refuse one that resolves into a folder the sandbox closes. The write tools never take one ([ADR-030](../adr/030-skill-read-roots.md)).

### Finding and listing

**1. Reading one skill** (`golem/skills/parse.py`). Only the header is read, at most 64 KB, and the body is read later, when the skill is used. A problem never stops golem: the skill is kept with its `errors`, and is never used, or with `warnings`, and is used anyway. The Agent Skills rules apply: `name` is lowercase letters, digits, and single hyphens, it matches the folder, and `description` is at most 1024 characters. Where Claude Code is looser, golem follows it: `name` may be left out, a missing `description` falls back to the first paragraph of the body, and a file may have no header at all. A `SKILL.md` over 1 MB is an error. Claude Code fields that golem does not use yet (`context`, `agent`, `hooks`) give a warning.

**2. Where it looks** (`golem/skills/registry.py`). A session's own folder first, then the user's folders, then golem's own skills:

1. `<folder>/.golem/skills`, `<folder>/.agents/skills`, `<folder>/.claude/skills`
2. `~/.golem/skills`, `~/.agents/skills`, `~/.claude/skills`, then `[skills] extra_dirs`
3. Bundled with golem (2.7)

Each source is read one level deep. A folder with a `SKILL.md` is a skill, and a name that starts with `.` or `_` is skipped. Symlinks are followed, and a folder reached twice counts once, so this repository's `.claude/skills`, which links to `.agents/skills`, lists each skill once.

**3. Who wins a name.** The daemon serves every session, and each session has its own folder, so there is no single list. `SkillRegistry.view(folder)` builds the list one folder sees. The first valid skill of a name wins. A broken skill never wins, so a broken copy in a project does not hide your working one. Every skill that lost stays in the list with `shadowed_by`, the folder of the winner, and `[skills] disabled` marks a skill that is listed but never used. Trust plays no part here: a skill is text, like any file in the project. What a skill may do without asking is decided in 2.6.

**4. Kept current.** A parsed skill is cached until the stamp of its `SKILL.md`, its modification time and size, changes. Every two seconds, `SkillRegistry.check` compares the stamps of the user's folders, and of each session folder the registry was asked about, with what it saw last. It also reads `[skills]` again when `config.toml` changes, and a file that does not validate keeps the last good settings. A change sends `skill.registry.changed` to every connection, with `root` set to the session folder, or `null` when every folder is affected. Golem polls instead of using a file watcher, the same way it reloads rules, models, and MCP servers ([ADR-025](../adr/025-skill-sources.md)).

**5. Seeing them.** `skill.list {cwd}` returns every skill found, winners first, each with its `source`, `path`, `usable`, `shadowed_by`, `errors`, `warnings`, and header flags. `/skills` in the TUI shows them by source, and opens one with its details. `golem skills` prints the same list. `golem skills check <path>` runs the parser in the daemon executable without a running daemon, prints every error and warning, and exits with 1 on an error.

The settings, `[skills] disabled`, `claude_dirs`, and `extra_dirs`, are in the [Settings](../guide/settings.md).

### Files

| File | What it does |
|---|---|
| `golem/skills/model.py` | `Skill`, what golem knows about one folder |
| `golem/skills/parse.py` | Reads and checks one `SKILL.md`. `read_body` reads the instructions |
| `golem/skills/registry.py` | Sources, winners, the per-folder view, the cache, and the watch |
| `golem/skills/check.py` | `golem skills check` |
| `golem/skills/expand.py`, `golem/skills/invoke.py` | Filling in a body, and running a skill by name |
| `golem/server/handlers.py` | `skill.list` |
| `packages/tui/src/skills-manager.ts` | `/skills` |
| `packages/view/src/commands.ts` | `/name` and `/skill run`, and the skill rows in the `/` suggestions |
| `packages/cli/src/format-skills.ts` | `golem skills` |

### What comes next

| Step | What you get |
|---|---|
| [2.4](https://github.com/MilanPavel/golem/issues/6) | The index in the system prompt, and a `load_skill` tool, so the model picks a skill itself |
| [2.5](https://github.com/MilanPavel/golem/issues/7) | A short list chosen by embeddings, for local models |
| [2.6](https://github.com/MilanPavel/golem/issues/8) | Trust: a skill's scripts ask first, and `allowed-tools` lets a trusted skill skip the ask, never past a deny rule |
| [2.7](https://github.com/MilanPavel/golem/issues/9) | Golem writes a skill for you to review |

Steps [2.2](https://github.com/MilanPavel/golem/issues/21), running a skill by name with its own files, and [2.3](https://github.com/MilanPavel/golem/issues/5), pinning and the system prompt, are built.

## Read more

- Next: [MCP](./mcp.md), tools from outside: servers that give golem more tools.
- Before: [Context](./context.md).
- [Skills](../guide/skills.md), the user's guide: writing one, where to put it, and the settings.
- [The overview](../architecture.md): the whole system on one page.
