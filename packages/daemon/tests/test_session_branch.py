"""session.create with a branch: the folder is switched before the session starts."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import BRANCH_SWITCH_FAILED, NOT_A_REPO


def _git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", *args], cwd=folder, capture_output=True, text=True, check=True, timeout=30
    )
    return done.stdout.strip()


def _make_repo(folder: Path) -> None:
    _git(folder, "init", "-q", "-b", "main")
    _git(folder, "config", "user.name", "Test")
    _git(folder, "config", "user.email", "test@example.com")
    _git(folder, "config", "commit.gpgsign", "false")
    (folder / "a.txt").write_text("one\n", "utf-8")
    (folder / "b.txt").write_text("one\n", "utf-8")
    _git(folder, "add", ".")
    _git(folder, "commit", "-q", "-m", "add the files")
    _git(folder, "branch", "side")
    _git(folder, "switch", "-q", "side")
    (folder / "a.txt").write_text("side\n", "utf-8")
    _git(folder, "commit", "-q", "-am", "side change")
    _git(folder, "switch", "-q", "main")


@pytest.fixture(autouse=True)
def _own_git_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "/dev/null")
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", "/dev/null")


async def _create(
    short_home: Path, folder: Path, **params: object
) -> tuple[dict[str, Any], list[str]]:
    app, task = await start_daemon(short_home)
    try:
        client = await RpcClient.connect(app.paths.socket_path)
        await client.call("hello", HELLO)
        reply = await client.call("session.create", {"cwd": str(folder), **params})
        listed = rpc_result(await client.call("session.list", {"limit": 10}))
        sessions: Any = listed["sessions"]
        ids = [str(s["session_id"]) for s in sessions]
        await client.close()
        return dict(reply), ids
    finally:
        await stop_daemon(app, task)


@pytest.fixture
def repo(short_home: Path) -> Path:
    folder = short_home / "work"
    folder.mkdir()
    _make_repo(folder)
    return folder


async def test_it_switches_to_an_existing_branch(short_home: Path, repo: Path) -> None:
    reply, ids = await _create(short_home, repo, branch="side")
    assert "session_id" in rpc_result(reply)
    assert _git(repo, "branch", "--show-current") == "side"
    assert len(ids) == 1


async def test_it_creates_a_new_branch(short_home: Path, repo: Path) -> None:
    reply, _ = await _create(short_home, repo, branch="fresh", create_branch=True)
    assert "session_id" in rpc_result(reply)
    assert _git(repo, "branch", "--show-current") == "fresh"


async def test_being_on_the_branch_already_is_fine(short_home: Path, repo: Path) -> None:
    reply, _ = await _create(short_home, repo, branch="main")
    assert "session_id" in rpc_result(reply)
    assert _git(repo, "branch", "--show-current") == "main"


async def test_an_unrelated_uncommitted_change_comes_along(short_home: Path, repo: Path) -> None:
    (repo / "b.txt").write_text("edited\n", "utf-8")
    reply, _ = await _create(short_home, repo, branch="side")
    assert "session_id" in rpc_result(reply)
    assert _git(repo, "branch", "--show-current") == "side"
    assert (repo / "b.txt").read_text("utf-8") == "edited\n"


async def test_a_conflicting_change_is_refused_with_gits_message(
    short_home: Path, repo: Path
) -> None:
    (repo / "a.txt").write_text("mine\n", "utf-8")
    reply, ids = await _create(short_home, repo, branch="side")
    error = reply["error"]
    assert error["code"] == BRANCH_SWITCH_FAILED
    assert error["data"] == {"reason": "branch_switch_failed"}
    assert "a.txt" in error["message"]
    assert ids == []
    assert _git(repo, "branch", "--show-current") == "main"
    assert (repo / "a.txt").read_text("utf-8") == "mine\n"


async def test_a_missing_branch_is_refused_without_create_branch(
    short_home: Path, repo: Path
) -> None:
    reply, ids = await _create(short_home, repo, branch="nope")
    assert reply["error"]["code"] == BRANCH_SWITCH_FAILED
    assert "nope" in reply["error"]["message"]
    assert ids == []
    assert _git(repo, "branch", "--show-current") == "main"


async def test_a_folder_that_is_not_a_repo_is_refused(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = short_home / "plain"
    folder.mkdir()
    # The temp folder may sit inside a checkout, as on CI: git must not find that repo above it.
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(short_home))
    reply, ids = await _create(short_home, folder, branch="side")
    assert reply["error"]["code"] == NOT_A_REPO
    assert reply["error"]["data"] == {"reason": "not_a_repo"}
    assert ids == []


async def test_without_a_branch_nothing_changes(short_home: Path, repo: Path) -> None:
    reply, _ = await _create(short_home, repo)
    assert "session_id" in rpc_result(reply)
    assert _git(repo, "branch", "--show-current") == "main"
