---
name: ship
description: Take the local changes in this golem checkout to an open pull request that follows CONTRIBUTING.md. Reviews the diff, runs just check, proposes the commit message and the PR title and body, and after a yes commits, pushes, and opens or updates the PR. Use when the user wants to ship, push, or open a PR, or types /ship (optionally with a hint, such as /ship fix the mcp restart).
---

# Ship a change

`/ship` ends at an open pull request. A person reviews and merges it on GitHub. The rules for messages and titles are in `CONTRIBUTING.md`, and `.githooks/commit-msg` is the one list of types and scopes.

Never:

- push to `main`, force-push, amend, or rebase;
- commit with `--no-verify`;
- merge, approve, or close anything;
- link or close issues (`Closes #N`, `Fixes #N`);
- name yourself or any agent in the commit, the PR, or a footer. No `Co-Authored-By` trailer and no "Generated with" line. The hidden marker below is the only sign of `/ship`.

Write every message in short, simple sentences.

## 1. Where are we

Run:

```sh
git status --short --branch
git fetch --quiet origin main
gh auth status --hostname github.com
```

Stop and say why if:

- there is nothing to ship (a clean tree, and no commits ahead of `origin/main`);
- HEAD is detached, or a merge or rebase is in progress;
- gh is not signed in to github.com. Ask the user to run `gh auth login --hostname github.com` in their own terminal;
- on `main`, local `main` has commits that `origin/main` doesn't. Say so, and let the user decide.

On another branch, look for its PR:

```sh
gh pr view --json number,url,state,title,body
```

- An open PR means this run adds a commit to it.
- A merged or closed PR means the branch is finished. Stop, and suggest a new branch from `main`.

On `main`, the branch is created in step 6, from the name you propose in step 4.

## 2. Review the diff

Read everything that would ship:

```sh
git diff origin/main...HEAD     # commits already on the branch
git diff HEAD                   # changes not committed yet
git ls-files --others --exclude-standard
```

Read new untracked files too, not only their names. Then flag:

| Look for | Then |
|---|---|
| A secret: an API key or token (`sk-`, `ghp_`, `gho_`, `AKIA`, `xox`), a private key (`-----BEGIN`), an `.env` file, a password in config | Stop. Never commit it, even if the user asks |
| A stray file: notes, scratch files, `.DS_Store`, a build output, a large binary. For example, a loose `*.md` file in the root that nothing links to | Leave it out of the commit. List it, so the user can add it if they want |
| A change under `packages/protocol/golem_protocol/` without a matching change in `packages/protocol/gen/` | Run `just gen`. Also check that `PROTOCOL_MINOR` or `PROTOCOL_MAJOR` in `packages/protocol/golem_protocol/version.py` was bumped |
| A non-obvious choice: a new dependency, a config key, a wire command, a stored format, a different approach to something an ADR covers | Suggest an ADR in `docs/adr/` (next number in `docs/adr/README.md`). Ask; don't block |
| A behaviour change that the docs describe | Name the doc to update: `README.md`, `docs/sre.md`, `docs/architecture.md`, `CONTRIBUTING.md` |
| A change to packaging, signing, or the daemon's startup (`scripts/dist.sh`, `scripts/package.sh`, `scripts/sign_dist.py`, `packages/daemon/golem-daemon.spec`, `golem/server/`) | Offer `just dist` and `just smoke-dist`. They take a few minutes |

If the user gave a hint (`/ship fix the mcp restart`), use it for the type, the scope, and the wording.

## 3. Check

```sh
just check
```

It runs lint, typecheck, tests, and `just gen`, and it fails if the generated files drifted. On failure, stop. Show the failing test names or lint lines, with the first error of each. Don't ship a red check, and don't skip it.

## 4. Propose

**Type** says what changed for someone using golem:

- `feat`: they can do something new.
- `fix`: something was wrong and now works.
- `docs`, `test`, `refactor`, `build`, `ci`, `chore`: no change in behaviour.

**Scope** comes from the paths:

| Paths | Scope |
|---|---|
| `packages/daemon/golem/mcp/` | `mcp` |
| `packages/daemon/golem/tools/`, `permissions/` | `tools` |
| `packages/daemon/golem/models/` | `models` |
| `packages/daemon/golem/sessions/`, `store/` | `sessions` |
| `packages/daemon/golem/secrets.py` | `secrets` |
| any other part of `packages/daemon/` | `daemon` |
| `packages/protocol/` | `protocol` |
| `packages/tui/`, `packages/cli/`, `packages/client/` | `tui`, `cli`, `client` |
| `scripts/setup.sh`, `scripts/dist.sh`, `scripts/package.sh`, `scripts/render_formula.sh`, `golem/launchd.py` | `install` |
| `cliff.toml`, `CHANGELOG.md`, `release.yml`, signing | `release` |
| `.github/` | `ci` |
| `docs/plan.md` | `plan` |
| other docs | `docs` |
| only `uv.lock`, `pnpm-lock.yaml`, or version pins | `deps` |

If the change spans several areas, pick the one a user would notice. Leave the scope out only when nothing fits.

**The commit message.** The first line is `<type>(<scope>): <what changed>`, at most 100 characters. It says what changed for a user, like the release notes would. Add a body only for a why that the diff doesn't show.

**The PR title.**

- A new PR's title is the commit's first line.
- On a PR that is already open, the title covers the whole branch. Keep the current title if it still fits.

The squash merge makes the title the one commit on `main`, so it must pass the same check as CI:

```sh
f=$(mktemp) && printf '%s\n' "<title>" > "$f" && .githooks/commit-msg "$f" --title; rm -f "$f"
```

**The PR body.** Fill in `.github/pull_request_template.md`:

- Replace each `<!-- … -->` hint with the real text. Keep the headings.
- **How it was tested:** tick `just check`, since step 3 ran it. Tick the others only if they ran. Add one line for anything else that was tried.
- **Checklist:** tick only what is true. Leave the rest unticked.
- The last line becomes exactly `<!-- shipped-by: /ship -->`. Add nothing after it.

**The branch name**, when on `main`: `<type>/<slug>`, where the slug is two to four words from the title in kebab case, for example `feat/ship-skill`.

## 5. Ask

Show everything in one message:

- the branch;
- the files that go into the commit, and the files left out;
- the commit message;
- the PR title and body. On an open PR, say whether the title and body change, and show the new body only if it does.

Then ask: ship it, change something, or stop. Do nothing until the answer is yes. If the user changes something, show the new version and ask again.

## 6. Ship

After the yes:

```sh
git switch -c <type>/<slug>             # only when on main
git add -- <the agreed files>           # by name, never `git add -A`
git commit -F <message file>            # the commit-msg hook runs
git push -u origin HEAD
```

Then the PR. Write the body to a temporary file first.

- A new PR: `gh pr create --base main --title "<title>" --body-file <file>`.
- An open PR: the push already added the commit. Run `gh pr edit --title "<title>" --body-file <file>` only if the user agreed to a new title or body.

If a step fails, stop and show its output:

- If the hook refuses the message, fix the message and commit again. Don't skip the hook.
- If the push is refused, say why and leave the commit as it is.

## 7. Report

End with three lines:

- the PR link;
- the checks link (`<PR link>/checks`). CI runs `check`, `dist`, and `pr-title`;
- what is left for the user: review, wait for green, and squash merge on GitHub. List any files left out of the commit, and any ADR or doc you suggested.

Don't wait for CI.
