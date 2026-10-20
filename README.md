# golem

<p align="center">
  <img src="docs/golem-logo.jpg" alt="golem" width="220">
</p>

Golem is a personal AI agent that runs on your own machine. It is built first for local models (through Ollama), and it can use hosted ones from Anthropic or OpenAI as well.

The name comes from the Prague legend. A clay servant, brought to life to work on its maker's behalf.

<p align="center">
  <img src="docs/images/demo.gif?v=2" alt="Chatting in the golem terminal" width="960">
</p>

## Why golem

- **Local models as first-class citizens.** Most agent tools assume a large hosted model. Golem is built to get real work out of a model running on a laptop, and to call a hosted model only when the task needs it. Your data stays on your machine by default, and the cost of each answer stays visible.
- **A lab for advanced agent techniques.** Golem is a place to experiment with what makes agents good over long, real tasks:
  - Context optimization: compaction, choosing which tools and skills enter the prompt, and token budgets.
  - Routing between models, with escalation when a small model fails.
  - Self-learning: memory, and skills the agent writes for itself, so each task makes the next one easier.
- **Learning by building.** The goal is to understand what it takes to make an agent production quality, by building each part instead of hiding it behind a framework. That covers durable runs that survive a crash, permissions and approvals before any side effect, sandboxing, a typed protocol between the agent and its screens, observability, and evals.
- **Connected to your tools.** Golem works with files, the shell, and git through built-in tools, and with anything else through MCP servers. Every tool call passes one permission layer, and golem asks before it does something that matters.

