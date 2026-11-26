"""Kept query results: a Parquet file, a table artifact, a page by id, and the clean-up."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

import duckdb
import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.config import DataSettings
from golem.data import parquet
from golem.data.client import DataWorker, Timing
from golem.data.results import KIND, ResultStore, table_record
from golem.data.sources import DataSources
from golem.data.tools import DATA_QUERY, MAX_SHOWN_ROWS, SHOWN_ROWS
from golem.data.types import DataError
from golem.graphs.chat import open_chat
from golem.graphs.data_stub import stub_local_rows
from golem.graphs.tools_node import DATA_KEY
from golem.models.router import ModelRouter
from golem.paths import GolemPaths
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import ToolContext, ToolRegistry
from golem_protocol.events import ChatEvent, ToolCompletedEvent

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
BIG = "select i as id, i * 2.5 as price, 'row ' || i as note from range(50000) t(i)"


@pytest.fixture
def paths(tmp_path: Path) -> GolemPaths:
    return GolemPaths(tmp_path / "home")


@pytest.fixture
async def sources(paths: GolemPaths) -> AsyncIterator[DataSources]:
    found = DataSources(
        DataWorker(DataSettings(query_timeout_seconds=30), paths, timing=FAST), paths
    )
    yield found
    await found.close()


def _ctx(sources: DataSources) -> ToolContext:
    return ToolContext(root=None, data=sources.access(None))


def _rows_in(path: Path) -> int:
    return int(duckdb.sql(f"select count(*) from read_parquet('{path}')").fetchone()[0])  # type: ignore[index]


# -- what the model gets, what the user keeps ---------------------------------------------------


async def test_a_50000_row_answer_costs_the_model_20_rows_and_a_summary(
    sources: DataSources, paths: GolemPaths
) -> None:
    result = await DATA_QUERY.call({"source": "golem", "sql": BIG}, _ctx(sources))
    lines = result.output.splitlines()
    assert lines[0].startswith("10 000 rows · truncated: yes · ")
    assert " · result res_" in lines[0]
    start = lines.index('<data_rows source="golem">')
    table = lines[start + 1 : lines.index("… 9 980 more rows")]
    assert len(table) == SHOWN_ROWS + 1  # the header and 20 rows
    assert "id: min 0 · max 9999 · sum 49995000" in result.output
    assert "price: min 0 · max 24997.5 · sum 124987500" in result.output
    assert "run data_query again with LIMIT and OFFSET" in result.output
    assert len(result.output) < 2_500

    table_read = result.table
    assert table_read is not None
    assert (table_read.total_rows, table_read.truncated) == (10_000, True)
    assert len(table_read.rows) == 50
    kept = paths.data_results_dir / f"{table_read.result_id}.parquet"
    assert _rows_in(kept) == 10_000
    assert sorted(p.name for p in paths.data_results_dir.iterdir()) == [kept.name]


async def test_pages_of_a_kept_result_match_its_rows(sources: DataSources) -> None:
    result = await DATA_QUERY.call({"source": "golem", "sql": BIG}, _ctx(sources))
    assert result.table is not None
    ident = result.table.result_id
    first = await sources.page(ident, 0, 1000)
    assert (first.source, first.total_rows) == ("golem", 10_000)
    assert [c["name"] for c in first.columns] == ["id", "price", "note"]
    assert first.rows[:2] == [[0, 0.0, "row 0"], [1, 2.5, "row 1"]]
    assert first.rows[:50] == result.table.rows
    last = await sources.page(ident, 9_990, 1000)
    assert [row[0] for row in last.rows] == list(range(9_990, 10_000))
    middle = await sources.page(ident, 4_321, 3)
    assert [row[0] for row in middle.rows] == [4_321, 4_322, 4_323]
    ordered = await sources.page(ident, 0, 2, "id", True)
    assert [row[0] for row in ordered.rows] == [9_999, 9_998]


async def test_a_bad_result_id_or_column_is_a_sentence(sources: DataSources) -> None:
    with pytest.raises(DataError, match="not a result id"):
        await sources.page("../../etc/passwd", 0, 10)
    with pytest.raises(DataError, match="gone"):
        await sources.page("res_nothing", 0, 10)
    result = await DATA_QUERY.call({"source": "golem", "sql": "select 1 as a"}, _ctx(sources))
    assert result.table is not None
    with pytest.raises(DataError, match="no column called b"):
        await sources.page(result.table.result_id, 0, 10, "b")


async def test_limit_is_how_many_rows_the_model_reads_and_is_capped(sources: DataSources) -> None:
    few = await DATA_QUERY.call({"source": "golem", "sql": BIG, "limit": 3}, _ctx(sources))
    assert "Showing the first 3." in few.output
    many = await DATA_QUERY.call({"source": "golem", "sql": BIG, "limit": 5000}, _ctx(sources))
    assert f"Showing the first {MAX_SHOWN_ROWS}." in many.output


async def test_a_small_result_has_no_paging_hint(sources: DataSources) -> None:
    result = await DATA_QUERY.call({"source": "golem", "sql": "select 7 as n"}, _ctx(sources))
    assert "Showing the first" not in result.output
    assert "n: min 7 · max 7 · sum 7" in result.output


async def test_a_repeated_column_name_is_kept_apart(sources: DataSources) -> None:
    result = await sources.query(None, "golem", "select 1 as a, 2 as a")
    assert [c["name"] for c in result.columns] == ["a", "a_2"]
    page = await sources.page(result.result_id, 0, 10)
    assert [c["name"] for c in page.columns] == ["a", "a_2"]


async def test_values_that_do_not_round_trip_are_kept_as_text(sources: DataSources) -> None:
    result = await sources.query(
        None, "golem", "select [1, 2] as l, {'a': 1} as s, date '2026-01-02' as d"
    )
    page = await sources.page(result.result_id, 0, 10)
    assert page.rows == [[[1, 2], {"a": 1}, "2026-01-02"]]


# -- the privacy of the model's copy -------------------------------------------------------------


async def test_a_hosted_call_over_a_local_source_still_gets_the_stub(
    sources: DataSources, paths: GolemPaths
) -> None:
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    shop = paths.home.parent / "shop"
    shop.mkdir(parents=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n")
    paths.config_file.write_text(f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "local"\n')
    result = await DATA_QUERY.call(
        {"source": "shop", "sql": "select id, total from orders"}, _ctx(sources)
    )
    assert "32.5" in result.output and result.data is not None
    message = ToolMessage(
        content=result.output,
        tool_call_id="c1",
        name="data_query",
        additional_kwargs={
            DATA_KEY: {
                "source": "shop",
                "privacy": result.data.privacy,
                "hosted": result.data.hosted,
            }
        },
    )
    (hosted,) = stub_local_rows([message])
    text = str(hosted.content)
    assert text.startswith("2 rows from shop, shown to the user, not sent to this model.")
    assert not any(word in text for word in ("32.5", "sum", "min", "result res_"))
    assert result.table is not None and result.table.rows == [[1, 10.0], [2, 32.5]]


# -- writing stays inside the wall -----------------------------------------------------------------


def test_a_result_is_written_only_to_its_own_file(tmp_path: Path) -> None:
    target = tmp_path / "results" / "res_a.parquet"
    parquet.write(target, ["a"], ["INTEGER"], [[1], [2]], {"source": "s", "sql": "select 1"})
    assert sorted(p.name for p in target.parent.iterdir()) == ["res_a.parquet"]
    assert parquet.page(target, 0, 10, None, False)["meta"] == {"source": "s", "sql": "select 1"}


def test_a_failed_write_leaves_no_part_file(tmp_path: Path) -> None:
    target = tmp_path / "results" / "res_b.parquet"
    with pytest.raises(DataError, match="Could not keep"):
        parquet.write(target, ["a"], ["INTEGER"], [[object()]], {})
    assert list(target.parent.iterdir()) == []


async def test_a_source_still_cannot_write(sources: DataSources, paths: GolemPaths) -> None:
    outside = paths.home.parent / "out.parquet"
    with pytest.raises(DataError):
        await sources.query(None, "golem", f"copy (select 1) to '{outside}' (format parquet)")
    assert not outside.exists()


# -- clean-up --------------------------------------------------------------------------------------


def _file(directory: Path, name: str, size: int, age_days: float, now: float) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.parquet"
    path.write_bytes(b"x" * size)
    stamp = now - age_days * 86_400
    os.utime(path, (stamp, stamp))
    return path


class _Fake:
    """Table artifacts in a list, for the clean-up tests."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    async def tables(self, session_id: str | None = None) -> list[tuple[str, str, str]]:
        return [r for r in self.rows if session_id is None or r[1] == session_id]

    async def drop(self, artifact_ids: list[str]) -> None:
        self.rows = [r for r in self.rows if r[0] not in artifact_ids]

    def add(self, artifact: str, session: str, result: str) -> None:
        self.rows.append((artifact, session, json.dumps({"result_id": result})))


