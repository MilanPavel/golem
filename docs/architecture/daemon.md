---
title: The daemon
description: Why an agent runs apart from the windows that show it, the ways agents usually do that, and how golem runs one daemon per user behind a Unix socket, with a lock, launchd, and no network port.
order: 3
adrs: [1, 4, 5, 19, 28, 33, 36]
---

# {{ $frontmatter.title }}

The program you look at and the program that does the work don't have to be the same program. An agent that answers in your terminal can also keep working after the terminal closes, if the work lives somewhere else. Where, though, and who starts it? And how does a window find it, and prove it is yours?

## The idea

::: concept In agents generally

Most programs are one process: you start it, it does the work, it draws the result, and it stops when you close it. An agent can be built that way, and many are. Four things push it apart:

1. **The work is longer than the window.** A long task, or one waiting for your approval, should not end because a terminal closed or a laptop slept.
2. **More than one window.** The same chat in a terminal and in a browser tab, or a timer that starts a task while no window is open.
3. **One owner for shared things.** The chat history, the API keys, the settings and rules, a local model server: one program should own each, not every open window.
4. **A broken window should not break the work.** A screen can crash, freeze, or be killed. The work should not notice.

So the agent becomes two kinds of program. A **daemon**, a background process that does the work, and **clients**, the windows that show it. A database server and its clients have the same split, and so does a print queue.

The split brings three questions of its own:

- **Who starts the daemon, and starts it again after a crash?** Usually the system's **service manager**: launchd on macOS, systemd on Linux.
- **How does a client find it, and prove who it is?** An address, such as a port or a file, and some kind of login.
- **How is there only one?** Two daemons writing the same files would corrupt them, so a start needs a **lock**.

And the two programs need a language to talk in. That is [the next chapter](./protocol.md).

