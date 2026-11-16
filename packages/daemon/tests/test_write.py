"""write_file and edit_file: planning a change, applying it, and where they may write."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from golem.tools import default_registry
from golem.tools.registry import ToolContext, ToolError, ToolResult
from golem.tools.write import (
    EditFileArgs,
    WriteFileArgs,
    commit,
    diff_counts,
    plan_edit,
    plan_write,
    unified_diff,
)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("x = 1\ny = 2\nx = 1\n", encoding="utf-8")
    return root


async def _call(root: Path, name: str, **args: object) -> ToolResult:
    return await default_registry().call(name, args, ToolContext(root=root))


async def test_edit_file_replaces_a_unique_match_and_reports_the_diff(project: Path) -> None:
    result = await _call(
        project, "edit_file", path="src/a.py", old_string="y = 2", new_string="y = 3"
    )
    assert (project / "src" / "a.py").read_text(encoding="utf-8") == "x = 1\ny = 3\nx = 1\n"
    assert result.summary == "+1 -1 src/a.py"
    assert result.output == "edited src/a.py (+1 -1)"
    assert result.diff is not None
    assert result.diff.splitlines()[:2] == ["--- a/src/a.py", "+++ b/src/a.py"]
    assert "-y = 2" in result.diff.splitlines()
    assert "+y = 3" in result.diff.splitlines()


@pytest.mark.parametrize(
    ("old", "new", "replace_all", "error"),
    [
        ("x = 1", "x = 9", False, "2 times; add context"),
        ("z = 0", "z = 1", False, "not in src/a.py"),
        ("y = 2", "y = 2", False, "the same"),
    ],
)
def test_edit_file_explains_what_it_cannot_do(
    project: Path, old: str, new: str, replace_all: bool, error: str
) -> None:
    args = EditFileArgs(path="src/a.py", old_string=old, new_string=new, replace_all=replace_all)
    with pytest.raises(ToolError, match=error):
        plan_edit(project, args)


def test_replace_all_changes_every_match(project: Path) -> None:
    args = EditFileArgs(path="src/a.py", old_string="x = 1", new_string="x = 9", replace_all=True)
    change = plan_edit(project, args)
    assert change.after == "x = 9\ny = 2\nx = 9\n"
    assert diff_counts(unified_diff(change)) == (2, 2)


def test_edit_file_needs_an_existing_text_file(project: Path) -> None:
    with pytest.raises(ToolError, match="does not exist; use write_file"):
        plan_edit(project, EditFileArgs(path="nope.py", old_string="a", new_string="b"))
    (project / "blob.bin").write_bytes(b"\x00\x01")
    with pytest.raises(ToolError, match="binary"):
        plan_edit(project, EditFileArgs(path="blob.bin", old_string="a", new_string="b"))


async def test_write_file_creates_folders_inside_the_project(project: Path) -> None:
    result = await _call(project, "write_file", path="docs/new/notes.md", content="hi\n")
    assert (project / "docs" / "new" / "notes.md").read_text(encoding="utf-8") == "hi\n"
    assert result.summary == "new file +1 -0 docs/new/notes.md"
    assert result.output == "created docs/new/notes.md (+1 -0)"
    assert result.diff is not None
    assert result.diff.startswith("--- /dev/null\n+++ b/docs/new/notes.md\n")


def test_planning_writes_nothing(project: Path) -> None:
    plan_write(project, WriteFileArgs(path="later.txt", content="x"))
    plan_edit(project, EditFileArgs(path="src/a.py", old_string="y = 2", new_string="y = 3"))
    assert not (project / "later.txt").exists()
    assert (project / "src" / "a.py").read_text(encoding="utf-8") == "x = 1\ny = 2\nx = 1\n"


@pytest.mark.parametrize(
    ("path", "error"),
    [
        ("/etc/hosts", "outside the project folder"),
        ("../outside.txt", "outside the project folder"),
        (".golem/policy.toml", r"inside a \.golem/ folder"),
        ("sub/.git/config", r"inside a \.git/ folder"),
        (".", "is the project folder"),
        ("src", "is a folder"),
    ],
)
def test_write_file_refuses_paths_it_must_not_touch(project: Path, path: str, error: str) -> None:
    with pytest.raises(ToolError, match=error):
        plan_write(project, WriteFileArgs(path=path, content="x"))


def test_a_symlinked_folder_out_of_the_project_is_refused(project: Path, tmp_path: Path) -> None:
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (project / "out").symlink_to(elsewhere)
    with pytest.raises(ToolError, match="outside"):
        plan_write(project, WriteFileArgs(path="out/x.txt", content="x"))


async def test_the_file_mode_and_line_endings_are_kept(project: Path) -> None:
    script = project / "run.sh"
    script.write_bytes(b"#!/bin/sh\r\necho one\r\n")
    script.chmod(0o755)
    await _call(project, "edit_file", path="run.sh", old_string="one", new_string="two")
    assert script.read_bytes() == b"#!/bin/sh\r\necho two\r\n"
    assert stat.S_IMODE(script.stat().st_mode) == 0o755
    assert sorted(p.name for p in project.iterdir()) == ["run.sh", "src"]


@pytest.mark.parametrize("path", [".GIT/hooks/pre-commit", ".Golem/policy.toml"])
def test_protected_folders_match_without_case(project: Path, path: str) -> None:
    with pytest.raises(ToolError, match="which golem does not change"):
        plan_write(project, WriteFileArgs(path=path, content="x"))


@pytest.mark.parametrize("path", ["a\0b", "~nobody-golem-test/x"])
def test_an_unusable_path_is_a_tool_error(project: Path, path: str) -> None:
    with pytest.raises(ToolError):
        plan_write(project, WriteFileArgs(path=path, content="x"))


def test_counts_and_lines_follow_the_diff_not_its_text(project: Path) -> None:
    (project / "q.sql").write_text("-- note\nselect 1;\n\x0cpage\n", encoding="utf-8")
    change = plan_edit(project, EditFileArgs(path="q.sql", old_string="-- note\n", new_string=""))
    diff = unified_diff(change)
    assert diff_counts(diff) == (0, 1)
    assert "No newline" not in diff


async def test_a_new_file_gets_the_umask_mode_and_an_unchanged_write_does_nothing(
    project: Path,
) -> None:
    await _call(project, "write_file", path="new.txt", content="x\n")
    assert stat.S_IMODE((project / "new.txt").stat().st_mode) != 0o600
    before = (project / "src" / "a.py").stat().st_mtime_ns
    result = await _call(project, "write_file", path="src/a.py", content="x = 1\ny = 2\nx = 1\n")
    assert result.summary == "unchanged"
    assert (project / "src" / "a.py").stat().st_mtime_ns == before


def test_a_crlf_file_says_why_old_string_is_missing(project: Path) -> None:
    (project / "w.txt").write_bytes(b"one\r\ntwo\r\n")
    with pytest.raises(ToolError, match="CRLF"):
        plan_edit(project, EditFileArgs(path="w.txt", old_string="one\nthree", new_string="x"))


def test_a_missing_final_newline_is_marked(project: Path) -> None:
    change = plan_write(project, WriteFileArgs(path="src/a.py", content="x = 1"))
    assert unified_diff(change).endswith("+x = 1\n\\ No newline at end of file\n")


def test_a_cut_diff_still_tells_two_changes_apart(project: Path) -> None:
    from golem.tools.write import DIFF_CHARS, shown_diff

    one = plan_write(project, WriteFileArgs(path="big.txt", content="a\n" * DIFF_CHARS + "end 1\n"))
    two = plan_write(project, WriteFileArgs(path="big.txt", content="a\n" * DIFF_CHARS + "end 2\n"))
    assert shown_diff(one)[:DIFF_CHARS] == shown_diff(two)[:DIFF_CHARS]
    assert shown_diff(one) != shown_diff(two)
    assert "sha256" in shown_diff(one)


def _method_file(project: Path) -> None:
    text = (
        "class A:\n    def go(self):\n        return 1\n\n    def stop(self):\n        return 2\n"
    )
    (project / "m.py").write_text(text, encoding="utf-8")


def test_an_edit_with_the_wrong_base_indentation_applies_with_the_files_indentation(
    project: Path,
) -> None:
    _method_file(project)
    args = EditFileArgs(
        path="m.py",
        old_string="def go(self):\n    return 1\n",
        new_string="def go(self):\n    return 10\n",
    )
    change = plan_edit(project, args)
    assert change.rung == "indent"
    assert change.after.startswith("class A:\n    def go(self):\n        return 10\n")
    assert commit(change).output.endswith(
        "; note: old_string matched after adjusting the indentation; check the result"
    )


def test_an_edit_missing_trailing_spaces_applies(project: Path) -> None:
    (project / "t.txt").write_text("one  \ntwo\n", encoding="utf-8")
    change = plan_edit(
        project, EditFileArgs(path="t.txt", old_string="one\ntwo", new_string="1\n2")
    )
    assert change.rung == "trailing_space"
    assert change.after == "1\n2\n"
    assert commit(change).output == (
        "edited t.txt (+2 -2); note: old_string matched after ignoring trailing spaces"
    )


def test_an_exact_edit_has_no_note(project: Path) -> None:
    result = commit(
        plan_edit(project, EditFileArgs(path="src/a.py", old_string="y = 2", new_string="y = 3"))
    )
    assert "note" not in result.output


def test_an_ambiguous_fuzzy_edit_errors_and_writes_nothing(project: Path) -> None:
    (project / "t.txt").write_text("a = 1  \nb\na = 1 \n", encoding="utf-8")
    args = EditFileArgs(path="t.txt", old_string="a = 1", new_string="a = 2")
    (project / "t.txt").write_text("key  \nval\nkey  \nval\n", encoding="utf-8")
    args = EditFileArgs(path="t.txt", old_string="key\nval", new_string="x")
    with pytest.raises(ToolError, match="places match when spacing is ignored"):
        plan_edit(project, args)
    (project / "u.txt").write_text("k\n  v\nk\n  v\n", encoding="utf-8")
    assert (project / "t.txt").read_text(encoding="utf-8") == "key  \nval\nkey  \nval\n"


def test_replace_all_does_not_apply_to_fuzzy_matches(project: Path) -> None:
    (project / "t.txt").write_text("key  \nval\nkey  \nval\n", encoding="utf-8")
    args = EditFileArgs(path="t.txt", old_string="key\nval", new_string="x", replace_all=True)
    with pytest.raises(ToolError, match="2 places match"):
        plan_edit(project, args)


def test_a_miss_quotes_the_nearest_lines_with_their_numbers(project: Path) -> None:
    (project / "f.py").write_text(
        "import os\n\ndef fetch(url):\n    return get(url)\n\ndef other():\n    pass\n",
        encoding="utf-8",
    )
    args = EditFileArgs(
        path="f.py", old_string="def fetch(uri):\n    return get(uri)", new_string="x"
    )
    with pytest.raises(ToolError) as caught:
        plan_edit(project, args)
    message = str(caught.value)
    assert "old_string is not in f.py. The closest text is lines 3-4:" in message
    assert "def fetch(url):\n    return get(url)\n" in message
    assert message.endswith("Copy the text from the file exactly, or read the file again.")


def test_a_far_miss_keeps_the_plain_hint(project: Path) -> None:
    args = EditFileArgs(path="src/a.py", old_string="zzzzzzzz\nqqqqqqqq", new_string="x")
    with pytest.raises(ToolError, match="read the file and copy it exactly"):
        plan_edit(project, args)


def test_write_and_edit_refuse_credential_folders(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from golem.tools.paths import writable
    from golem.tools.write import EditFileArgs, WriteFileArgs, plan_edit, plan_write

    home = tmp_path.resolve()
    (home / ".aws").mkdir()
    (home / ".aws" / "config").write_text("x\n")
    for name in (".aws/config", ".aws/new", ".netrc"):
        with pytest.raises(ToolError, match="holds credentials"):
            writable(home, name, home)
    assert writable(home, "notes.txt", home) == home / "notes.txt"
    monkeypatch.setenv("HOME", str(home))
    with pytest.raises(ToolError, match="holds credentials"):
        plan_write(home, WriteFileArgs(path=".aws/config", content="y"))
    with pytest.raises(ToolError, match="holds credentials"):
        plan_edit(home, EditFileArgs(path=".aws/config", old_string="x", new_string="y"))
