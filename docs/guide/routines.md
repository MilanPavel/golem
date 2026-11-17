---
title: Routines
description: Run a prompt on a schedule, and list, run, pause, resume, and edit those routines from a shell.
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
