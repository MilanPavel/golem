---
title: The terminal app
description: How a window draws an agent's work from a stream of numbered events, the usual ways agents build their screens, and how golem's terminal app folds events with one shared reducer, batches streamed text, and survives a dropped link.
order: 12
adrs: [5, 7, 19, 27, 29]
---

# {{ $frontmatter.title }}

A window shows an answer while it is still being written, a tool call while it runs, and a question while it waits for you. But the window doesn't do the work. The work happens in another process, which may have started before the window opened and may outlive it. So how does a window draw something it never saw from the start, and how do two windows on one chat show the same thing?

## The idea

::: concept In agents generally

When the agent and its screen are one program, the screen can read the chat from memory. Once they are apart (see [The daemon](./daemon.md)), the screen knows only what the agent sends it. There are two ways to send it:

- **The whole picture each time.** After every change, the agent sends the full chat. That is simple, and wasteful: a streamed answer changes a few characters at a time.
- **What happened, one event at a time.** "A run started." "A message started." "Here are five more characters." "The run ended." Each event is small, and each one has a number.

With events, the screen is a **fold**. It starts from an empty state and applies one function to each event: the state so far plus one event gives the next state. The state is small: the messages, whether a run is working, a question that waits, an error line. The screen paints from that state, and paints again on the next change. It never keeps the events themselves.

The fold gives three things for free:

1. **A late window catches up.** It reads the events from number 1 and folds them. It arrives where a window that watched live already is.
2. **A dropped link resumes.** The window remembers the last number it folded, asks for everything after it, and ignores any repeat.
3. **Many windows agree.** The same events through the same function give the same state.

This is the pattern behind Redux in web apps and event sourcing in databases. A bank statement works the same way: the balance is the sum of the lines, and anyone holding the statement gets the same balance.

