# Golem — operations guide

This guide explains how golem is built, tested, installed, and kept running, and what is still to come. It is written for someone who runs golem or ships it, not for someone changing its code.

For more detail:
- How the code works inside: [architecture.md](architecture.md)
- Why it is built this way: the [ADRs](adr/README.md)
- The roadmap, step by step: [plan.md](plan.md)

---

## 1. The big picture

Golem has two parts:

- **The daemon** is a program that runs in the background all the time. It talks to the AI models, runs tools, and saves every conversation. It is written in Python.
- **`golem`** is the command you type. With no arguments it opens the chat screen (the **TUI**). With arguments it does small jobs, such as `golem status`. It is written in TypeScript.

The two talk through a **socket**: a special file on disk, `~/.golem/run/golem.sock`, that works like a private phone line between programs on the same computer. Nothing is open to the network.

```mermaid
flowchart LR
  you([You]) --> golem["golem<br/>(chat screen and commands)"]
  golem <-->|"socket file<br/>~/.golem/run/golem.sock"| daemon["Daemon<br/>(runs in the background)"]
  launchd["launchd<br/>(macOS service manager)"] -->|"starts at login,<br/>restarts after a crash"| daemon
  daemon --> data[("~/.golem<br/>settings, chats, logs")]
  daemon --> keychain[("macOS Keychain<br/>API keys")]
  daemon -->|internet| cloud["Anthropic, OpenAI,<br/>OpenRouter, ..."]
  daemon -->|this computer| local["Ollama, LM Studio"]
```

Why split it this way? Closing the chat screen does not stop the work. An answer keeps streaming, or a question keeps waiting for your approval, while the screen is closed. Open it again and everything is still there.

**Who can connect?** Only your own user account. The socket file has permissions `0600`: only its owner can read or write it. There is no password. The file permission is the lock on the door.

---

## 2. The code and the tools

Everything is in one repository, with two sets of packages:

| Folder | Language | What it is |
|---|---|---|
| `packages/protocol` | Python | The message formats the daemon and `golem` agree on |
| `packages/daemon` | Python | The daemon |
| `packages/client` | TypeScript | The library that talks to the daemon |
| `packages/cli` | TypeScript | The `golem` command |
| `packages/tui` | TypeScript | The chat screen |
| `packages/web` | TypeScript | The web UI, built with Vite. Phase 10. |

The message formats are written once, in Python. A script (`just gen`) turns them into TypeScript, so the two sides cannot disagree. If someone changes one side and forgets the other, the checks fail.

Tools a developer needs:

| Tool | What it does here |
|---|---|
| **uv** | Installs Python and the Python packages |
| **pnpm** and **Node** | Install and test the TypeScript packages |
| **bun** | Runs `golem` from the source code, and turns it into a single program file |
| **PyInstaller** | Packs the daemon and its own copy of Python into one folder |
| **just** | Runs every task: `just check`, `just dist`, and so on |
| **git-cliff** | Writes the release notes in `CHANGELOG.md` from the commit messages. It comes with the Python dev tools, so `uv sync` installs it |
| **gh** | The GitHub command line. `just release`, `just tag`, and `just protect` use it |

Exact versions are pinned in two lock files, `uv.lock` and `pnpm-lock.yaml`. Everyone, including CI, installs the same versions.

---

## 3. Versions

There is one version number for everything. It comes from git tags.

```mermaid
flowchart LR
  tag["git tag<br/>v0.3.0"] --> script["scripts/version.sh"]
  script -->|"0.3.0"| build["just dist"]
  build --> d["daemon reports 0.3.0"]
  build --> c["golem reports 0.3.0"]
  none["no tag, or running<br/>from source code"] -->|"0.0.0-dev"| c2["both report 0.0.0-dev"]
```

- Running from the source code always shows `0.0.0-dev`.
- A build shows the tag it was built from.
- You do not type the tag. `just tag` creates it from the merged release commit (section 5, "Releases").
- `golem --version` prints its own version and, if the daemon is running, the daemon's version.
- If the two differ, the chat screen shows both in yellow. They still work together. Only a big protocol change (a new **major** version) stops them from connecting.

---

## 4. Building

`just dist` builds golem into one folder that you can copy anywhere:

```
dist/golem-0.3.0-darwin-arm64/
├─ bin/
│  └─ golem                  ← the command you type (one file, about 60 MB)
└─ libexec/
   └─ golem-daemon/          ← the daemon, with its own Python (about 50 MB)
      ├─ golem-daemon        ← the program that runs
      └─ _internal/          ← Python and libraries it needs
```

Neither part needs anything else installed: no Python, no Node, no uv.

How each part is made:

```mermaid
flowchart TB
  subgraph daemon_build [Daemon]
    py["Python source code"] --> pyi["PyInstaller"]
    pyi --> dfolder["libexec/golem-daemon/"]
  end
  subgraph cli_build [golem command]
    ts["TypeScript source code"] --> bun["bun build --compile"]
    bun --> bfile["bin/golem"]
  end
  version["version from git tag"] --> pyi
  version --> bun
```

- **The daemon** is packed by PyInstaller as a folder, not a single file. A single file would have to unpack itself every time it starts, which is slow. The recipe is in `packages/daemon/golem-daemon.spec`. It lists a few modules that PyInstaller cannot find on its own, because some libraries load them in a roundabout way.
- **`golem`** is compiled by bun into one file ([ADR-019](adr/019-single-binary.md)).
- **Signing.** Last, `scripts/sign_dist.py` signs every program file in the folder: ad-hoc by default, or with the certificate named by `GOLEM_SIGN_IDENTITY` (section 5). `just check-signature` checks the result, and `just package` packs the folder into the `.tar.gz` and `.sha256` a release ships.

### The smoke test

A "smoke test" is a quick check that the build turns on and works. `just smoke-dist` checks the newest build:

```mermaid
sequenceDiagram
  participant T as Smoke test
  participant F as Fake AI server
  participant D as Built daemon
  T->>F: start a fake server that always answers "smoke-ok"
  T->>D: start once, then stop (warm-up)
  T->>D: start again
  T->>D: hello, new chat, send "ping"
  D->>F: ask the "model"
  F-->>D: "smoke-ok"
  D-->>T: the answer is "smoke-ok"
  T->>D: stop (SIGTERM)
  D-->>T: exits cleanly (code 0)
  T->>D: start and stop four more times
  Note over T,D: the fastest of these five starts must be under 1.5 seconds
```

