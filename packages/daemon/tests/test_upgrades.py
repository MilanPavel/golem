"""Upgrades: an older golem.db keeps every session, with a copy taken first."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import cast

import pytest
from fakes import ScriptedChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.store.artifacts import ArtifactStore
from golem.store.checkpoints import installed_libraries, open_checkpoints, protect_checkpoints
from golem.store.database import Database, DatabaseTooNewError
from golem.store.events import EventLog
from golem.store.migrations import MIGRATIONS
from golem.store.records import RunRecords, SessionRecords

_PREVIOUS = Path(__file__).parent / "data" / "golem-schema-5.sql"
_LIBRARIES = {"langgraph": "1.2.0", "langgraph-checkpoint": "4.0.0"}


def _previous_release(path: Path) -> None:
    """``golem.db`` as the release at schema 5 left it."""
    with sqlite3.connect(path) as raw:
        raw.executescript(_PREVIOUS.read_text(encoding="utf-8"))
    os.chmod(path, 0o600)


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    with sqlite3.connect(path) as raw:
        return raw.execute(sql).fetchall()


def _user_version(path: Path) -> int:
    return int(cast(int, _rows(path, "PRAGMA user_version")[0][0]))


async def test_a_previous_release_database_keeps_every_session(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    _previous_release(path)
    before = _rows(path, "SELECT session_id, title, closed_at, cwd FROM sessions ORDER BY 1")
    counts = dict(
        cast(
            list[tuple[str, int]], _rows(path, "SELECT session_id, count(*) FROM events GROUP BY 1")
        )
    )
    assert _user_version(path) == 5 and len(before) == 3

    async with Database.open(path, golem_version="0.4.0") as database:
        assert await database.user_version() == len(MIGRATIONS)
        sessions = SessionRecords(database)
        events = EventLog(database)
        open_ids = {activity.session.session_id for activity in await sessions.recent(10)}
        for session_id, title, closed_at, cwd in before:
            assert isinstance(session_id, str)
            record = await sessions.get(session_id)
            assert record is not None
            assert (record.title, record.closed_at, record.cwd) == (title, closed_at, cwd)
            assert (session_id in open_ids) == (closed_at is None)
            replayed = await events.after(session_id)
            assert len(replayed) == counts[session_id]
            assert replayed[0].type == "session.created"
        run_ids = [str(row[0]) for row in _rows(path, "SELECT run_id FROM runs")]
        for run_id in run_ids:
            run = await RunRecords(database).get(run_id)
            assert run is not None and run.status == "completed"
        artifact = _rows(path, "SELECT artifact_id, session_id, size FROM artifacts")[0]
        page = await ArtifactStore(database).read(str(artifact[1]), str(artifact[0]), 0, 20)
        assert page is not None and page.size == artifact[2]

    assert _rows(path, "SELECT version, golem_version FROM schema_version") == [
        (version, "0.4.0") for version in range(6, len(MIGRATIONS) + 1)
    ]


async def test_the_old_file_is_copied_before_it_is_upgraded(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    _previous_release(path)
    original = _rows(path, "SELECT * FROM events ORDER BY session_id, seq")
    async with Database.open(path):
        pass
    backup = tmp_path / "golem.db.bak-5"
    assert _user_version(backup) == 5
    assert _rows(backup, "SELECT * FROM events ORDER BY session_id, seq") == original
    assert backup.stat().st_mode & 0o777 == 0o600
    assert not (tmp_path / "golem.db.bak-5.partial").exists()


async def test_a_new_or_current_file_is_not_copied(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    async with Database.open(path):
        pass
    async with Database.open(path):
        pass
    assert sorted(item.name for item in tmp_path.iterdir() if ".bak-" in item.name) == []


async def test_a_fresh_file_records_the_version_that_made_it(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    async with Database.open(path, golem_version="0.3.0"):
        pass
    # The history table arrives with schema 6, and each schema after it adds its row.
    assert _rows(path, "SELECT version, golem_version FROM schema_version") == [
        (version, "0.3.0") for version in range(6, len(MIGRATIONS) + 1)
    ]


async def test_a_newer_file_names_the_golem_it_needs_and_the_copy(tmp_path: Path) -> None:
    path = tmp_path / "golem.db"
    async with Database.open(path):
        pass
    newer = len(MIGRATIONS) + 1
    with sqlite3.connect(path) as raw:
        raw.execute(
            "INSERT INTO schema_version (version, golem_version, applied_at) VALUES (?, ?, ?)",
            (newer, "0.9.0", "2026-10-21T00:00:00+00:00"),
        )
        raw.execute(f"PRAGMA user_version = {newer}")
    (tmp_path / f"golem.db.bak-{len(MIGRATIONS)}").write_bytes(b"")

    with pytest.raises(DatabaseTooNewError) as caught:
        async with Database.open(path):
            pass
    error = caught.value
    assert (error.found, error.supported, error.needs) == (newer, len(MIGRATIONS), "0.9.0")
    message = str(error)
    assert "needs golem 0.9.0 or newer" in message
    assert f"golem.db.bak-{len(MIGRATIONS)}" in message
    assert _user_version(path) == newer


async def test_checkpoints_are_copied_when_langgraph_changes(
    database: Database, tmp_path: Path
) -> None:
    checkpoints = tmp_path / "checkpoints.db"
    async with open_checkpoints(database, checkpoints, _LIBRARIES):
        pass
    assert not list(tmp_path.glob("checkpoints.db.bak-*"))

    async with open_checkpoints(database, checkpoints, _LIBRARIES):
        pass
    assert not list(tmp_path.glob("checkpoints.db.bak-*"))

    upgraded = {**_LIBRARIES, "langgraph-checkpoint": "4.1.0"}
    backup = await protect_checkpoints(database, checkpoints, upgraded)
    assert backup is not None
    assert backup == tmp_path / "checkpoints.db.bak-1.2.0"
    assert {str(row[0]) for row in _rows(backup, "SELECT name FROM sqlite_master")} >= {
        "checkpoints",
        "writes",
    }
    assert await protect_checkpoints(database, checkpoints, upgraded) is None


async def test_checkpoints_from_before_the_record_are_copied_once(
    database: Database, tmp_path: Path
) -> None:
    checkpoints = tmp_path / "checkpoints.db"
    with sqlite3.connect(checkpoints) as raw:
        raw.execute("CREATE TABLE checkpoints (thread_id TEXT)")
    backup = await protect_checkpoints(database, checkpoints, installed_libraries())
    assert backup == tmp_path / "checkpoints.db.bak-unrecorded"
    assert await protect_checkpoints(database, checkpoints, installed_libraries()) is None


async def test_the_daemon_lists_every_open_session_after_an_upgrade(short_home: Path) -> None:
    _previous_release(short_home / "golem.db")
    expected = {
        str(row[0]): row[1]
        for row in _rows(
            short_home / "golem.db",
            "SELECT session_id, title FROM sessions WHERE closed_at IS NULL",
        )
    }
    model = ScriptedChatModel(replies=["Hi"])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("session.list", {}))
        sessions = cast(list[dict[str, object]], listed["sessions"])
        assert {str(item["session_id"]): item["title"] for item in sessions} == expected
    finally:
        await client.close()
        await stop_daemon(app, task)
    assert (short_home / "golem.db.bak-5").is_file()
    assert (short_home / "checkpoints.db").is_file()
