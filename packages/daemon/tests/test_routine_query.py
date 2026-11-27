"""A routine that runs a saved query with no model, and posts to the Inbox."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from pydantic import BaseModel, ValidationError

from golem.config import DataSettings, RoutineSettings
from golem.config_edit import add_routine, replace_routine
from golem.data.client import DataWorker
from golem.data.sources import DataSources
from golem.data.types import DataError
from golem.paths import GolemPaths
from golem.routine_files import read_routines
from golem.routine_query import DataQueryRoutines, QueryAnswer
from golem.routine_scheduler import Planned, RoutineScheduler
from golem.store.database import Database
from golem.store.inbox_posts import InboxPosts
from golem.store.routine_runs import RoutineRuns

ZONE = ZoneInfo("Europe/Prague")
START = datetime(2026, 2, 6, 9, 0, tzinfo=ZONE)
TABLE = {
    "name": "big-payments",
    "schedule": "every 1h",
    "query": {"source": "bank", "saved": "Big payments this week"},
}


def settings(**more: Any) -> RoutineSettings:
    return RoutineSettings.model_validate({**TABLE, **more})


def test_a_query_routine_has_neither_prompt_nor_workflow() -> None:
    assert settings().posts == "always"
    assert settings(post="rows").posts == "rows"
    with pytest.raises(ValidationError, match="exactly one of prompt, workflow and query"):
        settings(prompt="hello")
    with pytest.raises(ValidationError, match="exactly one of prompt, workflow and query"):
        settings(workflow="digest")
    with pytest.raises(ValidationError, match="exactly one of prompt, workflow and query"):
        RoutineSettings.model_validate({"name": "x", "schedule": "every 1h"})


def test_post_is_only_for_a_query_and_a_query_takes_no_model() -> None:
    with pytest.raises(ValidationError, match="post belongs to a routine that runs a query"):
        RoutineSettings.model_validate(
            {"name": "x", "schedule": "every 1h", "prompt": "hi", "post": "rows"}
        )
    with pytest.raises(ValidationError, match="post"):
        settings(post="sometimes")
    with pytest.raises(ValidationError, match="a query uses no model"):
        settings(model="fast")
    with pytest.raises(ValidationError, match="inputs"):
        settings(inputs={"a": "b"})


def test_a_watch_routine_can_run_a_query() -> None:
    found = RoutineSettings.model_validate(
        {
            "name": "new-file",
            "on": {"watch": "/tmp/bank", "glob": "*.csv"},
            "query": {"source": "bank", "saved": "Spending by month"},
            "post": "rows",
        }
    )
    assert found.query is not None and found.on is not None


def test_config_edit_round_trips_the_query_and_post(tmp_path: Path) -> None:
    file = tmp_path / "config.toml"
    add_routine(file, {**TABLE, "post": "rows"})
    text = file.read_text(encoding="utf-8")
    assert 'query = {source = "bank", saved = "Big payments this week"}' in text
    [read] = read_routines(file).routines
    assert read.query is not None and read.query.saved == "Big payments this week"
    assert read.post == "rows"
    replace_routine(file, "big-payments", {**TABLE, "post": "always"})
    [again] = read_routines(file).routines
    assert again.post == "always"


class Queries:
    """A fake data engine: the answer to give, or the error to raise."""

    def __init__(self) -> None:
        self.answer = QueryAnswer(["booked", "paid"], 0, [])
        self.error: str | None = None
        self.calls: list[tuple[str, str, Path | None]] = []

    async def run(self, source: str, saved: str, folder: Path | None) -> QueryAnswer:
        self.calls.append((source, saved, folder))
        if self.error is not None:
            raise DataError(self.error)
        return self.answer

    async def problem(self, source: str, saved: str, folder: Path | None) -> str | None:
        return None


class Rig:
    def __init__(self, database: Database, home: Path, queries: Any = None) -> None:
        self.home = home
        self.sent: list[BaseModel] = []
        self.told: list[tuple[str, str]] = []
        self.runs = RoutineRuns(database)
        self.inbox = InboxPosts(database)
        self.queries: Any = queries or Queries()

        async def tell(title: str, body: str, session: str | None, run: str | None) -> None:
            self.told.append((title, body))

        class NoSession:
            async def create(self, routine: Planned) -> str:
                raise AssertionError("a query routine made a session")

        self.scheduler = RoutineScheduler(
            runs=self.runs,
            launcher=NoSession(),  # pyright: ignore[reportArgumentType]
            user_file=home / "config.toml",
            broadcast=self.sent.append,
            now=lambda: START,
            zone=ZONE,
            queries=self.queries,
            inbox=self.inbox,
            tell=tell,
        )

    async def fire(self, **more: Any) -> str:
        table = {**TABLE, **more}
        add_routine(self.home / "config.toml", table)
        run_id, session_id = await self.scheduler.run("big-payments")
        assert session_id is None
        await self.scheduler.drain()
        return run_id


@pytest.fixture
def rig(database: Database, tmp_path: Path) -> Rig:
    return Rig(database, tmp_path)


async def test_post_always_posts_the_rows_and_the_phone_gets_only_the_count(rig: Rig) -> None:
    rows = [[f"2026-11-{day:02d}", 600.0 + day] for day in range(1, 13)]
    rig.queries.answer = QueryAnswer(["booked", "paid"], 12, rows[:10])
    run_id = await rig.fire()
    [post] = await rig.inbox.open_posts()
    assert (post.routine, post.source, post.saved, post.row_count) == (
        "big-payments",
        "bank",
        "Big payments this week",
        12,
    )
    assert post.columns == ["booked", "paid"] and len(post.rows) == 10 and post.error is None
    row = await rig.runs.get(run_id)
    assert row is not None and (row.status, row.summary) == ("succeeded", "12 rows, posted")
    assert row.session_id is None
    assert rig.told == [("big-payments", "12 rows")]
    assert "2026" not in rig.told[0][1]


async def test_post_always_posts_even_with_no_rows(rig: Rig) -> None:
    await rig.fire()
    [post] = await rig.inbox.open_posts()
    assert post.row_count == 0


async def test_post_rows_posts_when_there_are_rows(rig: Rig) -> None:
    rig.queries.answer = QueryAnswer(["booked"], 1, [["2026-11-24"]])
    await rig.fire(post="rows")
    [post] = await rig.inbox.open_posts()
    assert post.row_count == 1 and rig.told == [("big-payments", "1 row")]


async def test_post_rows_with_no_rows_posts_nothing_but_the_run_says_so(rig: Rig) -> None:
    run_id = await rig.fire(post="rows")
    assert await rig.inbox.open_posts() == []
    assert rig.told == []
    row = await rig.runs.get(run_id)
    assert row is not None and (row.status, row.summary) == ("succeeded", "0 rows, nothing posted")


async def test_a_failure_posts_the_engines_error(rig: Rig) -> None:
    rig.queries.error = 'column "amout" not found'
    run_id = await rig.fire(post="rows")
    [post] = await rig.inbox.open_posts()
    assert post.error == 'column "amout" not found' and post.rows == []
    row = await rig.runs.get(run_id)
    assert row is not None and (row.status, row.reason) == ("failed", 'column "amout" not found')
    assert rig.told == [("big-payments", "could not run")]


async def test_a_post_leaves_the_inbox_when_it_is_done(rig: Rig) -> None:
    await rig.fire()
    [post] = await rig.inbox.open_posts()
    assert await rig.inbox.done(post.post_id, "2026-02-06T09:00:00+00:00")
    assert await rig.inbox.open_posts() == []
    assert not await rig.inbox.done(post.post_id, "2026-02-06T09:00:00+00:00")


async def test_the_query_runs_in_the_routines_folder_of_the_scope(rig: Rig) -> None:
    await rig.fire()
    assert rig.queries.calls == [("bank", "Big payments this week", None)]


@pytest.fixture
async def real(tmp_path: Path, database: Database) -> AsyncIterator[tuple[Rig, DataSources]]:
    """A routine rig over a real DuckDB engine with a CSV source and two saved queries."""
    paths = GolemPaths(tmp_path / "home")
    paths.ensure_layout()
    shop = tmp_path / "shop"
    shop.mkdir()
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n3,7\n")
    paths.config_file.write_text(f'[data.shop]\npath = "{shop}/*.csv"\n', encoding="utf-8")
    worker = DataWorker(DataSettings(query_timeout_seconds=10, threads=1), paths)
    sources = DataSources(worker, paths, trusted=lambda _root: True)
    await sources.save_query(None, "shop", "Big", "select * from orders where total > 8", None)
    await sources.save_query(None, "shop", "Huge", "select * from orders where total > 999", None)
    rig = Rig(database, paths.home, DataQueryRoutines(sources))
    yield rig, sources
    await sources.close()


async def fire_real(rig: Rig, saved: str, post: str) -> None:
    name = f"{saved}-{post}".lower()
    table = {**TABLE, "name": name, "query": {"source": "shop", "saved": saved}, "post": post}
    add_routine(rig.home / "config.toml", table)
    await rig.scheduler.run(name)
    await rig.scheduler.drain()


async def test_a_real_csv_source_always_posts_the_rows(real: tuple[Rig, DataSources]) -> None:
    rig, _ = real
    await fire_real(rig, "Big", "always")
    (post,) = await rig.inbox.open_posts()
    assert (post.source, post.saved, post.row_count) == ("shop", "Big", 2)
    assert post.columns == ["file", "id", "total"] and len(post.rows) == 2


async def test_a_real_source_posts_with_rows_only_when_there_are_rows(
    real: tuple[Rig, DataSources],
) -> None:
    rig, _ = real
    await fire_real(rig, "Huge", "rows")
    assert await rig.inbox.open_posts() == []
    await fire_real(rig, "Big", "rows")
    assert len(await rig.inbox.open_posts()) == 1


async def test_a_real_source_always_posts_even_with_no_rows(real: tuple[Rig, DataSources]) -> None:
    rig, _ = real
    await fire_real(rig, "Huge", "always")
    (post,) = await rig.inbox.open_posts()
    assert post.row_count == 0


async def test_a_missing_source_or_saved_query_is_a_problem_in_plain_words(
    real: tuple[Rig, DataSources],
) -> None:
    runner = DataQueryRoutines(real[1])
    assert await runner.problem("shop", "Big", None) is None
    assert await runner.problem("shop", "Gone", None) == "shop has no saved query called Gone"
    assert "cash" in (await runner.problem("cash", "Big", None) or "")