async def test_results_older_than_30_days_are_deleted(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    store = ResultStore(tmp_path / "r", clock=lambda: now)
    old = _file(store.directory, "res_old", 10, 31, now)
    fresh = _file(store.directory, "res_new", 10, 29, now)
    cleaned = await store.clean()
    assert (cleaned.files, old.exists(), fresh.exists()) == (1, False, True)


async def test_the_oldest_go_first_above_the_size_limit(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    store = ResultStore(tmp_path / "r", max_bytes=250, clock=lambda: now)
    oldest = _file(store.directory, "res_a", 100, 3, now)
    middle = _file(store.directory, "res_b", 100, 2, now)
    newest = _file(store.directory, "res_c", 100, 1, now)
    await store.clean()
    assert (oldest.exists(), middle.exists(), newest.exists()) == (False, True, True)


async def test_a_clean_up_drops_the_artifact_of_a_deleted_file(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    store = ResultStore(tmp_path / "r", clock=lambda: now)
    fake = _Fake()
    store.artifacts = fake
    _file(store.directory, "res_old", 10, 40, now)
    _file(store.directory, "res_new", 10, 1, now)
    fake.add("a1", "s1", "res_old")
    fake.add("a2", "s1", "res_new")
    await store.clean()
    assert [r[0] for r in fake.rows] == ["a2"]


async def test_deleting_a_session_deletes_its_results(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    store = ResultStore(tmp_path / "r", clock=lambda: now)
    fake = _Fake()
    store.artifacts = fake
    mine = _file(store.directory, "res_mine", 10, 1, now)
    other = _file(store.directory, "res_other", 10, 1, now)
    fake.add("a1", "s1", "res_mine")
    fake.add("a2", "s2", "res_other")
    assert await store.forget_session("s1") == 1
    assert (mine.exists(), other.exists(), [r[0] for r in fake.rows]) == (False, True, ["a2"])


async def test_the_artifact_store_lists_and_drops_table_artifacts(tmp_path: Path) -> None:
    async with Database.open(tmp_path / "golem.db") as database:
        async with database.transaction() as tx:
            await tx.execute(
                "INSERT INTO sessions (session_id, model_profile, title, created_at, updated_at)"
                " VALUES ('s1', 'sonnet', 't', '2026-11-24T09:00:00Z', '2026-11-24T09:00:00Z')"
            )
        artifacts = ArtifactStore(database)
        record = table_record(
            result_id="res_x", source="golem", sql="select 1", columns=[], rows=1, truncated=False
        )
        made = await artifacts.put("s1", "c1", KIND, record)
        await artifacts.put("s1", "c2", "tool_output", "text")
        found = await artifacts.tables("s1")
        assert [(a, s) for a, s, _ in found] == [(made, "s1")]
        assert json.loads(found[0][2])["result_id"] == "res_x"
        assert await artifacts.tables("s2") == []
        await artifacts.drop([made])
        assert await artifacts.tables() == []


def test_partial_files_of_a_crash_are_removed(tmp_path: Path) -> None:
    now = 2_000_000_000.0
    store = ResultStore(tmp_path / "r", clock=lambda: now)
    part = store.directory / "res_z.parquet.part"
    store.directory.mkdir(parents=True)
    part.write_bytes(b"x")
    os.utime(part, (now - 2 * 86_400, now - 2 * 86_400))
    assert store._sweep().files == 0  # pyright: ignore[reportPrivateUsage]
    assert not part.exists()


async def test_a_chat_run_keeps_the_table_and_closing_the_session_removes_it(
    sources: DataSources, paths: GolemPaths, database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[[("data_query", {"source": "golem", "sql": BIG})], "seen"]
    )
    store = ArtifactStore(database)
    sources.results.artifacts = store
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "checkpoints.db")) as saver:
        await saver.setup()
        runtime = open_chat(
            ModelRouter(model=model), saver, ToolRegistry([DATA_QUERY]), None, store
        )
        runtime.data = sources
        runs = RunRecords(database)
        records = SessionRecords(database)
        events = EventLog(database)
        manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
        session_id = await manager.create(None, cwd=str(tmp_path))
        run_id = await manager.send(session_id, "how many orders")
        async with asyncio.timeout(20):
            while (run := await runs.get(run_id)) is None or run.status == "running":
                await asyncio.sleep(0.01)
        logged: list[ChatEvent] = await events.for_run(run_id)
        (done,) = [e for e in logged if isinstance(e, ToolCompletedEvent)]
        table = done.data.table
        assert table is not None
        assert (table.total_rows, table.truncated, len(table.rows)) == (10_000, True, 50)
        assert [c.name for c in table.columns] == ["id", "price", "note"]
        kept = paths.data_results_dir / f"{table.result_id}.parquet"
        assert kept.is_file() and len(await store.tables(session_id)) == 1
        await manager.close(session_id)
    assert not kept.exists() and await store.tables(session_id) == []
