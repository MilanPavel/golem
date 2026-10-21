# ADR-019: The `golem` command is one bun binary

**Date**: 2026-10-20
**Status**: accepted

## The idea

`golem` with no arguments opens the TUI. `golem status`, `golem daemon …`, and `golem --version` are the same program. A release ships that program as one file, so a Mac does not need Node.

## What the code does today

`packages/cli/src/main.ts` is the entry. No arguments dynamically import `runTui` from `@golem/tui`. `just dist` runs `bun build --compile` and writes `dist/…/bin/golem`. The git tag is inlined as `GOLEM_VERSION`.

Ink's layout engine is WebAssembly, and it loads in that binary. The packages are ESM, and the top-level `await` in the entry is fine. Ink optionally imports `react-devtools-core`, which is not installed. `scripts/react-devtools-core` is a stub dependency so the compile can see that import. The binary does not connect to devtools.

In a checkout, `packages/cli/bin/golem.js` starts the same entry with `bun`, because Node's type stripper does not compile JSX. `process.execPath` inside the compiled file is `bin/golem`, so the daemon locator finds `../libexec/golem-daemon/golem-daemon`. Under `bun` in a checkout, that sibling does not exist and the locator uses `uv`.

## Other shapes that lost

Node's single executable application was the fallback if `bun build --compile` failed. The compile succeeded, including the WebAssembly layout engine, so that fallback is unused.

A shell script that execs `tsx` for the TUI and Node for the CLI would still need both tools on the machine.

## What it costs

A checkout needs `bun` on `PATH` to run `golem`. The compiled file is about 60 MB. Cross-compiling for Linux and Windows is a later step in the release matrix; this decision only picks the tool.
