# ADR-042: The plan lives in GitHub issues and Project 1, not in a file

**Date**: 2026-11-09
**Status**: accepted

## Context

`docs/plan.md` listed every phase and step of golem's future. It grew to 1233 lines and drifted from the code and from the board:

- Each phase and step already has an issue, and each ticket is a sub-issue of its step. The issues hold the scope, the status, and the pull requests. The plan held the same scope a second time.
- Every merged step had to edit the plan too. Steps that did not left it wrong, and a reader could not tell which of the two was right.
- The docs describe what exists, but the plan described what does not. On the docs site, the two kinds of page sat side by side.

## Decision

The plan lives in GitHub issues and in [Project 1](https://github.com/users/MilanPavel/projects/1).

- A phase is an issue. A step is a sub-issue of its phase, and a ticket is a sub-issue of its step. The issue body holds the goal, the scope, and the check that ends it.
- The board's Status and Phase fields say what is next and what is done.
- `docs/roadmap.md` is a short page that links the board and the open phase issues. It lists no steps, so nothing in it can drift.
- The docs describe what exists. [vision.md](../vision.md) keeps the long view, with no dates.
- Cross-cutting notes that were in the plan (ground rules, LangGraph pitfalls, risks, open questions) moved into the issue of the phase they belong to.
- A non-obvious choice still gets an ADR.

`docs/plan.md` is deleted, and its links point to `docs/roadmap.md` or to the issue they meant.

## Alternatives Considered

### Keep plan.md and trim it

- **Pros**: one file to read.
- **Cons**: it is still a second copy of the issues, and it drifts the same way.
- **Why not**: trimming does not remove the cause.

### Generate the plan page from the issues

- **Pros**: always current, and still a page on the site.
- **Cons**: the docs build needs a GitHub token and network, and a build can fail for a reason that has nothing to do with docs.
- **Why not**: the board already shows the same thing, and a link costs nothing.

## Consequences

### Positive

- One source of truth for scope and status.
- A pull request that finishes a step closes its issue, and that is all it has to update.

### Negative

- Older ADRs and the commit history still say "the plan". Old ADRs keep their text and link to the issue where one is meant.
- Reading the whole roadmap means opening the board, not one file.