Notes:
- It uses a temporary folder for its data, so it never touches your real chats.
- **Why the warm-up start?** The first time a new build runs, macOS checks every library in it, which takes 2–4 seconds. This happens once per copy. After that, the daemon starts in about half a second.
- **Why the fastest of five, under 1.5 seconds?** CI runs on shared Macs, and the same build starts in anything from 0.5 to 1.4 seconds there, depending on the machine. One slow start says more about the machine than about golem. The budget still fails a change that makes every start twice as slow, and every start must exit cleanly.
- The smoke test catches modules PyInstaller missed. Without it, you would only find out when a user starts the program and it crashes.

---

## 5. CI (automatic checks on GitHub)

Every pull request, and every push to `main`, runs two jobs on GitHub:

```mermaid
flowchart LR
  push["Pull request or<br/>push to main"] --> check
  push --> dist
  subgraph check ["check — Linux"]
    c1["install exact versions"] --> c2["just check"]
  end
  subgraph dist ["dist — Mac (Apple Silicon)"]
    d1["install exact versions"] --> d2["just dist"] --> d3["just smoke-dist"]
  end
```

`just check` runs, in order:
1. Regenerates the TypeScript message types and fails if they changed (someone forgot to run `just gen`).
2. Lint: style and common-mistake checks (ruff, plus the TypeScript linters).
3. Type checks (pyright, tsc).
4. All tests (pytest, plus the TypeScript tests).

The `dist` job also runs `just check-signature`. CI builds are signed ad-hoc, which is enough for the checks.

A pull request also runs `pr-title` (`.github/workflows/pr.yml`). The title becomes the commit on `main`, so it goes through the same check as a local commit message, `.githooks/commit-msg` ([ADR-024](adr/024-commits-prs-releases.md)). A new push to a pull request cancels that PR's older run.

### Pull requests

Changes reach `main` only through a pull request:

```mermaid
flowchart LR
  branch["branch"] --> pr["pull request<br/>(the template)"]
  pr --> checks["check, dist, pr-title<br/>all green"]
  checks -->|squash merge| main["one commit on main:<br/>the PR title"]
```

The `main` ruleset (`scripts/github_ruleset.json`) refuses a direct push, a force-push, and deleting the branch. It needs the three checks to pass, allows squash merge only, and keeps history linear. No review is required, because there is one maintainer. A repository admin can merge a pull request without waiting for the checks, but cannot push to `main` directly.

`just protect` applies the ruleset and the repository's merge settings: squash only, the PR title as the commit title, an empty commit body, and the branch deleted on merge. It needs `gh auth login` as an admin, and it is safe to run again. Run it after changing the JSON, or after renaming a CI job, because a required check is matched by its job name.

`/ship` (`.agents/skills/ship/SKILL.md`) opens the pull request for you:

```mermaid
flowchart LR
  diff["review the diff"] --> check["just check"]
  check --> propose["commit message,<br/>PR title and body"]
  propose --> yes{"your yes"}
  yes --> push["commit, push,<br/>gh pr create"]
  push --> url["PR link"]
```

Up to your yes, nothing leaves your machine. It doesn't merge, force-push, or link issues. Every PR it opens ends with the hidden line `<!-- shipped-by: /ship -->`, so a search for that line finds them.

### Releases

A release is two things: its **notes**, a section in `CHANGELOG.md`, and its **files**, built and published by `release.yml` when a version tag is pushed. The notes come first, because `CHANGELOG.md` is a file on `main`, and `main` changes only through a pull request. The tag then goes on the commit that has the notes ([ADR-024](adr/024-commits-prs-releases.md)).

Nothing is released when a pull request merges. Merged changes wait on `main` until you decide to release them.

<p align="center">
  <img src="images/release-flow.gif" alt="An animation of a release in eight steps: commits land on main; just changelog sorts them into Features, Fixes, Docs, and left out; just release opens a PR that adds a 0.2.0 section on top of CHANGELOG.md; the PR is edited, checked, and squash-merged; just tag puts v0.2.0 on that commit; release.yml checks the notes, builds, signs, verifies, and publishes; the GitHub release shows the same section as CHANGELOG.md; and the whole loop" width="900">
</p>

The animation walks through a release of 0.2.0. The steps below say the same in words.

#### Step by step

```mermaid
flowchart LR
  c["just changelog<br/>(preview)"] --> r["just release"]
  r --> pr["release PR:<br/>CHANGELOG.md<br/>gets v0.2.0"]
  pr -->|"review, edit,<br/>squash merge"| main["main: chore(release): v0.2.0"]
  main --> t["git pull<br/>just tag"]
  t -->|"push tag v0.2.0"| wf["release.yml:<br/>build, sign, check,<br/>publish"]
```

All of it runs on `main` in your main checkout, up to date with GitHub.

1. **See what is waiting.** `just changelog` prints the notes the next release would get. It changes nothing.
2. **Open the release PR.** `just release` works out the next version from the commits since the last tag (below), or takes one: `just release 0.3.0`, `just release 0.2.0-rc.1`. It creates the branch `release/v0.2.0`, puts a new `## [0.2.0] - <date>` section at the top of `CHANGELOG.md`, commits it as `chore(release): v0.2.0`, pushes, opens the PR, and switches back to `main`. It refuses when `main` has local changes, is behind GitHub, the tag exists, or there is nothing user-facing to release.
3. **Edit the notes if they need it.** The PR is the place. Reword a line, merge two, drop an internal one, or add a sentence on top. Commit on the release branch and push. The commit messages are a first draft, and what is in `CHANGELOG.md` when the PR merges is what users read.
4. **Merge** once the checks are green (squash, like every PR).
5. **Tag.** `git pull`, then `just tag`. It checks that the newest commit on `main` is a `chore(release): vX.Y.Z` commit, that the tag does not exist yet, and that `CHANGELOG.md` has its section. Then it creates the tag `vX.Y.Z`, pushes it, and prints the link to the workflow run.
6. **Watch the workflow** (below). When it ends, the release is on GitHub with the `CHANGELOG.md` section as its notes, and a stable version has a pull request on the Homebrew tap.

If something is merged to `main` between steps 4 and 5, `just tag` refuses, because the newest commit is no longer the release. Release again with `just release`, which writes a new version.

#### Which version comes next

`just release` with no version reads the commit types since the last stable tag ([CONTRIBUTING.md](../CONTRIBUTING.md)):

