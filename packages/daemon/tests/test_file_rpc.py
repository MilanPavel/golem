"""file.read and file.list: the files of a session folder, and nothing outside it."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.coding.files import MAX_TEXT_CHARS
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND


@dataclass
class Setup:
    client: RpcClient
    folder: Path
    socket: Path
    session_id: str


@pytest.fixture
async def setup(short_home: Path) -> AsyncIterator[Setup]:
    folder = short_home / "work"
    folder.mkdir()
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        yield Setup(client, folder, app.paths.socket_path, str(created["session_id"]))
    finally:
        await client.close()
        await stop_daemon(app, task)


async def _read(setup: Setup, path: str) -> dict[str, object]:
    return await setup.client.call("file.read", {"session_id": setup.session_id, "path": path})


async def _list(setup: Setup, **extra: object) -> dict[str, object]:
    return await setup.client.call("file.list", {"session_id": setup.session_id, **extra})


async def test_a_file_is_read(setup: Setup) -> None:
    (setup.folder / "src").mkdir()
    (setup.folder / "src" / "a.txt").write_text("one\ntwo\n", "utf-8")
    result = rpc_result(await _read(setup, "src/a.txt"))
    assert result == {"path": "src/a.txt", "text": "one\ntwo\n", "truncated": False, "lines": 2}


async def test_a_path_through_dotdot_is_refused(setup: Setup) -> None:
    (setup.folder.parent / "secret.txt").write_text("nope", "utf-8")
    assert error_code(await _read(setup, "../secret.txt")) == INVALID_PARAMS


async def test_an_absolute_path_outside_is_refused(setup: Setup) -> None:
    other = setup.folder.parent / "secret.txt"
    other.write_text("nope", "utf-8")
    assert error_code(await _read(setup, str(other))) == INVALID_PARAMS


async def test_a_symlink_out_of_the_folder_is_refused(setup: Setup) -> None:
    other = setup.folder.parent / "secret.txt"
    other.write_text("nope", "utf-8")
    (setup.folder / "link.txt").symlink_to(other)
    assert error_code(await _read(setup, "link.txt")) == INVALID_PARAMS


async def test_a_folder_and_a_missing_file_are_refused(setup: Setup) -> None:
    (setup.folder / "d").mkdir()
    assert error_code(await _read(setup, "d")) == INVALID_PARAMS
    assert error_code(await _read(setup, "missing.txt")) == INVALID_PARAMS


async def test_a_binary_file_is_refused(setup: Setup) -> None:
    (setup.folder / "b.bin").write_bytes(b"ab\0cd")
    assert error_code(await _read(setup, "b.bin")) == INVALID_PARAMS


async def test_a_file_that_is_not_utf8_is_refused(setup: Setup) -> None:
    (setup.folder / "l.txt").write_bytes(b"caf\xe9")
    assert error_code(await _read(setup, "l.txt")) == INVALID_PARAMS


async def test_a_long_file_is_cut(setup: Setup) -> None:
    (setup.folder / "big.txt").write_text("x\n" * MAX_TEXT_CHARS, "utf-8")
    # The reply is one line of about 1.5 MB: read it with a roomier stream than the default.
    reader, writer = await asyncio.open_unix_connection(os.fspath(setup.socket), limit=4_000_000)
    wide = RpcClient(reader, writer)
    try:
        await wide.call("hello", HELLO)
        reply = await wide.call(
            "file.read", {"session_id": setup.session_id, "path": "big.txt"}, timeout=10
        )
    finally:
        await wide.close()
    result = rpc_result(reply)
    assert result["truncated"] is True
    assert len(cast("str", result["text"])) == MAX_TEXT_CHARS
    assert result["lines"] == MAX_TEXT_CHARS


async def test_an_unknown_session_is_refused(setup: Setup) -> None:
    reply = await setup.client.call("file.read", {"session_id": "s_nope", "path": "a"})
    assert error_code(reply) == SESSION_NOT_FOUND


async def test_a_session_without_a_folder_is_refused(setup: Setup) -> None:
    created = rpc_result(await setup.client.call("session.create", {}))
    reply = await setup.client.call("file.read", {"session_id": created["session_id"], "path": "a"})
    assert error_code(reply) == INVALID_PARAMS


async def test_the_list_is_shortest_first_then_alphabetical(setup: Setup) -> None:
    (setup.folder / "sub").mkdir()
    for name in ("b.py", "a.py", "sub/c.py", "readme.md"):
        (setup.folder / name).write_text("", "utf-8")
    result = rpc_result(await _list(setup))
    assert result == {"paths": ["a.py", "b.py", "sub/c.py", "readme.md"], "more": False}


async def test_the_list_matches_a_query_without_case(setup: Setup) -> None:
    (setup.folder / "ReadMe.md").write_text("", "utf-8")
    (setup.folder / "a.py").write_text("", "utf-8")
    result = rpc_result(await _list(setup, query="README"))
    assert result == {"paths": ["ReadMe.md"], "more": False}


async def test_the_list_stops_at_the_limit(setup: Setup) -> None:
    for index in range(5):
        (setup.folder / f"f{index}.txt").write_text("", "utf-8")
    result = rpc_result(await _list(setup, limit=2))
    assert result == {"paths": ["f0.txt", "f1.txt"], "more": True}


async def test_the_list_skips_folders_glob_skips(setup: Setup) -> None:
    for folder in ("node_modules", ".git", "src"):
        (setup.folder / folder).mkdir()
        (setup.folder / folder / "x.js").write_text("", "utf-8")
    result = rpc_result(await _list(setup))
    assert result["paths"] == ["src/x.js"]


def _dot_files(folder: Path) -> None:
    (folder / ".aws").mkdir()
    (folder / ".aws" / "config").write_text("", "utf-8")
    (folder / ".zshrc").write_text("", "utf-8")
    (folder / "src").mkdir()
    (folder / "src" / ".env").write_text("", "utf-8")
    (folder / "src" / "a.py").write_text("", "utf-8")


async def test_the_list_leaves_out_dot_files_and_dot_folders(setup: Setup) -> None:
    _dot_files(setup.folder)
    assert rpc_result(await _list(setup))["paths"] == ["src/a.py"]
    assert rpc_result(await _list(setup, hidden=False))["paths"] == ["src/a.py"]


async def test_the_list_holds_dot_files_when_hidden_is_on(setup: Setup) -> None:
    _dot_files(setup.folder)
    result = rpc_result(await _list(setup, hidden=True))
    assert result["paths"] == [".zshrc", "src/.env", "src/a.py", ".aws/config"]


async def test_a_query_names_a_dot_file_only_when_hidden_is_on(setup: Setup) -> None:
    _dot_files(setup.folder)
    assert rpc_result(await _list(setup, query=".zshrc"))["paths"] == []
    assert rpc_result(await _list(setup, query=".zshrc", hidden=True))["paths"] == [".zshrc"]
    assert rpc_result(await _list(setup, query="config"))["paths"] == []
    assert rpc_result(await _list(setup, query="config", hidden=True))["paths"] == [".aws/config"]


async def test_the_list_refuses_a_bad_limit(setup: Setup) -> None:
    assert error_code(await _list(setup, limit=0)) == INVALID_PARAMS
    assert error_code(await _list(setup, limit=201)) == INVALID_PARAMS
