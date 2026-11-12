---
title: The web UI
description: Open golem's chat in your browser with golem web, and what the page can do today.
---

# The web UI

`golem web` opens golem's chat in your browser. It talks to the same daemon as the terminal, so every chat is in both: start in the terminal, carry on in the browser, or watch one answer stream in both at once.

![The web UI in the slip theme](../images/web-chat-slip.png)

## Open it

```bash
golem web
```

golem starts a small server on `127.0.0.1:7480`, opens the page in your browser, and keeps running until you press **Ctrl-C**. With no daemon running, it first asks to start golem's service.

| Option | What it does |
|---|---|
| `--port N` | Serve on another port |
| `--no-open` | Print the link instead of opening the browser |
| `--json` | Print the link, the port, and the pid as JSON, for scripts |

Run `golem web` again while one is running, and it opens the same server instead of starting a second one. If that server runs an older golem than the one you typed, `golem web` says so on stderr; stop it with Ctrl-C and run `golem web` again.

`golem web serve [--port N]` runs the server in the foreground with no browser, no token in its output, and no question about the service. It is for a background job to run, not for typing. It exits with code 75 when a `golem web` already serves the port.

## What you can do today

- **Choose a folder for a new session** from the folder chip: pick one of your earlier folders, or `Choose a folder…` to browse your home folder, filter it, or type a path.
- **Choose a model for a new session** with the chip next to the folder chip on the empty screen, or with `/model`. It shows the default until you pick another. The pick is for that session only, and a refused model shows under the chips.
- **Sessions,** grouped by folder in the sidebar, the same list as `/sessions` in the terminal.
- **Read a chat:** answers in a book serif, with highlighted code. The tools of a turn fold into one line under the answer, such as `searched the web · 3 GitHub calls, 1 failed`, with a dot for each; click it to open the steps, and each step opens into its arguments and output. A failed tool is always on that line, and a tool waiting for you keeps it open. The Quiet, Normal and Verbose switch in the top bar (or `/detail`) sets how much shows. A reply that thought first has a line above it, such as `thought for 12s`, that you click to read the thinking. `/thinking` hides that line or brings it back, and the page remembers the choice; it only changes what you see, while `think` in the model dialog's Tune view is what the model is asked to do.
- **Write:** the composer sends a message, keeps your history, takes pastes, and stops an answer.
- **See what golem is doing:** the pixel golem's eyes, the tab's icon, and its title follow the chat's state: idle, working, waiting for you, or failed.
- **See and fix your setup** in Settings → Setup: a card for each part, with a mark and a word (`done`, `needs attention`, `failed`), the detail, and the fix beside it.
  - **Engine:** `Install Ollama` installs it with Homebrew and shows what it prints under the row; `Start Ollama` starts it. With no Homebrew, the row links to ollama.com/download.
  - **Model:** `Change…` opens the model list, where `Make default` picks the model new sessions start on.
  - **Service and keys** are commands to copy, such as `golem daemon install` and `golem auth set anthropic`, with `Check again`. The page never installs a service or takes a key.
  - **API keys** lists every provider with `key saved` or `no key`, and the command to store or replace the key of the one you pick. The page knows only that a key is saved, never its value.
  - **Run setup again** walks the steps from the start.
