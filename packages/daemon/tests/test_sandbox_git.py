"""Git under the sandbox: a worktree may write its own git folders, and nothing else."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from golem.config import ShellSettings
from golem.tools import sandbox

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")

_IDENTITY = "-c user.name=t -c user.email=t@example.com -c commit.gpgsign=false"


def _git(cwd: Path, *args: str) -> str:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    done = subprocess.run(
        ["git", *_IDENTITY.split(), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.strip()


@pytest.fixture(autouse=True)
def _no_outer_git(monkeypatch: pytest.MonkeyPatch) -> None:
    """A git hook that runs the tests sets ``GIT_DIR`` and others. Keep them from the commands."""
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)


@pytest.fixture
def checkout(short_home: Path) -> Path:
    """A clone of a bare ``origin``, with one commit. Outside the temp folders the sandbox opens."""
    origin = short_home / "origin.git"
    _git(short_home, "init", "--bare", "-b", "main", str(origin))
    main = short_home / "main"
    _git(short_home, "clone", str(origin), str(main))
    (main / "a.txt").write_text("a\n", "utf-8")
    _git(main, "add", "a.txt")
    _git(main, "commit", "-m", "first")
    _git(main, "push", "origin", "main")
    return main


@pytest.fixture
def worktree(checkout: Path) -> Path:
    folder = checkout.parent / "tree"
    _git(checkout, "worktree", "add", "-b", "work", str(folder))
    return folder


async def _sh(root: Path, command: str, home: Path) -> sandbox.Finished:
    return await sandbox.run(
        ["/bin/sh", "-c", command], root=root, settings=ShellSettings(), timeout=20, home=home
    )


def test_a_worktree_names_its_own_and_its_shared_git_folder(checkout: Path, worktree: Path) -> None:
    common = (checkout / ".git").resolve()
    assert sandbox.git_dirs(worktree) == [common / "worktrees" / "tree", common]
    assert sandbox.git_dirs(worktree / "sub") == [common / "worktrees" / "tree", common]
    assert sandbox.git_dirs(checkout) == [common]


def test_the_profile_adds_only_git_folders_outside_the_session_folder(
    checkout: Path, worktree: Path, short_home: Path
) -> None:
    home = short_home / "home"
    common = (checkout / ".git").resolve()
    in_tree = sandbox.profile(worktree, ShellSettings(), home=home)
    assert f'(subpath "{common}")' in in_tree
    assert f'(subpath "{common / "worktrees" / "tree"}")' in in_tree
    in_clone = sandbox.profile(checkout, ShellSettings(), home=home)
    assert f'(subpath "{common}")' not in in_clone
    # A folder inside a clone may commit, as the clone itself may.
    sub = checkout / "packages"
    sub.mkdir()
    assert f'(subpath "{common}")' in sandbox.profile(sub, ShellSettings(), home=home)


@pytest.mark.parametrize(
    "text",
    ["", "gitdir:", "gitdir: nowhere", "not a pointer"],
)
def test_a_dot_git_file_that_points_nowhere_adds_nothing(tmp_path: Path, text: str) -> None:
    (tmp_path / ".git").write_text(text, "utf-8")
    assert sandbox.git_dirs(tmp_path) == []


def test_a_folder_outside_any_checkout_has_no_git_folders(tmp_path: Path) -> None:
    folder = tmp_path / "plain"
    folder.mkdir()
    assert sandbox.git_dirs(folder) == []


@needs_sandbox
async def test_fetch_add_and_commit_work_in_a_worktree(
    checkout: Path, worktree: Path, short_home: Path
) -> None:
    (worktree / "b.txt").write_text("b\n", "utf-8")
    done = await _sh(
        worktree,
        f"git fetch origin && git add b.txt && git {_IDENTITY} commit -q -m second"
        " && git log -1 --format=%s",
        home=short_home / "home",
    )
    assert done.exit_code == 0, done.output
    assert done.output.strip().splitlines()[-1] == "second"
    assert _git(checkout, "log", "-1", "--format=%s", "work") == "second"


@needs_sandbox
async def test_a_write_elsewhere_in_the_main_checkout_is_still_refused(
    checkout: Path, worktree: Path, short_home: Path
) -> None:
    done = await _sh(worktree, f"echo x > {checkout / 'a.txt'}", home=short_home / "home")
    assert done.exit_code != 0
    assert (checkout / "a.txt").read_text("utf-8") == "a\n"
    beside = short_home / "beside.txt"
    done = await _sh(worktree, f"echo x > {beside}", home=short_home / "home")
    assert done.exit_code != 0
    assert not beside.exists()
