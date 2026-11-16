"""Changes a shell command made in a folder that is not a repository."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from golem.coding import plain_changes, shell_changes
from golem.coding.plain_changes import Plain
from golem.tools import default_registry, sandbox
from golem.tools.registry import FileEdit, ToolContext

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")


def _look(root: Path) -> Plain:
    before = plain_changes.look(root)
    assert before is not None
    return before


def test_a_new_folder_with_four_files(tmp_path: Path) -> None:
    before = _look(tmp_path)
    (tmp_path / "demo").mkdir()
    for name in ("a", "b", "c.txt", "d.py"):
        (tmp_path / "demo" / name).write_text(f"{name}\n", "utf-8")
    edits = plain_changes.changed(before)
    assert [edit.path for edit in edits] == ["demo/a", "demo/b", "demo/c.txt", "demo/d.py"]
    assert edits[0] == FileEdit("demo/a", None, "a\n")


def test_an_empty_new_file_is_reported(tmp_path: Path) -> None:
    before = _look(tmp_path)
    (tmp_path / "empty").touch()
    assert plain_changes.changed(before) == [FileEdit("empty", None, "")]


def test_a_changed_small_file_has_both_texts(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("one\n", "utf-8")
    before = _look(tmp_path)
    (tmp_path / "a.txt").write_text("two\n", "utf-8")
    assert plain_changes.changed(before) == [FileEdit("a.txt", "one\n", "two\n")]


def test_a_rewrite_of_the_same_size_and_time_is_found_by_its_text(tmp_path: Path) -> None:
    path = tmp_path / "a.txt"
    path.write_text("one\n", "utf-8")
    stat = path.stat()
    before = _look(tmp_path)
    path.write_text("two\n", "utf-8")
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert plain_changes.changed(before) == [FileEdit("a.txt", "one\n", "two\n")]


def test_a_file_rewritten_with_the_same_text_is_not_an_edit(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("one\n", "utf-8")
    before = _look(tmp_path)
    (tmp_path / "a.txt").write_text("one\n", "utf-8")
    assert plain_changes.changed(before) == []


def test_a_deleted_small_file(tmp_path: Path) -> None:
    (tmp_path / "a.txt").write_text("one\n", "utf-8")
    before = _look(tmp_path)
    (tmp_path / "a.txt").unlink()
    assert plain_changes.changed(before) == [FileEdit("a.txt", "one\n", None)]


def test_a_changed_file_over_the_kept_size_is_not_reported(tmp_path: Path) -> None:
    (tmp_path / "big.txt").write_text("x" * (plain_changes.MAX_KEPT_BYTES + 1), "utf-8")
    (tmp_path / "gone.txt").write_text("y" * (plain_changes.MAX_KEPT_BYTES + 1), "utf-8")
    before = _look(tmp_path)
    (tmp_path / "big.txt").write_text("z" * (plain_changes.MAX_KEPT_BYTES + 5), "utf-8")
    (tmp_path / "gone.txt").unlink()
    assert plain_changes.changed(before) == []


def test_a_binary_file_is_not_reported(tmp_path: Path) -> None:
    (tmp_path / "old.bin").write_bytes(b"\xff\xfe\x00")
    before = _look(tmp_path)
    (tmp_path / "new.bin").write_bytes(b"\xff\xfe\x00\x01")
    (tmp_path / "old.bin").write_bytes(b"\xff\xfe\x00\x02")
    assert plain_changes.changed(before) == []


def test_a_new_file_over_the_read_limit_is_not_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shell_changes, "MAX_BYTES", 10)
    before = _look(tmp_path)
    (tmp_path / "big.txt").write_text("x" * 11, "utf-8")
    (tmp_path / "ok.txt").write_text("x" * 10, "utf-8")
    assert [edit.path for edit in plain_changes.changed(before)] == ["ok.txt"]


def test_skipped_folders_are_ignored(tmp_path: Path) -> None:
    before = _look(tmp_path)
    for folder in (".git", ".venv", "node_modules", ".golem"):
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "x.txt").write_text("x", "utf-8")
    (tmp_path / "real.txt").write_text("r", "utf-8")
    assert [edit.path for edit in plain_changes.changed(before)] == ["real.txt"]


def test_too_many_files_is_not_watched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(plain_changes, "MAX_FILES", 2)
    for name in "abc":
        (tmp_path / name).write_text(name, "utf-8")
    assert plain_changes.look(tmp_path) is None
    assert plain_changes.tracking(tmp_path) == "off"


def test_exactly_the_most_files_is_watched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(plain_changes, "MAX_FILES", 2)
    for name in "ab":
        (tmp_path / name).write_text(name, "utf-8")
    assert plain_changes.look(tmp_path) is not None
    assert plain_changes.tracking(tmp_path) == "files"


def test_at_most_the_cap_of_edits_is_reported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(plain_changes, "MAX_FILES_REPORTED", 3)
    before = _look(tmp_path)
    for index in range(5):
        (tmp_path / f"f{index}.txt").write_text("x", "utf-8")
    assert len(plain_changes.changed(before)) == 3


def test_tracking_in_a_checkout_and_without_a_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert plain_changes.tracking(None) == "git"
    (tmp_path / ".git").mkdir()
    monkeypatch.setattr(sandbox, "available", lambda: True)
    assert plain_changes.tracking(tmp_path) == "git"
    monkeypatch.setattr(sandbox, "available", lambda: False)
    assert plain_changes.tracking(tmp_path) == "off"


@needs_sandbox
async def test_the_shell_records_files_it_makes_without_a_repository(tmp_path: Path) -> None:
    result = await default_registry().call(
        "shell", {"command": "mkdir p && printf x > p/a.txt"}, ToolContext(root=tmp_path)
    )
    assert result.edits == (FileEdit("p/a.txt", None, "x", "shell"),)
