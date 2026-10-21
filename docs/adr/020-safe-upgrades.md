# ADR-020: An upgrade copies a database first, and a newer one is refused with a way back

**Date**: 2026-10-21
**Status**: accepted

## The idea

A new release must never break an old release's data. Before a daemon changes `golem.db` or lets a new LangGraph open `checkpoints.db`, it copies the file. A daemon that is too old for a file leaves it alone and says what to do.

## What the code does today

`Database.open` reads SQLite's `user_version`. When migrations are pending and the file is not new, `golem/store/backup.py` copies it to `golem.db.bak-<schema>` with SQLite's backup API. The copy is written as `….partial` with the original's permissions and renamed when complete. Then each migration runs in its own transaction, which also writes `user_version` and, from schema 6 on, a `schema_version` row with the golem version that applied it.

When `user_version` is above what the daemon knows, it raises `DatabaseTooNewError` before it changes anything. The message names the golem version from `schema_version` for that schema, and `golem.db.bak-<schema>` when this daemon's schema has a copy. That table's columns never change, because daemons older than the file read it.

`library_versions` in `golem.db` holds the versions of `langgraph`, `langgraph-checkpoint`, and `langgraph-checkpoint-sqlite` that last opened `checkpoints.db`. `open_checkpoints` compares them with the installed ones. When they differ, it copies the file to `checkpoints.db.bak-<langgraph version>`, or `bak-unrecorded` the first time, records the new versions, and only then opens `AsyncSqliteSaver`. Recording before the open means a start that fails afterwards does not replace the good copy with a half-changed one on the next try.

`golem daemon restart` runs `launchctl kickstart -k`, so the old daemon gets SIGTERM and drains before the new one takes the lock. The CLI then waits for a daemon with a different pid to answer and prints its version.

## Other shapes that lost

**Only a `schema_version` table, no `user_version`.** The number would need a bootstrap for files from before the table, and a file from a much newer daemon could have a table this daemon does not understand. `user_version` is in the file header, so every daemon can read it.

**Name copies by golem version.** Every checkout is `0.0.0-dev`, so copies would overwrite each other. The schema is what decides whether a daemon can open a copy, so it is the name.

**Copy `checkpoints.db` on every golem upgrade.** That file can be large, and most upgrades do not change LangGraph. Its format belongs to those three packages, so their versions are the trigger.

**Keep the LangGraph versions in `checkpoints.db`.** That file is LangGraph's ([ADR-002](002-langgraph-boundary.md)), and wiping it should stay safe.

## What it costs

Each upgrade that migrates leaves a full copy next to the database, and nothing deletes old copies yet. Phase 7's nightly backups can take over pruning. A file at schema 5 or older has no `schema_version` history for that time, so a too-new error for those schemas cannot name a golem version. Only releases from schema 6 on can.
