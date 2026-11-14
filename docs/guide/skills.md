---
title: Skills
description: Teach golem a job with a SKILL.md, run it by name, or keep it on for a whole chat.
---

# Skills

A **skill** teaches golem one job, such as "open a pull request the way this project likes it". It is a folder with a `SKILL.md`: a short header that says what it is for, then the instructions, in plain markdown. Scripts and notes can sit next to it.

```markdown
---
name: release-notes
description: Write release notes from the merged pull requests. Use when the user asks for release notes or a changelog entry.
---

# Write release notes

1. List the pull requests merged since the last tag.
2. Group them into Features and Fixes, one line each.
```

golem uses the same format as Claude Code and other agents ([agentskills.io](https://agentskills.io)), so the skills you already have work unchanged.

## Where golem finds them

The project's folders come first:

| Where | Folders |
|---|---|
| The project you chat in | `.golem/skills/`, `.agents/skills/`, `.claude/skills/` |
| Yours, on this machine | `~/.golem/skills/`, `~/.agents/skills/`, `~/.claude/skills/` |

golem also ships a few skills of its own. They come last, so a skill of the same name in your project or in `~/.golem/skills/` replaces the bundled one.

Put each skill in its own folder, named like the skill: `~/.golem/skills/release-notes/SKILL.md`. Save a change and golem sees it within two seconds, with no restart.

## See them

Type `/skills` in the chat to see every skill golem found, and why one is not used: it is broken, turned off, or a skill of the same name in the project hides it.

```bash
golem skills                                       # the same list, in a shell
golem skills check ~/.golem/skills/release-notes   # find mistakes before you share one
```

## Run one by name

Type `/release-notes v0.5`. The model gets that skill's instructions, with `v0.5` filled in where the skill asks for its arguments.

- Skills show in the `/` suggestions, with their argument hint.
- A command such as `/help` keeps its name, so `/skill run help` runs a skill of that name.
- A skill with `user-invocable: false` is left out of the suggestions.
- The transcript shows the line you typed, marked `◆ skill`. **Ctrl-O** shows the instructions the model got.
- Once a chat runs a skill, the model may read the files in that skill's folder, and its commands may run the skill's scripts. Nothing writes there.

## Keep one on

`/skill pin terse` puts that skill's instructions in front of every message to the model, for the rest of the chat. The status line shows `skills: terse`.

- `/skill unpin terse` turns it off, and `/skill` alone lists what is pinned.
- A pin survives a restart of golem, and `/fork` keeps it.
- Skills with `user-invocable: false` can be pinned too.
- Edit the skill, and the next message uses the new version.
- If you delete or break it, golem says so once, shows `terse (skipped)`, and goes on without it. It stays pinned, so fixing the file brings it back.
- A pinned skill's own files, such as `references/`, are readable while it is pinned.

## What works today, and what is next

golem finds, checks, lists, runs, and pins skills, and lets a skill read its own files. Letting the model pick a skill by itself when the task fits is the next step of [Phase 2](https://github.com/MilanPavel/golem/issues/10). How it works inside is in [Skills](../architecture/skills.md) and [Context](../architecture/context.md).

## Settings

In `~/.golem/config.toml`:

```toml
[skills]
disabled = ["release-notes"]   # listed, but never used
claude_dirs = true             # read .claude/skills folders (the default)
extra_dirs = ["~/team-skills"] # more folders of skills, after your own
```

A header field golem does not know yet is kept and shown as a warning, never an error. The fields it reads are `name`, `description`, `argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, and `model`.

The decisions are in [ADR-025](../adr/025-skill-sources.md), [ADR-030](../adr/030-skill-read-roots.md), and [ADR-032](../adr/032-pinned-skills.md).
