"""A session hears when the branch of its folder changes (10.20.3)."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import cast

from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.graphs.notes import is_note
from golem.models.router import ModelRouter
from golem.sessions.branch import MAX_PATHS, BranchCache, branch_note, read_branch


def _git(folder: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=folder,
        check=True,
        capture_output=True,
    )


def _repo(folder: Path) -> Path:
    folder.mkdir()
    _git(folder, "init", "-q", "-b", "main")
    (folder / "a.py").write_text("one\n", encoding="utf-8")
    _git(folder, "add", ".")
    _git(folder, "commit", "-q", "-m", "first")
    return folder


def _branch_notes(history: list[BaseMessage]) -> list[str]:
    return [str(m.content) for m in history if is_note(m) and "branch of" in str(m.content)]


def _types(client: RpcClient) -> list[str]:
    return [cast(dict[str, object], e["params"])["type"] for e in client.events]  # type: ignore[misc]


async def _turn(client: RpcClient, session_id: str, text: str, count: int) -> None:
    await client.call("message.send", {"session_id": session_id, "text": text})
    for _ in range(500):
        await client.take_events()
        if _types(client).count("run.completed") >= count:
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


async def _summary_branch(client: RpcClient, session_id: str) -> object:
    listed = rpc_result(await client.call("session.list", {"limit": 10}))
    sessions = cast(list[dict[str, object]], listed["sessions"])
    found = [s for s in sessions if s["session_id"] == session_id]
    return found[0].get("branch")


async def test_the_summary_has_the_branch_in_a_repo_and_null_outside_one(
    short_home: Path, tmp_path: Path
) -> None:
    project = _repo(short_home / "project")
    # short_home is inside this checkout, so a folder there is in golem's own repo.
    plain = tmp_path / "plain"
    plain.mkdir()
    model = ToolCallingChatModel(replies=["ok"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        inside = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        outside = rpc_result(await client.call("session.create", {"cwd": str(plain)}))
        assert isinstance(inside, dict) and isinstance(outside, dict)
        assert await _summary_branch(client, str(inside["session_id"])) == "main"
        assert await _summary_branch(client, str(outside["session_id"])) is None
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_switch_between_turns_tells_the_model_once(short_home: Path) -> None:
    project = _repo(short_home / "project")
    model = ToolCallingChatModel(replies=["one", "two", "three"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        assert isinstance(created, dict)
        session_id = str(created["session_id"])
        await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
        await _turn(client, session_id, "first", 1)
        assert _branch_notes(model.seen[0]) == []
        assert "branch.changed" not in _types(client)

        _git(project, "switch", "-q", "-c", "fix-x")
        (project / "b.py").write_text("new\n", encoding="utf-8")
        (project / "a.py").write_text("two\n", encoding="utf-8")
        _git(project, "add", ".")
        _git(project, "commit", "-q", "-m", "second")
        await _turn(client, session_id, "second", 2)
        notes = _branch_notes(model.seen[1])
        assert len(notes) == 1
        assert (
            f"The branch of {project} changed from main to fix-x since your last turn." in notes[0]
        )
        assert "Read a file again before you edit it." in notes[0]
        assert "a.py" in notes[0] and "b.py" in notes[0]
        assert _types(client).count("branch.changed") == 1
        changed = [
            cast(dict[str, object], e["params"])["data"]
            for e in client.events
            if cast(dict[str, object], e["params"])["type"] == "branch.changed"
        ]
        assert changed == [{"from_branch": "main", "to_branch": "fix-x", "paths_count": 2}]
        assert await _summary_branch(client, session_id) == "fix-x"

        await _turn(client, session_id, "third", 3)
        assert _branch_notes(model.seen[2]) == notes
        assert _types(client).count("branch.changed") == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


def test_the_note_lists_fifty_paths_and_counts_the_rest() -> None:
    paths = [f"f{n:03d}.py" for n in range(MAX_PATHS + 7)]
    text = branch_note("/p", "main", "fix-x", paths)
    lines = text.splitlines()
    assert lines[-1] == "and 7 more"
    assert lines[-2] == f"f{MAX_PATHS - 1:03d}.py"
    assert "f050.py" not in text
    assert branch_note("/p", "main", "fix-x", ["a.py"]).endswith("Files that differ:\na.py")


async def test_a_burst_of_reads_asks_git_once_a_window(short_home: Path, tmp_path: Path) -> None:
    project = _repo(short_home / "project")
    now = [0.0]
    cache = BranchCache(clock=lambda: now[0])
    assert await cache.get(str(project)) == "main"
    _git(project, "switch", "-q", "-c", "other")
    assert await cache.get(str(project)) == "main"
    now[0] = 2.5
    assert await cache.get(str(project)) == "other"
    assert await read_branch(str(tmp_path)) is None
    assert await cache.get(None) is None