| Since the last release there is at least one… | 0.x (today) | 1.0 and later |
|---|---|---|
| breaking change (`feat!:`, `BREAKING CHANGE:`) | minor: 0.1.0 → 0.2.0 | major: 1.4.2 → 2.0.0 |
| `feat` | minor: 0.1.0 → 0.2.0 | minor: 1.4.2 → 1.5.0 |
| only `fix`, `perf`, … | patch: 0.1.0 → 0.1.1 | patch: 1.4.2 → 1.4.3 |

Leaving 0.x is a choice: `just release 1.0.0`.

#### What goes into the notes

`cliff.toml` decides. Each commit's first line becomes one bullet, with its scope in bold and the PR number as a link, under **Features** (`feat`), **Fixes** (`fix`), **Performance** (`perf`), **Reverts**, or **Docs**. `refactor`, `test`, `build`, `ci`, `chore`, `style`, `docs(plan)`, and the release commits themselves are left out. A commit that is not conventional lands under **Other**. Older `Scope - text` commits are read as `feat(scope): text`.

A section, once written, is never written again. `just release` only adds a new one above it, so an edit in a release PR stays.

#### Prereleases

A version with a `-`, such as `0.2.0-rc.1`, makes a prerelease: the same steps, a GitHub release marked as a prerelease, and no Homebrew update. It gets its own `CHANGELOG.md` section. A prerelease tag does not count as "the last release": `0.2.0-rc.2` and then `0.2.0` each list everything since `0.1.0`, and the version worked out next is still `0.2.0`.

#### What the workflow does with the tag

```mermaid
flowchart LR
  tag["push tag v0.1.0"] --> build
  subgraph build ["build — Mac"]
    b1["tag = version?<br/>notes in CHANGELOG.md?"] --> b2["just check"] --> b3["just dist<br/>(signed)"] --> b4["check-signature,<br/>smoke-dist"] --> b5["just package"] --> b6["draft release"]
  end
  build --> verify
  subgraph verify ["verify — a fresh Mac, no build tools"]
    v1["download the draft"] --> v2["checksum,<br/>signatures,<br/>--version"] --> v3["smoke test"]
  end
  verify --> publish["publish the release"]
  publish --> tap["pull request on the<br/>Homebrew tap<br/>(stable versions only)"]
```

- The release has `golem-<version>-darwin-arm64.tar.gz` and `golem-<version>-darwin-arm64.tar.gz.sha256`. The archive unpacks to one folder, `golem-<version>-darwin-arm64/`.
- The notes are the tag's `CHANGELOG.md` section, printed by `scripts/changelog.sh notes`. A tag pushed by hand, without a section, fails in the first step, before anything is built.
- A tag with a `-`, such as `v0.2.0-rc.1`, makes a prerelease.
- Nothing is published until a clean runner has checked the exact files users download. If a job fails, the draft stays. Fix the cause, then re-run the workflow. The build replaces the draft's files, and its notes with the current `CHANGELOG.md` section of the tagged commit. A published release is never replaced; release a new version.

#### When something goes wrong

| What happened | What to do |
|---|---|
| The release PR's notes are wrong | Edit `CHANGELOG.md` on the release branch and push, before merging |
| You merged, and want different notes | If the tag is not pushed yet: a normal PR that edits the section, then `just release` again for a new version. If the release is published: edit the notes on GitHub's release page, and fix `CHANGELOG.md` in a normal PR so the two agree |
| `just tag` says the last commit is not a release | Something merged after the release PR. Either run `just release` again for a new version, or `just tag 0.2.0` to tag `main` as it is now with the notes already written for 0.2.0 |
| The workflow failed, and the cause is the runner or a secret | Re-run the failed jobs on GitHub. The tag stays |
| The workflow failed, and the code needs a fix | The draft stays, unpublished. Delete the tag (`git push --delete origin v0.2.0 && git tag -d v0.2.0`) and the draft on GitHub. Merge the fix as a normal PR, then `git pull` and `just tag 0.2.0`. The tag goes on the commit with the fix, and the notes are the same section |
| You want to try the release process | `just release 0.2.0-rc.1`: a prerelease does not reach Homebrew. Delete it on GitHub afterwards |

### Signing

#### Why golem is signed

golem keeps its secrets in the macOS Keychain (section 9): API keys today, and later MCP server and hook tokens. This section says "key" for all of them. The Keychain protects each key from other programs on your Mac:
- The program that saved a key can read it without asking.
- Any other program can read it only after macOS shows a password dialog and you click Allow.

So macOS has to decide one thing every time the daemon asks for a key: *is this the same program that saved it?*

macOS answers this with the program's **code signature**, a seal stamped on the program file. What the seal says depends on how it was made:
- **Without a certificate** (an *ad-hoc* signature), the seal says only "this exact file". Every new build is a slightly different file. So after each upgrade, macOS sees a stranger and asks about every key again.
- **With a certificate**, the seal says "a program called `dev.golem.daemon`, signed by this certificate". Every release carries the same name and the same certificate. So after an upgrade, macOS sees the same program and does not ask.

Without signing, a password dialog would appear after every upgrade, once for every saved key. The daemon runs in the background, so these dialogs would pop up at random times, and the daemon would wait until someone answered. Signing makes upgrades silent.

That is the reason for the certificate. There is one more, smaller reason to sign at all: on Apple Silicon, macOS refuses to run a program file without a valid signature, even an ad-hoc one. `bun build --compile` leaves `bin/golem` with a broken signature, so every build is re-signed just so it starts.

Neither reason is about proving to Apple who made golem. That needs a paid Apple Developer ID and notarization, which come later. Until then, golem uses a **self-signed** certificate: one we made ourselves. macOS does not have to trust it. It only has to recognise it again on the next release. So every release must be signed with the **same** certificate ([ADR-021](adr/021-release-signing.md)).

#### What it means for users

Users never see or install the certificate. There are no extra steps for signing itself. What they notice:

| Situation | What the user sees | What to do |
|---|---|---|
| New user installs a release and saves a key with `golem auth set` | Nothing. The daemon saved the key, so it owns it. | Nothing |
| Upgrade to a newer release | Nothing. Same name, same certificate. | Nothing |
| First start of a release, with keys saved earlier by a source-code run or a local ad-hoc build | One Keychain dialog per key: "golem-daemon wants to use your confidential information" | Enter the Mac password and click **Always Allow**, once. The daemon then saves the key again as its own (section 9), so it never asks again. |
| Archive downloaded in a browser instead of `curl` | macOS refuses to open `golem`, because a self-signed program is not notarized | Download with `curl` (section 6), or run `xattr -dr com.apple.quarantine <the unpacked folder>` |
| We ever have to replace the certificate | One Keychain dialog per key after that upgrade | **Always Allow** once, as above |

