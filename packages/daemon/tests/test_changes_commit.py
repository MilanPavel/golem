"""changes.commit, changes.commit_info and changes.suggest_message, on a throwaway repository."""

from __future__ import annotations

import asyncio
import json
import subprocess
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.coding.changes import ChangeStore
from golem.models.router import ModelRouter
from golem.server.app import DaemonApp
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, SESSION_BUSY


@dataclass
class Setup:
    client: RpcClient
    store: ChangeStore
    folder: Path
    session_id: str


def _git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", *args], cwd=folder, capture_output=True, text=True, check=True, timeout=30
    )
    return done.stdout


def _make_repo(folder: Path) -> None:
    _git(folder, "init", "-q")
    _git(folder, "config", "user.name", "Test")
    _git(folder, "config", "user.email", "test@example.com")
    _git(folder, "config", "commit.gpgsign", "false")
    for name in ("a.txt", "b.txt", "c.txt"):
        (folder / name).write_text("one\n", "utf-8")
    _git(folder, "add", ".")
    _git(folder, "commit", "-q", "-m", "add the files")


@pytest.fixture(autouse=True)
def _own_git_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """The user's own git settings and hooks must not reach these repositories."""
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "/dev/null")
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", "/dev/null")


async def _serve(
    short_home: Path, *, repo: bool = True, model: BaseChatModel | None = None
) -> tuple[Setup, tuple[DaemonApp, asyncio.Task[None]]]:
    folder = short_home / "work"
    folder.mkdir()
    if repo:
        _make_repo(folder)
    router = None if model is None else ModelRouter(model=model)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
    store = app.state.changes
    assert store is not None
    return Setup(client, store, folder, str(created["session_id"])), (app, task)


@pytest.fixture
async def setup(short_home: Path) -> AsyncIterator[Setup]:
    ready, (app, task) = await _serve(short_home)
    try:
        yield ready
    finally:
        await ready.client.close()
        await stop_daemon(app, task)


async def _commit(
    setup: Setup, paths: list[str], message: str = "change things"
) -> dict[str, object]:
    return rpc_result(
        await setup.client.call(
            "changes.commit",
            {"session_id": setup.session_id, "paths": paths, "message": message},
        )
    )


def _status(folder: Path) -> list[str]:
    return sorted(_git(folder, "status", "--porcelain").splitlines())


async def test_two_of_three_changed_files_are_committed(setup: Setup) -> None:
    for name in ("a.txt", "b.txt", "c.txt"):
        (setup.folder / name).write_text("two\n", "utf-8")

    result = await _commit(setup, ["a.txt", "b.txt"], "change two files")

    assert result["ok"] is True
    assert result["sha"] == _git(setup.folder, "rev-parse", "--short", "HEAD").strip()
    assert _git(setup.folder, "log", "-1", "--format=%s").strip() == "change two files"
    assert _status(setup.folder) == [" M c.txt"]


async def test_a_new_file_is_added_and_committed(setup: Setup) -> None:
    (setup.folder / "new.txt").write_text("hello\n", "utf-8")

    result = await _commit(setup, ["new.txt"])

    assert result["ok"] is True
    assert "new.txt" in _git(setup.folder, "ls-files")
    assert _status(setup.folder) == []


async def test_a_path_outside_the_folder_is_refused(setup: Setup, short_home: Path) -> None:
    (short_home / "outside.txt").write_text("x\n", "utf-8")

    for path in ("../outside.txt", str(short_home / "outside.txt")):
        reply = await setup.client.call(
            "changes.commit",
            {"session_id": setup.session_id, "paths": [path], "message": "no"},
        )
        assert error_code(reply) == INVALID_PARAMS
    assert _git(setup.folder, "rev-list", "--count", "HEAD").strip() == "1"


async def test_a_failing_hook_is_a_result_with_its_output(setup: Setup) -> None:
    hook = setup.folder / ".git" / "hooks" / "pre-commit"
    hook.write_text("#!/bin/sh\necho 'hook says no'\nexit 1\n", "utf-8")
    hook.chmod(0o755)
    (setup.folder / "a.txt").write_text("two\n", "utf-8")

    result = await _commit(setup, ["a.txt"])

    assert result["ok"] is False
    assert result["sha"] is None
    assert "hook says no" in str(result["output"])
    assert _git(setup.folder, "rev-list", "--count", "HEAD").strip() == "1"


