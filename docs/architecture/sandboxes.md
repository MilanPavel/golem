---
title: Sandboxes
description: Why a command you allowed still runs in a box, what golem's shell sandbox lets through and what it stops, and how the file tools keep to the project folder.
order: 8
adrs: [14, 30, 38]
---

# {{ $frontmatter.title }}

[Permissions](./permissions.md) decide whether a call runs. But a yes can be wrong. You may allow a command without reading it to the end, or a command may do more than its name says. So what stops a command you allowed from reading your keys, or sending your code somewhere?

## The idea

::: concept In agents generally

A permission is one guard: it decides *whether* a call runs. A **sandbox** is a second one: it decides *what a running call may touch*. The operating system enforces it, so it holds even when the command, or the model that wrote it, tries to get around it.

A sandbox usually limits four things:

1. **Writes.** The project folder and the temp folders, and nothing else on the disk.
2. **Reads of secrets.** SSH keys, cloud credentials, and the agent's own files stay closed.
3. **The network.** Off by default, so a command cannot send data out or fetch a script to run.
4. **The environment.** Variables that hold API keys and tokens are removed before the command starts.

The two guards cover each other. A permission can't foresee everything a command does. A sandbox doesn't know which commands you meant to allow. Together, a wrong yes costs much less.

![Two guards: a permission decides whether a command runs, and a sandbox decides what a running command may touch. rm -rf ~ is stopped at the permission, because you said no. cat ~/.ssh/id_ed25519 was allowed by mistake, and the sandbox stops it. pytest -q passes both and reaches the project](../images/sandbox-layers.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| No sandbox | Approvals only | Nothing to set up | One wrong yes can do anything your user can |
| Checks in the tool | The tool itself refuses paths outside the project | Simple, for tools that do one thing | Useless for a shell, which can do anything |
| An OS sandbox | The kernel limits the process: Seatbelt (`sandbox-exec`) on macOS, Landlock or `bubblewrap` on Linux | Fast, and the command uses your own tools | Each OS has its own, and the rules take care to write |
| A container | Each command runs in Docker or a similar box | Strong walls, the same on every machine | Needs Docker, starts slowly, and sees a different toolchain than yours |
| A remote machine | The agent works on a VM in the cloud | Nothing on your machine is at risk | It is not your machine: your files, tools, and keys are elsewhere |

Every version has to answer the same questions:

- **How much to close.** Deny every read outside the project, and compilers and shells break, because they read from all over the home folder. Deny only the folders that hold secrets, and some files can still be read.
- **What to do without a sandbox.** Run the command anyway and ask every time, or refuse to run it.
- **Who may widen it.** A project file that opens the network would undo the point.

## How golem does it

::: golem In golem

golem has two kinds of wall, besides the permission rules:

- **The shell sandbox.** `shell`, `git_status`, `git_diff`, and `git_log` run under `sandbox-exec`, with a profile golem writes for each command. Where no sandbox can be applied, they don't run at all.
- **The file tools' folder check.** `read_file`, `write_file`, and the other file tools run in the daemon, not in the sandbox. Each one resolves its path first, and refuses anything outside the session's project folder.

![golem's shell sandbox in one real run, with every command allowed by a rule. touch notes.txt writes in the project folder and exits 0. touch in the home folder and ls ~/.ssh fail with Operation not permitted, curl cannot connect because the network is off, and printenv prints nothing because credential variables are removed](../images/sandbox-shell.svg)

One shell command, in the order it runs:

1. **It is allowed,** by a rule, a session allowance, or your yes ([Permissions](./permissions.md)).
2. **golem writes the profile.** Writes are allowed only to the project folder, the temp folders, the usual caches, and any folder in `[shell] writable`. Reads of the folders that hold credentials are denied. The network is off unless `[shell] network = true`.
3. **golem cleans the environment.** Variables whose names look like credentials are removed.
4. **The command runs** as `$SHELL -lc <command>` in the project folder, under `sandbox-exec`, in its own process group.
5. **A blocked action fails inside the command.** macOS answers `Operation not permitted`, the command prints it, and it exits with an error. The model reads that as the result, and the run goes on.

Here is a real run, recorded against a throwaway home with `qwen3-coder:30b` on a local Ollama. A rule in `config.toml` allowed every `shell` call, so the sandbox was the only guard. The daemon was started with `DEMO_API_KEY=not-a-real-key` in its environment, and the home folder is shown as `~`.

| seq | Command | `tool.completed` |
|---|---|---|
| 12 | `touch notes.txt` | `exit 0` |
| 15 | `touch ~/golem-sandbox-probe` | `exit 1`: `Operation not permitted` |
| 18 | `ls ~/.ssh` | `exit 1`: `Operation not permitted` |
| 21 | `curl -sS -m 5 https://example.com -o /dev/null` | `exit 7`: `Couldn't connect to server` |
| 23 | `printenv DEMO_API_KEY` | `exit 1`, and nothing printed |

One write in the project, and four things the sandbox kept out: a write to the home folder, a read of `~/.ssh`, the network, and a key in the environment. Afterwards, `~/golem-sandbox-probe` did not exist.

**Where it lives in the code:**

- `packages/daemon/golem/tools/sandbox.py`: `profile`, `environment`, `available`, `run`, `git_dirs`, and the folder lists `SECRET_DIRS`, `SKILL_DIRS`, and `CACHE_DIRS`.
- `packages/daemon/golem/tools/shell.py`: `shell` and the git tools, which run through it.
- `packages/daemon/golem/tools/paths.py`: `inside`, `writable`, and `Readable`, the file tools' folder check.

:::

## Why this way

**`sandbox-exec`, or not at all** ([ADR-014](../adr/014-shell-sandbox.md)). It ships with every macOS. A container or a VM would need software you may not have, start slowly, and see a different toolchain than yours. Apple marks `sandbox-exec` deprecated, so if it goes, the shell stops until another sandbox replaces it. It never falls back to a command without one: one wrong approval would be unrecoverable.

**Deny the secret folders, not every read.** Compilers, package managers, and your shell's startup files read from all over the home folder. Denying the folders that hold credentials keeps most of the value, with little breakage. The cost: a command you allowed can still read and print other files in your home folder.

**The file tools check their own paths.** They do one thing, to one path that has already been resolved, so the path check is the guard, and they need no sandbox.

**A skill's folder is readable, never writable** ([ADR-030](../adr/030-skill-read-roots.md)). A skill you ran may need its `references/` and `scripts/`. So the read tools may read its folder, and the sandbox lets commands read `~/.golem/skills`, but nothing writes there.

**Only you widen it.** `[shell]` is read only from your own `config.toml`. A project file cannot turn on the network or add a writable folder.

## Try it

1. Open the chat with `golem` in a project folder.
2. Ask: `Run ls ~/.ssh in the shell.` Allow it. The result is `Operation not permitted`.
3. Ask: `Run curl -sI https://example.com in the shell.` Allow it. It can't connect, because the network is off.
4. To let commands use the network, add this to `~/.golem/config.toml`, and restart the daemon with `golem daemon restart`:

   ```toml
   [shell]
   network = true
   ```

## The details

For contributors: the reference for the shell sandbox, the git tools, and the file tools' folders.

### The shell sandbox

`shell` runs the user's login shell (`$SHELL -lc`) in the session folder, under `sandbox-exec` ([ADR-014](../adr/014-shell-sandbox.md)):
- **The sandbox** allows writes only to the folder, the temp folders, the usual tool caches, and `[shell] writable`. When the folder is in a git checkout whose git folders are outside it, it may write those too, so `git fetch` and `git commit` work. In a git worktree they are its own folder, from the `gitdir:` line of its `.git` file, and the folder it shares with the main checkout, from `commondir`. The rest of the main checkout stays closed. golem reads the two files itself and does not run git (`sandbox.git_dirs`). The shared folder holds the main checkout's hooks and config, so a command could change them. A command in a plain clone could always do that, since its `.git` is inside the session folder. It denies the network unless `[shell] network = true`, except local Unix sockets. It denies reads of folders that hold credentials, `~/.ssh` and `~/.golem` among them, but allows reads of `~/.golem/skills`, so a skill can run its scripts ([ADR-030](../adr/030-skill-read-roots.md)). Variables that look like credentials (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*PASSWORD*`) are removed from the environment.
- **Policy.** `shell` is not read-only, so by default every command asks. A rule's `match` is checked against the command, so `match = "git status|pnpm test*"` allows those and nothing else. Allowing a command for the session allows that exact command, not every command.
- **Where there is no sandbox**, for example inside another sandbox or off macOS, `shell` and the git helpers refuse to run and say why.
- **Outside the sandbox.** `shell_unsandboxed` runs the same way without `sandbox-exec`, and keeps the variables that hold credentials, so `gh` and `git push` work ([ADR-038](../adr/038-shell-unsandboxed.md)). It needs no sandbox, so it runs where `shell` cannot. It is a tool of its own, so a rule or a session allowance for `shell` never lets a command out. An `allow` rule covers it only when it names it (`NAMED_ONLY` in `golem/permissions/engine.py`), so `tool = "*"` does not.

**The profile, in full** (`profile` in `golem/tools/sandbox.py`). It allows everything, then:

| | Allowed | Denied |
|---|---|---|
| Writes | The session folder, `/private/tmp`, `/private/var/folders`, `~/.cache`, `~/Library/Caches`, `~/.npm`, `~/Library/pnpm`, `~/.cargo/registry`, `[shell] writable`, the checkout's git folders when they are outside the session folder, and a few devices such as `/dev/null` | Everything else |
| Reads | Everything else, and `~/.golem/skills` | `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.config/gh`, `~/.config/gcloud`, `~/.golem`, `~/Library/Keychains` |
| Network | Local Unix sockets, or all of it with `[shell] network = true` | Everything else |

Paths are resolved first, because the profile matches real paths (`/tmp` is `/private/tmp`).

**The environment** (`environment`). A variable whose name contains `_API_KEY`, `_TOKEN`, `_SECRET`, `PASSWORD`, or `_PASSWD`, in any case, is removed. `PATH` gains `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, and `~/.cargo/bin` when they are missing. `TERM=dumb`, `NO_COLOR=1`, the pagers set to `cat`, and `GIT_TERMINAL_PROMPT=0` keep the output plain and stop prompts.

**Availability** is probed once per process, by applying an empty profile. It fails off macOS, and inside another sandbox. That is also why the sandbox tests skip when golem's own tests run under golem's shell.

Its output, and how a command is stopped, are in [Tools](./tools.md#the-shell-s-output).

### The git tools

`git_status`, `git_diff`, and `git_log` run git directly in the same sandbox, without the network. They switch off the repository settings that run code: `core.fsmonitor`, hooks, external diff drivers, and text conversion. They are read-only, so the default policy allows them.

### The file tools' folders

The file tools run in the daemon, not under `sandbox-exec`, so `golem/tools/paths.py` is their wall:

- **Inside the folder.** `inside` resolves a path against the session folder with symlinks followed. A path that lands outside, through `..` or a symlink, is refused.
- **Never the rules or the history.** `writable` also refuses the folder itself, and anything under a `.golem/` or `.git/` folder at any depth, matched without case.
- **No folder, no file tools.** A session without a project folder gets the tools, and each call says `this session has no project folder, so file tools are off.`
- **Skill folders, for reading.** The read tools also accept an absolute path inside the folder of a skill the session ran, or one it has pinned. A path there that resolves into a folder the sandbox keeps from commands is refused, so a skill folder that is a link to `~/.ssh` reads nothing.

Who may read and write where ([ADR-030](../adr/030-skill-read-roots.md)):

| Path | Read tools | Shell (sandbox) | Write tools |
|---|---|---|---|
| The session folder | yes | read and write | yes |
| The folder of a skill the session ran | yes, by absolute path | read | no |
| `~/.golem/skills/…` before the skill runs | no | read | no |
| `~/.golem/golem.db`, logs, config | no | no | no |

`web_fetch` has its own wall: it refuses private and local addresses ([Tools](./tools.md#web-fetch)).

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/tools/sandbox.py` | The profile, the environment, the availability probe, and running a command |
| `packages/daemon/golem/tools/shell.py` | `shell`, `git_status`, `git_diff`, and `git_log` |
| `packages/daemon/golem/tools/paths.py` | `inside`, `writable`, `Readable`, and `PROTECTED_DIRS` |

## Read more

- Next: [Context](./context.md), what the model sees on each call, and the system prompt.
- Before: [Permissions](./permissions.md).
- [Tools and permissions](../guide/permissions.md#the-shell-sandbox), the user's guide to the sandbox.
- [The overview](../architecture.md): the whole system on one page.
