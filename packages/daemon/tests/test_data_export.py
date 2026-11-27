"""``data_export``: a kept result written to a new file, and only after the user says yes."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import duckdb
import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from golem.config import DataSettings
from golem.data import parquet
from golem.data.client import DataWorker, Timing
from golem.data.engine import extension_installed
from golem.data.export import infer_format
from golem.data.sources import DataSources
from golem.data.tools import DATA_EXPORT, DATA_QUERY
from golem.data.types import DataError
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.paths import GolemPaths
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import ToolContext, ToolError, ToolRegistry
from golem_protocol.events import ApprovalNeededEvent, ToolCompletedEvent, ToolFailedEvent

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
BIG = "select i as id, 'row ' || i as note from range(5000) t(i)"
SMALL = "select 1 as id, 'a, b' as note union all select 2, 'c' order by id"


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


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    place = tmp_path / "out"
    place.mkdir()
    return place


def _ctx(sources: DataSources, root: Path | None = None) -> ToolContext:
    return ToolContext(root=root, data=sources.access(root))


async def _result(sources: DataSources, sql: str = BIG) -> str:
    return (await sources.query(None, "golem", sql)).result_id


def _read(sql: str) -> list[tuple[Any, ...]]:
    return duckdb.sql(sql).fetchall()


# -- every format keeps every row ----------------------------------------------------------------


@pytest.mark.parametrize("name", ["rows.csv", "rows.parquet", "rows.json", "rows.jsonl"])
async def test_the_whole_result_is_written_and_reads_back(
    sources: DataSources, folder: Path, name: str
) -> None:
    ident = await _result(sources)
    target = folder / name
    done = await DATA_EXPORT.call({"result": ident, "path": str(target)}, _ctx(sources))
    assert done.output == f"wrote 5 000 rows to {target}"
    assert "row 4999" not in done.output
    reader = {
        ".csv": "read_csv",
        ".parquet": "read_parquet",
        ".json": "read_json",
        ".jsonl": "read_json",
    }[target.suffix]
    found = _read(f"select id, note from {reader}('{target}') order by id")
    assert found == [(i, f"row {i}") for i in range(5000)]
    assert [p.name for p in folder.iterdir()] == [name]


async def test_a_json_file_is_an_array_and_jsonl_is_lines(
    sources: DataSources, folder: Path
) -> None:
    ident = await _result(sources, SMALL)
    await sources.export(await sources.plan_export(None, ident, str(folder / "a.json")))
    await sources.export(await sources.plan_export(None, ident, str(folder / "a.jsonl")))
    rows = [{"id": 1, "note": "a, b"}, {"id": 2, "note": "c"}]
    assert json.loads((folder / "a.json").read_text()) == rows
    lines = (folder / "a.jsonl").read_text().splitlines()
    assert [json.loads(line) for line in lines] == rows


async def test_a_csv_has_a_header_and_quotes(sources: DataSources, folder: Path) -> None:
    ident = await _result(sources, SMALL)
    await sources.export(await sources.plan_export(None, ident, str(folder / "a.csv")))
    assert (folder / "a.csv").read_text() == 'id,note\n1,"a, b"\n2,c\n'


async def test_a_format_that_is_given_wins_over_the_name(
    sources: DataSources, folder: Path
) -> None:
    ident = await _result(sources, SMALL)
    plan = await sources.plan_export(None, ident, str(folder / "table.txt"), "csv")
    assert await sources.export(plan) == 2
    assert (folder / "table.txt").read_text().startswith("id,note\n")


async def test_excel_writes_when_the_add_on_is_here_and_says_so_when_it_is_not(
    sources: DataSources, paths: GolemPaths, folder: Path
) -> None:
    ident = await _result(sources, SMALL)
    target = folder / "a.xlsx"
    if extension_installed(paths.data_extensions_dir, "excel"):  # pragma: no cover
        await sources.export(await sources.plan_export(None, ident, str(target)))
        assert target.stat().st_size > 0
        return
    with pytest.raises(ToolError, match="one-time download"):
        await DATA_EXPORT.call({"result": ident, "path": str(target)}, _ctx(sources))
    assert list(folder.iterdir()) == []


def test_the_format_follows_the_name() -> None:
    names = ("a.CSV", "a.parquet", "a.jsonl", "a.ndjson", "a.xlsx", "a.json")
    assert [infer_format(n) for n in names] == [
        "csv",
        "parquet",
        "json",
        "json",
        "xlsx",
        "json",
    ]
    with pytest.raises(DataError, match="Name the format"):
        infer_format("a.txt")


# -- what is refused -----------------------------------------------------------------------------


async def test_a_file_that_exists_is_never_overwritten(sources: DataSources, folder: Path) -> None:
    ident = await _result(sources, SMALL)
    target = folder / "mine.csv"
    target.write_text("keep me")
    with pytest.raises(ToolError, match="already exists"):
        await DATA_EXPORT.call({"result": ident, "path": str(target)}, _ctx(sources))
    assert target.read_text() == "keep me"
    with pytest.raises(DataError, match="already exists"):
        parquet.export(sources.results.path(ident), target, "csv")
    assert target.read_text() == "keep me"


async def test_a_file_that_appears_before_the_rename_is_kept(
    sources: DataSources, folder: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ident = await _result(sources, SMALL)
    target = folder / "late.csv"
    real = parquet._place  # pyright: ignore[reportPrivateUsage]

    def late(temp: Path, to: Path) -> None:
        to.write_text("someone else")
        real(temp, to)

    monkeypatch.setattr(parquet, "_place", late)
    with pytest.raises(DataError, match="already exists"):
        parquet.export(sources.results.path(ident), target, "csv")
    assert target.read_text() == "someone else"
    assert [p.name for p in folder.iterdir()] == ["late.csv"]


async def test_a_path_inside_a_source_is_refused(
    sources: DataSources, paths: GolemPaths, folder: Path
) -> None:
    statements = folder / "bank"
    statements.mkdir()
    (statements / "2026-01.csv").write_text("amount\n1\n")
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    paths.config_file.write_text(f'[data.bank]\npath = "{statements}"\n')
    ident = await _result(sources, SMALL)
    for inside in (statements / "clean.csv", statements / "2026-01.csv"):
        with pytest.raises(ToolError, match="never written to"):
            await DATA_EXPORT.call({"result": ident, "path": str(inside)}, _ctx(sources))
    done = await DATA_EXPORT.call(
        {"result": ident, "path": str(folder / "clean.csv")}, _ctx(sources)
    )
    assert "wrote 2 rows" in done.output


async def test_a_file_a_glob_would_read_is_refused(
    sources: DataSources, paths: GolemPaths, folder: Path
) -> None:
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    paths.config_file.write_text(f'[data.bank]\npath = "{folder}/stmt-*.csv"\n')
    (folder / "stmt-1.csv").write_text("a\n1\n")
    ident = await _result(sources, SMALL)
    with pytest.raises(ToolError, match="never written to"):
        await DATA_EXPORT.call({"result": ident, "path": str(folder / "stmt-2.csv")}, _ctx(sources))
    await DATA_EXPORT.call({"result": ident, "path": str(folder / "other.csv")}, _ctx(sources))


async def test_system_folders_credentials_and_git_are_refused(
    sources: DataSources, folder: Path
) -> None:
    ident = await _result(sources, SMALL)
    ctx = _ctx(sources)
    with pytest.raises(ToolError, match="system folder"):
        await DATA_EXPORT.call({"result": ident, "path": "/etc/golem-test.csv"}, ctx)
    with pytest.raises(ToolError, match="outside your home folder"):
        await DATA_EXPORT.call({"result": ident, "path": "/opt/golem-test.csv"}, ctx)
    (folder / ".git").mkdir()
    with pytest.raises(ToolError, match=r"\.git/ folder"):
        await DATA_EXPORT.call({"result": ident, "path": str(folder / ".git" / "x.csv")}, ctx)
    with pytest.raises(ToolError, match=r"does not exist|credentials"):
        await DATA_EXPORT.call({"result": ident, "path": "~/.ssh/golem-test.csv"}, ctx)
    with pytest.raises(ToolError, match="does not exist"):
        await DATA_EXPORT.call({"result": ident, "path": str(folder / "no" / "x.csv")}, ctx)
    with pytest.raises(ToolError, match="Name the format"):
        await DATA_EXPORT.call({"result": ident, "path": str(folder / "x")}, ctx)


async def test_a_missing_or_bad_result_id_is_a_sentence(sources: DataSources, folder: Path) -> None:
    ctx = _ctx(sources)
    with pytest.raises(ToolError, match="gone"):
        await DATA_EXPORT.call({"result": "res_nothing", "path": str(folder / "x.csv")}, ctx)
    with pytest.raises(ToolError, match="not a result id"):
        await DATA_EXPORT.call({"result": "../x", "path": str(folder / "x.csv")}, ctx)


async def test_a_relative_path_is_relative_to_the_session_folder(
    sources: DataSources, folder: Path
) -> None:
    ident = await _result(sources, SMALL)
    await DATA_EXPORT.call({"result": ident, "path": "rel.csv"}, _ctx(sources, folder))
    assert (folder / "rel.csv").is_file()
    with pytest.raises(ToolError, match="no project folder"):
        await DATA_EXPORT.call({"result": ident, "path": "rel2.csv"}, _ctx(sources))


# -- failures leave nothing ----------------------------------------------------------------------


def test_a_failed_write_leaves_no_part_file_and_no_target(tmp_path: Path) -> None:
    broken = tmp_path / "res_bad.parquet"
    broken.write_bytes(b"this is not parquet")
    target = tmp_path / "out.csv"
    with pytest.raises(DataError, match="Could not write"):
        parquet.export(broken, target, "csv")
    assert [p.name for p in tmp_path.iterdir()] == ["res_bad.parquet"]


def test_a_writer_cannot_reach_other_files(tmp_path: Path) -> None:
    source = tmp_path / "res_a.parquet"
    parquet.write(source, ["a"], ["INTEGER"], [[1]], {"source": "s"})
    secret = tmp_path / "secret.csv"
    secret.write_text("x\n1\n")
    target = tmp_path / "out.csv"
    # The database that writes may read the result and write the part file, nothing else.
    con = duckdb.connect(":memory:")
    con.execute("set allowed_paths = ?", [[str(source), f"{target}.part"]])
    con.execute("set enable_external_access = false")
    con.execute("set lock_configuration = true")
    with pytest.raises(duckdb.Error):
        con.execute(f"select * from read_csv('{secret}')")
    with pytest.raises(duckdb.Error):
        con.execute(f"copy (select 1) to '{tmp_path / 'other.csv'}'")
    with pytest.raises(duckdb.Error):
        con.execute("set allowed_paths = []")
    con.close()
    assert parquet.export(source, target, "csv") == {"rows": 1}
    assert not (tmp_path / "other.csv").exists()


# -- the question comes first --------------------------------------------------------------------


async def _settle(runs: RunRecords, run_id: str) -> None:
    async with asyncio.timeout(20):
        while (run := await runs.get(run_id)) is None or run.status == "running":
            await asyncio.sleep(0.01)


@pytest.mark.parametrize("decision", ["deny", "allow"])
async def test_the_model_asks_before_it_writes(
    sources: DataSources, database: Database, folder: Path, tmp_path: Path, decision: str
) -> None:
    target = folder / "answer.csv"
    model = ToolCallingChatModel(
        replies=[[("data_query", {"source": "golem", "sql": SMALL})], "queried", "done"]
    )
    async with AsyncSqliteSaver.from_conn_string(str(tmp_path / "checkpoints.db")) as saver:
        await saver.setup()
        runtime = open_chat(
            ModelRouter(model=model), saver, ToolRegistry([DATA_QUERY, DATA_EXPORT])
        )
        runtime.data = sources
        runs, records, events = RunRecords(database), SessionRecords(database), EventLog(database)
        manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
        session_id = await manager.create(None, cwd=str(folder))
        first = await manager.send(session_id, "how many")
        await _settle(runs, first)
        (queried,) = [e for e in await events.for_run(first) if isinstance(e, ToolCompletedEvent)]
        assert queried.data.table is not None
        ident = queried.data.table.result_id
        model.replies.insert(0, [("data_export", {"result": ident, "path": str(target)})])
        second = await manager.send(session_id, "export it")
        await _settle(runs, second)
        logged = await events.for_run(second)
        (asked,) = [e for e in logged if isinstance(e, ApprovalNeededEvent)]
        assert not target.exists()
        assert asked.data.name == "data_export"
        diff = asked.data.diff or ""
        assert f"query   {ident} (select 1 as id, 'a, b' as note union all select 2, 'c'" in diff
        assert "2 rows)" in diff
        assert "format  csv" in diff
        assert f"path    {target}   new file" in diff
        assert "source  @golem stays as it is: read-only" in diff
        await manager.respond(session_id, asked.data.call_id, decision)  # type: ignore[arg-type]
        async with asyncio.timeout(20):
            while True:
                run = await runs.get(second)
                after = await events.for_run(second)
                if (
                    run is not None
                    and run.status != "running"
                    and any(e.type == "run.completed" for e in after)
                ):
                    break
                await asyncio.sleep(0.02)
        await manager.close(session_id)
    done = [e for e in after if isinstance(e, ToolCompletedEvent)]
    if decision == "deny":
        assert not target.exists() and done == []
        return
    failed = [e.data for e in after if isinstance(e, ToolFailedEvent)]
    assert failed == []
    assert target.read_text() == 'id,note\n1,"a, b"\n2,c\n'
    (wrote,) = done
    assert wrote.data.preview == f"wrote 2 rows to {target}"
    assert not any(isinstance(e, ToolFailedEvent) for e in after)


def test_the_tool_asks_in_every_mode_and_says_it_sends_no_rows() -> None:
    assert "whatever its privacy level" in DATA_EXPORT.description
    assert DATA_EXPORT.read_only is False and DATA_EXPORT.allow_from is None
    assert ToolRegistry([DATA_EXPORT]).default_allowed("autopilot") == []
