---
title: Routines
description: Run a prompt on a schedule or when a file arrives, and list, run, pause, resume, and edit those routines from a shell.
---

# Routines

A **routine** is a prompt golem runs by itself: every weekday at 08:30, every hour, or when you ask. Each firing is a normal session you can open later. It is written as a `[[routine]]` in `config.toml`.

```toml
[[routine]]
name = "morning-brief"
schedule = "weekdays 08:30"
prompt = "Summarize my calendar and the open pull requests for today."
folder = "~/work/app"
```

A schedule is a cron line (`30 8 * * 1-5`) or one of these:

| Written | Means |
|---|---|
| `every 15m`, `every 2h` | every 15 minutes, every 2 hours |
| `daily 08:30` | every day at 08:30 |
| `weekdays 08:30` | Monday to Friday at 08:30 |
| `weekly mon 06:00` | every Monday at 06:00 |

Times are the Mac's local time. A routine that is due while the Mac sleeps follows its `missed` key: `skip` (the default) or `run_once`.

## When a file arrives

Instead of `schedule`, a routine can watch a folder with `on`:

```toml
[[routine]]
name = "receipts"
on = { watch = "~/Downloads", glob = "*.pdf" }
prompt = "/receipt-to-csv {path}"
```

Drop a PDF in `~/Downloads` and one session starts for it.

- A file fires when it is **new**, matches `glob` (matched on the file name, ignoring case; `*` if you leave it out), and has stayed **unchanged for 2 seconds**, so a download or a slow copy fires once, when it is done. A file moved in counts as new.
- Folders, dotfiles, and files ending in `.crdownload`, `.download` or `.part` are ignored.
- Files already in the folder when golem starts watching are ignored, and a restart does not fire old files again. Each file fires once.
- `{path}` (absolute), `{name}` and `{dir}` in the prompt are filled in. When the prompt is a `/skill` with arguments they are quoted for the shell, so a name with spaces stays one word.
- The session may read from the watched folder, and nothing else changes: the routine's folder, trust and tools apply as for a scheduled firing. The routine's origin is `routine:<name>`.
- A routine starts one file at a time. A file that settles while the previous run is still going waits, and fires when that run ends.
- If the folder is missing or cannot be read, the routine shows in the `issues` of `routine.list` and the log says why. It starts working when the folder does.

## In the web page

Open **Routines** in the sidebar. **+ New routine** opens a form, and **Edit** on a routine opens the same form. Under **When**, pick Every day, Weekdays, Weekly, Every N hours or Cron, and the page shows the next three times, which the daemon works out, so a wrong cron line is clear before you save. Pick **On new file** to watch a folder instead: a folder (type it, or **Browse…**) and a pattern such as `*.pdf`, and the page says what it will do, for example "Runs /receipt-to-csv for each new PDF in ~/Downloads". The **{path}**, **{name}** and **{dir}** chips put the placeholders into the prompt. Changing a routine from one kind to the other removes the key of the one it leaves. The list and the routine page say "New *.pdf in ~/Downloads" in place of a next time, and **History** shows the file of each run. The **Watch a folder** starter on the empty page fills this in. **What** is the prompt, with a **/ Skill** picker. **Where and with what** is the folder, the model and the MCP servers. Save writes the `[[routine]]` table into your `config.toml`. A project's routine is shown but not edited here; use **Open config**.

## Runs

Open **Runs** in the sidebar rail for one list of what golem did by itself: every routine firing and every `golem ask --detach`, newest first. The panel shows the groups in one line a run, and **Open Runs** (`/runs`) shows them as rows.

| Group | What is in it |
|---|---|
| **Needs you** | Runs that wait for an answer, such as a tool that asks for approval. The row says what it asks |
| **Running** | Runs that are queued or running |
| **Today** | Everything else that started today, in your local time |
| **Earlier** | The rest |

A row has a status dot, the routine's name (`golem ask` for a detached ask), what started it (`by schedule`, `by you`, `by new file receipt-0412.pdf`, or `from the CLI`), when it started, how long it took, and one line: the reply, the reason it failed, or the question. Click a row to open its session. A firing that was skipped never got a session, so it is in the routine's History and not in Runs.

A routine's session has a **banner** under its top bar: `Routine morning-brief · started 08:30 by schedule · 1 approval waiting`, with **Routine settings** and **All runs**. The approval itself is in the dock at the foot of the session, where you answer it.

The page reads the list with `run.list`, and refreshes it when a routine fires or ends and when a routine's session starts or stops waiting.

## From a shell

| Command | What it does |
|---|---|
| `golem routines` | One row per routine: its name, its schedule in words, the next run, the last result, and `paused` or `blocked` when that applies. `golem routines list` is the same |
| `golem routines run <name> [--wait]` | Fires the routine now and prints the session id. With `--wait` it waits for the firing and prints its summary, the way `golem ask` does |
| `golem routines pause <name>` | Writes `enabled = false` for the routine, so it stops firing. `golem routines run` still works |
| `golem routines resume <name>` | Sets `enabled` back to `true` |
| `golem routines edit` | Opens `config.toml` in `$EDITOR` at the first `[[routine]]`, then checks the file and prints each mistake with its line |

```
$ golem routines
morning-brief  weekdays at 08:30  tomorrow 08:30  succeeded 28m ago
tidy-notes     every hour         -               skipped (still running) 2h ago  paused
```

`golem routines run <name> --folder <dir>` runs a routine of the project in `<dir>`. A project's routines run only when that folder is trusted, and are edited in the project's own `.golem/config.toml`: `pause` and `resume` change your `config.toml` only.

### Waiting for a firing

`golem routines run morning-brief --wait` prints the session id on stderr and, when the firing succeeds, its summary on stdout, so you can pipe it. It exits with:

| Code | When |
|---|---|
| 0 | The firing succeeded |
| 1 | It failed or was skipped. The reason is on stderr |
| 3 | It stopped to ask you about a tool. Answer it with `golem open <id>` |

An unknown routine name prints the daemon's message and exits with 1.

## Not yet

`golem routines pause --all` is not offered yet. Pause the routines one by one.

See [Commands](./commands.md) for the other commands and [Settings](./settings.md) for `config.toml`.
