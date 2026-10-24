---
name: setup
description: Make this golem checkout ready for development. Checks the tools (just, uv, Node, pnpm, bun, gh), installs the Python and Node packages and the git hooks, and can run just check. Use after a fresh clone, when a tool or package seems missing, or when the user types /setup.
---

# Set up a golem checkout

All the work is in `scripts/setup.sh`, so a person without Claude gets the same result with `just setup`. Your job is to run it, explain what it says, and ask before changing the machine.

## 1. Check

Run from the repository root:

```sh
scripts/setup.sh
```

Each line starts with a mark:

- `✓` ready.
- `!` a warning. Setup goes on.
- `✗` a problem. Setup stops before the packages.

Lines under a `!` or `✗` start with `fix:` and say how to fix it.

## 2. If tools are missing (exit 1)

1. List the missing tools with their `fix:` commands in one short table.
2. Ask the user whether to install them. Never install without a yes.
3. On a yes, run `scripts/setup.sh --install`. It installs the missing tools with Homebrew, turns on corepack for pnpm, and then carries on.
4. If Homebrew itself is missing, don't install it. Point to https://brew.sh and stop.
5. Never use `sudo`.

## 3. Warnings

| Warning | What to tell the user |
|---|---|
| `gh` not signed in | They need it for `/ship` and `just release`. It's interactive, so they run `! gh auth login --hostname github.com` themselves |
| `bun` version | CI uses 1.3. A different version may build differently |
| `path` too long | The daemon tests create sockets under the checkout, and macOS allows 103 bytes. Suggest a clone in a shorter folder |

## 4. A package step fails

The script prints the failing command's output, indented. Read it and explain the cause in one or two sentences. Typical causes:

- a lock file that is out of date: `--frozen` refuses to change `uv.lock`, and `--frozen-lockfile` refuses to change `pnpm-lock.yaml`;
- no network;
- a Node version below 24.

Suggest the fix. Don't edit the lock files.

## 5. Finish

When the script says `Ready`, ask whether to run `just check` too. It takes about two minutes. If yes, run `scripts/setup.sh --check`, or `just check` when the packages are already installed. If a test fails, show its name and first error line.

End with a short summary:

- what is ready;
- what is still a warning;
- the next command, `just golem` to open the chat, as in the README.