Homebrew downloads with `curl`, so a `brew install` user (section 10) sees none of the dialogs above, except after a certificate change.

#### How the seal decides

For the curious: the rule inside the signature is called the *designated requirement*.

| Signed with | The rule says | After an upgrade |
|---|---|---|
| Nothing, or ad-hoc (`-`) | "the file with this exact hash" | A new hash, so a new program. macOS asks about every key again. |
| golem's certificate | `identifier "dev.golem.daemon" and certificate leaf = H"<sha1>"` | Same identifier, same certificate, so the same program. No prompt. |

**What gets signed.** `scripts/sign_dist.py sign` runs at the end of every `just dist` on macOS:

1. It finds every Mach-O file (compiled program or library) in the tree: 17 today, mostly PyInstaller's libraries under `_internal/`.
2. It signs the libraries first, deepest folder first, then the two programs, each with a fixed identifier:

   | File | Identifier |
   |---|---|
   | `libexec/golem-daemon/golem-daemon` | `dev.golem.daemon` |
   | `bin/golem` | `dev.golem.cli` |

3. It then runs the same checks as `just check-signature`.

Two environment variables choose the certificate:

| Variable | Meaning | Default |
|---|---|---|
| `GOLEM_SIGN_IDENTITY` | The certificate's SHA-1 (or its name) | `-`, which means ad-hoc |
| `GOLEM_SIGN_KEYCHAIN` | Look for the certificate only in this keychain | every keychain in the search list |

A local build is ad-hoc unless you set them. Even then it is re-signed, because `bun build --compile` leaves `bin/golem` with a signature that does not match the file.

**What is left out, on purpose.**
- No *hardened runtime*. Apple needs it only for notarization, and with a certificate that has no Apple team it makes macOS refuse to load PyInstaller's libraries. This is also why golem does not use PyInstaller's own signing option: it turns the hardened runtime on.
- No timestamp (`--timestamp=none`). A timestamp needs Apple's server and only matters for notarization.
- No notarization. Gatekeeper ignores a self-signed certificate. `curl` and Homebrew downloads are not checked by Gatekeeper, but an archive downloaded in a browser is blocked until the user allows it (section 6). Developer ID and notarization come later. Switching changes the rule once, so users approve the daemon once more.

**Checking a tree.** `just check-signature [tree] [--identity-hash <sha1>]` fails if any of these is false:
- every Mach-O file passes `codesign --verify --strict`;
- both programs carry their identifiers;
- with `--identity-hash`, both are signed by that certificate.

It prints one line per program, with the signer or `ad-hoc`:

```
libexec/golem-daemon/golem-daemon: dev.golem.daemon, golem release signing
bin/golem: dev.golem.cli, golem release signing
```

#### One-time setup (before the first tag)

1. Make the certificate on your Mac:

   ```bash
   sh scripts/make_signing_cert.sh ~/golem-signing
   ```

   It writes `~/golem-signing/golem-signing.p12`: an RSA 3072 key, valid for code signing only, for 20 years. An expired certificate would force the same re-approval as a new one. The script deletes the loose key file, and prints the certificate's SHA-1 and a random password for the `.p12`.
2. In the golem repository on GitHub, open the **Settings** tab, then **Secrets and variables > Actions** in the left sidebar. Add each secret on the **Secrets** tab with **New repository secret**, and the variable on the **Variables** tab with **New repository variable**. Do not use **Environment secrets**: the release workflow names no environment, so it cannot see them.

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `MACOS_SIGN_P12_BASE64` | `base64 < ~/golem-signing/golem-signing.p12 \| pbcopy`, then paste |
   | Secret | `MACOS_SIGN_P12_PASSWORD` | the printed password |
   | Variable | `MACOS_SIGN_IDENTITY` | the printed SHA-1 (not secret: it is in every signature) |

3. Store the `.p12` and its password in a password manager, then delete `~/golem-signing`.

Without these settings a release fails at "Import the signing certificate". It never falls back to an ad-hoc build.

#### What the release does with it

The `build` job decodes the `.p12` into a temporary keychain with a random password, and allows only `codesign` to use the key. It adds that keychain to the search list: codesign does not find a certificate outside the list, even with `--keychain`. It then sets `GOLEM_SIGN_IDENTITY` and `GOLEM_SIGN_KEYCHAIN` for `just dist`. The keychain is deleted at the end, even when the job fails. Both `build` and `verify` run `check-signature --identity-hash "$MACOS_SIGN_IDENTITY"`, so a release signed by any other certificate, or ad-hoc, is never published.

#### Signing a local build the same way

Do this when you want a local daemon to keep the Keychain's trust across rebuilds:

```bash
security import golem-signing.p12 -k ~/Library/Keychains/login.keychain-db -P '<password>' -T /usr/bin/codesign
GOLEM_SIGN_IDENTITY=<sha1> just dist
just check-signature "" --identity-hash <sha1>
```

#### Losing or replacing the certificate

**Never replace the certificate unless you have to.** A new certificate, a lost `.p12`, or an expired certificate all change the rule. Every user then gets a Keychain prompt for each key after their next upgrade, and must choose Always Allow again. Data is not lost, only the trust. If you must rotate it, run the one-time setup again and say so in the release notes.

---

## 6. Installing today

There are four ways. Homebrew is the one to give a colleague. The others are for working on golem, or for a Mac without Homebrew.

### With Homebrew

```bash
brew install milanpavel/golem/golem
golem daemon install
```

Section 10 explains upgrading, removing, and how the tap is kept up to date.

### From the source code (for developers)

```bash
git clone <repo-url> golem && cd golem
scripts/setup.sh             # tools, packages, and git hooks (or /setup in Claude Code)
just golem daemon install    # set up the background service and start it
just golem                   # open the chat screen
```

`scripts/setup.sh` is safe to run again. It works in two parts:

1. **Tools.** It checks just, uv, Node 24, pnpm, bun, and gh against the versions CI uses (`.github/actions/setup`). Each line is `✓` (ready), `!` (a warning), or `✗` (a problem), with a `fix:` line under a problem. A missing tool stops it here, before anything is installed.
2. **Packages.** It runs `uv sync --all-packages --frozen`, `pnpm install --frozen-lockfile`, and `just hooks`. The lock files are never changed.

