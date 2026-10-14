# ADR-006: The checkpoint is the chat's memory

**Date**: 2026-10-07
**Status**: accepted

## The idea

A later turn has to see the earlier ones after the daemon restarts. The sentences on the screen are a different store.

`checkpoints.db` is the memory the model reads. The messages on screen belong to the TUI process that reduced them from live events. The durable event log now exists in `golem.db`. A client that rebuilds the screen from it waits for `session.attach`.

## What the code does today

`session.create` remembers `{session_id, model_profile}` and emits `session.created` on that connection. `message.send` checks that id against memory or the checkpoint thread, starts one graph task, and returns `run_id` at once. The graph is `START → call_model → END`. Its thread id is the session id. `AsyncSqliteSaver` stays open for the life of the daemon and writes `checkpoints.db`.

The TUI calls `session.create` once. A reconnect does not call it again. The next `message.send` loads `thread_id = session_id`. A session that was created and never sent has no checkpoint, so `message.send` returns `-32003`. The TUI starts a new session and says the old one was not found.

Events are JSON-RPC notifications with method `event`: `session.created`, `message.started`, `message.delta`, `message.completed`, `run.started`, `run.completed`, `run.failed`. Every event is written to `golem.db` before it goes to the socket, and `seq` continues from the log after a restart. Deltas are deleted when their `message.completed` is written, so `seq` can have gaps. If the socket drops mid-run, the graph task still finishes and still checkpoints. Nothing is replayed to a client yet.

A run that was still open when the daemon stopped is closed at the next start. Its assistant message gets a `message.completed` with the text streamed so far and `interrupted: true`, then `run.failed`. That partial text is also written into the checkpoint, so the next turn sees what the screen showed.

Closing the TUI drops the transcript. Restarting the daemon, then sending on the same session, keeps the model context.

## Other shapes that lost

Writing every token into `golem.db` now would build the log before the chat works. The screen would depend on a store this phase does not have.

Drawing the transcript from checkpoint state would make the TUI read graph messages. The protocol events already say what to draw.

Replaying missed events from the daemon's memory would be wrong after a restart, because `seq` is not durable.

## What it costs

Quit the TUI and the messages on screen are gone, even though the daemon still has the thread. Two TUI processes do not share a screen. A run whose client has gone still spends the model call. Those tokens are not shown later.
