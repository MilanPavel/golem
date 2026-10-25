# Contributing to golem

To set up a checkout, run `/setup` in Claude Code, or `scripts/setup.sh`. It also turns on the commit check below. Building and testing are in [docs/sre.md](docs/sre.md), section 6. This file is about how a change gets written down.

## Commit messages

Every commit on `main` follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The release notes are generated from these lines, so each one should say what changed for someone using golem.

```text
<type>(<scope>): <what changed>

<optional body: why, and anything a reviewer needs>

<optional footers, such as BREAKING CHANGE: …>
```

Turn on the check once per clone:

```sh
just hooks
```

From then on, `git commit` refuses a first line that does not fit and shows an example. The check is `.githooks/commit-msg`, and it is also the one list of types and scopes.

### Types

| Type | Use it for | In the release notes |
|---|---|---|
| `feat` | Something new a user can do | Features |
| `fix` | Something that was wrong now works | Fixes |
| `perf` | The same thing, faster or smaller | Performance |
| `refactor` | Code changes that change no behaviour | — |
| `docs` | Documentation only | Docs |
| `test` | Tests only | — |
| `build` | Packaging, signing, dependencies of the build | — |
| `ci` | GitHub workflows and actions | — |
| `chore` | Anything else that users never see | — |
| `revert` | Undoing an earlier commit | Reverts |
| `style` | Formatting only | — |

### Scopes

The scope is optional. Use it when a change sits in one part of golem.

| Scope | Part |
|---|---|
| `daemon` | The daemon as a whole: startup, the socket, launchd |
| `tui` | The chat screen |
| `cli` | The `golem` command and its subcommands |
| `client` | The shared TypeScript socket client |
| `protocol` | The wire models and the generated types |
| `models` | Providers, the model catalog, prices |
| `sessions` | Sessions, the event log, checkpoints, forks |
| `tools` | Built-in tools, rules, approvals, the sandbox |
| `mcp` | MCP servers and their tools |
| `skills` | Skills: the registry, `/skills`, loading, trust |
| `secrets` | API keys and the Keychain |
| `install` | `golem daemon install`, upgrades, Homebrew |
| `release` | Versioning, signing, the release workflow |
| `ci` | CI that is not about releases |
| `docs` | A specific document, when the type is not `docs` |
| `plan` | `docs/plan.md` |
| `deps` | Dependency updates |

A new scope is a one-line change to `.githooks/commit-msg` and a row here.

### Breaking changes

A change that breaks something a user relies on, such as the protocol major version, the config file, or a command's flags, adds `!` before the colon and says what to do in a footer:

```text
feat(protocol)!: sessions are addressed by id, not by name

BREAKING CHANGE: clients older than 0.3 are refused. Upgrade the TUI with golem.
```

### Examples

Old messages, rewritten:

| Before | After |
|---|---|
| `MCP - golem runs stdio MCP servers from config.toml` | `feat(mcp): golem runs stdio MCP servers from config.toml` |
| `Tools - web_fetch keeps the body of a page with an unclosed title on newer Pythons.` | `fix(tools): web_fetch keeps the body of a page with an unclosed title on newer Pythons` |
| `CI - install a pinned just with the job's token` | `ci: install a pinned just with the job's token` |
| `Docs - a step-by-step guide for installing golem with Homebrew` | `docs(install): a step-by-step guide for installing golem with Homebrew` |
| `Update plan md file.` | `docs(plan): Phase 1, the engineering workflow` |

### Release notes

The first lines of the commits on `main` are the first draft of the release notes. `just release` groups them into a new section of [CHANGELOG.md](CHANGELOG.md), and the release PR is where that draft gets edited ([docs/sre.md](docs/sre.md), section 5). So write the line for someone using golem: `fix(tui): the composer keeps its text after a resize`, not `fix(tui): handle SIGWINCH`.

Keep the first line under 100 characters. Merge, revert, `fixup!`, and `squash!` commits are let through as git writes them.

## Pull requests

Nothing is pushed to `main` directly. Work on a branch, open a pull request, and fill in the template. The PR title is checked like a commit message (job `pr-title`), because it becomes the one commit on `main` when the pull request is squash-merged. The commits on the branch can say anything.

A pull request merges when `check`, `dist`, and `pr-title` pass. How the rules are set up is in [docs/sre.md](docs/sre.md), section 5.

### With `/ship`

`/ship` in Claude Code does the steps above for you. It's in `.agents/skills/ship/`, so other agents can follow it too.

1. On `main`, it creates a `<type>/<slug>` branch. On another branch, it stays there.
2. It reviews the diff. It stops on a secret, leaves stray files out, and points out a missing `just gen`, ADR, or doc update.
3. It runs `just check`, and stops if it fails.
4. It proposes the commit message and the PR title and body, and checks the title with `.githooks/commit-msg`.
5. After your yes, it commits, pushes, and opens the pull request. On a branch whose PR is already open, it adds a new commit.
6. It gives you the PR link.

It never force-pushes, amends, merges, or links issues. The template's hidden last line becomes `<!-- shipped-by: /ship -->`, so a PR opened this way can be recognised later.

## Decisions

A non-obvious choice gets a short ADR in [docs/adr/](docs/adr/README.md), in the same change.
