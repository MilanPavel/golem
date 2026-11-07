# ADR-039: The browser sets up golem on pages, not in a dialog

**Date**: 2026-11-06
**Status**: accepted

## Context

Step 1.9 built the setup window for the terminal: one panel at a time, a stepper, and a navigation table driven by Enter, the arrows, and Esc ([design/setup-window.md](../design/setup-window.md)). Step 10.10.6 ported it to the browser as a centred dialog that draws the same panels and reads the same table. Step 10.11.1 then added a Settings page, whose Setup section is a status line and an `Open setup` button that opens the dialog.

Using it showed that the port doesn't fit a page:

- A page already has room. A modal list that says `Enter picks · ↑↓ move · Esc closes` hides the Settings page it opens from, and shows one choice at a time where a page can show every part and its fix at once.
- Settings → Setup was only a door to the dialog, with nothing to change on the page itself.
- A first run in a dialog sits on top of an empty chat that can't be used yet.

## Decision

The browser draws setup as pages. The TUI does not change.

- **Settings → Setup is a form.** It has one card per `setup.status` row: the mark with its word, the name, the detail, and its fix in place. The fix is a button (`Install Ollama`, `Start Ollama`, `Change…`), a command to copy (`golem daemon install`, `golem auth set <provider>`) with `Check again`, or a link. This is the overview.
- **First run is a page, `/welcome`.** A stepper runs Engine → Model → Tools → Ready, the terminal's order. Tools (the starter MCP servers of step 1.12) is offered only when no server is set up. Service is skipped, because a connected page means the service runs. This is guided mode.
- **The start opens a page, not a dialog.** A fresh home navigates to `/welcome`, and a default that is gone navigates to `/welcome?step=model`. A send that fails with no model goes to `/welcome?from=send`, and keeps the draft. `/setup` opens `/settings/setup`.
- **The web has no setup dialog.** Its dialog and its navigation table are removed from `packages/web`.

What stays shared with the terminal, in `@golem/view`:

- `setup.status` and its rows, the words for each line (`setupProblem`, `pageServiceRow`, the key command)
- `setupAtStart` and `firstRunChoice`, so the same state opens the same thing in both
- the guided order and its panels' logic (`guided`, `advance`)
- the side effects (install, start, pull, set the default), behind one hook in the web

What the page may do does not change ([ADR-028](028-web-gateway.md)): it installs and starts Ollama, pulls, sets the default, and, as [ADR-037](037-browser-manages-mcp-and-config.md) allows, adds MCP servers with their tokens and installs Node or uv. Service and model keys stay commands to copy.

## Alternatives Considered

### Keep the dialog, and only make Settings a form

- **Pros**: less to build, and the first run matches the terminal exactly.
- **Cons**: two ways to draw setup in one browser, and a first run in a modal over an empty chat.
- **Why not**: the dialog was the part that felt ported.

### Send first run to Settings with a banner

- **Pros**: one place for everything.
- **Cons**: a fresh install sees every part at once, including rows that don't matter yet, with no order to follow.
- **Why not**: first run needs an order. The overview is for later.

## Consequences

### Positive

- Settings → Setup fixes things where they are shown.
- A fresh install opened with `golem web` lands on a page made for it.
- The rules about what opens when are still decided in one place, for both clients.

### Negative

- The browser's setup no longer reads the terminal's navigation table, so its keys differ: a page has Tab and buttons, not Enter on a list.
- Design and tests for setup now cover two drawings, the terminal's panels and the browser's pages.

### Risks

- The two can drift. They share rows, words, and the start rule through `@golem/view`, and `docs/design/setup-window.md` § *The web UI* says how they differ.
