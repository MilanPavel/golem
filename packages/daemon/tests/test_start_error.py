import os
import sqlite3
from pathlib import Path

from support import ServeProcess

from golem import __version__
from golem.lock import DaemonAlreadyRunning
from golem.paths import resolve_paths
from golem.server.start_error import (
    clear_start_error,
    describe_database_too_new,
    describe_lock_held,
    describe_socket_path_too_long,
    start_error_file,
    write_start_error,
)
from golem.store.database import Database, DatabaseTooNewError
from golem.store.migrations import MIGRATIONS


def test_the_file_holds_the_reason_then_the_next_step(tmp_path: Path) -> None:
    paths = resolve_paths(tmp_path)
    write_start_error(paths, "the reason\nsplit", "the  next step")
    path = start_error_file(paths)
    assert path.read_text(encoding="utf-8") == "the reason split\nthe next step\n"
    assert path.stat().st_mode & 0o777 == 0o600
    assert [entry.name for entry in path.parent.iterdir()] == ["last-error"]
    clear_start_error(paths)
    assert not path.exists()
    clear_start_error(paths)


def test_a_newer_database_names_both_versions() -> None:
    error = DatabaseTooNewError(9, 8, needs="0.9.0")
    assert describe_database_too_new(error) == (
        f"your data is from golem 0.9.0, this is {__version__}",
        "brew upgrade golem",
    )
    unknown = DatabaseTooNewError(9, 8)
    assert (
        describe_database_too_new(unknown)[0]
        == "golem.db is at schema 9, this golem reads up to schema 8"
    )


def test_a_long_socket_path_says_to_move_the_home() -> None:
    reason, next_step = describe_socket_path_too_long(Path("/x") / ("n" * 120))
    assert reason.startswith("the socket path is 123 bytes")
    assert next_step == "set GOLEM_HOME to a shorter folder"


def test_the_lock_holder_is_named_by_its_command_line() -> None:
    reason, next_step = describe_lock_held(DaemonAlreadyRunning(os.getpid()))
    assert reason.startswith(f"another golem daemon holds the lock (pid {os.getpid()}, ")
    assert "python" in reason.lower()
    assert next_step == f"stop it with kill {os.getpid()}"
    assert describe_lock_held(DaemonAlreadyRunning(None)) == (
        "another golem daemon holds the lock",
        "golem daemon restart",
    )


def test_a_second_daemon_leaves_the_holder_in_last_error(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    first = ServeProcess(short_home)
    second: ServeProcess | None = None
    try:
        first.wait_listening(paths.socket_path)
        second = ServeProcess(short_home)
        assert second.proc.wait(timeout=5) == 1
        reason, next_step = start_error_file(paths).read_text(encoding="utf-8").splitlines()
        assert f"(pid {first.proc.pid}, " in reason
        assert next_step == f"stop it with kill {first.proc.pid}"
        assert f"Next: stop it with kill {first.proc.pid}" in second.output()
    finally:
        if second is not None:
            second.stop()
        first.stop()


async def test_a_newer_database_is_written_down_and_a_clean_start_removes_it(
    short_home: Path,
) -> None:
    paths = resolve_paths(short_home)
    paths.ensure_layout()
    async with Database.open(paths.database_file):
        pass
    newer = len(MIGRATIONS) + 1
    with sqlite3.connect(paths.database_file) as raw:
        raw.execute(
            "INSERT INTO schema_version (version, golem_version, applied_at) VALUES (?, ?, ?)",
            (newer, "0.9.0", "2026-10-21T00:00:00+00:00"),
        )
        raw.execute(f"PRAGMA user_version = {newer}")

    refused = ServeProcess(short_home)
    try:
        assert refused.proc.wait(timeout=10) == 1
    finally:
        refused.stop()
    lines = start_error_file(paths).read_text(encoding="utf-8").splitlines()
    assert lines == [f"your data is from golem 0.9.0, this is {__version__}", "brew upgrade golem"]

    for leftover in paths.home.glob("golem.db*"):
        leftover.unlink()
    started = ServeProcess(short_home)
    try:
        started.wait_listening(paths.socket_path)
        assert not start_error_file(paths).exists()
    finally:
        started.stop()