- **Tune a local model** from its row in the model dialog (the model chip, or `/model`). An installed local model shows a `Tune` button while you point at it or highlight it. The dialog then shows that model's options in place of the list, with `←`, `Esc`, or `Done` to go back; the list keeps its place, and the row's fit is read again, since the context size changes it. There is one slider for each option, such as temperature and context size, `Keep loaded` is a list of times, and a model that can think also has a `Think` list, `off` and `on` or the levels `low`, `medium`, and `high`, that is left unset until you pick one. Under the rows, the focused option says what it does, in the same words as `/tune` in the terminal, and a row says `model default X` when it is not at the model's own value. The context size of a model with no `num_ctx` of its own says `set by Ollama when it loads` and has no thumb until you move it, which starts it at 8192. The four presets, `Precise`, `Balanced`, `Creative`, and `Long memory`, set several options for this chat at once and light the rows they moved; `Save these for the model` keeps what this chat has changed. Beside the context size, a note such as `+1.1 GB · fits` says what the window costs in memory, and whether it fits, is tight, or is too big for this Mac. `Save for this model` keeps a change in `config.toml` for every chat on the model, and `This session only` keeps it for this chat; for a model this chat does not use, every change is saved. A change is sent a moment after you stop moving the slider and applies from the next message, `Reset` on a row takes one back, the `Reset` at the bottom takes back all of them, and a change made in an attached terminal shows here at once, and the other way round. For the model this chat uses, `Try again with these settings` asks your last question again in a copy of the chat, named `try · <title>`, with the values in use. The new answer streams under the rows with the first line of the old one above it, `Open the try session` opens the copy, and this chat stays as it was. Tuning is for local Ollama models; a hosted model has no button. When a chat's local model runs with options changed from its own, a chip such as `temp 0.2 · top_p 0.9` sits before the `ctx` chip. It names at most three, then `+N`, leaves out the context size, and opens the Tune view of the chat's model.
- **See a model download** in the sidebar, above Settings, on every screen, even when the download began in the terminal. Press it to open the models.
- **Trace a session:** read how an answer was made, model call by model call. See [Trace a session](#trace-a-session).
- **Two themes:** slip (light) and kiln (dark). The switch at the bottom of the sidebar picks one, or follows your system.

The web UI is new, and it grows step by step in [Phase 10](https://github.com/MilanPavel/golem/issues/150). **Approvals, diffs, and the todo drawer** come next. Until then, answer an approval in the terminal: run `golem` in the same folder, and the waiting question is there. After that come models and a command palette, then settings, a layout for phones, and installing the page as an app.

## Trace a session

A trace shows how an answer was made. One reply can be several model calls, with tools run between them. The trace lists each step, and what it took in and gave out, so you can see why an answer was slow, costly, or wrong.

![The trace of a session in the slip theme: a run, two model calls, and a tool call, with the context of the first model call open](../images/web-trace-slip.png)

![The same trace in the kiln theme](../images/web-trace-kiln.png)

### Open it

- Press **Trace** in the row of tabs under the session's title. **Chat** takes you back.
- Or press ⌘K and pick **Trace**. The row is there only while a session is open.
- The address is `/s/<session>/trace`, and `?span=` names the selected row, so a link opens the same one.

The page shows what has finished. It does not move while an answer streams. Press **Refresh** to read again.

### Read the rows

Each row is one step. A run holds its model calls, and a model call holds the tools it asked for.

| Row | What it is | Mark |
|---|---|---|
| Run | One message you sent, and everything golem did for it | The first words of your message |
| Model call | One request to the model, and its reply | A clay diamond, named `model 1`, `model 2` ... |
| Tool call | One tool the model asked for | A grey cog, with the tool's name |

Each row has a bar on its run's time line. Where it starts and how wide it is show when it began and how long it took. Next come the time, as `0m 02.4s`, and the tokens: a model call's input, with how much of its window that fills, such as `21.7K · 17%`.

| Colour or mark | Means |
|---|---|
| Clay bar | A model call |
| Grey bar | A tool call |
| Red bar, and a red `✗` | The step failed |
| Hatched bar before a tool | golem waited for you to approve it |
| `denied` | You refused the tool, so it never ran |
| `running` | The step has not finished yet |

The line above the tree adds up the session: runs, time, tokens, and how full the context is now, with a thin bar that turns amber from 80% and red from 95%. The arrow keys move through the tree: Up and Down choose a row, Right opens one, and Left closes it.

### Open a step

Click a row to read it in the panel beside it.

- **A model call** has three tabs. **Context** is what was sent: the system prompt and the tools folded away, then the messages, with a line where the part new since the last call begins. **Reply** is what came back. **Metadata** is the model, the tokens, why it stopped, and the times.
- Above the tabs, the **context meter** shows how full the window was, and what filled it: the system prompt, the tool definitions, your messages, the replies, and the tool results. The split is an estimate, so it says so. A local model's window shows with `≈` when golem did not send it and read it from Ollama instead: it is a good guess, not a number golem set. Tools that come from an MCP server are grouped by server, with the cost of each, so you can see which server's tools use the most.
- When Ollama cut a prompt that did not fit, a line under the bar says so, and the messages it dropped are dimmed and tagged. `not seen` means golem proved that Ollama dropped older messages, from the token counts of two calls. `probably not seen` means golem estimated it from the size of the prompt. The size of what was dropped is always an estimate, and a call with no line was not shown to be cut or to fit.
- **A tool call** has **Args** (what the model asked for) and **Result** (what it got back). A long result opens in the full viewer. An **Approval** tab shows when you were asked.

**Pretty** and **JSON** switch how a tab is shown, and **Copy** copies it. In the chat, the `ctx` chip at the end of the meter row shows the same fill, and opens the trace at the latest model call.

### What "not recorded" means

golem keeps a trace only for a session it recorded. A session from before tracing still opens: its steps come from the messages, so you see the tree and the times. The tokens, the stop reason, the system prompt, and the tools were never kept, so those rows say `not recorded`, and the panel says `Not recorded. This session ran before golem kept traces.`

Two cases look alike and are not. A call that sent no system prompt says so: golem sends one only when a skill is pinned. A provider that does not report tokens leaves them blank, never zero.

A trace holds your prompts and files exactly as they were sent. They stay in `~/.golem/golem.db` on your Mac and are never sent anywhere.

## Safe by design

The page is only for you, on your Mac.

- **The server listens on `127.0.0.1` only,** never on your network.
- **The link logs you in.** It carries a one-time token after the `#`, which the page trades for a cookie and then removes from the address. You stay signed in for 30 days, even after the server restarts. To sign every browser out, run `golem web logout`. Other websites you have open cannot connect: the server checks every request's origin and refuses the rest.
- **The daemon does not change.** It still listens only on its private socket. The server in `golem web` stands in front of it, and passes on only what a browser may ask for.

## Install as an app

The page can run in its own window with the pixel golem as its Dock icon.

- **Chrome and Edge:** open the page, then use the install button in the address bar, or the menu's `Install golem…`.
- **Safari (macOS 14 and later):** open the page, then choose `File → Add to Dock…`. Safari shows no install prompt, so this menu item is the only way.

The app is tied to the address it was installed from, port included. `golem web --port N` is a different app, and it has no login. If the app opens to `This page needs a fresh link`, run `golem web` again.

There is no service worker, so after an upgrade the app shows the new page on its next load, never an old copy.

## When the page cannot connect

The page shows a full screen, with the command to run:

| What you see | What to do |
|---|---|
| This page needs a fresh link | The link is old, the sign-in is over 30 days old, or you ran `golem web logout`. Run `golem web` again |
| golem's daemon is not running | Run `golem daemon start`. The page reconnects by itself |
| The daemon is older than this page | Run `golem daemon restart` after an upgrade |

How the gateway works is in [ADR-028](../adr/028-web-gateway.md). How the page looks, screen by screen, is on [the gallery](/gallery/).
