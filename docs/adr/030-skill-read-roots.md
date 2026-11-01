# ADR-030: The folder of a skill the session ran is a read root, never a write root

**Date**: 2026-10-31
**Status**: accepted

## Context

A skill is a folder: `SKILL.md`, and often `references/…` to read and `scripts/…` to run. Skills written for other agents tell the model to open these files by path, through `${CLAUDE_SKILL_DIR}`. Golem fills that in with the skill's folder (2.2.1).

Two things stopped that from working:

- The read tools (`read_file`, `list_dir`, `glob`, `grep`) only read inside the session folder. A user skill lives in `~/.golem/skills`, `~/.agents/skills`, or `~/.claude/skills`, outside every project.
- The shell sandbox keeps commands out of all of `~/.golem`, because it holds `golem.db`, the logs, and the config. So a script in `~/.golem/skills` could not even be read by `sh`.

## Decision

- **Read tools.** Each skill the session runs adds its folder to the graph state (`skill_folders`), so the list survives a restart and follows a fork. A pinned skill's folder is readable too, while it is pinned: each turn passes the folders of the pins the session can use now (step 2.3.4). The read tools accept an absolute path inside one of those folders. A relative path still means the session folder.
- **Never written.** The write tools still take only paths inside the session folder. The sandbox still allows writes only to the session folder, the temp folders, and the caches.
- **Sandbox.** It still denies reads of `~/.golem`, then allows reads of `~/.golem/skills`. In a sandbox profile the later rule wins. The other skill folders were never denied.
- **Credentials stay closed.** A path inside a skill folder that resolves into a folder the sandbox keeps from commands (`~/.ssh`, the rest of `~/.golem`, and so on) is refused. A skill folder that is a link to `~/.ssh` reads nothing there.

| Path | Read tools | Shell (sandbox) | Write tools |
|---|---|---|---|
| The session folder | yes | read and write | yes |
| The folder of a skill the session ran | yes, by absolute path | read | no |
| `~/.golem/skills/…` before the skill runs | no | read | no |
| `~/.golem/golem.db`, logs, config | no | no | no |

## Alternatives Considered

### Every listed skill's folder is readable

- **Pros**: Simpler. The model could read a skill before it runs it.
- **Cons**: A session would read every skill on the machine, not only the ones the user chose.
- **Why not**: The issue asks for active skills only. 2.4 (the model loads a skill) adds folders the same way, when the model picks one.

### Take `.golem` out of the sandbox's secret folders

- **Pros**: One line.
- **Cons**: Commands could read `golem.db`, the logs, and the config.
- **Why not**: Only the skills folder needs to be readable.

### Copy the skill's files into the session folder

- **Pros**: No new read root.
- **Cons**: It writes files into the user's project, and `${CLAUDE_SKILL_DIR}` would point at the copy, not the skill.
- **Why not**: Skills expect their own folder.

## Consequences

### Positive

- An invoked skill reads its `references/` and runs its `scripts/`, as it does in other agents.
- Nothing about writes changes.

### Negative

- A skill file needs its absolute path. The skill body already has one through `${GOLEM_SKILL_DIR}`.
- Read tools have no approval step, so a skill that the session ran can be read without asking. The user ran it, so this is the intent.

### Risks

- The sandbox closes `~/.golem` by its default place. With `GOLEM_HOME` set elsewhere, that folder was never closed to commands, and this change does not alter that.
- A project skill lives inside the session folder, so the shell could already write to it. This change does not make that better or worse.
- Approval rules for running scripts come in 2.6.2.
