# ADR-010: A fork is cut from the checkpoint history

**Date**: 2026-10-15
**Status**: accepted

## The idea

Forking a session gives a new session that has the same conversation up to one message and nothing after it. You can try another direction without losing the first one. The source session is not touched.

The model's side and the screen's side are cut at the same place. Checkpoint messages and log events carry the same message id, so one id names the cut in both stores.

## What the code does today

`session.fork {session_id, at_message_id}` returns the new session's id. It does not attach the caller. The client attaches, as it does after `session.create`.

`ChatRuntime.fork` in `golem/graphs/chat.py` walks `aget_state_history` for the source thread, newest first. It takes the first checkpoint whose last message has that id. It writes those values to the new thread with `aupdate_state(..., as_node="call_model")`, with `session_id` set to the new session. The next `message.send` on the fork continues from there.

The manager checks the log first. The cut message must have a `message.completed` in the source's log. Then it writes the new thread, and logs the fork's `session.created` with `forked_from {session_id, message_id}`. The `sessions` row stores the same two columns. Then it copies the source's `message.completed` events up to and including the cut, with new `seq` numbers and their original `run_id`. A source with a title gives the fork the same title plus `(fork)`.

A message with no completed event, or no checkpoint ending at it, is `-32007`. A session from before the event log has an empty log, so it cannot be forked. An interrupted reply with no text was never written to the checkpoint, so it cannot be a cut either.

Forking at an assistant message keeps that reply. Forking at a user message keeps the question and drops its answer, so the next send on the fork adds a second user message after it.

The source may be running. The fork reads checkpoints that are already written, and the open turn is not copied.

In the TUI, `/fork` cuts at the newest finished message on the screen and switches to the new session. A message picker is not built.

## Other shapes that lost

Copying the source's current state and trimming its message list would break once plan step 9.5 compacts history. The trimmed list would no longer be the one the model saw at that point. The checkpoint history keeps that state as it was.

Copying every event, deltas and `run.*` included, would replay runs the fork never had, and the `runs` table would hold them twice. The completed messages are all the screen needs.

Giving the copied events new run ids would hide where each message came from.

## What it costs

`aget_state_history` reads checkpoints from newest to oldest. Forking near the start of a long session reads most of its history. That is fine at chat sizes. Compaction (plan step 9.5) may need a `before` bound.

A copied event's `run_id` names a run of the source session. `EventLog.for_run` returns those copies too. Recovery reads it only for runs still open, and the copies are completed messages, which it treats the same way.

Protocol minor `4` adds `session.fork`, `forked_from` on `session.created`, and `-32007`.
