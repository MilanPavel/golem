"""``git.info`` and ``git.branches``: what git says about a folder."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.folders import FolderError
from golem.gitinfo import git_branches, git_info
from golem.server.dispatcher import INVALID_PARAMS


@pytest.fixture
def home(tmp_path: Path) -> Path:
    root = tmp_path / "home"
    root.mkdir()
    return root.resolve()


def run(folder: Path, *args: str, when: str = "2020-01-01T00:00:00") -> None:
    env = {
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
        "GIT_COMMITTER_DATE": when,
        "HOME": str(folder),
        "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
    }
    subprocess.run(["git", *args], cwd=folder, env=env, check=True, capture_output=True)


@pytest.fixture
def repo(home: Path) -> Path:
    folder = home / "repo"
    folder.mkdir()
    run(folder, "init", "-q", "-b", "main")
    (folder / "a.txt").write_text("a")
    run(folder, "add", ".")
    run(folder, "commit", "-q", "-m", "first")
    return folder


async def test_a_folder_that_is_not_a_repo(home: Path) -> None:
    (home / "plain").mkdir()
    info = await git_info(str(home / "plain"), home)
    assert (info.repository, info.root, info.branch, info.changed) == (False, None, None, 0)
    assert info.worktrees == [] and not info.detached
    assert (await git_branches(str(home / "plain"), home)).branches == []


async def test_a_clean_repo_on_main(home: Path, repo: Path) -> None:
    info = await git_info(str(repo), home)
    assert info.repository and info.root == str(repo)
    assert (info.branch, info.detached, info.changed) == ("main", False, 0)
    assert [(w.path, w.branch, w.main, w.agent) for w in info.worktrees] == [
        (str(repo), "main", True, False)
    ]


async def test_changed_files_count_tracked_and_untracked(home: Path, repo: Path) -> None:
    (repo / "a.txt").write_text("changed")
    (repo / "new.txt").write_text("new")
    assert (await git_info(str(repo), home)).changed == 2


async def test_a_detached_head_has_no_branch(home: Path, repo: Path) -> None:
    run(repo, "checkout", "-q", "--detach")
    info = await git_info(str(repo), home)
    assert (info.branch, info.detached) == (None, True)
    assert (await git_branches(str(repo), home)).current is None


async def test_worktrees_list_main_first_and_mark_agents(home: Path, repo: Path) -> None:
    other = home / "other"
    agent = repo / ".claude" / "worktrees" / "agent-x"
    run(repo, "worktree", "add", "-q", "-b", "side", str(other))
    run(repo, "worktree", "add", "-q", "-b", "agent-x", str(agent))
    info = await git_info(str(repo), home)
    assert [(w.path, w.branch, w.main, w.agent) for w in info.worktrees] == [
        (str(repo), "main", True, False),
        (str(other.resolve()), "side", False, False),
        (str(agent.resolve()), "agent-x", False, True),
    ]
    inside = await git_info(str(agent), home)
    assert inside.branch == "agent-x" and inside.worktrees[0].main


async def test_branches_come_newest_first(home: Path, repo: Path) -> None:
    run(repo, "branch", "old")
    run(repo, "checkout", "-q", "-b", "new")
    (repo / "b.txt").write_text("b")
    run(repo, "add", ".")
    run(repo, "commit", "-q", "-m", "later", when="2099-01-01T00:00:00")
    result = await git_branches(str(repo), home)
    assert result.current == "new"
    assert result.branches[0].name == "new"
    assert {b.name for b in result.branches} == {"main", "old", "new"}
    assert all(b.last_used for b in result.branches)


async def test_branches_stop_at_200(home: Path, repo: Path) -> None:
    for number in range(205):
        run(repo, "branch", f"b{number}")
    assert len((await git_branches(str(repo), home)).branches) == 200


@pytest.mark.parametrize("name", ["relative", "missing", "file", "outside"])
async def test_a_bad_path_is_an_error(home: Path, tmp_path: Path, name: str) -> None:
    (home / "file").write_text("x")
    paths = {
        "relative": "repo",
        "missing": str(home / "nowhere"),
        "file": str(home / "file"),
        "outside": str(tmp_path),
    }
    with pytest.raises(FolderError):
        await git_info(paths[name], home)
    with pytest.raises(FolderError):
        await git_branches(paths[name], home)


async def test_the_methods_answer_on_the_wire(
    short_home: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_home = (tmp_path / "me").resolve()
    folder = fake_home / "repo"
    folder.mkdir(parents=True)
    run(folder, "init", "-q", "-b", "main")
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        info = rpc_result(await client.call("git.info", {"path": str(folder)}))
        assert info["repository"] is True and info["branch"] == "main"
        branches = rpc_result(await client.call("git.branches", {"path": str(folder)}))
        assert branches["current"] == "main"
        refused = await client.call("git.info", {"path": str(tmp_path)})
        assert error_code(refused) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
