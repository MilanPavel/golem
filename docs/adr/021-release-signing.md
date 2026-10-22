# ADR-021: Releases are signed with one self-signed certificate, and published only after a clean runner checks them

**Date**: 2026-10-21
**Status**: accepted

## The idea

The Keychain trusts a program by its code signature. An ad-hoc signature is a hash of the file, so every build is a new program, and macOS asks about every stored key again after each upgrade. A certificate gives every build the same designated requirement: `identifier "dev.golem.daemon" and certificate leaf = H"<sha1>"`. One certificate signs every release for as long as golem ships this way.

A release is built, signed, and smoke-tested, uploaded to a draft, downloaded again by a fresh runner that has none of the build tools, checked, and only then published. What users download is exactly what was checked.

## What the code does today

`scripts/sign_dist.py sign` signs every Mach-O file in the tree, libraries first, then `libexec/golem-daemon/golem-daemon` as `dev.golem.daemon` and `bin/golem` as `dev.golem.cli`. The identity is `GOLEM_SIGN_IDENTITY`, or ad-hoc when it is unset. `scripts/dist.sh` runs it on every macOS build, because `bun build --compile` leaves `bin/golem` with a signature that no longer matches the file. `sign_dist.py check` verifies every signature, the two identifiers, and, with `--identity-hash`, the certificate.

`scripts/make_signing_cert.sh` makes the certificate once: RSA 3072, code signing only, 20 years. The release workflow (`.github/workflows/release.yml`) imports it from the `MACOS_SIGN_P12_BASE64` and `MACOS_SIGN_P12_PASSWORD` secrets into a temporary keychain. The `MACOS_SIGN_IDENTITY` variable is its SHA-1. codesign accepts an untrusted certificate, but finds it only in the keychain search list, so the workflow adds the temporary keychain there.

The workflow on a `v*` tag: the tag must equal `scripts/version.sh`, then `just check`, `just dist`, `just check-signature`, `just smoke-dist`, `just package`, and a draft release with the archive and its `.sha256`. A second macOS job downloads the draft, checks the checksum and the signatures with the system `python3`, checks `bin/golem --version`, and runs `scripts/smoke_dist.py` on the unpacked tree. A third job publishes the draft. A tag with a `-`, such as `v0.2.0-rc.1`, is a prerelease.

## Other shapes that lost

**PyInstaller's own `codesign_identity`.** With an identity it turns on the hardened runtime and asks Apple's timestamp server. The hardened runtime enforces library validation, which a certificate without a team rejects for every library PyInstaller ships.

**Developer ID now.** It needs a paid Apple account. Notarization only matters for downloads from a browser, and Homebrew downloads with `curl`, which sets no quarantine. Moving to Developer ID later changes the designated requirement once, so users approve the daemon once more.

**Upload a workflow artifact and check that.** It would check a copy, not the file users get.

**Publish, then check.** A broken archive would be public until someone deleted it.

## What it costs

The certificate and its password are long-lived secrets. Losing them, or rotating them, makes every user approve the daemon again. A self-signed signature means nothing to Gatekeeper, so an archive downloaded in a browser is blocked until the user allows it. Items a previous ad-hoc build owned ask once more, and Always Allow adds the signed daemon, which every later release then matches.