Most of this is the direction, not the current state. [What works today](#what-works-today) lists what is built. [docs/plan.md](docs/plan.md) lists what comes next, in order.

## How it works

Golem has two parts:

- **The daemon** is a Python process that talks to the model and stores every session in `~/.golem`. Run it from a terminal, or let launchd keep it running in the background.
- **The TUI** is the chat screen in your terminal. It connects to the daemon over a local socket. Closing it does not stop an answer. Open it again and you see the text so far, plus the rest as it arrives.

### What works today

- Streaming chat with named model profiles: a local model through Ollama, Anthropic, OpenAI, or hosted open models through OpenRouter, Groq, or Together.
- Sessions that survive a daemon restart or a crash.
- Closing the TUI and coming back, from any number of terminals at once.
- Cancelling an answer with Ctrl-C, which keeps what it said so far.
- Automatic titles, a session switcher, new sessions, renaming, and forking.
- Reading files, listing folders, and searching with `glob` and `grep`, inside the folder you started the TUI in. Ctrl-O shows what each tool returned.

- Tool rules: allow, ask, or deny a tool by name, subject, or path, in `~/.golem/config.toml` or a project's `.golem/policy.toml`. `just golem config show` lists them.

- Approvals: a tool call a rule asks about waits for you. Press `a` to allow it once, `s` to allow that tool for the session, or `d` to deny. The question waits across closing the TUI and restarting the daemon.

- A sandboxed shell. The model can run tests or a build in that folder after you approve the command. It has no network and cannot write outside the folder. `git_status`, `git_diff`, and `git_log` need no approval.

Golem cannot change files with its own tools yet, only through an approved shell command. Write tools with a diff to approve come next. See [docs/plan.md](docs/plan.md).

Golem runs on macOS only, from a checkout of this repository. There is no installer yet.

## Set up

### Requirements

| Tool | Version | Install |
|---|---|---|
| macOS | any recent | Needed for the launchd background service |
| [uv](https://docs.astral.sh/uv/) | latest | `brew install uv`. It also installs Python 3.12, pinned in `.python-version` |
| Node.js | 24 | `brew install node` |
| pnpm | 10 (pinned in `package.json`) | `corepack enable` |
| [just](https://just.systems) | latest | `brew install just` |
| [Ollama](https://ollama.com) | optional | `brew install ollama`. Needed only for local models |

### After cloning

```bash
git clone <repo-url> golem && cd golem
uv sync --all-packages     # Python packages and dev tools into .venv
pnpm install               # TypeScript packages
just check                 # optional: lint, typecheck, and tests should pass
```

## Choose a model

The daemon reads `~/.golem/config.toml`. A model is named `provider/model-id`, for example `ollama/qwen3:8b` or `anthropic/<model-id>`. A profile gives one a short name:

```bash
ollama pull qwen3:8b       # a local model needs no API key
```

```toml
# ~/.golem/config.toml
default_model = "qwen"             # the model a new session starts on

[models.qwen]
model = "ollama/qwen3:8b"
ctx = 32768                        # optional, sent to Ollama as its context size

[models.sonnet]
model = "anthropic/<model-id>"
```

`default_model` can also be a `provider/model-id` directly, with no profile. The daemon picks up changes to `[models]`, `[providers]`, and `default_model` without a restart.

You don't need to write any of this by hand. In the TUI, `/model` opens a picker with every model below. Enter switches the current session from its next message, with the same conversation. `d` also makes the model the default for new sessions, and golem writes `default_model` into `config.toml` without touching your comments. `/model <name>` switches directly to a profile name or a `provider/model-id`. On a first start with no model configured, golem uses the only ready model if there is exactly one, and otherwise opens the picker.

**Downloading a model from the picker**
- **Download:** Enter on a local model you don't have asks once, showing its size and whether it fits in memory. It then downloads through Ollama with a live percentage, and the session switches to the model when it's done. A model too big for this Mac asks twice.
- **After you close the TUI:** the download keeps going, and the picker shows it when you open the TUI again.
- **Stop or remove:** `x` stops a download or removes an installed model, after asking.
- **Any Ollama model:** `/model pull <name>` downloads one that isn't in the list, after showing its size. `/model rm <name>` removes one.
- **Disk space:** golem checks the free space first.
- **When Ollama isn't there:** golem says whether to run `brew install ollama` or `ollama serve`.

`just golem models` shows what you can pick from:
- **Installed local models:** found through Ollama, so a fresh `ollama pull` shows up at once.
- **Local models to download:** a short built-in list, each with its download size and whether it fits in this Mac's memory.
- **Hosted models:** each provider's own list, once that provider has a key.
- **Prices and context sizes:** from the provider when it says (OpenRouter does), otherwise from [LiteLLM's price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json). A profile's `price` wins over both.
- **Caching:** hosted lists and LiteLLM's prices are cached for a day in `~/.golem/cache/`. Golem bundles a copy of LiteLLM's prices for the first start and for offline use.

| Provider | Talks to | API key from |
|---|---|---|
| `ollama` | Ollama at `http://127.0.0.1:11434`, through its native API | none |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY` |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `openrouter`, `groq`, `together` | Their OpenAI-compatible APIs, for hosted open models | `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY` |
| `lmstudio` | LM Studio at `http://127.0.0.1:1234/v1` | none |

Override a provider's address or key variable, or add any OpenAI-compatible server, under `[providers.<name>]`:

```toml
[providers.ollama]
base_url = "http://10.0.0.2:11434"

[providers.vllm]                   # a new name is OpenAI-compatible
base_url = "http://127.0.0.1:8000/v1"
api_key_env = "VLLM_API_KEY"       # optional
```

The older flat settings (`model_provider`, `model_name`, `model_base_url`) still work. They load as one profile named after `model_profile` (default `remote`), and an Ollama address there uses the native `ollama` provider.

API keys never go in the config file. Save one in the macOS Keychain, once, while the daemon is running:

```bash
just golem auth set anthropic          # prompts, and echoes nothing
pbpaste | just golem auth set openai   # or pipe it in
just golem auth list                   # where each provider's key is
just golem auth remove anthropic
```

In the TUI, `/login anthropic` asks for the key in a masked prompt and `/logout anthropic` removes it. The daemon stores the key and reads it back at each model call, so the background service needs no environment variables and no restart. An environment variable such as `ANTHROPIC_API_KEY` still works, and it wins over the Keychain.

After uv installs a new Python, macOS may ask once whether Python may use the golem Keychain item. Choose Always Allow. From a checkout, the Keychain trusts uv's shared Python interpreter, not golem itself, so another project's scripts on that same interpreter could read the keys. Run other projects on a different Python version until golem ships as its own signed binary (plan step 3.3).

### All settings

| Setting | Default | Meaning |
|---|---|---|
| `default_model` | `model_profile` | A profile name or a `provider/model-id`. New sessions start on it |
| `[models.<name>]` | none | A profile: `model` (a `provider/model-id`), an optional `ctx`, and an optional `price = { input = 3.0, output = 15.0 }` in USD per million tokens |
| `[providers.<name>]` | built-in presets | `kind` (`anthropic`, `openai`, `ollama`, or `openai_compat`), `base_url`, `api_key_env` |
| `model_provider`, `model_name`, `model_base_url` | none | Older flat settings for one model, kept working |
| `model_profile` | `remote` | The profile name the flat settings load as |
| `session_titles` | `true` | Name each session after its first answer. This costs one extra model call |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, or `ERROR` |

Each setting can also be set with an environment variable named `GOLEM_` plus the setting in capitals, for example `GOLEM_MODEL_NAME`. The environment wins over the file. Apart from the model settings, the daemon reads its settings only when it starts, so restart it after a change: Ctrl-C and run it again from the command line, or `just golem daemon start` under launchd.

## Run the daemon

There are two ways. Pick one, because only one daemon can run at a time.

### From the command line

The simplest way to start. The daemon runs in that terminal, and Ctrl-C stops it.

```bash
uv run python -m golem serve
```

It sees your shell's environment, so an exported `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` just works. Settings work the same way, for example `GOLEM_LOG_LEVEL=DEBUG uv run python -m golem serve`. Open the TUI in a second terminal. Nothing restarts the daemon if it crashes or you close the terminal.

### In the background with launchd

For daily use. launchd starts the daemon at every login and restarts it after a crash.

```bash
just golem daemon install    # write the launchd job and start it; run once
just golem status            # is it up? prints pid, version, protocol, uptime
```

`install` records this checkout's virtualenv, so run it again if you move the repository. To switch back to the command line, run `just golem daemon stop` first.

### Daemon commands

| Command | What it does |
|---|---|
| `just golem --version` | Prints the CLI version. When the daemon is up, prints its version on the next line |
| `just golem status` | Prints pid, version, protocol, and uptime. Exits 1 if nothing is listening |
| `just golem daemon install` | Writes `~/Library/LaunchAgents/dev.golem.daemon.plist` and loads it |
| `just golem daemon start` | Starts the daemon, or restarts it if it is running |
| `just golem daemon stop` | Unloads the job. The daemon stays down until the next `start` |
| `just golem daemon logs` | Shows the last log lines and follows them. `--no-follow` prints and exits |
| `just golem auth set <provider>` | Saves the provider's API key in the Keychain, from a hidden prompt or stdin |
| `just golem auth remove <provider>` | Removes that key from the Keychain |
| `just golem auth list` | Says where each provider's key is: the Keychain, an environment variable, or missing |
| `just golem models` | Lists every model golem can use or download, with context size, price, size, and whether it fits in memory. `--refresh` skips the one-day cache |
| `just golem config show` | Prints the settings the daemon uses and the tool rules for the current folder, in the order they are checked |

## Chat

```bash
just tui
```

The TUI opens your newest session, or a new one if there is none. Type and press Enter.

The header shows which golem this is. The status line shows the session title, how many messages it holds, and how long the daemon has been up. While you are scrolled up, it also shows how many new lines arrived. End jumps back. A narrow window hides uptime first, then the message count, then the folder. The terminal tab is named `golem — <title>`.

A finished answer shows how long it took, under the text. `/time` shows the time of each message.

### Slash commands

| Command | What it does |
|---|---|
| `/help` | Lists every command, with its arguments |
| `/copy` | Copies the last answer |
| `/copy code` | Copies the last fenced code block |
| `/export` | Writes this session as markdown, to `~/.golem/exports/<title>.md` |
| `/export <path>` | Writes that markdown to the path you give |
| `/time` | Shows or hides the time beside each message |
| `/sessions` | Opens the session switcher, with live status |
| `/close` | Closes this session and opens the newest other one |
| `/new` | Starts a new session |
| `/title` | Shows the current session's title |
| `/title <name>` | Renames the current session |
| `/fork` | Copies the session, up to its newest finished message, into a new session |
| `/model` | Opens the model picker: Enter uses or downloads a model, `d` also makes it the default, `x` stops a download or removes a model, typing filters, Ctrl-R refreshes |
| `/model <name>` | Switches this session to a profile or a `provider/model-id`, from the next message |
| `/model pull <name>` | Downloads any Ollama model, after showing its size and whether it fits |
| `/model rm <name>` | Removes a downloaded Ollama model, after asking |
| `/login <provider>` | Asks for the provider's API key in a masked prompt and saves it in the Keychain |
| `/logout <provider>` | Removes the provider's API key from the Keychain |
| `/debug` | Opens or closes the debug panel |
| `/debug wire` / `/debug model` | Shows the protocol messages, or the conversation the model sees |
| `/debug hold` | Holds back the next message so you can inspect it before sending |
| `/debug go` | Sends the held message |
| `//text` | Sends `/text` as a message, not a command |

Anything else that starts with `/` stays on screen: `unknown command — /help lists them`.

Type `/` and matching commands appear above the composer. Typing narrows them, prefix first. Up and Down move, Tab fills in the selected row, and Enter fills in a partial name. Esc closes the list and leaves what you typed. `/debug w` offers `wire`. A line starting with `//` keeps the list closed.

### Keys

| Key | What it does |
|---|---|
| Enter | Sends the message. Shift-Enter or Alt-Enter inserts a line |
| Up, Down | On an empty line, Up recalls a message you sent, newest first. Down steps back |
| Left, Right | Move the cursor. Alt-Left and Alt-Right move by word |
| Ctrl-A, Ctrl-E | Jump to the start or end of the line |
| Backspace, Delete, Ctrl-W, Ctrl-U, Ctrl-K | Delete around the cursor |
| Ctrl-G | Opens the draft in `$EDITOR`, or `vi` |
| `?` | On an empty line, shows every key. `?` or Esc closes the list |
| F1 | Shows or hides the key list |
| Ctrl-C | Cancels the answer in progress. A second Ctrl-C quits |
| Page Up, Page Down, Home, End, mouse wheel | Scroll the chat. End jumps back to new lines. The same keys scroll the key list while it is open |
| Up, Down | Move through command suggestions while that list is open |
| Tab | Fills in the selected command or argument. Also switches the debug tab |
| Up, Down, Enter, `n`, type, Ctrl-D, Esc | In the session switcher: move, open, start a new session when the filter is empty, filter by title, ask to close the selected session (`y` confirms), or leave. Esc clears a filter, cancels that confirm, or closes the list |
| Tab | Switches the debug tab |
| Esc | While recalling, restores the line you had. Then it closes suggestions, the command list, and the debug panel |

## Where things live

| Path | What |
|---|---|
| `~/.golem/config.toml` | Your settings |
| `~/.golem/golem.db` | Sessions, runs, and every event |
| `~/.golem/checkpoints.db` | What the model remembers of each conversation |
| `~/.golem/logs/golem.jsonl` | The daemon log. launchd's own output is next to it |
| `~/.golem/run/golem.sock` | The socket the TUI connects to |
| `~/.golem/history` | Messages you sent, so a new session can recall them |
| `~/.golem/exports/` | Sessions written with `/export` |
| `~/.golem/tui.json` | Whether message times are shown |

Set `GOLEM_HOME` to use another folder, for example a throwaway one for experiments. Both the daemon and the TUI respect it. A daemon started by launchd keeps the folder it was installed with.

## When something is wrong

| Symptom | Check |
|---|---|
| The status line says `reconnecting` | Is the daemon up? Run `just golem status`. Then start it from the command line, or with `just golem daemon start` |
| `daemon already running (pid N)` | The launchd copy is up. Run `just golem daemon stop` before running it from the command line |
| A red error says `needs key` | Run `/login <provider>` in the TUI, or `just golem auth set <provider>` |
| A red error mentions an unknown model or provider | Check `~/.golem/config.toml` |
| A local model does not answer | Is Ollama running (`ollama serve`), and is the model pulled? |
| Anything else | Run `just golem daemon logs` |

To see the restart for yourself: run `just tui`, then kill the pid from `just golem status`. The status line switches to `reconnecting`, launchd starts the daemon again, and the line returns to `connected`. Do not use `stop` for this. It unloads the job, so launchd does not bring the daemon back.

## Development

| Command | What it does |
|---|---|
| `just` | Lists all recipes |
| `just check` | Regenerates the protocol types, then runs lint, typecheck, and tests. This is what CI runs |
| `just test` | pytest and the TypeScript tests |
| `just fmt` | Formats the Python code |
| `just gen` | Regenerates the TypeScript types from the Python protocol models |
| `just catalog` | Checks the local model catalog against the Ollama registry, rewrites sizes that changed, and lists newer releases of each family |
| `just prices` | Rewrites the bundled copy of LiteLLM's model prices |

## Documentation

- [docs/architecture.md](docs/architecture.md) explains how the daemon, the protocol, and the TUI fit together.
- [docs/plan.md](docs/plan.md) is what comes next, step by step.
- [docs/monorepo.md](docs/monorepo.md) explains the Python and TypeScript workspace setup.
- [docs/adr/](docs/adr/README.md) records why things are built the way they are.
