# ADR-057: golem keeps a snapshot of every file it changes, and undo is a new change

**Date**: 2026-11-15
**Status**: accepted

## Context

Phase 16 (#934) lets a session say what it changed, take a change back, and show it on screen. Today `commit()` in `tools/write.py` applies a change and returns the diff as the tool output, and nothing else remembers it. In autopilot no diff reaches the screen at all.

To show and undo a change, golem needs the text of the file before and after each write. The plan is in step 16.1 (#936) and step 16.2 (#937).

## Decision

1. **Own snapshots, not a shadow git repository.** The text before and after each write goes to the blob store (`BlobStore`, kept once under its sha256). Reasons:
   - It works in a folder without git.
   - It never writes into the user's `.git`.
   - It records per tool call, which git cannot: git sees the state of a folder, not which call made it.

2. **What is recorded.**
   - Every write by `write_file` and `edit_file`.
   - Changes made by a `shell` command, as far as golem can see them (step 16.1, #952).
   - Every undo.

   Not recorded: binary files, files over the read limit (`MAX_READ_BYTES`, 5 MB), and anything outside the session folder.

3. **Where, and how long.** The table `file_changes` and blobs of kind `file`, both in `golem.db`, which only the user can read. They live as long as the session's events. A file with a secret in it that golem edited is in `golem.db` afterwards. Deleting the session is how to remove it.

4. **Undo is a new change, not a deletion.** An undo writes the old text and records a change with `source: "revert"` and `reverts` set to the change it took back. So an undo can be undone ("redo"), and the history stays whole.

5. **Undoing a turn rewinds.** It takes back that turn and every later one: each file changed in that run or a later one goes back to its text before that run. Taking back a middle turn alone can produce a file no turn ever wrote.

6. **A file changed outside golem is never overwritten silently.** A file is `stale` when it is no longer what golem last wrote. An undo of a stale file writes nothing and lists the file as a conflict. Only `force` overwrites it.

7. **The model gets one line back from an edit** (for example `edited src/fetch.py (+18 -4)`). The screen gets the diff from the `file.changed` and `tool.completed` events (step 16.3, #938). The diff is no longer paid twice in the model's context.

## Alternatives Considered

### Alternative 1: A shadow git repository under `~/.golem`

opencode does this.

- **Pros**: git already stores, diffs and restores files.
- **Cons**: needs git. It records the state of a folder at a moment, not the call that made the change. A second object store grows beside the first.
- **Why not**: it fails the first two reasons above.

### Alternative 2: `git stash`

- **Pros**: no storage of our own.
- **Cons**: writes into the user's repository, needs git, touches the user's own stash, and cannot record per tool call.
- **Why not**: it changes the user's `.git`.

### Alternative 3: A copy of the folder

- **Pros**: simple to restore.
- **Cons**: large, slow, and it holds every file when only a few changed.
- **Why not**: the cost grows with the folder, not with the change.

### Alternative 4: Undo that deletes history

- **Pros**: the change list stays short.
- **Cons**: no redo, and the list no longer says what happened.
- **Why not**: an undo recorded as a change keeps both.

## Consequences

### Positive

- Undo and diff work in any folder, with or without git.
- Every change is tied to a run and a tool call.
- An undo can itself be undone, and the history is whole.
- Edits cost the model less context.

### Negative

- `golem.db` grows with the text of every changed file, once per distinct text.
- Shell changes are seen only as far as golem can see them.

### Risks

- A secret in an edited file stays in `golem.db` until the session is deleted. The docs say so plainly.
- A rewind can put back many files at once. Stale files are listed and skipped unless `force` is given.
