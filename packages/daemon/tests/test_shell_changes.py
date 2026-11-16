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
async def test_a_folder_that_is_not_a_repository_is_compared_by_its_files(tmp_path: Path) -> None:
    folder = tmp_path / "plain"
    folder.mkdir()
    result = await _shell(folder, "echo a > a.txt")
    assert result.edits == (FileEdit("a.txt", None, "a\n", "shell"),)


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


def _worktree(repo: Path, name: str, *, ignore: bool = False) -> Path:
    """A worktree of ``repo`` in ``repo/.wt/<name>``, with README.md committed."""
    if not (repo / "README.md").exists():
        (repo / "README.md").write_text("readme\n", "utf-8")
        _git(repo, "add", "README.md")
        _git(repo, "commit", "-m", "readme")
    if ignore:
        with (repo / ".git" / "info" / "exclude").open("a", encoding="utf-8") as exclude:
            exclude.write(".wt/\n")
    folder = repo / ".wt" / name
    _git(repo, "worktree", "add", str(folder), "-b", name)
    return folder


@needs_sandbox
async def test_a_command_that_edits_a_file_of_a_worktree(repo: Path) -> None:
    _worktree(repo, "x")
    result = await _shell(repo, "printf 'hi\\n' >> .wt/x/README.md")
    assert result.edits == (FileEdit(".wt/x/README.md", "readme\n", "readme\nhi\n", "shell"),)


@needs_sandbox
async def test_a_worktree_the_outer_checkout_ignores_is_watched(repo: Path) -> None:
    _worktree(repo, "x", ignore=True)
    result = await _shell(repo, "echo hi >> .wt/x/README.md; echo new > .wt/x/n.txt")
    edits = _by_path(result)
    assert edits[".wt/x/README.md"] == FileEdit(
        ".wt/x/README.md", "readme\n", "readme\nhi\n", "shell"
    )
    assert edits[".wt/x/n.txt"] == FileEdit(".wt/x/n.txt", None, "new\n", "shell")
    assert len(edits) == 2


@needs_sandbox
async def test_a_worktree_ignored_files_are_not_reported(repo: Path) -> None:
    folder = _worktree(repo, "x", ignore=True)
    (folder / ".gitignore").write_text("build/\n", "utf-8")
    result = await _shell(repo, "mkdir .wt/x/build && echo o > .wt/x/build/o.txt")
    assert result.edits == ()


@needs_sandbox
async def test_a_command_that_makes_a_worktree_and_edits_it(repo: Path) -> None:
    (repo / "README.md").write_text("readme\n", "utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "readme")
    command = (
        "git -c user.name=t -c user.email=t@e.com worktree add .wt/y -b y >/dev/null 2>&1; "
        "printf 'hi\\n' >> .wt/y/README.md"
    )
    result = await _shell(repo, command)
    assert FileEdit(".wt/y/README.md", "readme\n", "readme\nhi\n", "shell") in result.edits


@needs_sandbox
async def test_a_dirty_file_of_a_worktree_keeps_its_text_as_before(repo: Path) -> None:
    folder = _worktree(repo, "x")
    (folder / "README.md").write_text("dirty\n", "utf-8")
    result = await _shell(repo, "echo two > .wt/x/README.md")
    assert result.edits == (FileEdit(".wt/x/README.md", "dirty\n", "two\n", "shell"),)


@needs_sandbox
async def test_a_change_in_the_main_checkout_and_one_in_a_worktree(repo: Path) -> None:
    _worktree(repo, "x")
    result = await _shell(repo, "echo two > a.txt; echo hi >> .wt/x/README.md")
    edits = _by_path(result)
    assert edits["a.txt"] == FileEdit("a.txt", "one\n", "two\n", "shell")
    assert edits[".wt/x/README.md"].before == "readme\n"
    assert len(edits) == 2


@needs_sandbox
async def test_a_worktree_outside_the_folder_is_not_watched(tmp_path: Path, repo: Path) -> None:
    (repo / "README.md").write_text("readme\n", "utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "readme")
    outside = tmp_path / "outside"
    _git(repo, "worktree", "add", str(outside), "-b", "o")
    assert shell_changes.worktrees(repo) == []
    result = await _shell(repo, f"echo hi >> {outside}/README.md; echo two > a.txt")
    assert [edit.path for edit in result.edits] == ["a.txt"]


@needs_sandbox
async def test_a_broken_gitdir_file_is_skipped(repo: Path) -> None:
    folder = _worktree(repo, "x")
    _worktree(repo, "z")
    for entry in (repo / ".git" / "worktrees").iterdir():
        if entry.name == "z":
            (entry / "gitdir").write_bytes(b"\xff\xfe")
    (repo / ".git" / "worktrees" / "empty").mkdir()
    assert shell_changes.worktrees(repo) == [folder.resolve()]
    result = await _shell(repo, "echo hi >> .wt/x/README.md")
    assert [edit.path for edit in result.edits] == [".wt/x/README.md"]


@needs_sandbox
async def test_only_eight_worktrees_are_watched(repo: Path) -> None:
    for number in range(10):
        _worktree(repo, f"w{number}")
    found = shell_changes.worktrees(repo)
    assert [folder.name for folder in found] == [f"w{number}" for number in range(8)]


@needs_sandbox
async def test_a_checkout_over_the_cap_is_not_watched_but_the_others_are(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = _worktree(repo, "x")
    monkeypatch.setattr(shell_changes, "MAX_FILES", 2)
    for name in "xyz":
        (folder / f"{name}.txt").write_text(name, "utf-8")
    result = await _shell(repo, "echo two > a.txt")
    assert [edit.path for edit in result.edits] == ["a.txt"]


@needs_sandbox
async def test_a_worktree_file_name_cannot_fake_a_separator(repo: Path) -> None:
    folder = _worktree(repo, "x")
    odd = "q\nE\n.txt"
    (folder / odd).write_text("odd\n", "utf-8")
    _git(folder, "add", "-f", "--", odd)
    _git(folder, "commit", "-m", "odd")
    result = await _shell(repo, "echo hi >> .wt/x/README.md; echo no >> .wt/x/q*.txt")
    assert FileEdit(".wt/x/README.md", "readme\n", "readme\nhi\n", "shell") in result.edits
    assert all("\n" not in edit.path for edit in result.edits)