async def test_a_folder_that_is_not_a_repository_gives_ok_false(short_home: Path) -> None:
    ready, (app, task) = await _serve(short_home, repo=False)
    try:
        (ready.folder / "a.txt").write_text("x\n", "utf-8")

        result = await _commit(ready, ["a.txt"])
        info = rpc_result(
            await ready.client.call("changes.commit_info", {"session_id": ready.session_id})
        )

        assert result["ok"] is False
        assert "not a git repository" in str(result["output"])
        assert info == {"repository": False, "branch": None, "paths": []}
    finally:
        await ready.client.close()
        await stop_daemon(app, task)


async def test_commit_info_lists_only_changed_paths_of_the_change_set(setup: Setup) -> None:
    for name in ("a.txt", "b.txt", "c.txt"):
        await setup.store.record(
            session_id=setup.session_id,
            run_id="r_1",
            call_id=None,
            path=name,
            before="one\n",
            after="two\n",
            source="tool",
        )
    (setup.folder / "b.txt").write_text("two\n", "utf-8")
    (setup.folder / "other.txt").write_text("not golem's\n", "utf-8")

    info = rpc_result(
        await setup.client.call("changes.commit_info", {"session_id": setup.session_id})
    )

    assert info["repository"] is True
    assert isinstance(info["branch"], str)
    assert info["paths"] == ["b.txt"]


async def test_the_session_folder_may_be_inside_the_repository(short_home: Path) -> None:
    ready, (app, task) = await _serve(short_home)
    try:
        sub = ready.folder / "sub"
        sub.mkdir()
        (sub / "x.txt").write_text("one\n", "utf-8")
        _git(ready.folder, "add", ".")
        _git(ready.folder, "commit", "-q", "-m", "sub")
        created = rpc_result(await ready.client.call("session.create", {"cwd": str(sub)}))
        session_id = str(created["session_id"])
        await ready.store.record(
            session_id=session_id,
            run_id="r_1",
            call_id=None,
            path="x.txt",
            before="one\n",
            after="two\n",
            source="tool",
        )
        (sub / "x.txt").write_text("two\n", "utf-8")

        info = rpc_result(
            await ready.client.call("changes.commit_info", {"session_id": session_id})
        )
        done = rpc_result(
            await ready.client.call(
                "changes.commit",
                {"session_id": session_id, "paths": ["x.txt"], "message": "in sub"},
            )
        )

        assert info["paths"] == ["x.txt"]
        assert done["ok"] is True
    finally:
        await ready.client.close()
        await stop_daemon(app, task)


async def test_a_commit_is_refused_while_a_run_is_active(short_home: Path) -> None:
    model = GatedChatModel()
    ready, (app, task) = await _serve(short_home, model=model)
    try:
        (ready.folder / "a.txt").write_text("two\n", "utf-8")
        sent = await ready.client.call(
            "message.send", {"session_id": ready.session_id, "text": "hi"}
        )
        rpc_result(sent)
        await model.started.wait()

        reply = await ready.client.call(
            "changes.commit",
            {"session_id": ready.session_id, "paths": ["a.txt"], "message": "no"},
        )

        assert error_code(reply) == SESSION_BUSY
        assert _git(ready.folder, "rev-list", "--count", "HEAD").strip() == "1"
    finally:
        await ready.client.close()
        await stop_daemon(app, task)


async def test_a_suggested_message_is_the_models_and_sees_the_recent_subjects(
    short_home: Path,
) -> None:
    reply = json.dumps({"subject": "Update a.txt", "body": "It says two now."})
    model = ScriptedChatModel(replies=[reply])
    ready, (app, task) = await _serve(short_home, model=model)
    try:
        (ready.folder / "a.txt").write_text("two\n", "utf-8")

        result = rpc_result(
            await ready.client.call(
                "changes.suggest_message", {"session_id": ready.session_id, "paths": ["a.txt"]}
            )
        )

        assert result == {"message": "Update a.txt\n\nIt says two now."}
        prompt = "\n".join(model.seen[0])
        assert "add the files" in prompt
        assert "+two" in prompt
    finally:
        await ready.client.close()
        await stop_daemon(app, task)


async def test_a_failing_model_gives_an_error_and_no_message(short_home: Path) -> None:
    model = ScriptedChatModel(replies=[])
    ready, (app, task) = await _serve(short_home, model=model)
    try:
        (ready.folder / "a.txt").write_text("two\n", "utf-8")

        reply = await ready.client.call(
            "changes.suggest_message", {"session_id": ready.session_id, "paths": ["a.txt"]}
        )

        assert error_code(reply) == INTERNAL_ERROR
    finally:
        await ready.client.close()
        await stop_daemon(app, task)
