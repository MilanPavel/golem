"""``fs.list_dirs``: what the folder browser may see (ADR-040)."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.folders import MAX_ENTRIES, FolderError, list_dirs
from golem.server.dispatcher import INVALID_PARAMS


@pytest.fixture
def home(tmp_path: Path) -> Path:
    root = tmp_path / "home"
    root.mkdir()
    return root.resolve()


def _names(home: Path, path: Path | None = None) -> list[str]:
    return [entry.name for entry in list_dirs(path, home).entries]


def test_home_lists_its_folders_and_has_no_parent(home: Path) -> None:
    (home / "code").mkdir()
    (home / "notes").mkdir()
    result = list_dirs(None, home)
    assert result.path == str(home)
    assert result.home == str(home)
    assert result.parent is None
    assert [(e.name, e.path) for e in result.entries] == [
        ("code", str(home / "code")),
        ("notes", str(home / "notes")),
    ]
    assert result.truncated is False


def test_a_folder_below_home_has_a_parent(home: Path) -> None:
    (home / "code" / "golem").mkdir(parents=True)
    result = list_dirs(home / "code", home)
    assert result.parent == str(home)
    assert [e.name for e in result.entries] == ["golem"]
    assert list_dirs(home / "code" / "golem", home).parent == str(home / "code")


def test_files_are_not_listed(home: Path) -> None:
    (home / "folder").mkdir()
    (home / "notes.txt").write_text("secret plans")
    assert _names(home) == ["folder"]


def test_dot_folders_library_and_secret_folders_are_hidden(home: Path) -> None:
    for name in (".git", ".hidden", "Library", ".ssh", ".aws", ".golem", "visible"):
        (home / name).mkdir()
    (home / ".config" / "gh").mkdir(parents=True)
    (home / ".config" / "gcloud").mkdir(parents=True)
    assert _names(home) == ["visible"]


def test_secret_folders_cannot_be_entered_either(home: Path) -> None:
    (home / ".ssh" / "keys").mkdir(parents=True)
    (home / "Library" / "Application Support").mkdir(parents=True)
    (home / "code" / ".cache").mkdir(parents=True)
    for path in (home / ".ssh", home / ".ssh" / "keys", home / "Library", home / "code" / ".cache"):
        with pytest.raises(FolderError, match="outside your home folder"):
            list_dirs(path, home)
    assert _names(home, home / "code") == []


def test_a_symlink_out_of_home_is_skipped_and_one_inside_is_kept(
    home: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (home / "real").mkdir()
    (home / "escape").symlink_to(outside)
    (home / "alias").symlink_to(home / "real")
    result = list_dirs(None, home)
    assert [e.name for e in result.entries] == ["alias", "real"]
    assert {e.path for e in result.entries} == {str(home / "real")}


def test_a_symlink_into_a_secret_folder_is_skipped(home: Path) -> None:
    (home / ".ssh").mkdir()
    (home / "shortcut").symlink_to(home / ".ssh")
    assert _names(home) == []


def test_a_path_outside_home_or_escaping_it_is_refused(home: Path, tmp_path: Path) -> None:
    (tmp_path / "elsewhere").mkdir()
    (home / "escape").symlink_to(tmp_path / "elsewhere")
    for path in (
        tmp_path / "elsewhere",
        home / ".." / "elsewhere",
        home / "escape",
        home.parent,
        Path("/"),
    ):
        with pytest.raises(FolderError, match=r"That folder is outside your home folder\."):
            list_dirs(path, home)


def test_a_missing_folder_and_a_file_are_refused(home: Path) -> None:
    (home / "file.txt").write_text("x")
    with pytest.raises(FolderError, match=re.escape(f"There is no folder at {home / 'nowhere'}.")):
        list_dirs(home / "nowhere", home)
    with pytest.raises(FolderError, match="There is no folder at"):
        list_dirs(home / "file.txt", home)


def test_an_unreadable_child_is_skipped_and_an_unreadable_folder_fails(home: Path) -> None:
    (home / "open").mkdir()
    (home / "locked").mkdir()
    (home / "locked" / "inner").mkdir()
    (home / "open" / "child").mkdir()
    (home / "locked").chmod(0o000)
    try:
        if os.access(home / "locked", os.R_OK):
            pytest.skip("this user can read a folder with no permissions")
        assert _names(home) == ["open"]
        with pytest.raises(FolderError, match="golem can't read"):
            list_dirs(home / "locked", home)
    finally:
        (home / "locked").chmod(0o755)


def test_a_child_whose_check_fails_is_skipped(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (home / "good").mkdir()
    (home / "bad").mkdir()
    real = Path.resolve

    def resolve(self: Path, strict: bool = False) -> Path:
        if self.name == "bad" and self.parent == home:
            raise PermissionError("denied")
        return real(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", resolve)
    assert _names(home) == ["good"]


def test_the_sort_ignores_case(home: Path) -> None:
    for name in ("banana", "Apple", "cherry", "apple2"):
        (home / name).mkdir()
    assert _names(home) == ["Apple", "apple2", "banana", "cherry"]


def test_the_list_stops_at_the_cap_and_says_so(home: Path) -> None:
    for number in range(MAX_ENTRIES + 3):
        (home / f"d{number:04d}").mkdir()
    result = list_dirs(None, home)
    assert len(result.entries) == MAX_ENTRIES
    assert result.truncated is True
    assert result.entries[0].name == "d0000"
    assert result.entries[-1].name == f"d{MAX_ENTRIES - 1:04d}"


def test_exactly_the_cap_is_not_truncated(home: Path) -> None:
    for number in range(MAX_ENTRIES):
        (home / f"d{number:04d}").mkdir()
    result = list_dirs(None, home)
    assert len(result.entries) == MAX_ENTRIES
    assert result.truncated is False


def test_git_marks_a_folder_with_a_git_entry(home: Path) -> None:
    (home / "repo" / ".git").mkdir(parents=True)
    (home / "worktree").mkdir()
    (home / "worktree" / ".git").write_text("gitdir: ../repo/.git")
    (home / "plain").mkdir()
    flags = {e.name: e.git for e in list_dirs(None, home).entries}
    assert flags == {"plain": False, "repo": True, "worktree": True}


# The method


def _record(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


async def test_the_method_lists_home_and_refuses_what_it_should(
    short_home: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_home = (tmp_path / "me").resolve()
    (fake_home / "code").mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("fs.list_dirs", {}))
        assert listed["home"] == str(fake_home)
        assert listed["path"] == str(fake_home)
        assert [_record(e)["name"] for e in cast(list[object], listed["entries"])] == ["code"]
        inside = rpc_result(await client.call("fs.list_dirs", {"path": str(fake_home / "code")}))
        assert inside["parent"] == str(fake_home)
        for path in ("relative", str(tmp_path), str(fake_home / "nowhere")):
            refused = await client.call("fs.list_dirs", {"path": path})
            assert error_code(refused) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_session_folder_that_does_not_exist_is_refused(
    short_home: Path, tmp_path: Path
) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        missing = str(tmp_path / "nowhere")
        refused = await client.call("session.create", {"cwd": missing})
        assert error_code(refused) == INVALID_PARAMS
        assert _record(_record(refused)["error"])["message"] == f"There is no folder at {missing}."
        made = rpc_result(await client.call("session.create", {"cwd": str(tmp_path)}))
        assert cast(str, made["session_id"]).startswith("s_")
        for method in ("session.list", "config.get", "skill.list"):
            assert error_code(await client.call(method, {"cwd": missing})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