| Flag | Adds |
|---|---|
| `--install` | `brew install` for each missing tool, and `corepack enable` for pnpm |
| `--check` | `just check` at the end |

Two warnings don't stop setup:

- **gh not signed in to github.com.** You need gh only to open pull requests and to release. Fix it with `gh auth login`.
- **The checkout's path is too long.** The daemon tests create sockets inside the checkout, and macOS allows a socket path of 103 bytes. That leaves 67 characters for the checkout's own path.

`/setup` in Claude Code (`.agents/skills/setup/SKILL.md`) runs the same script and asks before it installs anything. `.claude/skills` is a symlink to `.agents/skills`, so Claude Code and other agents read the same skills.

### From a build folder

```bash
just dist
dist/golem-<version>-darwin-arm64/bin/golem daemon install
dist/golem-<version>-darwin-arm64/bin/golem
```

The build folder can be moved anywhere on the same Mac. Run `golem daemon install` again after moving it.

**Limitation:** a local build is signed ad-hoc, so it is meant for the Mac that built it. To give golem to someone else, use Homebrew, or a release archive: unpack it anywhere and run `bin/golem daemon install`.

### From a release

```bash
curl -LO https://github.com/MilanPavel/golem/releases/download/v<version>/golem-<version>-darwin-arm64.tar.gz
curl -LO https://github.com/MilanPavel/golem/releases/download/v<version>/golem-<version>-darwin-arm64.tar.gz.sha256
shasum -a 256 -c golem-<version>-darwin-arm64.tar.gz.sha256
tar -xzf golem-<version>-darwin-arm64.tar.gz -C ~/Applications
~/Applications/golem-<version>-darwin-arm64/bin/golem daemon install
```

Download with `curl`, not a browser. A browser marks the files as downloaded, and Gatekeeper blocks a program that is not notarized. If you already used a browser, run `xattr -dr com.apple.quarantine ~/Applications/golem-<version>-darwin-arm64` to remove the mark. To upgrade, unpack the new version, run its `golem daemon install`, and delete the old folder.

### How `golem` finds the daemon

`golem` checks three places, and uses the first one it finds:

```mermaid
flowchart TB
  start(["golem needs the daemon"]) --> q1{"Is GOLEM_DAEMON set?"}
  q1 -->|yes| use1["Use that path.<br/>If the file is missing: error"]
  q1 -->|no| q2{"Is there a daemon in<br/>../libexec/golem-daemon/<br/>next to golem?"}
  q2 -->|yes| use2["Use it<br/>(a build or a brew install)"]
  q2 -->|no| use3["Use the source code<br/>through uv (development)"]
```

---

## 7. Keeping the daemon running

### launchd, the macOS service manager

launchd is the part of macOS that starts background programs. `golem daemon install` writes a small settings file for it, `~/Library/LaunchAgents/dev.golem.daemon.plist`, which says:

- **what to run:** the full path of the daemon, plus `serve`
- **start it at login**, and **start it again whenever it stops**, waiting 2 seconds between tries
- **where its data lives:** `GOLEM_HOME`, as it was at install time
- **where its output goes:** `~/.golem/logs/launchd.stdout.log` and `launchd.stderr.log`

```mermaid
stateDiagram-v2
  [*] --> Running: login, or golem daemon install
  Running --> Restarting: crash or kill
  Restarting --> Running: launchd restarts it after 2 s
  Running --> Stopped: golem daemon stop
  Stopped --> Running: golem daemon start
```

| Command | What it does |
|---|---|
| `golem daemon install` | Writes the launchd file and starts the daemon. Run it again after moving or upgrading golem |
| `golem daemon start` | Starts the daemon, or restarts it if it is running |
| `golem daemon stop` | Stops it and keeps it stopped until `start` |
| `golem daemon restart` | Swaps the running daemon for the one the launchd file names, after an upgrade. Waits until the new one answers and prints its version. Warns when the launchd file names a different golem than the one you ran: then run `install` |
| `golem daemon uninstall` | Stops it and deletes the launchd file. Your data in `~/.golem` stays |
| `golem daemon logs` | Shows the log and follows new lines |
| `golem status` | Shows pid, version, and uptime. Exits with code 1 if the daemon is not running |
| `golem doctor` | Checks the install and prints a fix under each problem (section 12). Exits with code 1 if anything failed |

`kill` is not a way to stop it: launchd starts it again within seconds. Use `golem daemon stop`.

**A trap:** launchd does not see the environment variables from your terminal. An API key you `export` in your shell does not reach the daemon. Save keys with `golem auth set`, which puts them in the Keychain.

### Running it by hand

For debugging, run the daemon in a terminal. Ctrl-C stops it.

```bash
uv run python -m golem serve                        # from the source code
dist/golem-*/libexec/golem-daemon/golem-daemon serve # from a build
```

### Only one daemon at a time

The daemon locks the file `~/.golem/run/golem.pid` for as long as it runs ([ADR-004](adr/004-pid-lock.md)). A second daemon sees the lock and exits with `daemon already running (pid N)`. If the daemon crashed, the lock is gone, so the next start knows the old socket file is stale and replaces it.

### Starting and stopping

```mermaid
flowchart LR
  subgraph startup [Start]
    s1[read settings] --> s2[take the lock] --> s3["open the databases<br/>(copy, then upgrade them if needed)"] --> s4[recover chats that<br/>were cut off] --> s5["open the socket<br/>= ready"]
  end
  subgraph shutdown [Stop]
    t1[stop taking<br/>new connections] --> t2["cancel running answers<br/>(keep what they said)"] --> t3[finish open requests] --> t4[remove the socket,<br/>release the lock] --> t5[exit 0]
  end
```

**After a crash, nothing is lost.** Every message is saved to the database before it is sent anywhere. An answer that was cut off is marked as interrupted at the next start. A question waiting for your approval keeps waiting.

---

## 8. Where the data lives

Everything is in one folder: `~/.golem`, or whatever `GOLEM_HOME` points to.

