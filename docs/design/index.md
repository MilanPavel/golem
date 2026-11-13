# The design system

The look of golem's web UI: the idea, the pixel golem, the type, the tokens, the shape, and the copy. What each screen looks like is on [the gallery](/gallery/), drawn from the real components in both themes. How each feature works is in [How golem works](../architecture.md).

## The idea

The design is minimal: one accent colour, a quiet reading column, and few borders. What makes it golem's is the figure itself.

- **The pixel golem is the status light.** The 9×6 figure from the TUI's logo (`packages/tui/src/logo.ts`) appears in the sidebar, on every answer, in the meter, on the empty screen, and as the favicon. Its eyes say what golem is doing.
- **Clay is the only accent.** It marks what is golem's or what needs you: the send button, the streaming cursor, the seal on an approval, the eyes while golem works.
- **Golem's answers read like a page,** in a book serif. Everything else (the interface, code, tools) is a quiet sans or mono.
- **An approval reads like the shem,** the scroll that tells the golem what it may do. It is a card with a clay seal, the question, the rule that asked, and the diff.

It borrows the calm, centred reading column and generous input from Claude's chat. From opencode it borrows sessions grouped by project, a diff-first approval, and a side drawer.

## The pixel golem

| State | Eyes | Word beside it | When |
|---|---|---|---|
| idle | dark (`golem-eye`) | `idle` | Nothing runs |
| thinking | clay, pulsing | `working` | A run is in progress |
| waiting | amber, a short blink | `waiting for you` | An approval waits |
| failed | brick | `last run failed` | The last run ended in `run.failed` |
| disconnected | grey, and the body grey | `offline` | The link is down |

- **Every state has a word as well as a colour,** so colour is never the only sign.
- **The golem on an answer shows only that answer's state.** It is plain when the answer is done, has clay eyes while it streams, and has amber eyes while a tool call in it waits for you.
- **The favicon and the tab title** follow the sidebar's state, from the same state the TUI's `window-title.ts` uses. They update outside the animation frame, so a hidden tab still shows it.
- **Motion** lasts 150 to 200 ms. `prefers-reduced-motion` turns off every animation: the eyes, the cursor, and the dots.

## Type

| Role | Face | Size and weight |
|---|---|---|
| Interface | Geist | 14 px / 1.5, 500 for buttons and titles, 600 for the shem's question |
| Wordmark | Geist | 17 px, 600, letter spacing −0.03 em, lowercase `golem` |
| Golem's answers | Literata (optical sizes) | 16.5 px / 1.6, 380 (16 px on a phone), in `ink-soft`; headings 500 at 19 px; code in answers 13 px / 1.55 |
| Headings on full screens | Literata | 26 px, 400 |
| Code, tools, labels, times | Geist Mono | 11 to 13.5 px |

The fonts are self-hosted and subset ([ADR-029](../adr/029-web-stack.md)). Silkscreen, a pixel face, was a wordmark choice to compare, and is not shipped.

## Tokens

These become `packages/web/src/styles/tokens.css` in step 10.6. The names say what a colour is for. **slip** is the light theme, like unfired clay, and **kiln** is the dark one.

### Colour