![Why an agent runs apart from its windows. Inside the window, the chat, the model calls, and the tools are all in one terminal's process: close it, and the work stops with it. Apart, a background process holds the work, and a terminal, a browser tab, and later a timer attach to it. One window closes and the others and the work go on. Opened again, it catches up](../images/daemon-apart.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| In the terminal | The agent is the command you run. The chat lives in its memory | Nothing to install or start | Dies with the window. One window per chat |
| A server per window | The window starts a helper process for itself and stops it on exit, as editors do with language servers | A clean split between the screen and the work | Still dies with its window. Two windows share nothing |
| A local server on a port | A background process listens on `127.0.0.1`, as Ollama does on port 11434, or Jupyter with a token in the URL | Any language, and a browser can reach it | Any program on the machine, and any web page in a browser, can try that port. It needs a login of its own |
| A local server on a socket file | A background process listens on a Unix socket, a file in the file system, as Docker's daemon does with `docker.sock` | The file's permissions are the login. No port is opened | A browser cannot reach a file. Windows needs its own kind of socket |
| A hosted agent | The agent runs on a server far away, and windows are web pages | Any device, nothing on the machine | Your code and keys leave the machine, and the tools run far from your files |

The open problems are the same in every agent:

- **Two owners.** A daemon started by a window and another by the service manager will fight over the same files.
- **A crash leaves things behind.** A stale socket file or pid file must be told apart from a live one.
- **Upgrades.** A running daemon must finish or stop its work before a new version takes over.
- **Reaching it from a browser.** A web page is the easiest window to build, and the hardest to let in safely.

## How golem does it

::: golem In golem

golem takes the fourth way: one daemon per user, behind a Unix socket, started by launchd ([ADR-001](../adr/001-process-split.md)).

- **One process.** `golem-daemon serve` in a release, or `python -m golem serve` in a checkout. Every session, run, model call, tool, and MCP server lives in it, as asyncio tasks on one event loop.
- **One socket.** Clients connect to `~/.golem/run/golem.sock`. Its mode is `0600`, so only your user can open it, and that permission is the login. No network port is opened.
- **One lock.** A `flock` on `run/golem.pid` decides which daemon owns the socket ([ADR-004](../adr/004-pid-lock.md)).
- **One owner of its life.** launchd starts it at login, and again 2 seconds after it exits (`KeepAlive`, `ThrottleInterval 2`). The first time `golem` finds no daemon and no launch agent, the setup window asks whether to install one, or to run a daemon only while the window is open ([ADR-036](../adr/036-setup-window-asks-for-the-service.md)).
- **Clients only attach.** The `golem` command, one bun binary, is the TUI, `golem status`, and `golem web` ([ADR-019](../adr/019-single-binary.md)). None of them holds the chat. A browser reaches the daemon only through the gateway in `golem web` ([ADR-028](../adr/028-web-gateway.md)).

The start, in the order it runs:

1. **The lock.** `DaemonLock` takes the `flock` and writes the pid. When another process holds it, the start exits 1, and `run/last-error` says who holds it and how to stop it.
2. **The files.** It opens `golem.db` and `checkpoints.db`, copying each first when it must migrate ([Sessions that survive](./sessions.md#migrations-and-backups)).
3. **What a crash left.** `recover_runs` closes the runs that were open when the last daemon died ([Sessions that survive](./sessions.md#crash-recovery)).
4. **The socket.** Only now, with the lock held, it unlinks a stale `golem.sock`, binds a new one, sets mode `0600`, and listens.
5. **The watch.** Every 5 s it checks that the socket file is still the one it bound. If it is gone, the daemon stops, so launchd starts one that clients can reach.

![How golem's daemon starts. It takes a flock on run/golem.pid for the life of the process. It opens golem.db and checkpoints.db, copying them before a migration, and closes the runs a crash left open. Only then does it unlink a stale golem.sock, bind a new one with mode 0600, and listen. Every 5 seconds it checks that the socket is still its own. When it exits, launchd starts it again after 2 seconds. When the lock is busy, it exits 1 and run/last-error says who holds it](../images/daemon-start.svg)

Here is a real session against a throwaway home, with the paths shortened to `~/.golem` and the logger's name left out. First, a daemon listens with pid 10406, and a second one tries to start:

```text
$ lsof -a -p 10406 -i       # internet sockets: none
$ lsof -a -p 10406 -U | grep golem
python3.1 10406 … unix … ~/.golem/run/golem.sock

$ golem-daemon serve         # the same home, again
daemon already running (pid 10406)
another golem daemon holds the lock (pid 10406, .venv/bin/python
-m golem serve). Next: stop it with kill 10406
(exit 1)

$ golem status
connected
pid: 10406
version: 0.0.0-dev
protocol: 2.35
uptime: 1s
state: running
```

Then the daemon is killed with `kill -9`, so it has no chance to clean up:

```text
$ ls -l ~/.golem/run
.rw-------  6  golem.pid
srw------- -  golem.sock     # left behind
.rw------- 105 last-error

$ golem-daemon serve         # the next start
19:56:44 INFO listening on ~/.golem/run/golem.sock

$ rm ~/.golem/run/golem.sock # at 19:56:48
19:56:49 WARNING socket ~/.golem/run/golem.sock is
         gone; stopping
19:56:49 INFO shutting down
```

The `s` in `srw-------` marks a socket, and the `rw` for the owner alone is the whole login. The next start held the lock, so it knew the old socket was dead, removed it, and listened. A daemon whose socket disappeared stopped within a second, instead of running on with no way to reach it.

**Where it lives in the code:**

- `packages/daemon/golem/server/app.py`: `DaemonApp.serve`, the start in order, `_watch_socket`, and the drain on SIGTERM.
- `packages/daemon/golem/lock.py`: `DaemonLock`, the `flock` on `run/golem.pid`.
- `packages/daemon/golem/server/start_error.py`: `run/last-error`, written when a start gives up.
- `packages/daemon/golem/launchd.py`: the plist that `golem daemon install` writes.
- `packages/cli/src/main.ts`: the `golem` command, which finds the daemon or asks to start it.

:::

## Why this way

**A daemon, not an agent inside the TUI** ([ADR-001](../adr/001-process-split.md)). A chat that keeps going after the terminal closes, a second window on the same chat, and a web UI all need the work to live somewhere else. The cost: a client can't call a Python function. Everything it needs crosses [the protocol](./protocol.md).

**A Unix socket, not a port.** A port on `127.0.0.1` is open to every program on the machine, and every web page can try to reach it. Browsers have been used to attack local servers that trusted `localhost`. A server on a port needs a login of its own, a token or a password, and code to check it. A socket file with mode `0600` has that check built in: the operating system refuses anyone but you. There is no port to collide with another program, and none to leave open by mistake.

**A gateway for the browser, not a port on the daemon** ([ADR-028](../adr/028-web-gateway.md)). A browser can't open a socket file, so `golem web` stands between them. It lets in only the page it opened, and passes the same protocol lines on. All the network security lives in that one program, and the daemon has no web code at all.

**One process, not several services.** A run is an asyncio task, and the graph is a library the session manager calls ([ADR-002](../adr/002-langgraph-boundary.md)). Splitting the model calls, the tools, or the MCP servers into processes of their own would need a second protocol between them, and gain nothing on one machine. The cost: a crash takes everything down at once. launchd starts it again, and recovery closes what was open.

**launchd owns it, not the window.** A daemon that a window starts dies with the window, or lives on with no one to restart it. launchd is already the owner of background jobs on macOS, and it restarts a crashed daemon in 2 seconds. A daemon only while the window is open is still there, when you choose it ([ADR-033](../adr/033-golem-offers-to-start-the-service.md)).

**A `flock`, not a pid check** ([ADR-004](../adr/004-pid-lock.md)). The operating system reuses pid numbers, so "is pid 10406 alive?" can be answered by a different program. A `flock` is dropped by the kernel when its holder dies, however it dies.

**Python for the daemon, TypeScript for the clients.** LangGraph and the providers' libraries are Python. The terminal UI (Ink and React) and the browser are TypeScript. The split already made the two programs separate, so each is written in what fits it, and [the protocol](./protocol.md) is the only thing they share ([ADR-005](../adr/005-client-package.md)).

## Try it

1. Run `golem status`. It prints the daemon's pid, version, protocol, and uptime.
2. Run `ls -l ~/.golem/run`. `golem.sock` starts with `s` and has `rw` for you alone.
3. Run `lsof -a -p $(cat ~/.golem/run/golem.pid) -i`. It prints nothing: the daemon has no network socket.
4. Ask for a long answer in `golem`, and close the terminal while it streams. Open `golem` again: the answer has finished.
5. Run `golem daemon restart`. It prints the new daemon's version once a different pid answers.

## The details

For contributors: the reference for the daemon's process, its socket and lock, and what it owns.

### The process

One daemon per user. It starts when you log in, and launchd starts it again if it crashes. Closing the TUI does not stop it. That is the point: a chat can finish, or wait for your approval, while the TUI is closed.

Clients reach it through a Unix socket at `~/.golem/run/golem.sock`. The file mode is `0600`, so only your user can open it. That permission is the login check. There is no account and no password. `run/golem.pid` is the lock that lets a restart delete a socket left behind by a crash. Every 5 s the daemon checks that the socket file is still the one it bound. If it is gone or replaced, as when `~/.golem` is deleted, the daemon stops, so launchd starts one that clients can reach. [ADR-004](../adr/004-pid-lock.md) is that lock. A start that gives up on purpose (the lock is held, the socket path is too long, or `golem.db` is from a newer golem) writes the reason and the next step to `run/last-error` (`golem/server/start_error.py`). The lock case names the holder's pid and command line, which shows a checkout's path for a `uv run` daemon. While nothing answers, the TUI shows that file in its banner, and `golem status` prints it. With no such file and a launch agent installed, the banner says the service isn't answering, and `r` with an empty composer runs `golem daemon restart`.

### What the daemon owns

The socket is only the door. Behind it, these jobs sit in one process:

| Job | What it does | Status |
|---|---|---|
| Protocol server | Reads one JSON line at a time. Runs the command. Queues the reply, and the events of attached sessions, for that connection. | Built |
| Sessions | One chat or one flow run. Each has an id and a row in `golem.db`. | Built |
| Graph runtime | The agent loop. Its memory is the checkpoint. | Built |
| Model router | Resolves a profile name or `provider/model` ref to a chat model. | Built |
| Tools | Plain Python functions with a Pydantic argument model, in `golem/tools/`. The graph offers them to the model and runs them in its own `tools` node ([Tools](./tools.md)). | Built: file reads and writes, `shell`, git, `web_fetch` |
| MCP servers | Child processes or HTTP endpoints from `[mcp.<name>]`, started in the background, watched with `ping`, and restarted with backoff. Each session's tools come from `ToolRegistry.scoped` (`golem/mcp/`, [MCP](./mcp.md)). | Built |
| Permissions | Rules from the project, the user, and the defaults, checked in order before every tool call (`golem/permissions/`, [Permissions](./permissions.md)). | Built |
| Skills | The `SKILL.md` folders a session's folder sees, and which one each name means (`golem/skills/`, [Skills](./skills.md)). | Built: finding, listing, running by name, and pinning. The model picking one planned |
| Event log | The history. Every event, numbered by `seq`, written before it is sent. A client that reconnects reads it and rebuilds the screen ([Sessions that survive](./sessions.md)). | Built |

What the graph owns, and what it calls instead, is in [The agent loop](./agent-loop.md#what-the-graph-owns-and-what-it-calls).

### The start and the stop

- **The start.** `DaemonApp.serve` checks that the socket path fits (a Unix socket path has a length limit), takes the lock, loads the settings, and opens the databases. Then it builds the model router, the tool registry, the MCP supervisor, the skill registry, and the session manager. Recovery runs inside `_open_sessions`. Only then does it unlink a stale socket, bind, `chmod 0600`, remove `run/last-error`, log `listening on …`, and start the MCP servers and the skill watcher.
- **Connections.** Each accepted socket is a `ClientConnection` with its own queue and writer task. Each command runs as a task, so a slow one does not hold up the next line. The daemon takes up to 32 connections at once, and refuses more.
- **The stop.** SIGTERM or SIGINT starts the drain: `daemon.status` says `draining`, new connections are refused, every open run is cancelled with the reason `shutdown`, handlers get up to 5 s to finish, and each queue gets up to a second to flush. Then the socket is unlinked and the lock released.
- **launchd.** `golem daemon install` writes `~/Library/LaunchAgents/dev.golem.daemon.plist` with `RunAtLoad`, `KeepAlive`, `ThrottleInterval 2`, and `GOLEM_HOME` in its environment. `golem daemon restart` runs `launchctl kickstart -k`, so the old daemon drains before the new one takes the lock ([ADR-020](../adr/020-safe-upgrades.md)).

### Limits

- **`run/last-error` outlives its cause.** A start that gave up leaves the file until a start listens. If the holder it names dies before then, `golem status` still shows that reason, with a pid that is gone, until the next start.
- **One daemon per home.** Two homes, through `GOLEM_HOME`, can each run one, which is how tests and the traces in these chapters work.
- **macOS only.** The service manager is launchd, and the socket is a Unix socket. Linux would need a systemd unit.

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/server/app.py` | `DaemonApp`: the start, the accept loop, the socket watch, and the drain |
| `packages/daemon/golem/server/connection.py` | `ClientConnection`: one client's queue and writer |
| `packages/daemon/golem/lock.py` | `DaemonLock`: the `flock` on `run/golem.pid` |
| `packages/daemon/golem/server/start_error.py` | `run/last-error`: why a start gave up, and the next step |
| `packages/daemon/golem/paths.py` | `resolve_paths`: the home, and every path under it |
| `packages/daemon/golem/launchd.py` | The launch agent's plist |
| `packages/cli/src/main.ts` | The `golem` command: the TUI, `golem status`, `golem web`, and `golem daemon …` |

## Read more

- Next: [The protocol](./protocol.md), the language between the daemon and its clients.
- Before: [Talking to models](./models.md).
- [Install](../install.md), where the launch agent is set up.
- [The overview](../architecture.md): the whole system on one page.
