"""The watch trigger (4.3.1): a new, settled, matching file fires its routine once."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from test_routine_scheduler import FakeLauncher

from golem.routine_scheduler import RoutineScheduler
from golem.routine_watcher import FileWatcher, fill_prompt
from golem.store.database import Database
from golem.store.routine_runs import RoutineRuns, WatchedFile

SETTLE = 2.0


class Ticks:
    """A clock that moves only when a test says so."""

    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


class Rig:
    def __init__(self, database: Database, home: Path) -> None:
        self.home = home
        self.runs = RoutineRuns(database)
        self.launcher = FakeLauncher()
        self.clock = Ticks()
        self.inbox = home / "in"
        self.inbox.mkdir()
        self.watcher = self.build()

    def build(self) -> FileWatcher:
        scheduler = RoutineScheduler(
            runs=self.runs,
            launcher=self.launcher,
            user_file=self.home / "config.toml",
            broadcast=lambda _note: None,
        )
        return FileWatcher(scheduler, settle=SETTLE, clock=self.clock)

    def config(self, extra: str = "") -> None:
        (self.home / "config.toml").write_text(
            '[[routine]]\nname = "receipts"\nprompt = "/receipt-to-csv {path}"\n'
            f'on = {{ watch = "{self.inbox}", glob = "*.pdf" }}\n{extra}',
            encoding="utf-8",
        )

    def drop(self, name: str, text: str = "x") -> Path:
        path = self.inbox / name
        path.write_text(text, encoding="utf-8")
        return path

    async def pass_(self, seconds: float = 0.0, watcher: FileWatcher | None = None) -> None:
        self.clock.now += seconds
        await (watcher or self.watcher).scan()

    async def settled(self, watcher: FileWatcher | None = None) -> None:
        """Two passes: the file is seen, then it has stayed unchanged for the settle time."""
        await self.pass_(0.0, watcher)
        await self.pass_(SETTLE, watcher)

    async def rows(self) -> list[Any]:
        return await self.runs.recent("receipts", "user")

    async def end_run(self) -> None:
        [row, *_] = await self.rows()
        assert await self.runs.finish(row.routine_run_id, "succeeded", "t", None)


@pytest.fixture
def rig(database: Database, tmp_path: Path) -> Rig:
    made = Rig(database, tmp_path)
    made.config()
    return made


async def test_a_new_matching_file_fires_once_with_its_path(rig: Rig) -> None:
    await rig.pass_()  # the baseline of an empty folder
    receipt = rig.drop("receipt.pdf")
    await rig.settled()
    await rig.pass_(SETTLE)
    await rig.pass_(SETTLE)
    assert rig.launcher.created == ["receipts"]
    assert rig.launcher.sent == [("s_1", f"/receipt-to-csv {receipt}")]
    assert rig.launcher.read_folders == [(str(rig.inbox),)]
    [row] = await rig.rows()
    assert (row.trigger, row.status) == ("watch", "running")
    info = receipt.stat()
    file = WatchedFile(str(receipt), info.st_size, info.st_mtime_ns)
    assert await rig.runs.has_fired_for("receipts", "user", file)


async def test_a_file_that_does_not_count_does_not_fire(rig: Rig) -> None:
    await rig.pass_()
    rig.drop("notes.txt")
    rig.drop("movie.pdf.crdownload")
    rig.drop("movie.pdf.part")
    rig.drop("movie.pdf.download")
    rig.drop(".hidden.pdf")
    (rig.inbox / "folder.pdf").mkdir()
    await rig.settled()
    await rig.pass_(SETTLE)
    assert rig.launcher.created == []


async def test_a_file_written_slowly_fires_once_after_it_settles(rig: Rig) -> None:
    await rig.pass_()
    path = rig.drop("big.pdf", "a")
    await rig.pass_()
    for chunk in ("bb", "ccc", "dddd"):
        await rig.pass_(SETTLE - 0.5)  # less than the settle time passes between writes
        with path.open("a", encoding="utf-8") as handle:
            handle.write(chunk)
        await rig.pass_()
        assert rig.launcher.created == []
    await rig.pass_(SETTLE)
    await rig.pass_(SETTLE)
    assert rig.launcher.created == ["receipts"]


async def test_a_file_moved_in_counts_as_new(rig: Rig, tmp_path: Path) -> None:
    await rig.pass_()
    elsewhere = tmp_path / "elsewhere.pdf"
    elsewhere.write_text("x", encoding="utf-8")
    os.utime(elsewhere, (1_000_000, 1_000_000))  # an old file, moved in
    elsewhere.rename(rig.inbox / "moved.pdf")
    await rig.settled()
    assert rig.launcher.created == ["receipts"]


async def test_files_already_there_when_the_watch_starts_are_ignored(rig: Rig) -> None:
    rig.drop("old.pdf")
    await rig.settled()
    await rig.pass_(SETTLE)
    assert rig.launcher.created == []


async def test_a_restart_does_not_fire_old_files_again(rig: Rig) -> None:
    await rig.pass_()
    rig.drop("one.pdf")
    await rig.settled()
    assert rig.launcher.created == ["receipts"]
    await rig.end_run()
    again = rig.build()  # the daemon starts again, with the same database
    await rig.settled(again)
    await rig.pass_(SETTLE, again)
    assert rig.launcher.created == ["receipts"]
    rig.drop("two.pdf")
    await rig.settled(again)
    assert rig.launcher.created == ["receipts", "receipts"]


async def test_a_file_that_comes_back_as_it_was_does_not_fire_twice(rig: Rig) -> None:
    await rig.pass_()
    path = rig.drop("one.pdf")
    stat = path.stat()
    await rig.settled()
    await rig.end_run()
    path.unlink()  # gone, then back with the same size and mtime
    await rig.pass_()
    path.write_text("x", encoding="utf-8")
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    await rig.settled()
    assert rig.launcher.created == ["receipts"]


async def test_a_second_file_waits_while_the_first_run_is_going(rig: Rig) -> None:
    await rig.pass_()
    rig.drop("one.pdf")
    await rig.settled()
    rig.drop("two.pdf")
    await rig.settled()
    assert rig.launcher.created == ["receipts"]  # the first is still running
    await rig.end_run()
    await rig.pass_(SETTLE)
    assert rig.launcher.created == ["receipts", "receipts"]


async def test_a_missing_folder_is_a_problem_until_it_exists(rig: Rig) -> None:
    rig.inbox.rmdir()
    await rig.pass_()
    [problem] = rig.watcher.problems()
    assert problem.file == str(rig.home / "config.toml")
    assert "receipts" in problem.message and "does not exist" in problem.message
    rig.inbox.mkdir()
    await rig.pass_()
    assert rig.watcher.problems() == []


async def test_a_disabled_routine_is_not_watched(rig: Rig) -> None:
    rig.config("enabled = false\n")
    await rig.pass_()
    rig.drop("one.pdf")
    await rig.settled()
    assert rig.launcher.created == []


def test_the_prompt_gets_path_name_and_dir() -> None:
    path = Path("/tmp/in box/it's.pdf")
    assert fill_prompt("Summarize {name} in {dir}: {path}", path) == (
        "Summarize it's.pdf in /tmp/in box: /tmp/in box/it's.pdf"
    )
    assert fill_prompt("/receipt {path} --dir {dir}", path) == (
        "/receipt '/tmp/in box/it'\"'\"'s.pdf' --dir '/tmp/in box'"
    )
