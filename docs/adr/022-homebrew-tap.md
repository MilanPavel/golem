# ADR-022: Homebrew installs the signed release unchanged, from a tap the release workflow keeps up to date

**Date**: 2026-10-22
**Status**: accepted

## The idea

`brew install milanpavel/golem/golem` downloads the release archive and copies `bin/` and `libexec/` into the keg, byte for byte. Homebrew changes nothing, so the files on a user's Mac are the ones the release signed and checked ([ADR-021](021-release-signing.md)). The launchd job names the stable `opt` path, so `brew upgrade` plus `golem daemon restart` switches versions, and `golem daemon install` stays the one owner of the job.

The golem repository is the source of every file in the tap. Each stable release opens a pull request on `homebrew-golem`, and a workflow in the tap installs the formula, checks it, and smoke-tests the result before anyone merges.

## What the code does today

`packaging/homebrew/golem.rb.in` is the formula, with the version, checksum, and repository left blank. `scripts/render_formula.sh` fills them in and refuses anything but a stable `X.Y.Z`, a sha256, and `owner/repo`.

By default Homebrew edits a keg after install. It gives every library an absolute install name and signs it again ad-hoc, and it deletes `RECORD` from Python `.dist-info` folders. Every library in the daemon has an `@rpath` install name and links nothing outside the tree, so `preserve_rpath` leaves all of them alone. `skip_clean "libexec"` keeps the Python metadata. The formula has no `service` block. Its caveats print `golem daemon install`, `restart`, and `uninstall`.

`golem` resolves its own path before it looks for `../libexec/`, because `$(brew --prefix)/bin/golem` is a link into the keg. The daemon finds its files the same way. `launchd.stable_path` turns `<prefix>/Cellar/golem/<version>/…` into `<prefix>/opt/golem/…` when that link points at the same file, and `golem daemon install` writes that path into the plist.

After `publish`, the release workflow's `tap` job skips prereleases. It renders the formula from the release's `.sha256`, copies `packaging/homebrew/tap/` (the tap's README and test workflow) next to it, and force-pushes the branch `golem-<version>` to `<owner>/homebrew-golem` with the `HOMEBREW_TAP_TOKEN` secret. Then it opens a pull request, or updates the open one. The tap's `test` workflow runs `brew audit --strict --online`, `brew install`, and `brew test`. It then diffs the installed `bin/` and `libexec/` against the archive and runs `scripts/smoke_dist.py` on the keg. Finally it checks that `golem daemon install` names the `opt` path, and runs `brew uninstall`.

## Other shapes that lost

**A cask.** A cask copies files without editing them, but Homebrew marks cask downloads as quarantined. Gatekeeper then blocks a program that is not notarized.

**Let Homebrew edit the keg.** It works, because the daemon has no hardened runtime. But the libraries would carry Homebrew's ad-hoc signatures, not golem's, and `check-signature` could not tell a good install from a tampered one.

**A `service` block, or restarting the daemon in `post_install`.** Two owners of one launchd job start two daemons, and the second fails on the lock forever. A restart from inside `brew upgrade` would also cut off a running answer whenever someone upgrades everything.

**Push to the tap's main branch directly.** Nothing would check the formula before users get it.

**Keep the tap's files only in the tap.** They would drift from the formula they test. Copying them from the golem repository means the token also needs the Workflows permission on the tap.

## What it costs

`HOMEBREW_TAP_TOKEN` is a second long-lived secret. It is a fine-grained token for the tap repository only, with Contents, Pull requests, and Workflows write, and it has to be renewed before it expires. A release whose token is missing or expired is still published, and only its `tap` job fails. A new version reaches `brew upgrade` only after someone merges the tap pull request. A running daemon keeps its old files until `golem daemon restart`. `brew upgrade` can delete them first, and then the daemon fails on its next import until launchd starts the new one. Removing golem with `brew uninstall` before `golem daemon uninstall` leaves a launchd job that points at nothing; section 14 of `docs/sre.md` shows how to remove it.
