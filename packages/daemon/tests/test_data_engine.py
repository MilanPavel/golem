"""The engine over a temp folder: tables, types, limits, and every way out of the folder."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

import duckdb
import pytest

from golem.data.engine import Limits, Source, extension_installed
from golem.data.types import DataError, SourceSpec
from golem.paths import resolve_paths

SMALL = Limits(memory="512MB", threads=1)


def _source(location: Path | str, kind: str = "files", limits: Limits = SMALL) -> Source:
    spec = SourceSpec.from_json({"name": "s", "kind": kind, "location": str(location)})
    return Source(spec, limits)


def _rows(source: Source, sql: str, limit: int = 100) -> list[list[Any]]:
    return source.query(sql, limit)["rows"]


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    base = tmp_path / "sales"
    base.mkdir()
    for month, amounts in (("jan", (1, 2)), ("feb", (3,)), ("mar", (4, 5))):
        lines = "\n".join(f"{month},{value}" for value in amounts)
        (base / f"sales_{month}.csv").write_text(f"month,amount\n{lines}\n")
    return base


def test_a_glob_of_csvs_with_the_same_columns_is_one_table_with_a_file_column(folder: Path) -> None:
    source = _source(folder / "*.csv")
    assert source.tables() == [{"name": "sales", "type": "view"}]
    result = source.query("select file, month, amount from sales order by file, amount", 100)
    assert [c["name"] for c in result["columns"]] == ["file", "month", "amount"]
    assert len(result["rows"]) == 5
    assert {Path(row[0]).name for row in result["rows"]} == {
        "sales_jan.csv",
        "sales_feb.csv",
        "sales_mar.csv",
    }


def test_a_folder_is_read_like_a_star_glob(folder: Path) -> None:
    assert [t["name"] for t in _source(folder).tables()] == ["sales"]


def test_files_with_other_columns_are_tables_of_their_own(folder: Path) -> None:
    (folder / "people.csv").write_text("name,age\nann,30\n")
    names = [t["name"] for t in _source(folder).tables()]
    assert names == ["people", "sales"]


def test_one_file_is_a_table_named_from_its_stem(folder: Path) -> None:
    source = _source(folder / "sales_jan.csv")
    assert source.tables() == [{"name": "sales_jan", "type": "view"}]
    assert _rows(source, "select count(*) from sales_jan") == [[2]]


def test_parquet_and_json_lines(tmp_path: Path) -> None:
    con = duckdb.connect()
    con.execute(f"copy (select 1 as id, 'a' as tag) to '{tmp_path / 'p.parquet'}' (format parquet)")
    (tmp_path / "events.jsonl").write_text('{"id": 1, "tag": "x"}\n{"id": 2, "tag": "y"}\n')
    source = _source(tmp_path)
    assert [t["name"] for t in source.tables()] == ["events", "p"]
    assert _rows(source, "select id, tag from events order by id") == [[1, "x"], [2, "y"]]
    assert _rows(source, "select id, tag from p") == [[1, "a"]]


def test_a_semicolon_csv_gets_its_columns_and_types(tmp_path: Path) -> None:
    (tmp_path / "eu.csv").write_text("day;price;note\n2024-01-05;1,5;a\n2024-02-06;2,5;b\n")
    result = _source(tmp_path / "eu.csv").query("select day, note from eu order by day", 10)
    assert [(c["name"], c["type"]) for c in result["columns"]] == [
        ("day", "DATE"),
        ("note", "VARCHAR"),
    ]
    assert result["rows"] == [["2024-01-05", "a"], ["2024-02-06", "b"]]


def test_values_become_json_safe(tmp_path: Path) -> None:
    (tmp_path / "t.csv").write_text("a\n1\n")
    source = _source(tmp_path / "t.csv")
    row = _rows(
        source,
        "select date '2024-03-01', timestamp '2024-03-01 10:00:00', time '10:20:30', "
        "1.50::decimal(5,2), 2::decimal(5,2), 'nan'::double, [1, 2], {'k': 1}, "
        "'\\xAA'::blob, interval 1 day",
    )[0]
    assert row == [
        "2024-03-01",
        "2024-03-01T10:00:00",
        "10:20:30",
        1.5,
        2,
        "nan",
        [1, 2],
        {"k": 1},
        "aa",
        "1 day, 0:00:00",
    ]


def test_describe_gives_columns_types_and_stats(folder: Path) -> None:
    (folder / "sales_apr.csv").write_text("month,amount\napr,\napr,9\n")
    source = _source(folder / "*.csv")
    info = source.describe("sales")
    assert info["rows"] == 7
    amount = next(c for c in info["columns"] if c["name"] == "amount")
    assert amount["type"] == "BIGINT"
    assert (amount["min"], amount["max"]) == ("1", "9")
    assert amount["distinct"] >= 5
    assert amount["null_percent"] == pytest.approx(100 / 7, abs=0.5)  # pyright: ignore[reportUnknownMemberType]
    with pytest.raises(DataError, match="There is no table called nope"):
        source.describe("nope")


def test_a_query_over_the_limit_is_cut_and_says_so(folder: Path) -> None:
    source = _source(folder / "*.csv")
    cut = source.query("select * from sales", 3)
    assert len(cut["rows"]) == 3
    assert cut["truncated"] is True
    whole = source.query("select * from sales", 5)
    assert len(whole["rows"]) == 5
    assert whole["truncated"] is False


def test_the_guard_runs_before_the_engine(folder: Path) -> None:
    source = _source(folder / "*.csv")
    with pytest.raises(DataError, match="Only one statement"):
        source.query("select 1; select 2", 10)
    with pytest.raises(DataError, match="Only queries that read"):
        source.query("delete from sales", 10)


def test_no_files_and_a_missing_folder_are_plain_errors(tmp_path: Path) -> None:
    with pytest.raises(DataError, match="No CSV, Parquet or JSON files"):
        _source(tmp_path)
    with pytest.raises(DataError, match="There is no folder"):
        _source(tmp_path / "gone" / "*.csv")


# -- escapes: each one must fail --------------------------------------------------------------


@pytest.fixture
def secret(tmp_path: Path) -> Path:
    path = tmp_path / "outside" / "secret.csv"
    path.parent.mkdir()
    path.write_text("token\nhunter2\n")
    return path


def _refused(source: Source, sql: str) -> str:
    """Run ``sql`` on the engine's own cursor, past the guard, and return DuckDB's error."""
    cursor = source.cursor()
    try:
        with pytest.raises(duckdb.Error) as caught:
            cursor.execute(sql).fetchall()
    finally:
        cursor.close()
    return str(caught.value)


def test_reading_a_file_outside_the_folder_fails(folder: Path, secret: Path) -> None:
    source = _source(folder / "*.csv")
    assert "Permission Error" in _refused(source, f"select * from read_csv('{secret}')")
    assert "Permission Error" in _refused(
        source, f"select * from read_csv('{folder}/../outside/secret.csv')"
    )
    assert "Permission Error" in _refused(source, "select * from read_csv('/etc/hosts')")


def test_copy_to_fails(folder: Path, tmp_path: Path) -> None:
    source = _source(folder / "*.csv")
    target = tmp_path / "out.csv"
    _refused(source, f"copy (select 1) to '{target}'")
    _refused(source, f"copy (select * from sales) to '{folder}/new.csv'")
    jan = folder / "sales_jan.csv"
    before = jan.read_text()
    _refused(source, f"copy (select 'x' as month, 0 as amount) to '{jan}' (format csv)")
    assert not target.exists()
    assert not (folder / "new.csv").exists()
    assert jan.read_text() == before


def test_attach_install_and_load_fail(folder: Path, tmp_path: Path) -> None:
    source = _source(folder / "*.csv")
    _refused(source, f"attach '{tmp_path / 'x.db'}' as x")
    _refused(source, "install sqlite")
    _refused(source, f"load '{tmp_path / 'evil.duckdb_extension'}'")
    assert not (tmp_path / "x.db").exists()


def test_the_configuration_cannot_be_changed_back(folder: Path) -> None:
    source = _source(folder / "*.csv")
    _refused(source, "set enable_external_access = true")
    _refused(source, "set memory_limit = '64GB'")
    _refused(source, "set allowed_directories = ['/']")
    _refused(source, "set lock_configuration = false")


def test_a_symlink_that_points_outside_is_not_part_of_the_source(
    folder: Path, secret: Path
) -> None:
    os.symlink(secret, folder / "link.csv")
    os.symlink(secret.parent, folder / "dirlink")
    source = _source(folder / "*.csv")
    assert [t["name"] for t in source.tables()] == ["sales"]
    assert all("link.csv" not in str(row[0]) for row in _rows(source, "select file from sales"))
    assert "Permission Error" in _refused(source, f"select * from read_csv('{folder}/link.csv')")
    assert "Permission Error" in _refused(
        source, f"select * from read_csv('{folder}/dirlink/secret.csv')"
    )


def test_a_database_source_allows_only_its_own_file(tmp_path: Path) -> None:
    db = tmp_path / "one.duckdb"
    other = tmp_path / "two.csv"
    other.write_text("a\n1\n")
    con = duckdb.connect(str(db))
    con.execute("create table t as select 1 as a")
    con.close()
    source = _source(db, kind="duckdb")
    assert _rows(source, "select a from t") == [[1]]
    assert [t["name"] for t in source.tables()] == ["t"]
    assert "Permission Error" in _refused(source, f"select * from read_csv('{other}')")
    _refused(source, "create table u as select 1")


def test_a_bad_memory_size_is_refused(folder: Path) -> None:
    with pytest.raises(DataError, match="worker_memory"):
        _source(folder, limits=Limits(memory="lots"))


# -- sqlite needs a one-time extension download; these skip without it ----------------------------

_EXTENSIONS = resolve_paths().data_extensions_dir
needs_sqlite = pytest.mark.skipif(
    not extension_installed(_EXTENSIONS, "sqlite"), reason="the sqlite extension is not installed"
)


def _sqlite_file(path: Path) -> None:
    con = sqlite3.connect(path)
    con.execute("create table people (name text, age integer)")
    con.execute("insert into people values ('ann', 30), ('bob', 41)")
    con.commit()
    con.close()


def test_sqlite_without_the_extension_says_what_to_do(tmp_path: Path) -> None:
    db = tmp_path / "a.sqlite"
    _sqlite_file(db)
    with pytest.raises(DataError, match="one-time download of DuckDB's sqlite extension"):
        _source(db, kind="sqlite", limits=Limits(extension_dir=tmp_path / "no-extensions"))


@needs_sqlite
def test_a_sqlite_file_is_a_read_only_source(tmp_path: Path) -> None:
    db = tmp_path / "a.sqlite"
    _sqlite_file(db)
    source = _source(db, kind="sqlite", limits=Limits("512MB", 1, extension_dir=_EXTENSIONS))
    assert [t["name"] for t in source.tables()] == ["people"]
    assert _rows(source, "select name, age from people order by age") == [["ann", 30], ["bob", 41]]
    assert source.describe("people")["rows"] == 2
    _refused(source, "insert into people values ('eve', 1)")
    _refused(source, "install sqlite")
    other = tmp_path / "x.csv"
    other.write_text("a\n1\n")
    assert "Permission Error" in _refused(source, f"select * from read_csv('{other}')")
