"""File sources: every kind, inspect, add / update / remove, the one-time download, watching."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, cast

import duckdb
import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings
from golem.data.client import DataWorker, Timing
from golem.data.engine import extension_installed, location_kind, sniff_kind
from golem.data.sources import DataSources
from golem.data.types import DataError, NeedsExtension
from golem.paths import GolemPaths, resolve_paths
from golem.server.dispatcher import INVALID_PARAMS

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
ONE_TIME = "needs a one-time download"
needs_excel = pytest.mark.skipif(
    not extension_installed(resolve_paths().data_extensions_dir, "excel"),
    reason="the excel extension is not installed",
)
needs_sqlite = pytest.mark.skipif(
    not extension_installed(resolve_paths().data_extensions_dir, "sqlite"),
    reason="the sqlite extension is not installed",
)


@pytest.fixture
def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    return found


Make = Callable[..., DataSources]


@pytest.fixture
async def make(paths: GolemPaths) -> AsyncIterator[Make]:
    opened: list[DataSources] = []

    def build(**options: Any) -> DataSources:
        worker = DataWorker(DataSettings(query_timeout_seconds=10, threads=1), paths, timing=FAST)
        found = DataSources(worker, paths, **options)
        opened.append(found)
        return found

    yield build
    for found in opened:
        await found.close()


def _bank(folder: Path, months: int = 3) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    for month in range(1, months + 1):
        (folder / f"2026-{month:02d}.csv").write_text(
            f"date,description,amount\n2026-{month:02d}-03,rent,-{month}00\n"
            f"2026-{month:02d}-15,pay,{month}500\n"
        )
    return folder


# -- the kinds -------------------------------------------------------------------------------


async def test_a_csv_a_tsv_a_parquet_and_json_lines_are_each_one_table(
    make: Make, tmp_path: Path
) -> None:
    folder = tmp_path / "kinds"
    folder.mkdir()
    (folder / "a.csv").write_text("id,city\n1,Prague\n2,Brno\n")
    (folder / "b.tsv").write_text("id\tcolor\n1\tred\n")
    (folder / "d.jsonl").write_text('{"id": 1, "tag": "x"}\n{"id": 2, "tag": "y"}\n')
    duckdb.connect().execute(f"copy (select 1 as id, 'p' as name) to '{folder / 'c.parquet'}'")
    sources = make()
    found = await sources.inspect(str(folder))
    assert found.kind == "files" and found.files == 4
    assert sorted(t.name for t in found.tables) == ["a", "b", "c", "d"]
    assert found.sample["a"] == [
        [str(folder / "a.csv"), 1, "Prague"],
        [str(folder / "a.csv"), 2, "Brno"],
    ]
    assert {t.name: t.rows for t in found.tables} == {"a": 2, "b": 1, "c": 1, "d": 2}


async def test_a_glob_of_files_with_one_shape_is_one_table_with_a_file_column(
    make: Make, tmp_path: Path
) -> None:
    bank = _bank(tmp_path / "bank")
    found = await make().inspect(f"{bank}/*.csv")
    (table,) = found.tables
    assert found.files == 3 and table.rows == 6
    assert next(c.name for c in table.columns) == "file"
    assert not any("different sets" in note for note in found.notes)


async def test_files_with_two_shapes_are_two_tables_and_a_note(make: Make, tmp_path: Path) -> None:
    bank = _bank(tmp_path / "bank", months=2)
    (bank / "cards.csv").write_text("card,limit\nvisa,500\n")
    found = await make().inspect(str(bank))
    assert len(found.tables) == 2 and found.files == 3
    assert any("2 different sets of columns" in note for note in found.notes)


async def test_files_a_folder_holds_that_golem_does_not_read_are_noted(
    make: Make, tmp_path: Path
) -> None:
    bank = _bank(tmp_path / "bank", months=1)
    (bank / "readme.txt").write_text("hello")
    found = await make().inspect(str(bank))
    assert any("1 file was skipped (.txt)" in note for note in found.notes)


def test_a_file_with_no_suffix_is_sniffed(tmp_path: Path) -> None:
    lite = tmp_path / "ledger"
    connection = sqlite3.connect(lite)
    connection.execute("create table t (a integer)")
    connection.commit()
    connection.close()
    assert sniff_kind(lite) == "sqlite" and location_kind(str(lite)) == "sqlite"
    plain = tmp_path / "rows"
    plain.write_text("a,b\n1,2\n")
    assert sniff_kind(plain) == "csv" and location_kind(str(plain)) == "files"
    assert location_kind(str(tmp_path / "x.duckdb")) == "duckdb"
    assert location_kind(str(tmp_path / "x.sqlite3")) == "sqlite"
    (tmp_path / "json").write_text('{"a": 1}')
    assert sniff_kind(tmp_path / "json") == "json"


async def test_a_duckdb_file_is_read_without_a_download(make: Make, tmp_path: Path) -> None:
    database = tmp_path / "shop.duckdb"
    connection = duckdb.connect(str(database))
    connection.execute("create table orders as select 1 as id, 9.5 as total")
    connection.close()
    found = await make().inspect(str(database))
    assert found.kind == "duckdb" and [t.name for t in found.tables] == ["orders"]
    assert found.sample["orders"] == [[1, 9.5]]


async def test_a_header_less_csv_gets_a_note(make: Make, tmp_path: Path) -> None:
    (tmp_path / "raw.csv").write_text("1,2,3\n4,5,6\n7,8,9\n")
    found = await make().inspect(str(tmp_path / "raw.csv"))
    assert any("no header row" in note for note in found.notes)


async def test_excel_and_sqlite_without_the_extension_say_what_to_do(
    make: Make, tmp_path: Path
) -> None:
    sheet = tmp_path / "budget.xlsx"
    sheet.write_bytes(b"PK\x03\x04 not really a workbook")
    lite = tmp_path / "ledger.sqlite"
    sqlite3.connect(lite).close()
    sources = make()
    for place, need in ((sheet, "excel"), (lite, "sqlite")):
        found = await sources.inspect(str(place))
        if extension_installed(sources._paths.data_extensions_dir, need):  # pyright: ignore[reportPrivateUsage]
            continue
        assert found.needs_extension == need and found.tables == ()
        assert ONE_TIME in found.notes[0] and "extensions.duckdb.org" in found.notes[0]
    assert str(NeedsExtension("excel")).startswith("Reading Excel needs a one-time download (2 MB)")


@needs_excel
async def test_an_excel_file_is_a_table(make: Make, tmp_path: Path, paths: GolemPaths) -> None:
    sheet = tmp_path / "budget.xlsx"
    connection = duckdb.connect()
    connection.execute(f"set extension_directory = '{paths.data_extensions_dir}'")
    connection.execute("load excel")
    connection.execute(f"copy (select 1 as id, 'rent' as item) to '{sheet}' (format xlsx)")
    connection.close()
    found = await make().inspect(str(sheet))
    assert [t.name for t in found.tables] == ["budget"] and found.tables[0].rows == 1


@needs_sqlite
async def test_a_sqlite_file_is_read_in_inspect(make: Make, tmp_path: Path) -> None:
    lite = tmp_path / "ledger.sqlite"
    connection = sqlite3.connect(lite)
    connection.execute("create table t (a integer)")
    connection.execute("insert into t values (1)")
    connection.commit()
    connection.close()
    found = await make().inspect(str(lite))
    assert found.kind == "sqlite" and found.tables[0].rows == 1


# -- inspect ---------------------------------------------------------------------------------


async def test_inspect_suggests_a_name_and_a_privacy_with_a_reason(
    make: Make, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bank = _bank(tmp_path / "bank-exports 2026")
    found = await make().inspect(str(bank))
    assert found.suggested_name == "bank_exports_2026"
    assert (found.suggested_privacy, found.privacy_reason) == ("local", "has an `amount` column")
    (tmp_path / "notes.csv").write_text("id,word\n1,a\n")
    monkeypatch.setenv("HOME", str(tmp_path))
    found = await make().inspect("~/notes.csv")
    assert found.privacy_reason == "in your home folder" and found.suggested_name == "notes"


async def test_inspect_names_are_unique_and_never_golem(
    make: Make, paths: GolemPaths, tmp_path: Path
) -> None:
    paths.config_file.write_text('[data.bank]\npath = "/x"\n')
    sources = make()
    assert sources.suggest_name(tmp_path / "bank", None) == "bank_2"
    assert sources.suggest_name(tmp_path / "golem", None) == "golem_2"
    assert sources.suggest_name(tmp_path / "2026", None) == "data_2026"


async def test_inspect_refuses_what_is_missing_empty_or_a_system_folder(
    make: Make, tmp_path: Path
) -> None:
    sources = make()
    with pytest.raises(DataError, match="There is nothing at"):
        await sources.inspect(str(tmp_path / "nope"))
    (tmp_path / "empty").mkdir()
    with pytest.raises(DataError, match="No CSV"):
        await sources.inspect(str(tmp_path / "empty"))
    with pytest.raises(DataError, match="system folder"):
        await sources.inspect("/etc")


async def test_inspect_leaves_nothing_open(make: Make, tmp_path: Path) -> None:
    sources = make()
    await sources.inspect(str(_bank(tmp_path / "bank")))
    assert sources.worker.running
    assert sources.worker._sources == {}  # pyright: ignore[reportPrivateUsage]


async def test_a_source_line_shows_files_and_the_months_of_a_date_column(
    make: Make, paths: GolemPaths, tmp_path: Path
) -> None:
    from golem.data.section import line

    bank = _bank(tmp_path / "bank", months=3)
    paths.config_file.write_text(f'[data.bank]\npath = "{bank}"\nprivacy = "local"\n')
    sources = make()
    (info,) = [i for i in await sources.list(None) if i.name == "bank"]
    assert line(info) == "- bank  1 table · 3 files · 6 rows · 2026-01 … 2026-03 · rows local"
    paths.config_file.write_text(f'[data.bank]\npath = "{bank}"\nprivacy = "schema"\n')
    await sources.forget("bank")
    (hidden,) = [i for i in await sources.list(None) if i.name == "bank"]
    assert "2026-01" not in line(hidden)


# -- watching --------------------------------------------------------------------------------


async def test_a_watched_folder_is_reopened_when_a_file_is_added(
    make: Make, paths: GolemPaths, tmp_path: Path
) -> None:
    bank = _bank(tmp_path / "bank", months=2)
    paths.config_file.write_text(f'[data.bank]\npath = "{bank}"\nwatch = true\n')
    sources = make(watch_seconds=0.1)
    changes: list[tuple[str, str]] = []
    sources.changed = lambda name, reason: changes.append((name, reason))
    (before,) = [i for i in await sources.list(None) if i.name == "bank"]
    assert before.rows == 4 and before.files == 2
    (bank / "2026-03.csv").write_text("date,description,amount\n2026-03-01,gift,50\n")
    for _ in range(100):
        await asyncio.sleep(0.05)
        if changes:
            break
    assert changes == [("bank", "files")]
    (after,) = [i for i in sources.snapshot(None) if i.name == "bank"]
    assert after.rows == 5 and after.files == 3
    (bank / "2026-03.csv").unlink()
    for _ in range(100):
        await asyncio.sleep(0.05)
        if len(changes) == 2:
            break
    assert len(changes) == 2
    assert [i.rows for i in sources.snapshot(None) if i.name == "bank"] == [4]


async def test_a_source_that_is_not_watched_stays_as_it_was(
    make: Make, paths: GolemPaths, tmp_path: Path
) -> None:
    bank = _bank(tmp_path / "bank", months=1)
    paths.config_file.write_text(f'[data.bank]\npath = "{bank}"\n')
    sources = make(watch_seconds=0.05)
    changes: list[tuple[str, str]] = []
    sources.changed = lambda name, reason: changes.append((name, reason))
    await sources.list(None)
    (bank / "2026-02.csv").write_text("date,description,amount\n2026-02-01,a,1\n")
    await asyncio.sleep(0.4)
    assert changes == []


# -- the methods over the socket -------------------------------------------------------------


async def _call(client: RpcClient, method: str, **params: object) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(await client.call(method, dict(params), timeout=30)))


async def _start(home: Path) -> tuple[Any, Any, RpcClient]:
    app, task = await start_daemon(home)
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


async def test_inspect_add_list_update_and_remove_over_the_socket(short_home: Path) -> None:
    bank = _bank(short_home.parent / "bank-1879", months=2)
    config = short_home / "config.toml"
    config.write_text('# my settings\ndefault_model = "sonnet"\n', encoding="utf-8")
    app, task, client = await _start(short_home)
    try:
        found = await _call(client, "data.inspect", location=str(bank))
        assert found["suggested_name"] == "bank_1879" and found["files"] == 2
        assert found["suggested_privacy"] == "local" and "amount" in found["privacy_reason"]
        assert len(found["sample"][found["tables"][0]["name"]]) == 4

        added = await _call(
            client, "data.add", name="bank", location=str(bank), privacy="local", scope="user"
        )
        assert added["source"]["name"] == "bank" and added["source"]["rows"] == 4
        assert added["source"]["watch"] is True  # a folder is watched unless it says otherwise
        text = config.read_text(encoding="utf-8")
        assert text.startswith("# my settings\n") and "[data.bank]" in text
        assert f'path = "{bank}"' in text and "kind" not in text

        await client.take_events()
        assert {"source": "bank", "reason": "added"} in [
            n["params"] for n in client.notices if n["method"] == "data.changed"
        ]

        again = await client.call(
            "data.add",
            {"name": "bank", "location": str(bank), "privacy": "open", "scope": "user"},
            timeout=30,
        )
        assert error_code(again) == INVALID_PARAMS and "already" in str(again["error"])
        reserved = await client.call(
            "data.add",
            {"name": "golem", "location": str(bank), "privacy": "open", "scope": "user"},
            timeout=30,
        )
        assert error_code(reserved) == INVALID_PARAMS and "built-in" in str(reserved["error"])
        odd = await client.call(
            "data.add",
            {"name": "1bad name", "location": str(bank), "privacy": "open", "scope": "user"},
            timeout=30,
        )
        assert error_code(odd) == INVALID_PARAMS

        updated = await _call(
            client, "data.update", name="bank", privacy="schema", watch=False, exclude=["x*"]
        )
        assert updated["source"]["privacy"] == "schema" and updated["source"]["watch"] is False
        text = config.read_text(encoding="utf-8")
        assert 'privacy = "schema"' in text and "watch" not in text and "x*" in text

        builtin = await client.call(
            "data.update", {"name": "golem", "privacy": "local"}, timeout=30
        )
        assert error_code(builtin) == INVALID_PARAMS and "built-in" in str(builtin["error"])
        gone = await client.call("data.remove", {"name": "golem"}, timeout=30)
        assert error_code(gone) == INVALID_PARAMS

        await _call(client, "data.remove", name="bank")
        text = config.read_text(encoding="utf-8")
        assert "[data" not in text and text.startswith("# my settings\n")
        names = [s["name"] for s in (await _call(client, "data.list"))["sources"]]
        assert names == ["golem"]
        none = await client.call("data.remove", {"name": "bank"}, timeout=30)
        assert error_code(none) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_source_needs_a_trusted_project(short_home: Path, tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    bank = _bank(tmp_path / "bank")
    params = {"name": "mine", "location": str(bank), "privacy": "local", "scope": "project"}
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        refused = await client.call("data.add", {**params, "session_id": session_id}, timeout=30)
        assert error_code(refused) == INVALID_PARAMS and "not in trusted_projects" in str(refused)
        assert error_code(await client.call("data.add", params, timeout=30)) == INVALID_PARAMS
        assert not (project / ".golem").exists()
    finally:
        await client.close()
        await stop_daemon(app, task)

    (short_home / "config.toml").write_text(
        f'trusted_projects = ["{project.resolve()}"]\n', encoding="utf-8"
    )
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        added = await _call(client, "data.add", **params, session_id=session_id)
        assert added["source"]["scope"] == "project"
        assert "[data.mine]" in (project / ".golem" / "config.toml").read_text(encoding="utf-8")
        assert "data.mine" not in (short_home / "config.toml").read_text(encoding="utf-8")
        await _call(client, "data.update", name="mine", privacy="open", session_id=session_id)
        assert 'privacy = "open"' in (project / ".golem" / "config.toml").read_text()
        await _call(client, "data.remove", name="mine", session_id=session_id)
        assert "[data.mine]" not in (project / ".golem" / "config.toml").read_text()
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_workbook_needs_a_download_that_a_query_never_makes(short_home: Path) -> None:
    sheet = short_home.parent / "budget-1879.xlsx"
    sheet.write_bytes(b"PK\x03\x04 not really a workbook")
    app, task, client = await _start(short_home)
    try:
        if extension_installed(app.paths.data_extensions_dir, "excel"):
            pytest.skip("the excel extension is installed")
        found = await _call(client, "data.inspect", location=str(sheet))
        assert found["needs_extension"] == "excel" and found["tables"] == []
        assert found["notes"][0].startswith("Reading Excel needs a one-time download")
        added = await _call(
            client, "data.add", name="budget", location=str(sheet), privacy="local", scope="user"
        )
        assert added["source"]["needs_extension"] == "excel"
        assert added["source"]["watch"] is False  # a single file is not watched by default
        query = await client.call("data.query", {"source": "budget", "sql": "select 1"}, timeout=30)
        assert error_code(query) == INVALID_PARAMS and ONE_TIME in str(query["error"])
        assert not any(app.paths.data_extensions_dir.glob("**/*.duckdb_extension"))
        bad = await client.call("data.extension.install", {"name": "nope"}, timeout=30)
        assert error_code(bad) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_new_methods_are_browser_methods() -> None:
    from golem_protocol.methods import METHOD_ACCESS

    for method in ("inspect", "add", "update", "remove", "extension.install"):
        assert METHOD_ACCESS[f"data.{method}"] == "browser"
    assert json.dumps(METHOD_ACCESS)
