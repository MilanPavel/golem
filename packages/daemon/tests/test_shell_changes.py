"""Changes a shell command made, found with git."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from golem.coding import shell_changes
from golem.tools import default_registry, sandbox, shell
from golem.tools.registry import FileEdit, ToolContext, ToolResult

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")

_IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"]


def _git(cwd: Path, *args: str) -> None:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    subprocess.run(["git", *_IDENTITY, *args], cwd=cwd, env=env, capture_output=True, check=True)


@pytest.fixture(autouse=True)
def _no_outer_git(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    folder = tmp_path / "repo"
    folder.mkdir()
    _git(folder, "init", "-b", "main")
    (folder / "a.txt").write_text("one\n", "utf-8")
    (folder / "b.txt").write_text("keep\n", "utf-8")
    (folder / ".gitignore").write_text("build/\n", "utf-8")
    _git(folder, "add", ".")
    _git(folder, "commit", "-m", "first")
    return folder


async def _shell(root: Path, command: str) -> ToolResult:
    return await default_registry().call("shell", {"command": command}, ToolContext(root=root))


def _runner(root: Path) -> shell_changes.RunGit:
    return shell.git_runner(ToolContext(root=root), root)


def _by_path(result: ToolResult) -> dict[str, FileEdit]:
    return {edit.path: edit for edit in result.edits}


@needs_sandbox
async def test_a_command_that_edits_a_clean_file(repo: Path) -> None:
    result = await _shell(repo, "echo two > a.txt")
    assert result.edits == (FileEdit("a.txt", "one\n", "two\n", "shell"),)


@needs_sandbox
async def test_a_command_that_edits_a_dirty_file(repo: Path) -> None:
    (repo / "a.txt").write_text("dirty\n", "utf-8")
    result = await _shell(repo, "echo two > a.txt")
    assert result.edits == (FileEdit("a.txt", "dirty\n", "two\n", "shell"),)


@needs_sandbox
async def test_a_dirty_file_the_command_leaves_alone_is_not_an_edit(repo: Path) -> None:
    (repo / "a.txt").write_text("dirty\n", "utf-8")
    result = await _shell(repo, "echo hi > c.txt")
    assert result.edits == (FileEdit("c.txt", None, "hi\n", "shell"),)


@needs_sandbox
async def test_a_command_that_creates_and_one_that_deletes(repo: Path) -> None:
    result = await _shell(repo, "mkdir sub && echo new > sub/n.txt && rm b.txt")
    edits = _by_path(result)
    assert edits["sub/n.txt"] == FileEdit("sub/n.txt", None, "new\n", "shell")
    assert edits["b.txt"] == FileEdit("b.txt", "keep\n", None, "shell")
    assert len(edits) == 2


@needs_sandbox
async def test_a_command_that_changes_nothing(repo: Path) -> None:
    assert (await _shell(repo, "cat a.txt")).edits == ()


@needs_sandbox
async def test_binary_and_ignored_files_are_skipped(repo: Path) -> None:
    command = "mkdir build && echo x > build/o.txt && printf '\\377\\376\\000' > bin.dat"
    assert (await _shell(repo, command)).edits == ()


@needs_sandbox
async def test_a_folder_that_is_not_a_repository_records_nothing(tmp_path: Path) -> None:
    folder = tmp_path / "plain"
    folder.mkdir()
    assert (await _shell(folder, "echo a > a.txt")).edits == ()


async def test_nothing_is_recorded_without_a_sandbox(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sandbox, "available", lambda: False)
    assert await shell_changes.look(repo, _runner(repo)) is None


@needs_sandbox
async def test_look_is_none_outside_a_repository(tmp_path: Path) -> None:
    assert await shell_changes.look(tmp_path, _runner(tmp_path)) is None


@needs_sandbox
async def test_look_gives_up_on_too_many_files(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(shell_changes, "MAX_FILES", 2)
    for name in "xyz":
        (repo / f"{name}.txt").write_text(name, "utf-8")
    assert await shell_changes.look(repo, _runner(repo)) is None


@needs_sandbox
async def test_a_file_the_command_changed_back_is_reported(repo: Path) -> None:
    (repo / "a.txt").write_text("dirty\n", "utf-8")
    before = await shell_changes.look(repo, _runner(repo))
    assert before is not None
    (repo / "a.txt").write_text("one\n", "utf-8")
    edits = await shell_changes.changed(before, _runner(repo))
    assert edits == [FileEdit("a.txt", "dirty\n", "one\n")]


@needs_sandbox
async def test_a_committed_file_that_is_not_utf8_is_skipped(repo: Path) -> None:
    (repo / "l.txt").write_bytes(b"caf\xe9\n")
    _git(repo, "add", "l.txt")
    _git(repo, "commit", "-m", "latin")
    assert (await _shell(repo, "echo changed > l.txt")).edits == ()


@needs_sandbox
async def test_text_that_looks_like_a_separator_is_reported_whole(repo: Path) -> None:
    tricky = "OK 2 abc\nNEW 1\nNO 3\n\n"
    (repo / "t.txt").write_text(tricky, "utf-8")
    _git(repo, "add", "t.txt")
    _git(repo, "commit", "-m", "tricky")
    result = await _shell(repo, "echo x > t.txt; echo y > a.txt; : > b.txt")
    edits = _by_path(result)
    assert edits["t.txt"] == FileEdit("t.txt", tricky, "x\n", "shell")
    assert edits["a.txt"] == FileEdit("a.txt", "one\n", "y\n", "shell")
    assert edits["b.txt"] == FileEdit("b.txt", "keep\n", "", "shell")


@needs_sandbox
async def test_a_staged_new_file_keeps_its_text_as_before(repo: Path) -> None:
    (repo / "s.txt").write_text("s\n", "utf-8")
    _git(repo, "add", "s.txt")
    before = await shell_changes.look(repo, _runner(repo))
    assert before is not None
    (repo / "s.txt").write_text("t\n", "utf-8")
    edits = await shell_changes.changed(before, _runner(repo))
    assert edits == [FileEdit("s.txt", "s\n", "t\n")]


@needs_sandbox
async def test_a_cut_output_skips_every_clean_file(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sandbox, "HEAD_CHARS", 10)
    monkeypatch.setattr(sandbox, "TAIL_CHARS", 10)
    result = await _shell(repo, "echo y > a.txt; echo z > b.txt")
    assert result.edits == ()
