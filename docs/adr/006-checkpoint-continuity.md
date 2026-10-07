# ADR-006: The checkpoint is the chat's memory

**Date**: 2026-10-07
**Status**: accepted

## The idea

A later turn has to see the earlier ones after the daemon restarts. The sentences on the screen are a different store.

`checkpoints.db` is the memory the model reads. The bubbles belong to the TUI process that reduced them from live events. A durable event log, and a client that rebuilds the screen from it, wait until that log exists.

## What the code does today

`session.create` remembers `{session_id, model_profile}` and emits `session.created` on that connection. `message.send` checks that id against memory or the checkpoint thread, starts one graph task, and returns `run_id` at once. The graph is `START → call_model → END`. Its thread id is the session id. `AsyncSqliteSaver` stays open for the life of the daemon and writes `checkpoints.db`.

The TUI calls `session.create` once. A reconnect does not call it again. The next `message.send` loads `thread_id = session_id`. A session that was created and never sent has no checkpoint, so `message.send` returns `-32003`. The TUI starts a new session and says the old one was not found.

Events are JSON-RPC notifications with method `event`: `session.created`, `message.started`, `message.delta`, `message.completed`, `run.started`, `run.completed`, `run.failed`. `seq` is counted in memory per session and starts again at 1 after a daemon restart. If the socket drops mid-run, the graph task still finishes and still checkpoints. Events that cannot be written are dropped. Nothing is replayed.

Closing the TUI drops the transcript. Restarting the daemon, then sending on the same session, keeps the model context.

## Other shapes that lost

Writing every token into `golem.db` now would build the log before the chat works. The screen would depend on a store this phase does not have.

Drawing the transcript from checkpoint state would make the TUI read graph messages. The protocol events already say what to draw.

Replaying missed events from the daemon's memory would be wrong after a restart, because `seq` is not durable.

## What it costs

Quit the TUI and the bubbles are gone, even though the daemon still has the thread. Two TUI processes do not share a screen. A run whose client has gone still spends the model call. Those tokens are not shown later.
