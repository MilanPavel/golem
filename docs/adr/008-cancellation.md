# ADR-008: A cancelled run keeps what it said

**Date**: 2026-10-14
**Status**: accepted

## The idea

Stopping a long answer should not erase it. The words you saw stay on the screen, and the model sees them on the next turn, so "go on" or "no, shorter" makes sense.

A cancel ends a run the same way every time: the open reply completes with the text streamed so far, marked `interrupted`, then `run.cancelled` follows with a reason. The partial reply is written into the checkpoint too.

## What the code does today

`run.cancel {run_id}` finds the run task and cancels it. The reply is sent once `run.cancelled` is in the log. `cancelled` is false for a run that had already ended, and an id the daemon never ran is `-32006`.

The runner in `golem/sessions/runner.py` catches the cancel. It notes how far the turn got: whether `run.started` and `message.started` went out, the deltas so far, and whether the reply already completed. Then it closes what is open. `close_reply` in `golem/sessions/interrupted.py` writes the partial text into the checkpoint as the assistant message, with the same id and `response_metadata["golem_interrupted"] = True`, then emits `message.completed` with `interrupted: true`. It does nothing to the checkpoint when no token arrived. Crash recovery at startup uses the same function. The stream is closed with `aclosing` before the checkpoint is touched, so the graph run has ended first.

Every emit is shielded, so a cancel cannot leave an event half-written. `send` waits until the run task is inside its handler before it returns `run_id`, so even a cancel sent at once ends in `run.cancelled`.

The reason is `user` for `run.cancel`, and `shutdown` when the daemon stops. On shutdown every run is cancelled, its end is logged, and the queues are flushed before the sockets close. A run is closed by recovery, with `run.failed`, only when the daemon died without that chance.

In the TUI, Ctrl-C while a run is in progress sends `run.cancel`. Otherwise the first press shows "Ctrl-C again to exit" for two seconds, and a second press exits. That logic is `interrupt.ts`, a pure function. Ink's own Ctrl-C exit is off. An interrupted reply ends with `· interrupted`.

## Other shapes that lost

Dropping the partial reply from the checkpoint would keep the model's history clean, but the screen and the model would disagree about what was said. The next turn would answer a question the user no longer sees.

A separate `message.interrupted` event would make every client handle one more type for the same fact. A flag on `message.completed` keeps one end for every message.

Cancelling through a flag the graph checks between steps would wait for the whole model call, which is the slow part. Cancelling the task stops the HTTP stream.

## What it costs

A model that streams nothing before the cancel leaves a turn with a user message and no reply in the checkpoint. The next call sees two user messages in a row. The providers in use accept that.

`run.cancel` waits for the run's end to be written. A slow checkpoint write makes the reply slow too.

Protocol minor `1` adds `run.cancel` and `run.cancelled`. A `2.0` client ignores the new event, and its screen stays busy until the next event that ends the run.
