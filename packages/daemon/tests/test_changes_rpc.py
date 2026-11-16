"""changes.list and changes.diff: what a session changed, and the diff of a file or a change."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.coding import plain_changes
from golem.coding.changes import ChangeStore
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND
from golem.tools import sandbox
from golem.tools.write import DIFF_CHARS


@dataclass
class Setup:
    client: RpcClient
    store: ChangeStore
    folder: Path
    session_id: str


async def _file_entries(client: RpcClient, session_id: str) -> list[dict[str, object]]:
    result = rpc_result(await client.call("changes.list", {"session_id": session_id}))
    return cast("list[dict[str, object]]", result["files"])


@pytest.fixture
async def setup(short_home: Path) -> AsyncIterator[Setup]:
    folder = short_home / "work"
    folder.mkdir()
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        store = app.state.changes
        assert store is not None
        yield Setup(client, store, folder, str(created["session_id"]))
    finally:
        await client.close()
        await stop_daemon(app, task)


async def _record(setup: Setup, path: str, before: str | None, after: str | None) -> str:
    change = await setup.store.record(
        session_id=setup.session_id,
        run_id="r_1",
        call_id=None,
        path=path,
        before=before,
        after=after,
        source="tool",
    )
    return change.change_id


async def test_the_list_counts_the_net_change_of_three_changes(setup: Setup) -> None:
    (setup.folder / "a.txt").write_text("one\nTWO\nthree\nfour\n", "utf-8")
    first = await _record(setup, "a.txt", "one\ntwo\n", "one\nTWO\n")
    second = await _record(setup, "a.txt", "one\nTWO\n", "one\nTWO\nthree\n")
    third = await _record(setup, "a.txt", "one\nTWO\nthree\n", "one\nTWO\nthree\nfour\n")

    files = await _file_entries(setup.client, setup.session_id)

    assert files == [
        {
            "path": "a.txt",
            "status": "modified",
            "added": 3,
            "removed": 1,
            "change_ids": [first, second, third],
            "stale": False,
        }
    ]


async def test_a_file_changed_on_disk_afterwards_is_stale(setup: Setup) -> None:
    (setup.folder / "a.txt").write_text("new\n", "utf-8")
    (setup.folder / "b.txt").write_text("new\n", "utf-8")
    (setup.folder / "c.bin").write_bytes(b"\xff\xfe")
    await _record(setup, "a.txt", None, "new\n")
    await _record(setup, "b.txt", None, "new\n")
    await _record(setup, "c.bin", None, "text\n")
    (setup.folder / "b.txt").write_text("someone else\n", "utf-8")

    files = await _file_entries(setup.client, setup.session_id)

    assert {str(file["path"]): file["stale"] for file in files} == {
        "a.txt": False,
        "b.txt": True,
        "c.bin": True,
    }


async def test_a_deleted_file_is_listed_and_a_file_that_came_back_is_stale(setup: Setup) -> None:
    await _record(setup, "gone.txt", "bye\n", None)
    await _record(setup, "back.txt", "bye\n", None)
    (setup.folder / "back.txt").write_text("again\n", "utf-8")

    files = await _file_entries(setup.client, setup.session_id)

    assert [(file["path"], file["status"], file["stale"]) for file in files] == [
        ("gone.txt", "deleted", False),
        ("back.txt", "deleted", True),
    ]
    assert files[0]["added"] == 0
    assert files[0]["removed"] == 1


async def test_a_file_that_ends_as_it_began_is_not_listed(setup: Setup) -> None:
    (setup.folder / "a.txt").write_text("one\n", "utf-8")
    await _record(setup, "a.txt", "one\n", "two\n")
    await _record(setup, "a.txt", "two\n", "one\n")

    assert await _file_entries(setup.client, setup.session_id) == []


async def test_a_session_without_a_folder_has_no_files(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = str(created["session_id"])
        store = app.state.changes
        assert store is not None
        await store.record(
            session_id=session_id,
            run_id=None,
            call_id=None,
            path="a.txt",
            before=None,
            after="x\n",
            source="tool",
        )

        assert await _file_entries(client, session_id) == []
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_an_unknown_session_is_refused(setup: Setup) -> None:
    listed = await setup.client.call("changes.list", {"session_id": "s_nope"})
    diffed = await setup.client.call("changes.diff", {"session_id": "s_nope", "path": "a.txt"})

    assert error_code(listed) == SESSION_NOT_FOUND
    assert error_code(diffed) == SESSION_NOT_FOUND


async def test_the_diff_of_a_path_is_its_net_change(setup: Setup) -> None:
    await _record(setup, "a.txt", "one\n", "two\n")
    await _record(setup, "a.txt", "two\n", "three\n")

    result = rpc_result(
        await setup.client.call("changes.diff", {"session_id": setup.session_id, "path": "a.txt"})
    )

    assert result["truncated"] is False
    diff = str(result["diff"])
    assert "-one\n+three\n" in diff
    assert "two" not in diff


async def test_the_diff_of_a_change_is_that_change_only(setup: Setup) -> None:
    first = await _record(setup, "a.txt", "one\n", "two\n")
    await _record(setup, "a.txt", "two\n", "three\n")

    result = rpc_result(
        await setup.client.call(
            "changes.diff", {"session_id": setup.session_id, "change_id": first}
        )
    )

    assert "-one\n+two\n" in str(result["diff"])
    assert "three" not in str(result["diff"])


async def test_a_long_diff_is_cut_and_says_so(setup: Setup) -> None:
    await _record(setup, "big.txt", None, "x" * (DIFF_CHARS + 10) + "\n")

    result = rpc_result(
        await setup.client.call("changes.diff", {"session_id": setup.session_id, "path": "big.txt"})
    )

    assert result["truncated"] is True
    assert len(str(result["diff"])) == DIFF_CHARS


async def test_the_diff_needs_exactly_one_of_path_and_change_id(setup: Setup) -> None:
    change_id = await _record(setup, "a.txt", None, "x\n")
    base = {"session_id": setup.session_id}

    both = await setup.client.call(
        "changes.diff", {**base, "path": "a.txt", "change_id": change_id}
    )
    neither = await setup.client.call("changes.diff", base)

    assert error_code(both) == INVALID_PARAMS
    assert error_code(neither) == INVALID_PARAMS


async def test_an_unknown_path_or_another_sessions_change_is_refused(setup: Setup) -> None:
    other = rpc_result(await setup.client.call("session.create", {"cwd": str(setup.folder)}))
    await setup.store.record(
        session_id=str(other["session_id"]),
        run_id=None,
        call_id=None,
        path="a.txt",
        before=None,
        after="x\n",
        source="tool",
    )
    foreign = (await setup.store.list(str(other["session_id"])))[0].change_id
    base = {"session_id": setup.session_id}

    unknown = await setup.client.call("changes.diff", {**base, "path": "a.txt"})
    not_ours = await setup.client.call("changes.diff", {**base, "change_id": foreign})

    assert error_code(unknown) == INVALID_PARAMS
    assert error_code(not_ours) == INVALID_PARAMS


def _no_git(root: Path) -> list[Path]:
    return []


async def _shell_of(setup: Setup) -> object:
    result = rpc_result(await setup.client.call("changes.list", {"session_id": setup.session_id}))
    return result["shell"]


async def test_list_says_files_for_a_folder_without_a_repository(
    setup: Setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sandbox, "git_dirs", _no_git)
    assert await _shell_of(setup) == "files"


async def test_list_says_off_for_a_folder_too_big_to_watch(
    setup: Setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(plain_changes, "MAX_FILES", 1)
    monkeypatch.setattr(sandbox, "git_dirs", _no_git)
    (setup.folder / "a").write_text("a", "utf-8")
    (setup.folder / "b").write_text("b", "utf-8")
    assert await _shell_of(setup) == "off"


async def test_list_says_git_for_a_repository(
    setup: Setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    (setup.folder / ".git").mkdir()
    monkeypatch.setattr(sandbox, "available", lambda: True)
    assert await _shell_of(setup) == "git"
