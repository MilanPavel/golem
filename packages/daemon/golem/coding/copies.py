"""A git copy of the lead's folder for a helper that edits files.

A worker helper edits files in its own copy, so the lead's folder stays untouched until the
lead takes the worker's diff. The copy is ``git worktree add --detach`` of ``HEAD`` under
``copies_dir/<helper id>``. The lead's uncommitted state is laid on top (``git diff HEAD
--binary`` applied, then the untracked files that are not ignored), and golem makes one
baseline commit, so the worker's diff taken against it holds only the worker's own work.

Ignored folders (``.venv``, ``node_modules``) are neither copied nor linked. The project's
checks install what they need in the copy; a link would make an editable install test the
lead's code instead of the copy's.

A folder that is not a git checkout is refused: there is no plain-copy fallback. No model and
no session is involved here, only git, run without the user's hooks.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from golem.paths import resolve_paths

GIT_SECONDS = 120.0
NOT_GIT_MESSAGE = "workers need a git folder; this one is not"
BASELINE_MESSAGE = "golem: baseline of the lead's folder"
_QUIET = (
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=golem",
    "-c",
    "user.email=golem@localhost",
)


class CopyError(Exception):
    """A copy could not be made. The message says why."""


class NotGitFolderError(CopyError):
    """The folder is not a git checkout with at least one commit."""

    def __init__(self, folder: str | Path) -> None:
        super().__init__(f"{NOT_GIT_MESSAGE} ({folder})")


@dataclass(frozen=True, slots=True)
class Copy:
    """A made copy: its folder, and the commit holding the lead's state at that moment."""

    path: Path
    baseline_sha: str


async def _git(
    folder: Path, *args: str, stdin: bytes | None = None, check: bool = True
) -> tuple[int, bytes]:
    """Run git in ``folder``; return its exit code and stdout. It never prompts."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        process = await asyncio.create_subprocess_exec(
            "git",
            "--literal-pathspecs",
            *args,
            cwd=folder,
            env=env,
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise CopyError(f"git could not start: {exc}") from exc
    try:
        async with asyncio.timeout(GIT_SECONDS):
            out, err = await process.communicate(stdin)
    except TimeoutError as exc:
        process.kill()
        await process.wait()
        raise CopyError(f"git took longer than {GIT_SECONDS:g} seconds and was stopped") from exc
    except asyncio.CancelledError:
        process.kill()
        await asyncio.shield(process.wait())
        raise
    code = process.returncode if process.returncode is not None else -1
    if check and code != 0:
        text = err.decode("utf-8", errors="replace").strip()
        raise CopyError(f"git {args[0]} failed: {text}")
    return code, out


async def _top(folder: Path) -> Path:
    code, out = await _git(folder, "rev-parse", "--show-toplevel", check=False)
    if code != 0:
        raise NotGitFolderError(folder)
    code, _ = await _git(folder, "rev-parse", "--verify", "-q", "HEAD", check=False)
    if code != 0:
        raise NotGitFolderError(folder)
    return Path(out.decode("utf-8").strip())


async def create(
    lead_folder: str | Path, helper_id: str, *, copies_dir: Path | None = None
) -> Copy:
    """Make the copy for ``helper_id``. Raises :class:`NotGitFolderError` for a non-git folder.

    The lead's branch, ``HEAD`` and working tree are not changed. If anything fails, the
    half-made copy is removed.
    """
    if not helper_id or helper_id in {".", ".."} or "/" in helper_id or "\\" in helper_id:
        raise CopyError(f"not a usable helper id: {helper_id!r}")
    folder = Path(lead_folder)
    if not folder.is_dir():
        raise NotGitFolderError(folder)
    top = await _top(folder)
    root = copies_dir if copies_dir is not None else resolve_paths().copies_dir
    path = (root / helper_id).resolve()
    if path.exists():
        raise CopyError(f"a copy already exists at {path}")
    root.mkdir(parents=True, exist_ok=True)
    await _git(top, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", str(path))
    try:
        await _lay_state(top, path)
        await _git(path, "add", "-A")
        await _git(path, *_QUIET, "commit", "--allow-empty", "--no-verify", "-m", BASELINE_MESSAGE)
        _, sha = await _git(path, "rev-parse", "HEAD")
    except BaseException:
        await asyncio.shield(remove(path))
        raise
    return Copy(path, sha.decode("utf-8").strip())


async def _lay_state(top: Path, path: Path) -> None:
    """Put the lead's uncommitted changes and untracked, non-ignored files in the copy."""
    _, diff = await _git(top, "diff", "HEAD", "--binary", "--no-ext-diff")
    if diff:
        with tempfile.TemporaryDirectory() as scratch:
            patch = Path(scratch) / "lead.patch"
            patch.write_bytes(diff)
            await _git(path, "apply", "--binary", "--whitespace=nowarn", str(patch))
    _, listing = await _git(top, "ls-files", "-z", "--others", "--exclude-standard")
    for raw in listing.split(b"\0"):
        if not raw:
            continue
        name = os.fsdecode(raw)
        source = top / name
        target = path / name
        if source.is_dir() and not source.is_symlink():  # a nested checkout
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target, follow_symlinks=False)


async def remove(path: str | Path) -> None:
    """Remove a copy. A missing copy is not an error, so a second call does nothing."""
    folder = Path(path)
    if not folder.exists() and not folder.is_symlink():
        return
    common: Path | None = None
    if folder.is_dir():
        code, out = await _git(
            folder, "rev-parse", "--path-format=absolute", "--git-common-dir", check=False
        )
        if code == 0:
            common = Path(out.decode("utf-8").strip())
    if common is not None:
        await _git(common, "worktree", "remove", "--force", str(folder), check=False)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    if common is not None and common.exists():
        await _git(common, "worktree", "prune", check=False)


async def prune(folder: str | Path) -> None:
    """``git worktree prune`` in a lead's folder. A folder that is gone or not git is skipped."""
    path = Path(folder)
    if path.is_dir():
        await _git(path, "worktree", "prune", check=False)


def list_copies(*, copies_dir: Path | None = None) -> list[Path]:
    """The folders under ``copies_dir``, sorted. For the sweep of copies nobody owns."""
    root = copies_dir if copies_dir is not None else resolve_paths().copies_dir
    if not root.is_dir():
        return []
    return sorted(entry for entry in root.iterdir() if entry.is_dir())


async def diff_since_baseline(copy: Copy) -> str:
    """What the worker changed in the copy since the baseline, as a binary-safe patch."""
    await _git(copy.path, "add", "-A")
    _, out = await _git(copy.path, "diff", "--binary", "--no-ext-diff", copy.baseline_sha)
    return out.decode("utf-8", errors="replace")


async def changed_paths(copy: Copy) -> list[str]:
    """The files the worker changed since the baseline, with ``/``, sorted.

    A rename counts as one deleted file and one created file.
    """
    await _git(copy.path, "add", "-A")
    _, out = await _git(
        copy.path, "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", copy.baseline_sha
    )
    return sorted(os.fsdecode(raw) for raw in out.split(b"\0") if raw)


async def baseline_bytes(copy: Copy, path: str) -> bytes | None:
    """The file as the lead's folder had it when the copy was made. None: there was none."""
    code, out = await _git(copy.path, "show", f"{copy.baseline_sha}:{path}", check=False)
    return out if code == 0 else None
