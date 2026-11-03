# Install golem on a Mac

A step-by-step guide for a new user. It takes about five minutes, plus the model download if you choose a local model.

## What you need

- A Mac with Apple Silicon (M1 or newer). Check with  > About This Mac: the chip should say Apple M-something.
- [Homebrew](https://brew.sh). If `brew --version` says "command not found", install it:

  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```

  At the end, the installer prints two or three commands under "Next steps". Run them, so your terminal finds `brew`.

## 1. Install

```bash
brew install milanpavel/golem/golem
golem --version             # golem 0.1.0, or newer
```

## 2. Open golem

```bash
golem
```

The first time, golem asks to start its background service. The service is the part of golem that talks to the model and keeps your chats, so a chat keeps going when you close the terminal. Press Enter to start it now and at every login. It also restarts by itself if it ever crashes. Press `n` to run it only while this window is open, or `q` to quit.

Check it any time:

```bash
golem status                # prints pid, version, and uptime
golem doctor                # checks the whole install
```

Without the chat, for example to use only `golem web` or a script, start the service with no question:

```bash
golem daemon install
```

## 3. Choose a model

Pick at least one. You can use both.

**A local model.** It's free and private, and it needs no account. It needs a few GB of disk and memory. There is nothing to install now. When you pick a local model in golem and Ollama is missing, golem asks once, then installs it with Homebrew and downloads the model. Without Homebrew, it gives you the download link from ollama.com.

golem starts Ollama when a local model needs it, and stops it after 30 minutes unused. If you want Ollama running all the time, run `brew install ollama` and `brew services start ollama`. golem uses that one and never stops it.

You choose the model in step 4, from inside golem.

**A hosted model** (Anthropic, OpenAI, OpenRouter, Groq, or Together). You need an API key from that provider. golem saves it in the macOS Keychain, never in a file:

```bash
golem auth set anthropic    # paste the key; nothing is echoed
golem auth list             # shows which providers have a key
```

Or type `/login anthropic` in the chat.

## 4. Chat

Go to the folder you want golem to work in, and open the chat:

```bash
cd ~/my-project
golem
```

- On the first start, golem uses your only ready model, or opens the model picker if there are several or none. `/model` opens the picker any time. Choose a model with Up and Down, then press Enter. A local model that isn't downloaded yet asks once, then downloads with a progress bar.
- Type a message and press Enter.
- golem can read and search files only inside the folder you started it in. It asks before it changes a file or runs a command.
- Type `/help` for all commands, or `?` on an empty line for all keys. Ctrl-C twice quits.

Closing the chat doesn't stop an answer. Run `golem` again to see it. [First chat](guide/first-chat.md) walks through a first question and a first approval.

## Upgrade

```bash
brew update
brew upgrade golem
```

The running service is still the old version. golem says so in the chat: press Ctrl-R there to restart it. Or run `golem daemon restart`.

Your chats and settings carry over. If a new version changes the database, golem copies the old file first, for example to `~/.golem/golem.db.bak-5`.

## Remove

Run these in this order. If you run `brew uninstall` first, macOS keeps trying to start a daemon that no longer exists.

```bash
golem daemon uninstall
brew uninstall golem
brew untap milanpavel/golem
```

Your chats and settings stay in `~/.golem`. To delete them too, run `rm -rf ~/.golem`. API keys stay in the Keychain until you remove them: run `golem auth remove <provider>` before you uninstall.

## When something is wrong

Run `golem doctor` first. It checks the install from top to bottom, prints a fix under each problem, and ends with the one thing to do next:

```text
✓ daemon   /opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon
✓ service  launchd runs /opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon
✓ running  version 0.2.0, pid 4242
✓ socket   only you can open it (0600)
✓ config   /Users/you/.golem/config.toml is valid
✓ model    new chats start on ollama/qwen3:8b
✗ ollama   Ollama is not installed
           fix: golem, then /setup installs it, or brew install ollama
✓ disk     154.6 GB free

1 problem.
Next: golem, then /setup installs it, or brew install ollama
```

| What you see | What to do |
|---|---|
| `brew install` stops for a few minutes after "Installing golem" | Homebrew is asking `api.github.com` whether the tap is private, for its usage statistics, and your network blocks that address. Wait, or run `brew analytics off` once to skip the question |
| `golem: command not found` | Homebrew isn't in your terminal's path. Run the "Next steps" commands the Homebrew installer printed, then open a new terminal |
| The chat says `reconnecting` | The daemon isn't running. Run `golem status`, then `golem daemon start` |
| `needs key` in red | Run `golem auth set <provider>`, or `/login <provider>` in the chat |
| A local model doesn't answer | Run `golem doctor`. golem starts Ollama itself. If it doesn't start, look in `~/.golem/logs/ollama.log` |
| macOS asks whether golem may use a Keychain item | Choose Always Allow. It asks once, for keys saved by an older copy of golem |
| Anything else | Run `golem daemon logs` |

Settings are in `~/.golem/config.toml`. [Models and API keys](guide/models.md#settings) lists them all.