| Token | slip | kiln | Used for |
|---|---|---|---|
| `bg` | `#F3F2EF` | `#15120F` | The page, the diff |
| `surface` | `#FBFAF8` | `#1D1915` | Cards, the composer, the drawer |
| `sunken` | `#EAE8E3` | `#110E0C` | The sidebar, hunk headers |
| `ink` | `#1D1A17` | `#EEE7DF` | Text, the primary button |
| `ink-soft` | `#2B2724` | `#E2DAD1` | Golem's answers, a little softer than `ink` |
| `muted` | `#57524C` | `#B5ACA2` | Secondary text |
| `faint` | `#6C665F` | `#8F877E` | Times, labels, folder names. Not on `slip` |
| `line` | `#DEDAD3` | `#2C2621` | Borders |
| `line-strong` | `#C9C3BA` | `#3B332C` | Control borders, empty boxes |
| `clay` | `#C4783A` | `#D08549` | The accent as a fill: send, seal, cursor, eyes |
| `clay-ink` | `#94501E` | `#E6A06A` | The accent as text: `/commands`, the tool chip |
| `clay-soft` | `#F1E2D4` | `#2E2118` | The current todo, the tool chip's ground |
| `slip` | `#ECE3D8` | `#2A221B` | Your messages |
| `golem-body` | `#9C6B3C` | `#A8733F` | The figure |
| `golem-eye` | `#2A1408` | `#0E0704` | The figure's eyes at rest |
| `allow` / `allow-soft` | `#3F7342` / `#DFEBDD` | `#86B57F` / `#1F2B1E` | Allowed, added lines, done |
| `deny` / `deny-soft` | `#A8402F` / `#F4DED9` | `#E58474` / `#33201C` | Denied, removed lines, failed |
| `wait` / `wait-soft` | `#8A600E` / `#F3E7C9` | `#E2B655` / `#30271A` | Waiting for you |
| `code-bg` | `#EFEDE9` | `#191512` | Code blocks, tool output |
| `ctx-system` | `#6B7A8F` | `#8E9DB3` | System prompt part of the context meter |
| `ctx-tools` | `#AE6B34` | `#D08549` | Tool definitions part |
| `ctx-user` | `#59855C` | `#8DB88A` | Your messages part |
| `ctx-replies` | `#95752F` | `#D9B45E` | Replies part |
| `ctx-results` | `#8A5A86` | `#B98BB4` | Tool results part |

The five `ctx-*` tokens are data colours for the context meter; each is at least 3:1 against `line` and `surface`.

### Contrast

Checked with the WCAG 2.2 formula. 4.5:1 for text, 3:1 for fills and focus rings that carry meaning.

| Pair | slip | kiln |
|---|---|---|
| `ink` on `bg` / `surface` / `sunken` / `slip` | 15.5 / 16.6 / 14.2 / 13.7 | 15.2 / 14.3 / 15.7 / 12.8 |
| `ink-soft` on `bg` / `surface` / `sunken` / `slip` | 13.2 / 14.2 / 12.1 / 11.7 | 13.5 / 12.6 / 13.9 / 11.3 |
| `muted` on `bg` / `sunken` / `slip` | 6.9 / 6.3 / 6.1 | 8.3 / 7.8 / 7.0 |
| `faint` on `bg` / `sunken` / `surface` | 5.1 / 4.6 / 5.4 | 5.3 / 4.9 / 5.4 |
| `clay-ink` on `bg` / `surface` | 5.5 / 5.9 | 8.5 / 8.0 |
| `allow`, `deny`, `wait` on `surface` | 5.4, 5.9, 5.35 | 7.4, 6.6, 9.2 |
| `wait` on `bg` / `sunken` | 4.99 / 4.56 | 9.8 / 10.1 |
| `clay` on `bg` (a fill, and the focus ring) | 3.1 | 6.3 |

`wait` was darkened from `#96690F` so the waiting label passes on `bg` as well.

`faint` reaches only 4.47 on `slip`, so text on your messages uses `muted`. The check in 10.6.2 runs over every pair in this table.

### Shape and space

| Token | Value |
|---|---|
| Radius | 6 px (small), 10 px (controls), 16 px (cards, the shem), 18 px (the composer), round for chips |
| Shadow | One soft shadow, for the composer, the shem, and the palette only |
| Sidebar, drawer, column | 268 px, 320 px, 46 rem |
| Gutter | At least 16 px, and the safe-area insets on a phone |
| Grid | 4 px steps. The empty screen's faint grid is 20 px, one pixel of the golem |

## Pages and dialogs

These rules came from the 10.16 polish of Settings, the model dialog, Tune, and the trace header.

**Pages.** A page such as Settings uses the full width of the main area, with 28 px gutters. It has no centered column. Its header holds the title in `font-prose` and a close button that goes back to the last session. Below the header is a row of underline tabs, the same `TAB_LOOK` as the trace page, and each tab is a link with its own URL. A short form, such as Appearance, keeps to `max-w-column`.

- Status cards sit in a grid: 1 column on a phone, 2 from `md`, and 3 from `wide`. A table, such as API keys, spans the full width.
- A list with a detail, such as MCP servers, shows both side by side: a fixed list pane (`w-mcp-list`, 300 px) and a detail that scrolls on its own. Below `narrow`, the detail replaces the list and gets a Back button.

