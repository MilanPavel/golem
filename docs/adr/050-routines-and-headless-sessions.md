# ADR-050: A routine fires a headless session; `runs` stay agent turns, `routine_runs` are firings

**Date**: 2026-11-13
**Status**: accepted, amended 2026-11-13 (keep-awake matches ADR-051)
**Deciders**: Milan Pavel

## Context

Phase 4 ([#85](https://github.com/MilanPavel/golem/issues/85)) makes golem work while you are away. A **routine** is a trigger (a schedule, a new file, later a webhook) plus a target (a prompt, a `/skill`, later a workflow), run in a folder with a model and the MCP servers it may use. Nine steps build it. They share a few choices that are cheap to make now and costly to change after the protocol and the database have shipped:

- Two words are already taken. The `runs` table (`packages/daemon/golem/store/migrations.py`) and the `run.*` events are **agent turns**. Workflows (Phase 3, [workflows.md](../vision/workflows.md)) will have runs too.
- A firing has to be a session you can open, answer, and find later, not a second kind of object with its own chat page.
- Something has to start firings (a scheduler), tell you (a notifier), survive a closed lid, and decide what a project's `.golem/config.toml` may start by itself.

Most of the base already exists. `SessionManager.send` starts a run whether or not a client is attached. An approval is an interrupt: the run ends, `approval.needed` is stored, and the run waits in the log with no task and no timeout ([ADR-013](013-approvals.md)). A restart keeps a waiting run. `SessionSummary.status` already says `waiting`. What is missing is an origin, a summary when a run ends, a clock, and a way to reach you.

## Decision

### Terms and names

The UI uses these four words and never says "flow".

| Term | What it is | Stored as | Methods and events |
|---|---|---|---|
| **Skill** | Instructions (`SKILL.md`) the model follows | files | `skill.*` |
| **Workflow** | Python code, durable, resumable ([workflows.md](../vision/workflows.md)) | `workflow_runs` | `workflow.*` (designed in 3.0) |
| **Routine** | A trigger plus a target | `[[routine]]` in `config.toml` | `routine.list`, `routine.get`, `routine.run`, `routine.update` |
| **Run** | One execution of a routine or a workflow | `routine_runs`, `workflow_runs` | `routine.fired`, `routine.finished` |

- `runs` and `run.*` **stay agent turns.** Nothing is renamed. A routine firing is a `routine_run`, and it has one session, which has one or more `runs`.
- `routine.fired` and `routine.finished` are daemon-wide notifications to every connection, like `mcp.server.status`, not session events. `routine.fired {routine, routine_run_id, session_id, trigger}` names the trigger: `schedule`, `watch`, `manual`, or later `hook`. `routine.finished {routine_run_id, status, summary}` carries the outcome. A skipped firing sends `routine.finished` with `skipped` and no `routine.fired`.
- `routine.run` fires a routine now. It works while paused (you asked), still obeys trust, and is refused with a clear error while the routine's previous run is still running or waiting. `routine.update` creates, replaces, removes or toggles one `[[routine]]` through `config_edit.py`.
- The Runs list in the web and the terminal takes rows of a kind: a routine run now, a workflow run later (3.9). A client never infers the kind from the id.

### A headless session

A headless session is a normal session started with no client attached. It is not a new kind of object.

- **Origin.** `sessions` gets one column, `origin TEXT` (a new migration, appended; `NULL` reads as `user`). Values: `user`, `cli` (`golem ask --detach`), `routine:<name>`, and later `workflow:<id>`. `SessionSummary` carries it. A session's origin never changes. Clients show a small clock glyph for `routine:*` and filter on the prefix.
- **Approvals wait.** An `ask` in a headless session stops the run exactly as in a chat and waits, with no timeout, for as long as it takes. It is never turned into an allow or a deny because nobody is watching. A routine gets the same permission policy and deny rules its session would. It carries no rules of its own. A per-routine tool allow is 4.7, and needs skill trust (2.6).
- **A summary when it ends.** `session.completed {run_id, status, summary}` is stored in the session's log and sent to attached clients when a run in a session whose origin is not `user` ends: `status` is `completed`, `failed` or `cancelled`. A run that stops on an approval emits no `session.completed`; `approval.needed` is the event for that. When you answer and the run later ends, it does. `summary` is the last assistant message, cut at 280 characters. No extra model call makes it.
- **Answering.** The first answer wins, from any client or from a notification. A late answer from a stale tab is refused with the existing "nothing is waiting" error, and the page opens at the run's result and says it was answered. It does not quietly show the result as if the click had worked.

A routine firing creates a session (origin `routine:<name>`, the routine's folder, model and MCP servers), sends the prompt or the `/skill` through the same `send` a chat uses, and writes a `routine_runs` row:

`routine_run_id`, `routine` (name), `scope` (`user` or the project folder), `session_id`, `trigger`, `due_at`, `started_at`, `ended_at`, `status`, `reason`.

`status` is stored as `queued`, `running`, `succeeded`, `failed`, `skipped` or `cancelled`. `waiting` is not stored. `routine.get` and `routine.list` join the session's status to report it, so there is one source of truth. `reason` says why a firing was `skipped`: `missed`, `paused`, `untrusted`, `still running`, `quiet`.

### Where routines live

`[[routine]]` in `config.toml`, in the user file and in a project's `.golem/config.toml`, like `[[rule]]` and `[mcp.*]`. `GolemSettings` gets `routine: list[Routine]` (`extra="forbid"`, frozen, like `PolicyRule`). The keys are the ones the tickets use: `name`, `schedule` or `on = { watch, glob }`, `prompt`, `folder`, `model`, `mcp`, `missed`, plus `enabled` (default `true`). `config_edit.py` gets `add_routine`, `replace_routine`, `remove_routine` and `set_routine_enabled`, the way it has them for MCP servers, so the web editor and `golem routines edit` rewrite one table and keep your comments. `routine` joins `BROWSER_SETTINGS`, as `mcp` is: the browser edits routines through `routine.update`, and `config.raw.set` may touch the file as it may touch `mcp`.

- A **name** is unique within a scope. A project routine is shown as `name` with its folder, and `routine.get` takes `(name, folder?)`.
- **Pause is runtime state, not config.** `golem pause` (one routine or all, with an optional end time) is a row in a small `routine_state` table, so a restart does not un-pause, and a committed project file is never edited by a pause. `enabled = false` is the permanent off switch you write on purpose.

### Trust

A project's `[[routine]]` runs only when its folder is in `trusted_projects`, the rule project MCP servers follow ([ADR-023](023-mcp-client.md)): a project names programs and prompts to run, so a repository must not start work on your Mac because you cloned it.

- The daemon reads `.golem/config.toml` only for folders in `trusted_projects`. It does not walk the disk. An untrusted project's routines are not scheduled and are listed nowhere but by `golem doctor`, which says "routines in this folder are not running: trust it first".
- Trust is checked **again at each firing**. A folder that lost its trust fires nothing; the run is `skipped` with reason `untrusted`.
- A project routine's `folder` must be the project folder or inside it. A project file cannot aim a routine at your home folder.
- A project routine cannot name an MCP server the project does not already see through the user and project config. It cannot carry rules.

### The scheduler

**A small loop of our own, on a cron parser. Not APScheduler.**

- One asyncio task in the daemon. It keeps each enabled routine's next due time, sleeps until the earliest one, and sleeps at most 60 seconds at a time. The cap does two jobs: it notices a changed config file (mtime) and it notices that the Mac slept, because wall time has jumped by more than the sleep.
- Schedules are the cron the tickets show (`30 8 * * 1-5`) and a few plain forms (`weekdays 08:30`, `daily 08:30`, `mon 06:00`, `every 1h`, `every 15m`) that parse to the same thing. The web builder shows the next three runs from the same code. Times are local. A time that does not exist on a daylight-saving day fires at the next valid time; one that happens twice fires once.
- The parser is **`cronsim`** (pure Python, no dependencies, handles daylight saving). `croniter`, which the ticket names, is the fallback, and 4.2.2 may swap them behind `next_after(expr, now)` without changing anything else. Only that function is imported from the library.
- Due times are written to `routine_runs` before the session starts, so the table is both the history and the memory of what was already fired.
- **At most 2 routine runs run at once** (`[routines] max_running = 2`). The rest wait as `queued` in due order. One local model on one machine should not run eight 08:30 routines together.
- **A routine does not overlap itself.** If its previous run is still running, or waiting on an approval, a new due time is `skipped` with reason `still running`. A pending approval holds the next firing. It does not pile up a backlog behind it.

**Missed runs: the default is `skip`.** A missed run is a due time that passed while the daemon was down, the Mac asleep, or golem paused. `missed = "skip"` (default) drops it, and `missed = "run_once"` fires it once, late, and never more than once per routine, however many times it was due. The reasons:

- Most routines post, create, or tell you something. An 08:30 brief at 14:00 is noise, and a missed hourly triage is replaced by the next hour's.
- It is the safe error. A skipped brief costs you one note. A late run of something that posts or writes costs more, and you did not choose it.
- `run_once` is one key away for a routine like the weekly dependency report, where late is better than never.
- The rule is the same for sleep, a daemon restart, and a pause. Resuming a pause fires each `run_once` routine that was due, once, and fires nothing for a `skip` one. The pause message says which will happen. This replaces the mock's "one catch-up run per routine on resume", which would run `skip` routines too.
- A dropped firing is still a `routine_runs` row, `skipped` with reason `missed`, so History says what did not happen. It sends no notification.

**APScheduler (async)** was the other choice. It brings job stores and its own clock and triggers, and we would store due times in `golem.db` anyway (history, pause, missed). Its misfire options (`misfire_grace_time`, `coalesce`) do not map onto `skip` and `run_once` across a pause, and a second source of truth for "what is due" is what breaks when a Mac wakes. Our loop is about 150 lines, tested with a fake clock.

### Sleep

**golem holds a power assertion while a routine or a detached session is running or waiting for an answer, and does not try to wake the Mac.** This is the same rule as [ADR-051](051-relay-and-pairing.md), which this paragraph was amended to match on 2026-11-13.

- While at least one headless run is running, or is waiting for an approval, the daemon holds an idle-sleep assertion: it runs `caffeinate -i -w <daemon pid>`, and stops it when nothing runs or waits. A run that has **waited for an answer for 4 hours** no longer counts, so a forgotten approval does not keep a laptop awake all night. A waiting run stays awake so that an answer from the phone, or a notification you act on, can continue it at once. `[power] keep_awake = false` turns it off (it is on by default). Chats you are sitting at are not covered: you are there.
- The assertion stops **idle** sleep. Closing the lid still sleeps the Mac (unless it is on power with a display attached). golem does not claim otherwise, and does not fight it.
- **Waking the Mac for a 08:30 routine is out.** It needs `pmset schedule` and root. A routine due while the Mac sleeps is a missed run, under the rule above.
- **When the Mac sleeps mid-run,** the process is suspended and resumes on wake. A model call whose connection died fails the run in the usual way: `session.completed` with `failed`, and one failure notification. The run is not resumed on its own. Durable resume is what workflows are for (Phase 3). The next firing follows `missed` and fires if it is due.

Not holding the assertion (alternative: let the OS sleep) makes a one-hour local-model run fail whenever you step away. Holding it forever would keep a laptop awake on a battery for a routine that is waiting for you; the 4-hour cap on waiting bounds that.

### The notifier (4.1)

**M2 ships a small signed helper app, `golem-notify.app`, posted to by the daemon. The fallback, when the helper is absent, is `osascript`, with no click.**

- The daemon, which sees `approval.needed`, `session.completed` and `routine.finished`, decides **what** to tell you. A helper, one Swift file built with the release, only **shows** it. It is signed with the same certificate as the rest of the release ([ADR-021](021-release-signing.md)) as `dev.golem.notify`. macOS asks once for permission to notify, and the helper carries golem's icon.
- A click relaunches the helper with the notification's id, and the helper runs `golem open <id> --notified` and exits. `golem open` picks the place from `[notifications] open_in`. Nothing stays running to wait for a click.
- **Events (the part the phone shares, #745):** `needs_you` (an `approval.needed` in a session whose origin is not `user` and that no client is attached to), `failed` (a run ended `failed`), and `finished` (off by default). A notification is keyed by the session and replaced, not added, so a run that fails twice shows one banner. It is removed when you answer elsewhere or attach. A routine that keeps failing tells you **once**: a `failed` is sent when the previous run of that routine did not fail, and the next success clears the state.
- **Content is short and never private.** The routine's name and one line ("needs you: Allow `mcp__linear__create_issue`"). Never file contents, model text, or a path outside the project.
- **The click target defaults to the web page.** It works for everyone with the daemon running. It opens the session, `/s/<id>` today and `/runs/<id>` once 4.6.3 ships, scrolled to the approval. `open_in = "terminal"` opens a terminal tab that runs `golem open <id>`. Terminal.app and iTerm2 are supported first. Others are added on request.
- **"Allow once" in the banner is not in M2.** It would let an approval pass without the diff on screen, and a click only opens golem.
- **Per-routine overrides:** a routine may turn `finished` on and `failed` off. It can **never** silence `needs_you`. Settings gets a **Notifications tab**: it has room for the phone, and pause and quiet hours belong with the thing they quiet.

**Quiet hours hold every notification, `needs_you` included, in M2.** There is no `urgent`.

- Quiet hours (`22:00-07:30`) mean you chose not to be interrupted. A rule that lets some routines through is a rule you will write once and forget about.
- A held approval costs you nothing you would not have lost anyway: you were asleep, and the run waits with no timeout. The Runs list and the in-app badge still show it, and one summary ("2 need you") is sent when quiet hours end.
- A real urgent case, an alert routine, is real, so `urgent = true` is **reserved** as a key now. A routine with it would let `needs_you` and `failed` through. It is not built until someone asks, and adding a key to a forbidding model is a minor change.
- Pause does not silence an approval that is already pending, and quiet hours never stop a routine from running.

**When the Mac app exists (Phase 14 family),** the app posts notifications itself, with real actions, and the helper is retired. The event selection, the keys, `golem open <id>`, and the `[notifications]` settings stay as they are. Only the poster is swapped.

### What the lists show

- **A routine's session appears in the sidebar** with the clock glyph while it is running, waiting, or failed. A finished, succeeded routine session leaves the folder groups and lives in Runs. An hourly routine cannot flood the list, and a waiting approval is never lost. `session.list` returns all of them with their origin, so a client filters, and the protocol does not change for it.
- **Retention:** succeeded and skipped runs are kept 30 days, failed and cancelled ones 90 days, and a waiting run never goes. `[routines] keep_days` changes the first number. The routine run and its session are removed together. The pruning code is part of 4.2.2 if the session store has a delete path by then, and a follow-up ticket if it has not.
- **Where a workflow is edited:** a routine that starts a workflow shows "Edit workflow", which opens the Workflows page. The routine form links to a workflow and does not edit it inline (4.8).
- **The terminal** has separate `/routines` and `/runs` overlays, like `/mcp` and `/skills`. Its status line has **one** `runs: N waiting` segment for routines and workflows together; the overlay separates them.
- **The trace** of a run that waited draws the wait hatched and to scale, as the trace page already does ([ADR-041](041-session-trace.md)). The mock's squeezed wait is for the picture.

### What the code does today

Nothing of the above is built. `SessionManager.send` starts a run for a session no client is attached to. A run that hits an `ask` ends its task, is stored as `waiting`, and survives a restart ([ADR-013](013-approvals.md)). `SessionSummary.status` can be `waiting`. There is no `origin`, no `routine_runs`, no clock in the daemon, no notifier, and no dependency on a cron library. 4.0.2 adds the first two, 4.2.1 and 4.2.2 the rest.

## Alternatives Considered

### Alternative 1: Rename the `runs` table and `run.*` events

- **Pros**: "Run" would mean one thing for the user.
- **Cons**: It is a migration of every stored run and a breaking change of every event the TUI, web and phone already read. `schema_version` rules forbid it for some columns.
- **Why not**: The user word and the storage word can differ. The UI says "run" for a routine firing and a workflow run. The code keeps `runs` for turns.

### Alternative 2: A routine firing is its own object with its own page

- **Pros**: No clutter in the session list. A tailored view.
- **Cons**: A second chat view, a second approval card, a second attach path, and a place where an approval can be answered and not found.
- **Why not**: A session already has all of it, including answering from the phone. A routine run **is** a session with an origin.

### Alternative 3: APScheduler

- **Pros**: A known library with many trigger types and a persistent store.
- **Cons**: See the scheduler section: a second clock, a second store, and misfire options that do not fit our rules. More dependencies in a binary that ships as one file.
- **Why not**: The hard part is catch-up and pause, not computing the next time. We have to write that anyway.

### Alternative 4: `launchd` `StartCalendarInterval` for each routine

- **Pros**: The OS wakes it, even from sleep on a schedule, and survives a daemon crash.
- **Cons**: One job per routine, edited by writing plists. It cannot express `every 1h` after a missed hour, pause, or `run_once`. Windows and Linux would need another scheduler.
- **Why not**: The daemon is already kept running by launchd ([launchd.py](../../packages/daemon/golem/launchd.py)). A second layer of clocks is harder to explain and to test.

### Alternative 5: `osascript` or `terminal-notifier` as the notifier

- **Pros**: `osascript` needs nothing installed. `terminal-notifier` supports a click action.
- **Cons**: `osascript display notification` is attributed to Script Editor, and clicking it does not reach golem, so 4.1's "click it and land on the session" cannot work. `terminal-notifier` is a third-party binary to install, written against a notification API Apple has deprecated, and its icon and permission belong to a program that is not golem.
- **Why not**: The first misses the goal. The second is a dependency we cannot update or sign. The helper is one file, signed like the rest of the release, and it is the shape the Mac app replaces. `osascript` stays as the fallback so a checkout still tells you something.

### Alternative 6: `missed = "run_once"` as the default

- **Pros**: Nothing is ever lost. A weekly report always arrives.
- **Cons**: A routine that posts, writes, or tells you something fires late, once you open the lid, in a pile with every other routine that was due.
- **Why not**: The wrong default does more damage in this direction. The routines that want it opt in.

### Alternative 7: No power assertion, or `caffeinate` always on

- **Pros**: None, or no change.
- **Cons**: Without one, a long routine dies when you step away. Always on, a laptop never sleeps.
- **Why not**: It is held only while a headless run has a task, and a waiting run holds nothing.

### Alternative 8: `urgent` routines may break quiet hours now

- **Pros**: An alert routine can wake you.
- **Cons**: A second setting to get wrong in the first release, and most routines would set it.
- **Why not**: Quiet hours that hold everything are easy to trust. The key is reserved, not built.

## Consequences

### Positive

- A routine firing is a session. Everything that works for a session (attach, the approval band, the trace, the session list, the phone) works for a routine, with no second UI.
- Every word the user sees has one meaning, and no stored name changes.
- The same rules apply when nobody is watching: no extra rights, no auto-answered approval.
- The notifier's event selection and `golem open` outlast the helper app, the phone, and the Mac app.

### Negative

- A helper app is one more thing to build and sign in the release, and macOS asks once for permission to notify. The release job needs a Swift toolchain, which the macOS runner has.
- A routine due while the Mac sleeps does not run (`skip`), and golem does not wake it. A routine you cannot afford to miss needs `run_once`, power, or a mac that is awake.
- A routine waiting for an approval blocks its own next firing. You see a `skipped: still running` row, not a pile of questions.
- A routine can only use the policy its session has. A routine that needs `shell` without asking has to wait for 4.7.

### Risks

- A self-signed helper may be blocked when the archive is downloaded in a browser, as the rest of the release is ([ADR-021](021-release-signing.md)). The Homebrew install is not.
- `cronsim` is a small dependency with one maintainer. It is used through one function and can be replaced with `croniter` in a day.
- A paused-and-restarted daemon relies on the `routine_state` row. If it is lost, routines resume, which is the safe direction for a routine and the unsafe one for "on holiday". `golem status` shows `paused`, and the Mac app and the phone will show it too.
- A retention rule that keeps failed runs 90 days could keep a lot of sessions for a routine that fails every minute. The "tells you once" rule helps the user. A cap per routine may be needed.
