# ADR-001: One long-running process, clients that only attach

**Date**: 2026-10-05
**Status**: accepted

## The idea

Work should keep going after you close the program that showed it. A second program should be able to attach to the same work.

There is one process per user. Call it the daemon. It owns the files, the settings, and the log. Every other program is a client. A client connects, reads what happened, and sends commands. It does not store the work itself.

```mermaid
flowchart LR
  tui["TUI"] --> sock["Unix socket"]
  cli["CLI"] --> sock
  sock --> daemon["daemon"]
```

The socket is a file, `run/golem.sock`, inside the home directory. Its mode is `0600`: only your user can open it. That permission is the login check. There is no account system.

The home directory is the one `resolve_paths` picks, usually `~/.golem`. [architecture.md](../architecture.md) walks through that choice.

## What the code does today

`GolemPaths.socket_path` is `<home>/run/golem.sock`. `ensure_layout()` creates the `run/` directory. No module opens the socket. No module reads or writes a client message.

The parts of this split that already run are the home directory, `load_settings`, and `configure_logging`. They live in the `golem` package.

## Other shapes that lost

Putting the work inside the TUI process means closing the terminal kills the work. A second program cannot attach.

An HTTP server on localhost needs its own password. A socket file with mode `0600` is already limited to your user.

A hosted graph server would keep the files and the permission checks off this machine.

## What it costs

A client cannot call Python functions. Anything it needs has to cross the message shapes in [ADR-003](003-protocol.md).

A crash can leave the socket file behind after the process is gone. The next start has to tell a dead file from a live one. Nothing in the tree does that check yet.
