# homebrew-golem

The Homebrew tap for [golem](https://github.com/MilanPavel/golem), a personal AI agent that runs on your own machine. Apple Silicon Macs only, for now.

```bash
brew install milanpavel/golem/golem
golem                       # open the chat; the first time, it asks to start its service
```

The [install guide](https://github.com/MilanPavel/golem/blob/main/docs/install.md) explains each step.

Upgrade:

```bash
brew upgrade golem
golem daemon restart        # or press Ctrl-R in golem
```

Remove, in this order. Chats and settings stay in `~/.golem`:

```bash
golem daemon uninstall
brew uninstall golem
```

## How this repository is maintained

Do not edit it by hand. Each golem release opens a pull request here that replaces `Formula/golem.rb` with the new version and checksum, and copies this README and `.github/` from `packaging/homebrew/` in the golem repository. The `test` workflow installs the formula, checks that Homebrew kept the signed archive unchanged, and smoke-tests the daemon. Merge the pull request when it passes.
