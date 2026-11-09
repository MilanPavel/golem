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
| Golem's answers | Literata (optical sizes) | 16 px / 1.68 (15.5 px on a phone) |
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

## Copy

- Plain words, and the names the TUI already uses: session, fork, model, folder, rule, approval, todo.
- A button says what happens: `Allow once`, `Deny`, `New session`.
- An error says what is wrong and the one thing to do: `golem's daemon is not running` with `golem daemon start`.