| Path | What it holds | Back it up? |
|---|---|---|
| `config.toml` | Your settings and tool rules | **Yes** |
| `golem.db` | Every chat and event: the real history | **Yes** |
| `checkpoints.db` | What the model remembers of each chat. Losing it loses the model's memory, not your history ([ADR-006](adr/006-checkpoint-continuity.md)) | **Yes** |
| `history` | Messages you typed, for Up-arrow recall | Optional |
| `tui.json`, `exports/` | Screen preferences, and chats you exported | Optional |
| `cache/` | Model lists and prices, refreshed daily | No, safe to delete |
| `logs/` | Log files, and `ollama.log` from an Ollama golem started | No |
| `run/` | The socket, the lock, the Keychain record, and `ollama-<port>.pid` for an Ollama golem started | No |

**Backing up:** both `.db` files are SQLite databases. Copy them while the daemon is stopped. While it runs, use `sqlite3 ~/.golem/golem.db ".backup /path/to/copy.db"`.

**Upgrades:** `golem.db` has a schema number. A newer daemon upgrades an older file once, at start, after copying it to `golem.db.bak-<schema>`, for example `golem.db.bak-5`. An older daemon refuses a file from a newer version rather than damaging it, and says which golem it needs and which copy it can still open. `checkpoints.db` is copied to `checkpoints.db.bak-<langgraph version>` when golem starts with different LangGraph packages. The copies are not deleted for you; remove old ones when you no longer need them.

**Going back a version:** stop the daemon, move `golem.db` aside, rename the copy the error names to `golem.db`, and start the older golem. What happened after the upgrade is only in the file you moved aside.

---

## 9. API keys and the Keychain

API keys are kept in the **macOS Keychain**, never in a file.

- Save one with `golem auth set anthropic`, or `/login anthropic` in the chat screen.
- `golem auth list` shows where each key comes from.
- A settings file that contains a key does not load at all, so a key cannot leak through a shared config.
- If both are set, an environment variable such as `ANTHROPIC_API_KEY` wins over the Keychain.

### Which program is allowed to read the key?

The Keychain remembers which **program** created each item, and lets only that program read it without asking.

```mermaid
flowchart TB
  subgraph before [Running from source code]
    py["uv's shared Python"] -->|created the key| k1[("Keychain item")]
    other["Any other Python script<br/>on the same Python"] -.->|can also read it| k1
  end
  subgraph after [Running a build]
    gd["golem-daemon<br/>(golem's own program)"] -->|"asks you once,<br/>then re-saves the key"| k2[("Keychain item")]
    other2["Other programs"] -.->|macOS asks you first| k2
  end
```

When a built daemon first reads a key saved by the source-code version, macOS asks once. Choose **Always Allow**. The daemon then deletes the key and saves it again, so from then on only the daemon is trusted. It writes the key's name to `~/.golem/run/keychain-migrated`, so this happens only once per key.

**Releases keep the trust.** Releases are signed with one certificate, so after you choose Always Allow once, later releases read the keys without asking. A local build is signed ad-hoc unless you give it the certificate, so macOS treats each rebuild as a new program and asks again.

---

## 10. Homebrew

**Status: built. It is live once the tap repository and its token exist (below), and the first stable tag has been released and its tap pull request merged.** The decisions are in [ADR-022](adr/022-homebrew-tap.md).

### What it looks like for a user

A colleague with an Apple Silicon Mac runs:

```bash
brew install milanpavel/golem/golem   # download and install
golem daemon install                  # start the background service, now and at every login
golem auth set anthropic              # save an API key (or use Ollama, no key needed)
golem                                 # open the chat screen
```

That's all. They don't need Python, Node, uv, bun, or the source code. After the install, Homebrew prints the three `golem daemon` commands a user needs, so they don't have to remember them.

### What happens behind the scenes

Three things work together:

1. **A GitHub release.** Each version tag (for example `v0.3.0`) makes GitHub Actions build golem and upload `golem-0.3.0-darwin-arm64.tar.gz`, plus its checksum (a fingerprint that proves the file was not changed). See section 5.
2. **A "tap".** A tap is a small extra GitHub repository that Homebrew can read: `MilanPavel/homebrew-golem`. It holds one formula, `Formula/golem.rb`. The formula says: "version 0.3.0 is at this URL, its checksum is this; copy `bin/` and `libexec/` into place."
3. **The tap updates itself.** After each stable release, the release workflow opens a pull request on the tap with the new version and checksum. A workflow in the tap installs that formula on a fresh Mac and tests it. You merge the pull request when it passes. Prereleases (tags with a `-`) never go to the tap.

```mermaid
sequenceDiagram
  participant Dev as Maintainer
  participant GH as golem release workflow
  participant Rel as GitHub release
  participant Tap as homebrew-golem
  participant User as Colleague's Mac
  Dev->>GH: push tag v0.3.0
  GH->>Rel: build, sign, check, publish the archive and checksum
  GH->>Tap: pull request: golem.rb now points at 0.3.0
  Tap->>Tap: test workflow: install, compare, smoke test, uninstall
  Dev->>Tap: merge
  User->>Tap: brew install / brew upgrade
  Tap-->>User: formula: URL and checksum
  User->>Rel: download the archive
  User->>User: check the checksum, copy bin/ and libexec/
```

Nothing is compiled on the user's Mac. Homebrew only downloads, checks, and copies.

**The golem repository owns every file in the tap.** The formula is made from `packaging/homebrew/golem.rb.in` by `scripts/render_formula.sh`. The tap's README and test workflow are copied from `packaging/homebrew/tap/`. Change them there. Every release pull request replaces whatever is in the tap.

### Where the files end up

```
/opt/homebrew/
├─ bin/golem                      → link to the current version
├─ opt/golem/                     → link to the current version (never changes name)
└─ Cellar/golem/0.3.0/
   ├─ bin/golem
   └─ libexec/golem-daemon/...
```

Homebrew keeps each version in its own folder under `Cellar/`, plus two links that always point at the current one. `golem daemon install` writes the `opt/golem/...` path into the launchd file, **not** the `Cellar/golem/0.3.0/...` path. So after an upgrade, launchd starts the new version, and the old folder can be deleted safely.

**The files are exactly the released ones.** By default, Homebrew edits programs after installing them: it rewrites each library's name to an absolute path and signs it again, ad-hoc. It also deletes some Python package metadata. golem's formula turns both off (`preserve_rpath` and `skip_clean "libexec"`). So the libraries keep golem's signature, and the tap's test checks that the installed `bin/` and `libexec/` are identical to the archive.

### Upgrading and removing

```bash
brew upgrade golem          # download the new version
golem daemon restart        # switch the running daemon to it
```