![A screen as a fold over events. The numbered events of one session, from session.created to run.completed, go one at a time through one function that takes the state and an event and gives a new state. The state is small: the messages, whether a run is busy, a call that waits for approval, and the error and notice lines. The screen is painted from that state and thrown away. Live, replayed from the first event, or resumed after a drop, the same events give the same screen](../images/tui-fold.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| Print as you go | The agent writes the answer to the terminal line by line, like a shell | Nothing to build. The terminal's scrollback holds the chat | Nothing on screen can change once printed: no live tool status, no question in place. One window |
| A full-screen app in the agent's process | A terminal UI library (Ink for React, Textual for Python, Bubble Tea for Go) draws panels from the agent's own memory | Rich screens, keys, approvals in place | The screen holds the chat. Close it, and the chat goes with it |
| A copy of the server's state | The window asks for the whole chat, after every change or on a timer | Hard to get wrong | Heavy while text streams. A slow poll shows stale text |
| A fold over an event stream | The window folds numbered events and asks for the ones it missed | Late windows, reconnects, and many windows, with one piece of code | Every event needs a case in the reducer, and the events must say everything the screen needs |

Several open problems are the same in every terminal agent:

- **Streamed text is the busy path.** A fast model sends hundreds of small pieces a second. Painting a terminal that often costs more than it shows.
- **The terminal is small and changes size.** Every panel has to give rows back when the window shrinks.
- **The terminal's own features.** A full-screen app takes over the screen, so the terminal's scrollback, text selection, and copy no longer see the chat. The app has to do them itself.
- **Light and dark terminals.** The app can't know the background colour.

## How golem does it

::: golem In golem

golem's terminal app is a fold over the daemon's event stream, in three TypeScript packages ([ADR-005](../adr/005-client-package.md)). [The web UI](./web.md), the next chapter, shares the lower two.

- **`@golem/client` keeps the link.** It sends `hello`, then a `ping` every 5 s, and drops a link whose reply doesn't come within 10 s. It reconnects after a wait that starts at up to 200 ms and doubles up to 5 s. For each session it follows, it remembers the newest `seq` it delivered. After a reconnect it attaches again from that `seq`, and `Attachments.accept` drops any event at or below it ([ADR-007](../adr/007-attach-and-fan-out.md)).
- **`@golem/view` folds.** `reduceChat` takes the chat and one event and returns the next chat. `createDeltaBatcher` collects `message.delta` text for 16 ms and hands it over as one update. The composer's commands and the setup window are here too, with no React, DOM, or Node code.
- **`@golem/tui` paints.** Ink 8 and React 19 draw a frame the height of the terminal, in bands: the header, the transcript, the meter, the approval band, the composer, and the status line. The frame is rebuilt from the state on every paint.

![golem's terminal app in three packages, from the socket up. @golem/client keeps the link: hello, a ping every 5 seconds, a reconnect that waits from 200 milliseconds up to 5 seconds, and an attach after the last seq it delivered, so a repeat is dropped. @golem/view folds each new event into the chat with reduceChat, and batches deltas for 16 milliseconds. @golem/tui paints the state with Ink and React. The web UI, the next chapter, uses the same view and client over a WebSocket. Real: a window drew 192 deltas as 158 updates, and a late window drew 16 replayed deltas as one. A link dropped at seq 44 was back in 25 milliseconds, attached after 44, and seq 45 came next](../images/tui-layers.svg)

A line goes out and comes back like this. Enter doesn't put your line on screen. It goes to the daemon, and your line appears when the daemon's `message.completed` for it comes back. So the screen shows only what is in the log.

![A line from the keys to the screen. You press Enter. applyComposer in App decides: a line that starts with a slash is a local command, the rest is text. App calls sendMessage, and the client sends message.send. The daemon answers only with the run id. Your line appears when message.completed comes back. Then 192 message.delta events arrive, and a 16 millisecond batcher turns them into 158 screen updates. message.completed and run.completed end the reply](../images/tui-keys.svg)

Here is a real run against a throwaway daemon with `qwen3.5:4b`. Two windows are scripts built on the same `@golem/client` and `reduceChat` the TUI uses. Window A creates a session and asks for a story. Window B opens 15 deltas in and attaches from 0. At delta 40, A's link is closed by hand. Times are milliseconds from the start, ids are shortened, and `→` marks a line A sent:

```text
    4 A state connected
    6 A seq 1 session.created
   44 A message.send answered
   44 A seq 2 message.completed        # your line
   45 A seq 3 run.started
   45 A seq 4 message.started
 1988 B opens while A is at seq 19, attaches from 0
 1990 B seq 1 session.created          # the replay
 1990 B seq 2 message.completed
 1990 B seq 3 run.started
 1990 B seq 4 message.started
 2001 B live from seq 20, after 15 replayed deltas
 2006 B first screen update holds 16 deltas
 2370 A seq 44: link dropped by hand
 2372 A state reconnecting attempt 1, wait 19 ms
 2393 A → hello
 2394 A → session.attach s_6ecc…
 2395 A first event after reconnect: seq 45
 2395 A state connected
 4775 A seq 197 message.completed
 4776 B seq 197 message.completed
 4776 A seq 198 run.completed
 4776 B seq 198 run.completed
 5112 A: 198 event frames, 192 deltas → 158 updates
 5112 A and B: 871 chars each, same chat: true
```

Window B caught up in 13 ms. Its 15 replayed deltas and the first live one landed in one update, because the batcher holds 16 ms of text. Window A was gone for 25 ms, asked for what came after seq 44, and seq 45 was next: nothing lost and nothing repeated. Both folded to the same chat. The local model wrote slower than 60 updates a second, so the batcher saved little here (192 deltas, 158 updates). A fast hosted model, or a replay, gives it far more to merge.

The same guarantee is a test. `just golden` records five chats from a real daemon with a scripted model: plain, a tool, an approval, a cancel, and a failure. `packages/view/src/golden.test.ts` folds each one live, replayed from 0, and reconnected with repeats and gaps, and expects the same chat every time.

**Where it lives in the code:**

- `packages/client/src/connect.ts`: `connectGolem`, the ping, the reconnect, and the attach after a reconnect.
- `packages/client/src/attachments.ts`: `Attachments`, the last `seq` per session, and `accept`, which drops repeats.
- `packages/client/src/backoff.ts`: `backoffDelayMs`, from 200 ms up to 5 s.
- `packages/view/src/chat-state.ts`: `reduceChat`, `emptyChat`, and `createDeltaBatcher`.
- `packages/view/src/commands.ts`: `applyComposer`, which decides what Enter means.
- `packages/tui/src/main.tsx`: `runTui`, which opens the client, takes the alternate screen, and mounts `App`.
- `packages/tui/src/app.tsx`: `App`, the events into the reducer, and the bands.
- `packages/tui/src/layout-chat.ts` and `chrome.ts`: the state into rows.

:::

## Why this way

**A fold over the event log, not a copy of the chat** ([ADR-007](../adr/007-attach-and-fan-out.md)). The daemon already writes every event to the log before it sends it ([Sessions](./sessions.md)). A window that folds those events needs nothing else: the replay after a restart, a late window, and a reconnect are one code path, and the golden test checks all three. A snapshot API would be a second way to say the same thing, and the two could drift. The cost: every new event needs a case in `reduceChat`, and an event must carry everything the screen needs.

**One reducer for the terminal and the browser** ([ADR-029](../adr/029-web-stack.md)). `@golem/view` holds `reduceChat` and imports no React, DOM, or Node API. The TUI calls it from React state, and the web UI from small stores. A bug fixed there is fixed in both windows. A second reducer would let the terminal and the browser disagree about the same chat.

**A full-screen frame, not printed lines.** A streamed answer is redrawn as it grows, turns into markdown when it ends, and a tool line changes from `…` to `✓`. An approval waits in place under the transcript. Printed lines can't change once they are on screen. The cost is the terminal's own features: scrollback, selection, and copy don't see an alternate screen, so the TUI does its own scrolling, drag-to-select, and copy (`selection.ts`, `clipboard.ts`).

**Ink and React, in TypeScript** ([ADR-005](../adr/005-client-package.md)). The daemon is already a separate process, so the screen can be written in what fits a screen. Ink lets the TUI be React components, the same model the browser uses. Ink 8 and React 19, not Ink 5 with its test library, so the TUI didn't pin itself to React 18. The cost: most TUI tests check the pure functions that build rows, not rendered frames.

**Batch the text, not the events.** Only `message.delta` waits, for 16 ms, which is about 60 updates a second. Every other event lands at once, and `message.completed` empties the batch first and replaces the text with the whole answer. A slow model loses nothing, and a fast one or a replay costs a few paints instead of hundreds.

**Bands that ask for rows.** Each band asks for rows only while it has something to show, and a short window takes rows back in a fixed order until the chat has one. The layout is a pure function of the state and the window size, so a resize is just another paint.

**One binary, and the tab says what it is doing** ([ADR-019](../adr/019-single-binary.md), [ADR-027](../adr/027-terminal-tab-status.md)). `bun build --compile` makes the TUI, `golem status`, and `golem web` one file to install. The terminal tab shows whether a run works, waits for you, or failed, so a waiting approval is seen from another tab.

## Try it

1. Run `golem`, ask something, and type `/debug wire` while it answers. The panel lists the protocol lines as they arrive.
2. Open a second terminal in the same folder and run `golem`. It attaches to the newest session there, and both windows show the same answer.
3. Make the window short while an answer streams. The bands give rows back, and the chat keeps at least one.
4. Press Ctrl-O after an answer with tool calls. Each call's output opens under its line.
5. For contributors: `pnpm --filter @golem/view test` runs the golden test, which folds every recorded chat live, replayed, and reconnected.

## The details

For contributors: the reference for the TUI, from the keys to the screen, and the shared client.

The TUI is `@golem/tui`. `golem` with no arguments calls `runTui` in `main.tsx`, which opens one client, takes the alternate screen, and mounts `App`. `just dist` compiles that command with `bun build --compile` ([ADR-019](../adr/019-single-binary.md)). The screen draws. It does not run the model, and it does not open the socket. `@golem/client` does that. `golem status` uses the same library, asks once, and exits. `golem --version` prints the CLI version, and the daemon version when the daemon is up. `golem doctor` runs `golem-daemon doctor`, which checks the launchd job, socket, config, models, and disk with the daemon's own code and prints them as JSON (`golem/doctor.py`). The CLI adds whether it found the daemon program and whether the running daemon has its version, then prints the checklist and the next step (`packages/cli/src/doctor.ts`). The TUI asks the client to reconnect.

The picture is rebuilt on every paint. `chrome.ts`, `layout-chat.ts`, and `debug-view.ts` turn memory into rows, and those rows are thrown away. What stays is the conversation, the draft, and a few facts about the link.

### A line, from the keys to the screen

Enter does not insert your sentence. `applyComposer` decides first. A line that starts with `/` is a local command. Anything else is text to send, and a line that starts with `//` is text too: the two slashes are stripped so a message can itself start with `/`.

The figure in [How golem does it](#how-golem-does-it) shows the order: Enter, `applyComposer`, `sendMessage`, `message.send`, your line back as `message.completed`, then `run.started`, `message.started`, the deltas collected for 16 ms, and `message.completed` and `run.completed`.

`message.send` only answers that a run started. Your line appears when `message.completed` comes back, and the draft is already cleared. If the send fails, the draft returns and the banner turns red. If the code is `SESSION_NOT_FOUND` (`-32003`), the screen puts the draft back, then creates and attaches to a new session.

`/sessions` shows every open session in place of the transcript: a green dot while a run is open, the title, and how long ago it was active. Up and down move, Enter attaches, `n` starts a new session while the filter is empty, and typing narrows the list by title. Ctrl-D asks before closing the selected session; `y` closes it and the list stays open. Esc clears a filter, cancels that confirm, or closes the list. `/close` closes the current session and opens the newest one still open, or a new session when it was the last. A closed session leaves the list and stays out after a restart. Its events remain in the log. `/model` shows every model from `model.list` in place of the transcript, in the same way:
- **Groups:** profiles, installed, download, then one group per provider, with a green dot on the session's current model.
- **Keys:** Enter switches the session through `session.set_model`, `d` also calls `model.set_default`, typing filters by ref, label, or profile name, Ctrl-R lists again with `refresh`, Ctrl-A toggles `show_all` and lists again, a row of tabs (All and the six categories) is the category filter, and Tab or Right moves to the next tab and Shift-Tab or Left to the one before, and Esc clears the filter or closes the picker.
- **A model that cannot run** is dimmed, and choosing it says what to do instead.
- **Downloads:** Enter on a model to download asks once with its size and fit, or twice when it is too big, then calls `model.pull`. The row shows the live percentage from `model.pull.progress`, and the session switches to the model on `model.pull.done`. `x` asks, then stops a download or removes an installed model. `/model pull <name>` and `/model rm <name>` probe first and ask in the same way.
- **`/model <name>`** switches directly, and the suggestions under the composer are the profile names and ready refs from the last listing.
- **The setup window** (`packages/view/src/setup-window.ts`, drawn by `packages/tui/src/setup-frame.tsx`) covers the screen, with no logo, composer, or status bar, until the chat can answer. At the start it opens guided on Service when nothing answers, guided on Engine when no model is chosen, and on its own model step when the default is gone. With the only ready model it uses that one, and when everything works it shows only `welcome back · <model> · N chats in /sessions`. One navigation table says which panel follows which result, in guided mode, for one panel alone, and from the overview. Engine offers On this Mac, With an API key, and Later. On this Mac goes through the Ollama panel (`packages/view/src/setup-local.ts`): a missing Ollama is installed through `ollama.install` with brew's last line and the seconds, or the download page opens and golem waits for Ollama to appear, and a stopped one is started. The Model panel lists this Mac's catalog with the recommended model first, each size, `heavy` or `too big` for this memory, the free disk, and Show all. Enter downloads in the panel with the size, speed, and time left, and Esc leaves the download in the band. Alone, the Model panel lists every ready engine's models with the current one first, and a default that is gone at the start is named, with Download it again first. With an API key goes through the Provider panel and the Key panel (`packages/view/src/setup-key.ts`): a hidden field, where to get a key, and "Use it" first when the terminal's environment has the provider's variable, such as `ANTHROPIC_API_KEY`. The TUI passes that key to the daemon, which never reads the shell. `auth.set` checks the key before it stores it: a refused key shows the provider's reason and opens the field again, and a working one says how many models it opens. After about a second of waiting, the panel says macOS may ask whether golem may use the key, and to choose Always Allow. Then the Model panel lists that provider's models with one recommended. Add an API key on the overview, and `/login`, open Provider and Key alone, and `/login <provider>` opens Key. The key never goes through the composer. A send with no model keeps the message in the composer and opens the window on Engine. `q` asks Quit setup? once the service runs. `/setup` opens the overview from `setup.status`, with the Service row the TUI fills itself: a problem's fix comes first, `r` checks again, and Enter opens that one step and comes back. Run setup again walks the steps with today's choices, and Stop and remove it asks again. In the chat, the first thing `setup.status` finds wrong is one band line, such as `! Ollama: Ollama is not installed · /setup`. Before the first token of a local model, the band says `starting Ollama…` while the server starts, then `loading <model>…` the first time that model answers in this window.
- **Code:** `model-picker.ts`, which holds the pure state, grouping, and layout, and `model-picker.tsx`.

`/permissions` shows, in place of the transcript, the tool rules for the session's folder in the order they are checked, then what this session allows, from `config.get`. Up and Down move. `a`, `k`, and `d` set the selected rule to allow, ask, or deny (`policy.update`), and `x` deletes it (`policy.remove`) or revokes the allowance (`session.revoke`). Built-in defaults are listed dimmed and cannot be changed. `r` lists again, and Esc closes. Code: `permissions.ts`.

`/new` starts a new session directly. `/title <name>` renames the current session, and `/title` alone shows its title. `/fork` copies this session up to its newest finished message into a new session and switches to it. The other session keeps running in the daemon. `/copy` copies the last answer. `/copy code` copies the last fenced code block. Copies go through `packages/tui/src/clipboard.ts`: `pbcopy`, which says whether it worked, or OSC 52 over SSH or when `pbcopy` fails. OSC 52 asks the terminal to copy and gets no answer, so the hint then says `asked the terminal to copy N chars` instead of `copied N chars to clipboard`. `/export` writes this session as markdown, from the messages on screen, to `~/.golem/exports/<title>.md`, or to a path you give. `/time` shows or hides a dimmed time beside each label, and remembers that in `~/.golem/tui.json`. The slash commands are one table in `commands.ts`. `/help` prints that table in the transcript area. It is not sent and not stored. Any other `/word` says `unknown command — /help lists them`. Typing `/` lists those commands above the composer. The list narrows as you type, prefix matches first, then substrings. Up and Down move, Tab fills in the selected row, and Enter fills in a partial name. Esc closes the list and keeps the draft. A space after the name lists that command's argument choices. A line starting with `//` does not open the list. Keys are one table in `keys.ts`. The input handler dispatches through it. `?` on an empty line, or F1 anywhere, opens the list, grouped by composer, transcript, switcher, and debug. Esc or `?` closes it.

`/debug` opens a panel. `/debug wire` and `/debug model` pick a tab. `/debug hold` keeps the next line on the screen and does not send it. `/debug go` sends that held line. Esc closes the panel. Tab swaps the tab.

### The screen, top to bottom

Read this from top to bottom. Each box is one horizontal band. A band that has nothing to show takes no rows. The transcript receives every row the others leave.

The bands, in order: the header (the logo, or one summary line), the transcript (the chat, and it fills what is left), debug (only after `/debug`), the banner (only for an error or a notice), the meter (only while a reply is in progress), install (only while golem installs Ollama), todos (only while the agent keeps a todo list), suggestions or approval (a `/` command, or a call that waits), the composer (`❯` the line you are typing, between two thin rules), and status (connection, title, model, folder).

![golem's screen, top to bottom, in three moments. Idle: the header, the transcript, the composer, and the status line. While a reply streams, the meter takes one row, writing with the characters and seconds, and the composer shrinks to an ellipsis. While a tool call waits, the approval band takes rows above the composer and the meter says waiting for your approval. The transcript gets every row the others leave. A 24 by 80 terminal gives a frame 79 columns wide and 15 rows of chat](../images/tui-bands.svg)

A window at least 20 rows tall and 42 columns wide gives the header the logo: 18 columns, 7 rows, because two pixel rows share one cell. Beside it sit the version, the model (`name · profile`), and the folder. The version is one string for the CLI, the TUI, and the daemon: `0.0.0-dev` from a checkout, or the git tag stamped at `just dist`. When the TUI matches the daemon, one number is shown. When it does not, the header shows `tui X · daemon Y` in yellow, and the banner says `golem is X, its service still runs Y · ctrl-r restart`. Ctrl-R runs `golem daemon restart`, which is what a `brew upgrade` leaves to do. A reply that was streaming ends as interrupted, and the chat reattaches to the new daemon. The socket still connects: only a different protocol major is refused. A smaller window uses one line: `█ golem`, the version, the model, then the folder. No rows at all draws nothing.

The other bands ask for rows only when they are needed.

- The debug panel wants 7.
- The composer wants one row per line of the draft, up to 5, or 1 while a reply is in progress. That one row is `…`, and typing is ignored. The first line starts with `❯ `. A dim `─` rule above and below frames it, in place of a background, so it reads the same on light and dark terminals. A chat with no messages lists starter prompts under `Type a message.`, chosen from the folder by `starterPrompts` in `packages/view` (a git repo, an empty folder, or any other). Down moves into the list, and Enter puts the prompt in the composer. An empty draft shows a dim tip such as `Tip: /skills lists what golem knows how to do`, with the cursor on its first letter. The tips are `TIPS` in `packages/view`. A session keeps its tip, and each new session shows the next one: the count is in `~/.golem/tip`. The colours are named in `theme.ts`. Extra lines come out of the chat. Scroll is how many lines sit below the window, so the line you were reading stays put.
- The meter wants 1 while a reply is in progress: `thinking` (or `starting ollama` while golem starts the session model's local server, from `model.server.status`), then `writing · N chars · Ns`, with a small block that moves.
- Command suggestions want up to 6, above the composer, and only while the draft is a `/` command.
- The todo band wants one row per item of the agent's todo list: `[ ]` pending, `[~]` in progress (bold, clay), `[x]` done (dim). A finished list, a list longer than 6, or a short window shows one row instead: `todos 2/5 · <the current step>`. An empty list takes no rows, and `/todos` hides or shows the band, remembered in `tui.json`.
- The install band wants 6 while `brew install ollama` runs: the title (`Installing Ollama with Homebrew · Esc stops`) and the newest output. After it, one row says installed or stopped, a failure keeps its last lines and `/model to switch`, and with no Homebrew two rows give the ollama.com download link. Esc stops brew, then puts the band away. The picker opens it when you choose a local model and the `ollama` provider is `not_installed` (`packages/tui/src/ollama-install.ts`). The daemon runs brew and the band shows its output, so a second window sees the same install. Once brew is done, the TUI lists the models again and the picker asks to download the one you chose. A message that fails with `not_installed` turns the banner into the same question while the composer is empty: Enter installs Ollama, downloads the session's model if it is missing, and sends the message again. Esc leaves the banner as it was.
- A running tool call shows its newest output line under its line, or up to 12 lines while Ctrl-O is on.
- The approval band takes those rows instead while a run waits on a tool call: `Allow read_file notes.txt?`, the rule that asked, and the keys. A file change also shows its diff between the question and the rule, coloured by line, in up to half the screen; Up and Down scroll it a line, Page Up and Page Down a page. `a` or Enter allows once, `s` allows the same call for the session, `w` allows it always by writing a rule, `e` opens its arguments as JSON in the composer's place (Enter allows once with them, Esc goes back), and `d` or Esc denies. Ctrl-C cancels the run. The meter says `waiting for your approval`, and the switcher shows a yellow `?` for a waiting session.
- An error wants 1 row in red. A notice wants 1 row in yellow. A hint shares that row, on the right, in grey: a short message that needs no answer, gone after 4 seconds (`packages/tui/src/hint.ts`). Hints are `Ctrl-C again to exit` and `cancelling…` (2 seconds, the window for the second press), `cancelled`, `copied N chars to clipboard` and `nothing to copy yet`, `exported to <file>` (8 seconds), `timestamps on` or `off`, `todo list shown` or `hidden`, and `<model> downloaded` or `stopped downloading <model>`. When the banner and a hint do not both fit, the hint is cut first, and below 6 columns it is left out. Errors, download progress, and messages that ask for something stay on the left.
- The status line wants 1. Left to right: the connection word, the session title (`untitled` until one arrives), the model, the folder, the message count, `↓ N new lines` while you are scrolled up and more text has arrived, and how long the daemon has been up. A narrow window drops the lowest segment first: uptime, then the message count, then the folder, then that count. A long title is shortened so the session name stays. The connection word is never dropped. It is shortened only when it alone is wider than the window. The terminal tab is `<mark> <title> (golem)`, or `<mark> golem` before the session has a title, and the previous title is put back on exit. The mark is `✳` idle, a braille spinner while a run works (one frame a second, so the tab does not flicker), `!` when an approval waits, `✗` after an error, and `○` while the daemon is not connected (`packages/tui/src/window-title.ts`). golem also writes OSC `9;4` progress, which some terminals show on the tab or the dock: busy while a run works, paused while it waits for an approval, and cleared when the run ends and on exit. Terminals that do not know it, such as Terminal.app, ignore it. In iTerm2, outside tmux, golem also sets the tab status (OSC `21337`): a coloured dot and a word under the title, green `idle`, orange `working`, blue `waiting for you`, red `failed`, and grey `disconnected`. There the title has no mark, since the dot shows the state. [ADR-027](../adr/027-terminal-tab-status.md) says why these sequences.

A 24×80 terminal becomes a frame 79 columns wide. One column is left unused, because a glyph in the last column would wrap and scroll the header away. With the logo, a one-line composer and its two rules, and the status line, the chat has 15 rows.

If the window is short, bands give rows back until the chat still has one. In order: the composer's rules go away, the bottom one first, then the suggestion list goes away, the approval band's diff shrinks to its three rows, the todo band collapses to one row, the install band shrinks toward one row, the debug panel shrinks toward 3 rows, the composer shrinks to one line, the meter goes away, the logo collapses to one line, the banner goes away, the debug panel goes away, the header goes away, the todo band goes away, the install band goes away, the approval band goes away, the composer goes away, and last the status line.

Inside the transcript, messages are painted in order with a blank line between them. A reply that called tools has one line per call under its text: the tool name, its string arguments, then `…` while it runs, `✓` and a summary (`12 lines`) when it finished, or `✗` and the reason when it failed. A reply that only called tools shows those lines and no text, and has no duration under it. Ctrl-O shows or hides each finished call's output, up to 12 lines, under its line, and the body of each skill you ran. Each starts with a bold `you` or `golem`. With `/time` on, a dimmed time follows the label (`14:02`, or the date when the message is from another day). A finished answer has its duration dimmed underneath (`12.4s`). Your lines sit on a clay background. While `streaming` is set, the text is wrapped as plain characters. When the answer is finished, the same text is drawn as markdown. If the laid-out lines are taller than the band, a scrollbar appears (`│`, with `█` as the thumb) and the text uses one fewer column. When the `you` row of the question you are reading has scrolled off the top, the top row of the chat shows that question pinned: `you` and its first line, cut with `…` to one row, on the clay background. The rest of the chat moves down one row. A click on the pinned row scrolls back to the question.

Scroll is how many lines sit below the window. Zero means the newest line is on screen. Page Up, Page Down, Home, End, and the wheel move it. End jumps back to the newest line. Rows that arrive while the offset is above zero are added to that offset, so the line you were reading stays put. The wheel moves the debug panel instead while that panel is open. golem turns on mouse reporting for the wheel (`?1000h`, with SGR coordinates from `?1006h`) and for drags (`?1002h`), and turns it off while an editor has the terminal and on exit (`packages/tui/src/screen.ts`). `bindPointer` sends the wheel to one listener and a left press, drag, or release, with its 0-based cell, to another. Other buttons and clicks with Shift, Alt, or Ctrl are not passed on. While mouse reporting is on, the terminal does not select on its own: in iTerm2, hold Option to drag-select the terminal's way.

Drag over the chat to select text (`packages/tui/src/selection.ts`). The selected cells turn inverse, and on release golem copies them and shows the hint `copied N chars to clipboard`. A selection is kept as rows of the whole transcript, not screen rows, so it stays on its text while the chat scrolls, and dragging above or below the chat scrolls it a row at a time. Rows that a wrap split join again with the space the wrap took out, so a wrapped paragraph copies as one line. Real line breaks and blank lines stay, and each row loses its trailing spaces, such as the padding of your own messages. The scrollbar column is not selected. A click, Esc, a new message, or a new width clears the selection. Only the chat can be selected so far; while a panel such as the picker covers it, a drag does nothing. While the key list is open, those keys scroll the list.

The debug band keeps its first row for the title. The wire tab lists recent protocol lines and hides pings, though the title still counts them. The model tab lists the checkpoint from `session.inspect`, with the system prompt first when there is one. If the on-screen count and `message_count` differ, a yellow line says `screen N · model M`.

### What the screen keeps

`chat` is the conversation: a list of messages, the waiting approval, the agent's todo list, plus four fields. Each message has an id, a role, the text so far, `streaming`, the event time, for a finished answer how long it took, and the tool calls it asked for. A tool call keeps its id, name, arguments, status (requested, running, done, or failed), and the summary, preview, or error that ended it. `busy` is true while the model works. `error` is the red line. `notice` is the yellow line. `runStartedAt` is the timestamp the meter uses for seconds.

`reduceChat` folds one event at a time. It does not keep the events.

| Event | What the screen does |
|---|---|
| `message.completed` | Insert the message, or replace it when the id is already there. Streaming turns off. The event time is kept. An assistant message records the time since `run.started`. |
| `run.started` | `busy` on, error cleared, start time stored. |
| `message.started` | Append an empty assistant message, streaming on, with the event time. |
| `message.delta` | Append text to that id. An unknown id changes nothing. |
| `run.completed` | `busy` off. |
| `run.failed` | `busy` off, and `error` is the daemon's message, then its `hint`. For `model_unreachable` it adds `/model to switch`, and the status line shows `<provider> ✗` until a run completes or the session changes model. |
| `run.cancelled` | `busy` off. A cancel you asked for shows the hint `cancelled`. A daemon that stopped leaves a notice that says so. |
| `tool.requested` | Add a tool call to the message with that `message_id`. |
| `tool.started` | That call is running. |
| `tool.output` | Append to that call's live output, keeping its newest 4000 characters. |
| `tool.completed` | That call is done, with its summary and output preview. |
| `tool.failed` | That call failed, with the reason. |
| `approval.needed` | That call waits (`?`), and the approval band opens. `busy` stays on. |
| `approval.resolved` | The band closes. An allowed call goes back to requested until `tool.started`, with the edited arguments when there are any. |
| `todos.updated` | The todo list is that list, whole. |
| `skill.activated` | Nothing yet. The transcript line for an invoked skill comes from the user `message.completed`, which carries `skill`. |

Deltas do not take that path one socket frame at a time. They wait in a small map, grouped by message id, for about 16 milliseconds, then land as one update. When the answer finishes, that map is emptied first, and `message.completed` replaces the text with the full answer. `session.created` does not change `chat`. The screen reads the model and the project folder off that event on its own. The folder in the header and the status line is the session's, or the TUI's working directory for a session without one.

A replay is the same events, so the same table draws it. Stored deltas are already folded into their `message.completed`, so a finished answer arrives whole. An answer still in progress arrives as `message.started` and its deltas so far.

If the socket drops, `busy` stays as it was. The half-written answer stays, still marked streaming. After the reconnect the client attaches again, and the events it missed say whether the run finished. Events for any other session are ignored.

The draft is the composer text and a cursor. Left and Right move by character, Alt-Left and Alt-Right by word, and Ctrl-A and Ctrl-E jump to the ends of the line. Backspace, Delete, Ctrl-W, Alt-Backspace, Ctrl-U, and Ctrl-K delete around the cursor. Shift-Enter inserts a line, and so does Alt-Enter. The composer grows by that line. Enter still sends the whole draft as one message. A paste, including its newlines, is inserted at the cursor and is not sent by those newlines. A paste of 3 or more lines, or 800 or more characters, goes in as one token instead, `[Pasted text #N +M lines]` (M is the lines after the first), or `[Pasted text #N 1,234 chars]` for one long line, numbered from 1 while the TUI runs (`packages/tui/src/paste.ts`). Backspace right after a token removes all of it. Sending swaps each token for its text, so the model, the chat, and the history get what you pasted, and Ctrl-G opens the editor with it. Only the exact token expands: one you type inside stays plain text. The secret prompt never collapses a paste. Ctrl-G opens the draft in `$EDITOR` (or `vi`), leaving the alternate screen while the editor runs. Enter clears the draft only when the line is sent. In a draft with text, Up and Down move the cursor a row, on the rows as drawn, wrapped ones included. The cursor keeps its column, or goes to the end of a shorter row, and Up then Down comes back to that column. Up on the first row goes to the start, and Down on the last row to the end (`moveRow` in `packages/tui/src/chrome.ts`). Up on an empty line recalls messages you sent, newest first: this session's lines, then older ones from `~/.golem/history` (or `GOLEM_HOME`). Down steps back. Esc restores the draft from before that. Changing a recalled line does not change the stored one. A sent line is appended to that file, which keeps the newest 1000.

The link is remembered as `connection`: connecting, connected, reconnecting, closed, or rejected. The status line paints that word green, yellow, or red. The session title on that line follows `session.updated`. Until that event is replayed, the title already on the session list is used. Uptime comes from `daemon.status` and then advances on the clock. `sessionId` is this chat on the daemon. `use-session.ts` picks it: on the first connect, the newest session from `session.list` with the TUI's working folder as `cwd`, or a new one there when that folder has none. A session's folder never changes, so attaching to one from another folder would point the file tools at the wrong place. It is set before the attach, so the replay is drawn. Until it exists, and until the link is connected, typing does nothing. The header's model prefers the session's profile, provider, and name, and fills any hole from `daemon.status`.

`offset` is the transcript scroll. `debugOffset` is the same count inside the debug panel. `tick` increases ten times a second while `busy` is true. The screen never prints it. It exists so the meter block moves.

The debug panel remembers whether it is open, which tab is showing, whether hold is on, and the text held back from sending. `wire` is a copy of the client's last protocol lines, at most 50. `modelMessages` is a second copy of the conversation, loaded when the model tab opens, when hold turns on, and when a run finishes while the panel is open. It does not update on each token. A slow inspect is dropped when a newer one has already started.

Keystrokes and socket messages arrive in callbacks that cannot see the latest React values. The session id, the draft, the busy flag, the connection, and the debug panel are also kept in refs for those callbacks. There is still one conversation.

### The shared client

The TUI and `golem status` both reach the daemon's Unix socket through `@golem/client`, as the figure in [How golem does it](#how-golem-does-it) shows.

The client has two entry points. `@golem/client` runs in any runtime, and takes a `dial` function that opens the link. `@golem/client/node` adds the Unix socket, and its `connectGolem` takes a `socketPath`. The TUI and the CLI use the Node entry.

`main.tsx` calls `connectGolem` with the name `tui` and reconnect turned on. The socket is `~/.golem/run/golem.sock`, or under `GOLEM_HOME` when that is set. The first line is `hello`. After the daemon accepts the protocol version, the screen asks for `daemon.status`, watches the session list, and asks `session.list` for the newest session in its working directory. It then attaches to that session, or runs `session.create` with its working directory as `cwd` and attaches. `just tui` runs from the folder `just` was started in, not `packages/tui`.

Every 5 seconds the client sends `ping` with a fresh nonce. If the matching reply does not arrive within 10 seconds, the socket is dropped. The first reconnect wait is at most 200 milliseconds. Later waits double, up to 5 seconds. A protocol major mismatch sets the state to `rejected` and stops the retries. `golem status` is the other way around: `reconnect: false`, one `daemon.status`, then `close()`.

The client remembers each attached session and the last `seq` it delivered. After a reconnect it sends `session.attach` for each one from that `seq`, before it reports `connected`. Events at or below that `seq` are dropped, because a replay can repeat them.

The client does not build the transcript. It hands each `event` line to `App`. It also keeps those last 50 lines, which the debug panel copies.

### Files

| File | What it does |
|---|---|
| `packages/client/src/connect.ts` | `connectGolem`: the link, `hello`, the ping, the reconnect, and every protocol call |
| `packages/client/src/attachments.ts` | `Attachments`: the last `seq` per session, and repeats dropped |
| `packages/client/src/node.ts` | The Node entry, with the Unix socket |
| `packages/view/src/chat-state.ts` | `reduceChat`, `emptyChat`, and `createDeltaBatcher` |
| `packages/view/src/commands.ts` | `applyComposer`: what Enter means |
| `packages/view/src/golden.test.ts` | Live, replayed, and reconnected events give the same chat |
| `packages/tui/src/main.tsx` | `runTui`: the client, the alternate screen, and `App` |
| `packages/tui/src/app.tsx` | `App`: events into the reducer, keys into commands, and the bands |
| `packages/tui/src/layout-chat.ts`, `chrome.ts` | The state into rows |
| `packages/tui/src/use-session.ts` | Which session a new window attaches to |

## Read more

- Next: [The web UI](./web.md): a browser on a local socket.
- Before: [MCP](./mcp.md).
- [The protocol](./protocol.md): `seq`, attach, and replay, which this screen folds.
- [Sessions](./sessions.md): the event log the replay reads.
- [The overview](../architecture.md): the whole system on one page.
