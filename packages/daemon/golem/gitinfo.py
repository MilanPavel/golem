"""What git says about a folder (``git.info`` and ``git.branches``).

Read only. git runs in the folder with the user's own git, never prompts, and
each call is stopped after two seconds. The path rules are those of
``fs.list_dirs`` (under the home folder, not ``~/Library`` or a secret folder),
except that dot-folders are allowed, because agent worktrees live in one.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from golem.coding.commit import run_git
from golem.folders import OUTSIDE, FolderError, hidden_folders, is_under
from golem_protocol.commands import (
    GitBranch,
    GitBranchesResult,
    GitInfoResult,
    GitWorktree,
)

GIT_INFO_SECONDS = 2.0
MAX_BRANCHES = 200
AGENT_WORKTREES = Path(".claude") / "worktrees"


def _folder(path: str, home: Path) -> str:
    """``path`` resolved, if it is an existing folder the page may ask about."""
    if not Path(path).is_absolute():
        raise FolderError("path must be an absolute path")
    root = home.resolve()
    try:
        target = Path(path).resolve()
    except (OSError, RuntimeError) as exc:
        raise FolderError(OUTSIDE) from exc
    if not is_under(target, root) or any(
        is_under(target, hidden) for hidden in hidden_folders(root)
    ):
        raise FolderError(OUTSIDE)
    if not target.is_dir():
        raise FolderError(f"There is no folder at {path}.")
    return str(target)


async def _git(folder: str, *args: str) -> str | None:
    """The output of one git call, or None when git says no. A timeout is an error."""
    result = await run_git(folder, *args, seconds=GIT_INFO_SECONDS)
    if result.code == -1:
        raise FolderError(result.output.strip())
    return result.output if result.ok else None


def _worktrees(listing: str) -> list[GitWorktree]:
    """The checkouts in ``git worktree list --porcelain``: main first, then the rest by path."""
    entries: list[tuple[str, str | None]] = []
    for block in listing.split("\n\n"):
        path: str | None = None
        branch: str | None = None
        bare = False
        for line in block.splitlines():
            if line.startswith("worktree "):
                path = line.removeprefix("worktree ")
            elif line.startswith("branch "):
                branch = line.removeprefix("branch ").removeprefix("refs/heads/")
            elif line == "bare":
                bare = True
        if path is not None and not bare:
            entries.append((path, branch))
    if not entries:
        return []
    main_path = entries[0][0]
    agents = Path(main_path) / AGENT_WORKTREES

    def make(path: str, branch: str | None, main: bool) -> GitWorktree:
        return GitWorktree(
            path=path, branch=branch, main=main, agent=not main and is_under(Path(path), agents)
        )

    rest = sorted(entries[1:], key=lambda entry: entry[0])
    return [make(*entries[0], True), *(make(path, branch, False) for path, branch in rest)]


async def git_info(path: str, home: Path) -> GitInfoResult:
    """Whether ``path`` is in a repo, its branch, changed files, and worktrees."""
    folder = _folder(path, home)
    try:
        async with asyncio.timeout(GIT_INFO_SECONDS):
            top = await _git(folder, "rev-parse", "--show-toplevel")
            if top is None:
                return GitInfoResult(repository=False, detached=False, changed=0, worktrees=[])
            branch = await _git(folder, "symbolic-ref", "--short", "-q", "HEAD")
            status = await _git(folder, "status", "--porcelain")
            listing = await _git(folder, "worktree", "list", "--porcelain")
    except TimeoutError as exc:
        raise FolderError("git took longer than 2 seconds") from exc
    name = branch.strip() if branch is not None and branch.strip() else None
    return GitInfoResult(
        repository=True,
        root=top.strip(),
        branch=name,
        detached=name is None,
        changed=len((status or "").splitlines()),
        worktrees=_worktrees(listing or ""),
    )


async def git_branches(path: str, home: Path) -> GitBranchesResult:
    """The local branches of the repo ``path`` is in, newest commit first."""
    folder = _folder(path, home)
    try:
        async with asyncio.timeout(GIT_INFO_SECONDS):
            head = await _git(folder, "symbolic-ref", "--short", "-q", "HEAD")
            listing = await _git(
                folder,
                "for-each-ref",
                "--sort=-committerdate",
                f"--count={MAX_BRANCHES}",
                "--format=%(refname:lstrip=2)\t%(committerdate:iso-strict)",
                "refs/heads",
            )
    except TimeoutError as exc:
        raise FolderError("git took longer than 2 seconds") from exc
    branches: list[GitBranch] = []
    for line in (listing or "").splitlines():
        name, _, when = line.partition("\t")
        if name:
            branches.append(GitBranch(name=name, last_used=when or None))
    current = head.strip() if head is not None and head.strip() else None
    return GitBranchesResult(current=current, branches=branches)