**Dialogs keep one size.** A dialog that filters, selects, or swaps views has a fixed height, up to `max-h-dialog` (44 rem). Its header and footer stay put, and only the body scrolls. The footer is always there: its buttons are disabled until they can act, so nothing moves when you pick something.

**Facts on a row** are a right-hand stack of short lines that never wrap: usage (`131k · free`), then size and fit (`4.6 GB fits`), then the action (`download`). Only an error turns a line `deny`.

**Settings with values (Tune).**
- Group the values under small uppercase headings: Sampling, Memory, Output.
- A row is the label with an ⓘ tooltip for the long help, the value on the right (in `clay-ink` when changed), a full-width slider below, and a one-line hint under that.
- Reset is a ↺ icon, shown only on a changed row.
- A special value is a choice, not a magic number: Answer length is Until done, Fill context, or Limit, and Seed is Random or Fixed. A short list of values is a segmented control, not a select.

**A summary line** goes on its own full-width row under the tabs, not beside them. The tab row holds only the tabs and the page's actions, such as Refresh.

## The chat

These rules came from the 10.17 redesign. A turn should read like an answer, not a log. Tracing detail stays one click away.

**One turn, one golem.** The model steps of one run render as one turn. A turn has one pixel golem at the top and one footer at the end. The footer gives the time of the whole turn and the number of its steps (`42.1s · 5 steps`). It also has `Inspect ↗`, which opens the trace at that turn.

**Steps fold into an activity line.**
- Under the answer, one quiet line in `muted` sans: a dot per step, then a summary such as `searched the web · 3 GitHub calls, 1 failed · 1 approval`.
- The dots are `allow` when done, `deny` when failed, and a `wait` diamond for an approval. A failure is never hidden behind the fold.
- Clicking the line opens the steps in place. The steps form a list with a thin `line` rule at the left: one mono row per step, with a mark, the tool, and a one-line result.
- An MCP tool reads `github · get_me`, not `mcp__github__get_me`.

**Detail: Quiet, Normal, Verbose.** The Chat detail setting in Settings, under Appearance, and `/detail` set how much shows, for every chat. The choice is remembered per browser.

| Detail | Shows |
|---|---|
| Quiet | The activity line, with the count of steps only |
| Normal | The activity line with its summary. The steps stay closed |
| Verbose | The steps open, with their arguments and results, like Ctrl-O in the TUI |

**Approvals.**
- **While one waits,** it docks above the composer as a compact bar: the seal, `Allow github · get_me?`, a one-line reason in `faint` mono, and the buttons `Allow once ↵`, `Allow in this chat S ▾`, `Details`, `Deny D`.
- **The ▾ opens wider scopes:** always for this tool, every read from this server, or all of this server.
- **Once answered,** it becomes a chip in the steps (`✓ get_me · this chat`). An approval has no target when the call has no arguments.

**Permission modes.** A session runs in one of three modes. A chip beside the model in the composer shows it, `/mode` changes it, and Settings sets the default.

| Mode | Runs without asking |
|---|---|
| Careful | Reads, search in files, git status, diff and log, todos |
| Balanced (default) | Careful's tools, plus web search, web fetch, the sandboxed shell without network, and the read-only tools of an MCP server you trust |
| Autopilot | Balanced's tools, plus edits inside the project and every tool of a server you trust |

- The unsandboxed shell and any path outside the project always ask.
- A rule you write still wins, and a deny always wins.

**Type of the answer.** Golem's answers use Literata at 16.5 px / 1.6 and weight 380, in a 38 rem column, in `ink-soft`. Code is Geist Mono at 13 px. Your message is 15 px, so it is never smaller than the reply.

**The trace is an inspector.**
- Chat has no Chat/Trace tabs. The trace opens in a resizable panel on the right, from:
  - the Inspect icon in the session header,
  - ⌘.,
  - `Inspect ↗` on a turn, which scrolls the panel to that turn's span.
- The panel has its own summary line and `Open full ↗`, which goes to the full trace page.
- On a phone, the panel opens full screen.

## Copy

- Plain words, and the names the TUI already uses: session, fork, model, folder, rule, approval, todo.
- A button says what happens: `Allow once`, `Deny`, `New session`.
- An error says what is wrong and the one thing to do: `golem's daemon is not running` with `golem daemon start`.
