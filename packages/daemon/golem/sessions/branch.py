"""The branch of a session's folder, and what a switch changed.

A session never switches its own branch. Another session or a terminal can, so before each
turn the daemon compares the folder's branch with the one the model last heard of
(:func:`branch_change`). git runs read only, never prompts, and each call is stopped after
two seconds.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

from golem.coding.commit import run_git

BRANCH_SECONDS = 2.0
"""How long one git call may run, and how long a folder's branch is cached."""

MAX_PATHS = 50
"""Changed paths a branch note lists. The rest is counted."""


class BranchCache:
    """The branch of each folder, read at most once every two seconds.

    A burst of summaries for sessions in one folder runs git once: callers inside the window
    share one read, even one still running.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._reads: dict[str, tuple[float, asyncio.Task[str | None]]] = {}

    async def get(self, cwd: str | None, *, fresh: bool = False) -> str | None:
        """The branch checked out in ``cwd``. None for no folder, no repo, or a detached head.
        ``fresh`` skips the cache and renews it."""
        if cwd is None:
            return None
        now = self.clock()
        cached = self._reads.get(cwd)
        if cached is not None and not fresh and now - cached[0] < BRANCH_SECONDS:
            return await asyncio.shield(cached[1])
        task = asyncio.ensure_future(read_branch(cwd))
        self._reads[cwd] = (now, task)
        return await asyncio.shield(task)

    def forget(self, cwd: str | None) -> None:
        """Drop the cached branch of ``cwd``, so the next read asks git."""
        if cwd is not None:
            self._reads.pop(cwd, None)


async def read_branch(cwd: str) -> str | None:
    """The branch checked out in ``cwd``, None when there is none or git fails."""
    result = await run_git(cwd, "symbolic-ref", "--short", "-q", "HEAD", seconds=BRANCH_SECONDS)
    name = result.output.strip() if result.ok else ""
    return name or None


async def changed_paths(cwd: str, old: str, new: str) -> list[str] | None:
    """The files that differ between two branches, None when git cannot say."""
    result = await run_git(cwd, "diff", "--name-only", old, new, "--", seconds=BRANCH_SECONDS)
    if not result.ok:
        return None
    return [line for line in result.output.splitlines() if line]


@dataclass(frozen=True, slots=True)
class BranchChange:
    """A switch the model has not heard of. ``note`` is what it reads."""

    old: str
    new: str
    paths_count: int | None
    note: str


def branch_note(cwd: str, old: str, new: str, paths: list[str] | None) -> str:
    """The note for the model: the switch, what to do about it, and up to 50 changed paths."""
    text = (
        f"The branch of {cwd} changed from {old} to {new} since your last turn. "
        "Files may differ from what you read. Read a file again before you edit it."
    )
    if not paths:
        return text
    shown = "\n".join(paths[:MAX_PATHS])
    more = len(paths) - MAX_PATHS
    tail = f"\nand {more} more" if more > 0 else ""
    return f"{text}\nFiles that differ:\n{shown}{tail}"


async def branch_change(
    cache: BranchCache, cwd: str | None, seen: str | None
) -> tuple[str | None, BranchChange | None]:
    """The folder's branch now, and the change since ``seen``, the branch the model last heard
    of. There is no change without a known ``seen``, or when the folder has no branch now."""
    current = await cache.get(cwd, fresh=True)
    if cwd is None or current is None or seen is None or current == seen:
        return current, None
    paths = await changed_paths(cwd, seen, current)
    return current, BranchChange(
        old=seen,
        new=current,
        paths_count=None if paths is None else len(paths),
        note=branch_note(cwd, seen, current, paths),
    )


__all__ = [
    "BRANCH_SECONDS",
    "MAX_PATHS",
    "BranchCache",
    "BranchChange",
    "branch_change",
    "branch_note",
    "changed_paths",
    "read_branch",
]