The running daemon keeps using the old version's files until you restart it. `brew upgrade` may delete the old folder straight away. The daemon then fails on the next thing it loads from disk, and launchd starts the new version. So restart right after the upgrade. The chat screen also shows a yellow notice when the daemon's version differs from its own.

```bash
golem daemon uninstall      # first: remove the launchd service
brew uninstall golem        # then: remove the program
```

Your chats and settings in `~/.golem` stay, on purpose. Delete that folder yourself if you want them gone.

**The order matters.** After `brew uninstall`, the `golem` command is gone, so `golem daemon uninstall` can no longer run. launchd keeps trying to start a program that does not exist. To clean up by hand:

```bash
launchctl bootout gui/$(id -u)/dev.golem.daemon
rm ~/Library/LaunchAgents/dev.golem.daemon.plist
```

### Why Homebrew does not start the daemon itself

Homebrew can run background services (`brew services`). golem's formula does **not** use that. If both Homebrew and `golem daemon install` started a daemon, the second would hit the lock and exit, launchd would start it again, and it would fail forever. So only `golem daemon install` manages the service, and it works the same way whether golem came from Homebrew or from a downloaded archive. For the same reason, `brew upgrade` does not restart the daemon. It would cut off an answer in progress whenever someone upgrades all their Homebrew packages.

### Setting up the tap (once)

