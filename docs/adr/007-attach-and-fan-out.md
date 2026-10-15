# ADR-007: A connection sees only the sessions it attached

**Date**: 2026-10-14
**Status**: accepted

## The idea

A run should outlive the TUI that started it. Another TUI, or the same one after a restart, should pick the run up and see every token, once, in order.

Events used to go to the connection that sent the command. Now they go to every connection attached to the session, and only to those. `session.attach` replays the stored events after a `seq`, then streams new ones. Because the connection that receives an event changed, the protocol is major `2`.

## What the code does today

`session.create` stores the session and its `session.created`. It does not attach the caller. A client that wants the events sends `session.attach` with `after_seq`, usually `0` for a new session. The reply carries the newest `seq`. `session.detach` stops live events for one session. Closing the socket detaches from all of them. `session.list` returns sessions newest activity first, each with `status` (`idle` or `running`), `title`, and `last_seq`.

`SessionLog` in `golem/sessions/log.py` owns `seq`. One lock per session covers two things. An emit stores the event, then publishes it. An attach reads the replay, queues it on the connection, then subscribes. No event can be stored between the replay read and the subscribe, so the client sees no gap and no duplicate. `EventBus` in `golem/sessions/bus.py` maps a session to the connections that follow it.

Each connection, in `golem/server/connection.py`, has an outbound queue and one writer task. Responses and events share that queue, so the order on the wire is the order they were queued. Publishing never waits on a socket. A client more than 20 000 frames behind is dropped. It reconnects and attaches from its last `seq`. On shutdown the daemon flushes every queue for up to a second before closing.

`@golem/client` remembers each attached session and the last `seq` it delivered. After `hello` on a reconnect it attaches to each one again from that `seq`, then reports `connected`. Events at or below that `seq` are dropped, because a replay can repeat what the client saw. A session the daemon no longer knows is forgotten.

At startup the TUI asks `session.list` for the newest session and attaches to it. With no session, it creates one and attaches. It sets the session before the attach, so the replay is drawn, and it ignores events for any other session. A dropped socket no longer clears `busy`. The replay after the reconnect says whether the run finished.

## Other shapes that lost

Keeping `session.create` and `message.send` streaming to their caller, and adding attach on top, would send a second copy to a caller that also attached. Every client would need to know which path an event took.

Subscribing first, buffering live events, replaying, then flushing the buffer is the usual gapless shape. The per-session lock gives the same guarantee with less code, because an attach is short next to a model call.

Writing to the socket from the emit would let one slow terminal stall every run it watches. Blocking on a full queue would do the same. Dropping the client turns that into a reconnect, which the replay already handles.

## What it costs

Major `2` refuses older clients. Both sides of this repository ship together, so nothing outside it breaks.

A client that skips `session.attach` sees no events. The `golem` command only reads `daemon.status`, so it is not affected.

A replay of a long session is sent as one burst inside the lock. An emit for that session waits until the burst is queued.
