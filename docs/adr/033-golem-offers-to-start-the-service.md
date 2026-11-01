# ADR-033: `golem` offers to start the service when nothing answers, and launchd still owns it

**Date**: 2026-11-01
**Status**: accepted

## The idea

`brew install milanpavel/golem/golem` does not start the daemon ([ADR-022](022-homebrew-tap.md)). Until now, a new user who typed `golem` got a chat that said `reconnecting` forever. Now `golem` checks first. If no daemon answers and there is no launch agent, it asks once, in plain lines, before the chat screen opens:

```
golem runs a small background service, so a chat keeps
going when you close the terminal.

Start it now and at every login?
  Enter  yes
  n      only while this window is open
  q      quit
```

- **Enter** runs `golem daemon install`, the same command as before, then waits until the daemon answers. launchd is still the one owner of the long-lived daemon.
- **n** runs `golem-daemon serve` as a child of `golem`. It stops with SIGTERM when the chat closes, so nothing is left running and no launch agent is written.
- **q** exits and says how to start the service later.

## What the code does today

`openTui` in `packages/cli/src/main.ts` calls `gateService` (`packages/cli/src/service-gate.ts`) before it imports the TUI. The gate is a pure function over its inputs, so the tests cover every path without a daemon:

- a daemon that answers (`daemon.status` over the socket) opens the chat;
- a plist at `~/Library/LaunchAgents/dev.golem.daemon.plist`, loaded or not, opens the chat and asks nothing. launchd owns that job, and a job that does not answer is a different problem (1.7.2);
- no terminal on stdin or stdout opens the chat and asks nothing, so a script never installs anything;
- otherwise it asks, with one key read in raw mode (`read-choice.ts`).

Both ways of starting wait up to 30 s for the daemon to answer, because the first start of a fresh build checks every library. A window daemon's stderr is read all along and kept, short, only to show why it never answered.

## Other shapes that lost

**Install the launch agent without asking.** One less key, but golem would start a program at every login that the user never agreed to. Rule 2 of #62 is never to install without asking.

**A `service` block or `post_install` in the formula.** ADR-022 explains why: two owners start two daemons.

**The question as a card inside the chat screen.** It looks nicer. But the TUI would need a state before it has a client, and callbacks into the CLI to find and run the daemon. `golem web` (1.7.5) would need its own copy. Asking before the screen opens is one code path for both.

**Start the daemon in the background without launchd, every time.** A daemon started by the TUI dies with the terminal, or lives on with no owner to restart it after a crash. That is only right when the user asks for it, which is what `n` does.

## What it costs

The check adds one socket connect before the chat opens. When no daemon is running, the socket is missing, so the connect fails at once. A user who picks `n` loses the point of the daemon: closing the window stops the chat. The prompt names that ("only while this window is open"). On Linux and Windows (Phase 8), `golem daemon install` fails with `launchd is macOS-only`, so the gate has to learn their service managers then.