1. **Make the golem repository public.** Homebrew downloads the release and `brew audit` checks the homepage without logging in.
2. **Create the tap repository.** On GitHub: new repository, owner `MilanPavel`, name exactly `homebrew-golem`, **Public**, and tick **Add a README file**. The name must start with `homebrew-`: that is how `brew install milanpavel/golem/golem` finds it. The README gives it a `main` branch. Leave everything else empty: the first release fills it.
3. **Create a token for the release workflow.** GitHub, your profile, **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**:

   | Field | Value |
   |---|---|
   | Name | `golem release to homebrew-golem` |
   | Expiration | up to 1 year; put a reminder in your calendar |
   | Repository access | **Only select repositories**: `MilanPavel/homebrew-golem` |
   | Permissions | **Contents**: Read and write. **Pull requests**: Read and write. **Workflows**: Read and write (the release copies the tap's test workflow) |

4. **Store it in the golem repository**, not the tap: open the **Settings** tab, then **Secrets and variables > Actions** in the left sidebar. On the **Secrets** tab, click **New repository secret**, name it `HOMEBREW_TAP_TOKEN`, and paste the token. Use **Repository secrets**, not **Environment secrets**: no environment is needed.
5. **Optional, recommended:** in `homebrew-golem`, under **Settings > Branches**, protect `main` and require the `formula` check before merging.
6. **Release a stable version**, for example `git tag v0.1.0 && git push origin v0.1.0`. When the release is published, the `tap` job opens the pull request `golem 0.1.0` on the tap. The first one also adds the README and the test workflow. Merge it when `test` passes.

If the token is missing or has expired, the release is still published, and only the `tap` job fails. Renew the token, then re-run that job.

### What must be true before a colleague can use it

| Requirement | Why |
|---|---|
| Both repositories are **public** | Homebrew downloads the formula and the archive without logging in |
| The build is **signed with a stable identity** (section 5) | Without it, the Keychain asks again after every upgrade |
| The Mac is **Apple Silicon** (M1 or newer) | Only a `darwin-arm64` build exists. The formula refuses to install on an Intel Mac |
| **Notarization** (Apple's malware scan) is not needed | Homebrew downloads formulae with `curl`, which does not mark files as "downloaded from the internet", so Gatekeeper does not block them |

### Linux and Windows later

The same formula will work on Linux (plan step 8.2), with a systemd service instead of launchd. Windows will use **Scoop**, a similar tool for Windows, from its own "bucket" repository (plan step 8.4).

---

## 11. Settings that matter for running golem

All settings are listed in the [README](../README.md#all-settings). For running golem, you mostly need to know where settings come from and when they take effect.

**Where they come from.** If the same setting is in more than one place, the last one wins:

```mermaid
flowchart LR
  a["~/.golem/config.toml<br/>(yours)"] --> b["project/.golem/config.toml<br/>(per folder)"] --> c["GOLEM_... environment<br/>variables"] --> result([setting used])
```

A project's file cannot loosen safety settings (`[shell]`, `[web]`), and cannot allow tools unless you listed that folder in `trusted_projects`.

**When changes take effect:**

| Takes effect at once | Needs a restart (`golem daemon start`) |
|---|---|
| Models, providers, `default_model`, tool rules | Everything else, such as `log_level`, `session_titles`, `[shell]`, `[web]` |

If you break the file, golem keeps using the last version that worked and writes a warning to the log.

Remember: under launchd, `GOLEM_...` variables from your terminal do not apply. Put settings in `config.toml`.

| Setting | Default | What to know |
|---|---|---|
| `log_level` | `INFO` | `DEBUG` writes more detail to the log |
| `session_titles` | `true` | Costs one extra model call per new chat |
| `[shell] network` | `false` | Commands the AI runs cannot use the internet |
| `[shell] timeout_seconds` | `120` | The longest a command can run |
| `[web] allow_private` | `false` | `web_fetch` cannot reach your own computer or home network |

---

## 12. Logs and health checks

- **Logs:** `golem daemon logs`. The log file is `~/.golem/logs/golem.jsonl`, one JSON record per line. If the daemon fails before it can write its log, look in `~/.golem/logs/launchd.stderr.log`. An Ollama that golem started writes to `~/.golem/logs/ollama.log`.
- **Is it running?** `golem status` shows the pid, version, uptime, state (`running`, or `draining` while it shuts down), the default model, and each local model server golem has used: started by golem with its pid and memory, or running without golem.
- **Is the install healthy?** `golem doctor` prints a checklist, with a fix under each line that is not ok. It exits with code 1 when a check fails, and 0 when there are only warnings.

| Check | Fails when | Fix it prints |
|---|---|---|
| `daemon` | `golem` cannot find the daemon program (section 6) | `brew reinstall golem`, or set `GOLEM_DAEMON` |
| `service` | launchd has no golem job, runs another copy of golem, or the job is stopped | `golem daemon install`, or `golem daemon start` |
| `running` | The daemon does not answer, or runs another version than `golem` | `golem daemon start`, or `golem daemon restart` |
| `socket` | Someone other than you could open the socket | `golem daemon restart` |
| `config` | `config.toml` does not load. The line names the setting | Edit the file |
| `model` | No model is chosen yet (a warning), or the default does not resolve | `/model` in the chat |
| `ollama` | Ollama is not installed, a remote Ollama does not answer, `[ollama] start = false` and it does not answer, or a profile's model is not downloaded. One line, however many profiles use it. A stopped local Ollama is ok, because golem starts it | Pick a local model in `/model` (golem installs Ollama), `brew install ollama`, or `ollama pull <model>` |
| A hosted provider, such as `anthropic` | Its API key is not in the Keychain. A key only in your shell is a warning, because launchd does not pass it to the daemon | `golem auth set <provider>` |
| `disk` | Less than 1 GB is free | Free some space |

`golem` checks the first and the third itself. The daemon program checks the rest (`golem-daemon doctor` prints them as JSON), because it reads the same launchd file, settings, Keychain items, and model servers that the running daemon does. That also works when the daemon is down.
- **What is it doing?** In the chat screen, `/debug wire` shows every message between `golem` and the daemon, and `/debug model` shows what the model sees.
- **Not there yet:** log rotation (the log grows forever), metrics, tracing, and cost tracking.

---

## 13. Safety limits

| Area | Limit |
|---|---|
| Socket | Only your user can open it (`0600`). It is created under a strict file mask, so it is never readable by others, not even for a moment |
| File tools | Work only inside the folder the chat was started in. Never change `.golem/` or `.git/` |
| Approvals | Anything that changes something asks you first, unless a rule says otherwise ([ADR-012](adr/012-permission-rules.md)) |
| Shell | Every command runs in a macOS sandbox (`sandbox-exec`): no internet, no writing outside the folder. Without the sandbox, commands do not run at all ([ADR-014](adr/014-shell-sandbox.md)) |
| Web | Asks per website, refuses addresses on your own network, and marks page text as untrusted ([ADR-017](adr/017-web-fetch.md)) |

---

## 14. When something goes wrong

| What you see | What to do |
|---|---|
| Anything | Run `golem doctor` first. It prints a fix under each problem it finds |
| The chat screen says `reconnecting` | Run `golem status`. If it is down, run `golem daemon start`, then look at `~/.golem/logs/launchd.stderr.log` |
| `daemon already running (pid N)` | The background copy is running. Run `golem daemon stop` before starting one by hand |
| The daemon keeps restarting | Read `launchd.stderr.log`. Common causes: the database is from a newer golem version (the message names the golem it needs and the copy that still opens); `GOLEM_HOME` is too long (a socket path must be under 104 characters on macOS); golem was moved (run `golem daemon install` again) |
| `needs key` | `golem auth set <provider>`, or `/login <provider>` in the chat screen |
| `/mcp` shows a server as `failed: command not found` | The daemon runs under launchd, with a short `PATH`. Golem also looks in `/opt/homebrew/bin`, `/usr/local/bin`, and `~/.local/bin`. Anywhere else, give `command` as a full path |
| `/mcp` shows a server as `failed: the server exited with code N: …` | The text after the code is the last line the server printed. Golem keeps trying, waiting longer each time, up to a minute. Run its command in a terminal to see more. `golem daemon logs` has everything it printed, at `DEBUG` |
| An MCP server's tools are missing | Run `/mcp`. `idle` means it is on demand: `/mcp enable <name>`. A project's server needs its folder in `trusted_projects`. Changes to `[mcp.*]` apply within a few seconds; a file that does not validate keeps the last good servers, and the log says why |
| `/mcp` shows `no secret mcp/<name> in the Keychain` | Run `golem auth set mcp/<name>`. The server starts again with it |
| An HTTP MCP server shows `HTTP 401` | The token is wrong or expired. Store a new one with `golem auth set mcp/<name>` |
| macOS asks about the Keychain on every start | A local build is signed ad-hoc, so every rebuild asks. Choose Always Allow, or sign local builds with the release certificate (section 5). A release asks once, after the first upgrade from a local or ad-hoc build |
| A release workflow fails at "Import the signing certificate" | The secrets or the `MACOS_SIGN_IDENTITY` variable are missing. See section 5 |
| The release's `tap` job fails | The `HOMEBREW_TAP_TOKEN` secret is missing or expired, or `homebrew-golem` does not exist. The release itself is published. Fix the token (section 10), then re-run the job |
| The tap's `test` workflow fails at "Homebrew installed the archive unchanged" | Homebrew edited a file after install. A new library in the daemon may have a non-`@rpath` install name (`otool -D`), or a newer Homebrew may edit kegs in a new way. Do not merge |
| `brew upgrade golem` does not offer the new version | The tap pull request is not merged yet. Then run `brew update` |
| launchd keeps failing to start golem after `brew uninstall` | The service was not removed first. See "The order matters" in section 10 |
| A build crashes with `ModuleNotFoundError` | PyInstaller missed a module. Add it to `golem-daemon.spec`, then run `just dist && just smoke-dist` |
| The first start of a new build is slow | Expected: macOS checks the new files once |

**Building behind a company proxy:** `just dist` and `just smoke-dist` work offline once the packages are installed. `just check` tries to update packages first, and fails if it can't download them. If everything is already installed, run `UV_NO_SYNC=1 just check`.

---

## 15. What is planned

The phases that matter for running golem, in the order of [the plan](plan.md):

```mermaid
flowchart LR
  p4["Phase 4<br/>Triggers"] --> p6["Phase 6<br/>Hardening"] --> p8["Phase 8<br/>Linux and<br/>Windows"] --> p9["Phase 9<br/>Costs"]
```

| Phase | What you will get |
|---|---|
| **4. Triggers** | The daemon does work on a schedule or when files change, with no chat screen open |
| **6. Hardening** | Tracing (a timeline of where each answer spent its time), nightly database backups, crash tests, speed checks, and a security review |
| **8.1 Platform layer** | Everything that differs between macOS, Linux, and Windows moves behind one interface, so the next steps are additions, not rewrites |
| **8.2 Linux** | Linux builds, a systemd service, CI on Ubuntu. No shell sandbox at first, so shell commands always ask |
| **8.3 Windows: running** | A Windows "named pipe" instead of the socket file, Task Scheduler instead of launchd, CI on Windows |
| **8.4 Windows: installing** | `scoop install golem` |
| **9. Model routing** | Token and cost display, and spending limits |

**Not planned yet:** log rotation, metrics export, Intel Mac builds, and access from other computers or other users. Golem is meant to run for one person, on one computer.
