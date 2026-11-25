"""coding.copies: a git copy of a folder, on throwaway repositories."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from golem.coding import copies
from golem.coding.copies import CopyError, NotGitFolderError
from golem.paths import GolemPaths


def git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=folder,
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


@pytest.fixture
def lead(tmp_path: Path) -> Path:
    folder = tmp_path / "lead"
    folder.mkdir()
    git(folder, "init", "-q", "-b", "main")
    (folder / ".gitignore").write_text(".venv/\n")
    (folder / "a.txt").write_text("one\n")
    (folder / "b.bin").write_bytes(b"\x00\x01\x02")
    git(folder, "add", "-A")
    git(folder, "commit", "-q", "-m", "first")
    return folder


@pytest.fixture
def root(tmp_path: Path) -> Path:
    return tmp_path / "copies"


def snapshot(folder: Path) -> tuple[str, str, str, str]:
    return (
        git(folder, "rev-parse", "HEAD"),
        git(folder, "branch", "--show-current"),
        git(folder, "status", "--porcelain=v1", "-uall", "--ignored"),
        git(folder, "diff", "HEAD", "--binary"),
    )


async def test_clean_tree(lead: Path, root: Path) -> None:
    made = await copies.create(lead, "h1", copies_dir=root)
    assert made.path == (root / "h1").resolve()
    assert (made.path / "a.txt").read_text() == "one\n"
    assert git(made.path, "rev-parse", "HEAD").strip() == made.baseline_sha
    assert git(made.path, "log", "-1", "--format=%an").strip() == "golem"
    assert await copies.diff_since_baseline(made) == ""
    assert copies.list_copies(copies_dir=root) == [made.path]


async def test_dirty_tree(lead: Path, root: Path) -> None:
    (lead / "a.txt").write_text("one\ntwo\n")
    (lead / "b.bin").write_bytes(b"\x00\xff\x10")
    (lead / "new.txt").write_text("new\n")
    (lead / "sub").mkdir()
    (lead / "sub" / "deep.txt").write_text("deep\n")
    (lead / ".venv").mkdir()
    (lead / ".venv" / "lib.py").write_text("x\n")
    made = await copies.create(lead, "h2", copies_dir=root)
    assert (made.path / "a.txt").read_text() == "one\ntwo\n"
    assert (made.path / "b.bin").read_bytes() == b"\x00\xff\x10"
    assert (made.path / "new.txt").read_text() == "new\n"
    assert (made.path / "sub" / "deep.txt").read_text() == "deep\n"
    assert not (made.path / ".venv").exists()
    assert await copies.diff_since_baseline(made) == ""
    (made.path / "a.txt").write_text("worker\n")
    assert "+worker" in await copies.diff_since_baseline(made)


async def test_non_git_refused(tmp_path: Path, root: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    with pytest.raises(NotGitFolderError, match=copies.NOT_GIT_MESSAGE):
        await copies.create(plain, "h3", copies_dir=root)
    assert copies.list_copies(copies_dir=root) == []


async def test_existing_copy_refused(lead: Path, root: Path) -> None:
    await copies.create(lead, "h4", copies_dir=root)
    with pytest.raises(CopyError):
        await copies.create(lead, "h4", copies_dir=root)


async def test_remove_twice(lead: Path, root: Path) -> None:
    made = await copies.create(lead, "h5", copies_dir=root)
    await copies.remove(made.path)
    assert not made.path.exists()
    await copies.remove(made.path)
    assert "h5" not in git(lead, "worktree", "list")
    assert copies.list_copies(copies_dir=root) == []


async def test_lead_unchanged(lead: Path, root: Path) -> None:
    (lead / "a.txt").write_text("changed\n")
    (lead / "new.txt").write_text("new\n")
    before = snapshot(lead)
    made = await copies.create(lead, "h6", copies_dir=root)
    await copies.remove(made.path)
    assert snapshot(lead) == before
    assert (lead / "new.txt").read_text() == "new\n"


def test_copies_dir_in_paths(tmp_path: Path) -> None:
    assert GolemPaths(tmp_path).copies_dir == tmp_path / "copies"
