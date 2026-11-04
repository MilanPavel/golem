# ADR-036: The setup window asks for the service, inside the chat screen

**Date**: 2026-11-03
**Status**: accepted

## The idea

[ADR-033](033-golem-offers-to-start-the-service.md) had `golem` ask about the service in plain lines, before the chat screen opened. Testing v0.5.0 on a bare Mac showed two problems. After Enter nothing moved while launchd started the daemon, so golem looked stuck. And the next question, how golem should think, came in a different screen with a different look.

Step 1.9 ([#343](https://github.com/MilanPavel/golem/issues/343)) makes setup one window, drawn in `docs/design/setup-window.md`. Its first panel is the service question. So `golem` now opens the chat screen at once, and the screen opens the setup window on Service when nothing answers.

## What the code does

- `openTui` in `packages/cli/src/main.ts` no longer asks. It passes the TUI a `ServiceControl` (`packages/tui/src/service.ts`) that can run `golem daemon install` and `golem daemon uninstall` quietly, start `golem-daemon serve` for this terminal, and read the end of the log. The CLI still finds the daemon and runs it, so the TUI never learns where it lives.
- The window's state is pure TypeScript in `packages/view/src/setup-window.ts`: the panels, the navigation table, the stepper, and each panel's lines. The browser uses the same file in 10.10.
- The Service panel shows each sub-step as it happens: `launch agent installed`, then `starting the service…` with the seconds. The client's own reconnect finds the daemon, so there is no separate wait loop. A plist that launchd doesn't run (not loaded, or its program is gone, as after `brew uninstall`) counts as the earlier yes: the window installs it again without asking. After 10 s it explains the wait. `golem daemon install` itself runs the daemon's binary, whose first run after `brew install` waits while macOS checks every library, so the install gets 3 minutes and an install that ends after a give-up still starts the service. Once the agent is installed, after 45 s, or when a daemon this terminal started exits, it shows the reason from `run/last-error` or the daemon's stderr, with Retry, Show the log, and Quit.
- A daemon started for this terminal stops when golem quits, also on SIGHUP and SIGTERM, so closing the terminal window leaves nothing running.
- `golem web` keeps ADR-033's question in plain lines, because the browser can't install a launch agent ([ADR-028](028-web-gateway.md)).

## Why ADR-033's objection no longer holds

ADR-033 turned down a card inside the chat screen because the TUI would need a state before it has a client, callbacks into the CLI, and a second copy for `golem web`. The TUI now has that state anyway: the setup window is shown before a session exists, and the client reconnects on its own. The callbacks are the five new members of `ServiceControl`. `golem web` keeps its plain question, which is short and needs no window.

## Other shapes that lost

**Keep the question before the screen, and add a spinner to it.** It fixes the silent wait, but the service question and the model question would still look like two programs.

**Have the TUI find and run the daemon itself.** The CLI already knows where the daemon is, for a checkout and for the brew install. A second copy of that search would drift.

## What it costs

- The TUI opens before anything answers, so the first frame is the setup window, not the chat. A script with no terminal never got the question and still doesn't, because the TUI needs a terminal.
- Show the log reads `logs/launchd.stderr.log`, the file launchd writes. A daemon that fails before it opens its own log shows only what it printed there.
