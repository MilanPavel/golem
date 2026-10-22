# homebrew-golem

The Homebrew tap for [golem](https://github.com/MilanPavel/golem), a personal AI agent that runs on your own machine. Apple Silicon Macs only, for now.

```bash
brew install milanpavel/golem/golem
golem daemon install        # start the daemon, now and at every login
golem auth set anthropic    # optional: save an API key, or use Ollama
golem                       # open the chat
```

Upgrade:

```bash
brew upgrade golem
golem daemon restart
```

Remove, in this order. Chats and settings stay in `~/.golem`:

```bash
golem daemon uninstall
brew uninstall golem
```

## How this repository is maintained

Do not edit it by hand. Each golem release opens a pull request here that replaces `Formula/golem.rb` with the new version and checksum, and copies this README and `.github/` from `packaging/homebrew/` in the golem repository. The `test` workflow installs the formula, checks that Homebrew kept the signed archive unchanged, and smoke-tests the daemon. Merge the pull request when it passes.
