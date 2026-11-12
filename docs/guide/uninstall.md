---
title: Uninstall
description: Remove golem, its background jobs, your keys, and optionally your chats and Ollama.
---

# Uninstall

Run the steps in this order. `golem` has to be installed for steps 1 and 2, and if you run `brew uninstall` first, the old background service can keep running. The next golem you install then finds the leftover launch agent and installs it again.

## 1. Stop the background jobs

```bash
golem uninstall
```

This removes both launchd jobs: the service (`dev.golem.daemon`) and the web page (`dev.golem.web`). `golem daemon uninstall` removes only the service, so use `golem uninstall`. Your chats and settings in `~/.golem` stay.

## 2. Remove your keys

Keys are in the macOS Keychain, not in a file, so removing golem does not remove them.

```bash
golem auth list                    # the providers that have a key
golem auth remove anthropic        # repeat for each provider
golem auth remove mcp/github       # an MCP server's token, if you added one
```

After step 3 there is no `golem` left to do this with. If you are past that point, see [If golem is already gone](#if-golem-is-already-gone).

## 3. Remove the program

```bash
brew uninstall golem
brew untap milanpavel/golem
```

## 4. Optional: your chats and settings

`~/.golem` holds your chats (`golem.db`), what the model remembers of them (`checkpoints.db`), `config.toml`, logs, and the files golem needs while it runs (`run/`). If you keep the folder and install golem again, your chats come back. To delete everything:

```bash
rm -rf ~/.golem
```

See [Where the data lives](../ops/run.md#_8-where-the-data-lives) for what each file is.

## 5. Optional: Ollama and its models

If you chose a local model, golem may have installed Ollama through Homebrew and downloaded models, which take several GB. `brew uninstall golem` does not remove them. If nothing else on your Mac uses Ollama:

```bash
brew services stop ollama
brew uninstall ollama
rm -rf ~/.ollama                   # the downloaded models
```

## Check that it is gone

```bash
launchctl list | grep dev.golem    # prints nothing
which golem                        # prints nothing
```

## If golem is already gone

You ran `brew uninstall` first, or `golem` does not start. Remove the jobs by hand:

```bash
launchctl bootout gui/$(id -u)/dev.golem.daemon
launchctl bootout gui/$(id -u)/dev.golem.web
rm -f ~/Library/LaunchAgents/dev.golem.daemon.plist ~/Library/LaunchAgents/dev.golem.web.plist
```

`bootout` prints an error for a job that is not there. That is fine.

Remove leftover keys in Keychain Access: search for `golem` and delete each item. Or in the terminal, once per key, where the account is the provider name (`anthropic`) or `mcp/<name>` or `hook/token`:

```bash
security delete-generic-password -s golem -a anthropic
```

This asks for no confirmation.
