# ADR-009: The session list has its own notification

**Date**: 2026-10-15
**Status**: accepted

## The idea

The switcher shows every session with its title, whether a run is open, and when it was last active, and keeps that current while it is open. A client gets this by watching the list, not by attaching to every session.

A watcher gets one kind of message, `session.summary`, which carries the same `SessionSummary` that `session.list` returns. It sits next to `event`, not inside it, so it never mixes with a session's own stream.

A session gets a title once, after its first completed run. The title is an event in that session's log, so `sessions.title` is a projection like the rest of the table.

## What the code does today

`session.list {watch: true}` returns the list and marks the connection as a watcher until it closes. After every stored event except `message.delta`, `SessionLog` reads that session's row and sends its summary to every watcher. It does this inside the per-session lock, so one session's summaries arrive in order. Watching starts before the list is read, so a change can arrive before the list it is newer than. `last_seq` decides: `mergeSummary` in `@golem/client` keeps the copy with the higher `last_seq`.

`GolemClient.watchSessions()` sends that call, and hands each listed session, then each change, to `onSessionSummary`. After a reconnect it lists and watches again by itself.

After a session's first completed run, the manager starts a task that asks for a title. It is a separate task, so the session can take the next message while the title is chosen. `golem/sessions/titles.py` asks the session's own model, outside the graph, with a 20 s limit. The result is cut to its first line and 60 characters. If the call fails, times out, or returns nothing, the title is the first line the user wrote. The task emits `session.updated {title}`, and the projection writes `sessions.title`. A title still being chosen at shutdown is cancelled, and the next completed run tries again. `session_titles = false` in the config turns this off, and no title is set.

`session.rename {session_id, title}` sets a title by hand, cleaned the same way, and returns it. It emits the same `session.updated`. A blank title is `-32602`. The manager lock orders a rename against an automatic title still being chosen. Whichever lands first is kept, and an automatic title never replaces one that is already set. In the TUI, `/title <name>` renames the current session and `/title` alone shows its title.

`/sessions` replaces the transcript with the list. Up and down move, Enter attaches, `n` starts a new session while the filter is empty, and typing narrows the list by title. Ctrl-D asks before closing the selected row; `y` hides that session and the list stays open. Esc clears a filter, cancels that confirm, or closes the list. `/close` hides the current session and opens the newest one still listed, or a new session when it was the last. A running session is cancelled first. `session.closed` sets `closed_at`, `session.list` skips those rows, and a summary with status `closed` drops the row from a watched list. The events stay in the log. `/new` starts a new session directly. A running session has a green dot. The slash commands are one table in `commands.ts`.

## Other shapes that lost

Sending watchers the session's own `run.*` events would have needed no new message. The client, though, drops events at or below the last `seq` it saw for a session it follows. A watched event that arrived while an attach to the same session was in flight would move that `seq` forward, and part of the replay would be dropped.

A `session.updated {status}` event on every run start and end would put two extra events in each run's log, repeating what `run.*` already says.

Storing the title only in the `sessions` table, with no event, would make the table more than a projection, and a client attached to the session would not hear about it.

## What it costs

A watched daemon runs one extra SQLite read per stored event. That is a few per turn, not per token.

A summary repeats every field even when one changed. The rows are small, and the client can simply replace its copy.

Watching has no stop command. Closing the connection stops it. The TUI watches for as long as it runs.

Titles use the session's model until plan step 7.3 adds a cheap profile, so each new session costs one extra model call.

Protocol minor `2` adds `watch`, `session.summary`, and `session.updated`. Minor `3` adds `session.rename`. Minor `5` adds `session.close`, `session.closed`, and `closed` on a session summary. A `2.1` client never asks to watch, and its `asChatEvent` drops `session.updated`.
