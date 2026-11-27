"""The profile of a table's columns, and the pages of a table a person browses.

The page's SQL is built by golem from names it checks. These tests read a table through the
engine and through ``DataSources``, and try to slip text into a filter and a search.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import duckdb
import pytest

from golem.config import DataSettings
from golem.data import engine
from golem.data import profile as profile_module
from golem.data.client import DataWorker, Timing
from golem.data.engine import Limits, Source
from golem.data.sources import DataSources
from golem.data.types import DataError, SourceSpec
from golem.paths import GolemPaths

SMALL = Limits(memory="512MB", threads=1)
FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
ROWS = 60


def approx(value: float) -> Any:
    return pytest.approx(value)  # pyright: ignore[reportUnknownMemberType]


def _csv(folder: Path) -> Path:
    """60 passengers: an id, a 0/1, a number, a name, some text, a date and a mostly empty one."""
    lines = ["id,survived,fare,name,note,seen,cabin"]
    for i in range(1, ROWS + 1):
        note = "same" if i % 3 else f"other {i}"
        cabin = f"C{i}" if i % 10 == 0 else ""
        lines.append(f"{i},{i % 2},{i * 1.5},person {i},{note},2024-01-{(i % 28) + 1:02d},{cabin}")
    path = folder / "people.csv"
    path.write_text("\n".join(lines) + "\n")
    return path


def _source(path: Path) -> Source:
    spec = SourceSpec.from_json({"name": "s", "kind": "files", "location": str(path)})
    return Source(spec, SMALL)


@pytest.fixture
def people(tmp_path: Path) -> Source:
    return _source(_csv(tmp_path))


def _page(source: Source, **args: Any) -> dict[str, Any]:
    return source.browse("people", {"offset": 0, "limit": 200, **args})


def _by_name(found: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {c["name"]: c for c in found["columns"]}


# -- the profile -------------------------------------------------------------------------------


def test_each_column_has_a_shape(people: Source) -> None:
    found = _by_name(people.profile("people"))
    assert {n: c["shape"] for n, c in found.items() if n != "file"} == {
        "id": "key",
        "survived": "category",
        "fare": "number",
        "name": "key",
        "note": "text",
        "seen": "date",
        "cabin": "category",
    }


def test_a_key_is_unique_and_never_empty(people: Source) -> None:
    ident = _by_name(people.profile("people"))["id"]
    assert (ident["distinct"], ident["empty"], ident["min"], ident["max"]) == (ROWS, 0, 1, ROWS)


def test_a_number_has_a_mean_and_24_bins_that_add_up(people: Source) -> None:
    fare = _by_name(people.profile("people"))["fare"]
    assert fare["mean"] == approx(sum(i * 1.5 for i in range(1, ROWS + 1)) / ROWS)
    assert len(fare["bins"]) == profile_module.BINS
    assert sum(fare["bins"]) == ROWS
    assert (fare["min"], fare["max"]) == (1.5, ROWS * 1.5)


def test_a_category_lists_its_top_values_and_the_rest(people: Source) -> None:
    survived = _by_name(people.profile("people"))["survived"]
    assert [(t["value"], t["count"]) for t in survived["top"]] == [(0, 30), (1, 30)]
    assert survived["more_values"] == 0
    cabin = _by_name(people.profile("people"))["cabin"]
    assert cabin["empty"] == approx(0.9)
    assert len(cabin["top"]) == profile_module.TOP_VALUES
    assert cabin["more_values"] == 2
    assert cabin["more_rows"] == 2


def test_text_has_a_unique_ratio_a_length_and_its_most_common_value(people: Source) -> None:
    note = _by_name(people.profile("people"))["note"]
    assert note["shape"] == "text"
    assert note["unique_ratio"] == approx(21 / ROWS)
    assert note["avg_length"] == approx(
        sum(len("same" if i % 3 else f"other {i}") for i in range(1, ROWS + 1)) / ROWS
    )
    assert note["most_common"] == {"value": "same", "count": 40}


def test_dates_get_a_histogram_over_time(people: Source) -> None:
    seen = _by_name(people.profile("people"))["seen"]
    assert sum(seen["bins"]) == ROWS
    assert seen["min"] == "2024-01-01"
    assert seen["max"] == "2024-01-28"


def test_a_column_with_nothing_in_it_is_text_with_all_empty(tmp_path: Path) -> None:
    path = tmp_path / "gaps.csv"
    path.write_text("a,b\n1,\n2,\n")
    found = _by_name(_source(path).profile("gaps"))
    assert (found["b"]["shape"], found["b"]["empty"]) == ("text", 1.0)


def test_an_empty_table_profiles_without_error(tmp_path: Path) -> None:
    path = tmp_path / "none.csv"
    path.write_text("a,b\n")
    found = _source(path).profile("none")
    assert found["rows"] == 0
    assert all(c["shape"] == "text" for c in found["columns"])


def test_distinct_counts_are_estimates_above_a_million_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = _csv(tmp_path)
    monkeypatch.setattr(engine, "EXACT_DISTINCT_ROWS", 10)
    found = _source(path).profile("people")
    assert found["distinct_estimate"] is True
    columns = _by_name(found)
    # A column that looks like a key is counted exactly, so an estimate never claims one.
    assert (columns["id"]["shape"], columns["id"]["distinct_estimate"]) == ("key", False)
    assert columns["fare"]["distinct_estimate"] is True


def test_the_profile_of_a_table_that_is_not_there_says_so(people: Source) -> None:
    with pytest.raises(DataError, match="no table called nope"):
        people.profile("nope")


# -- paging --------------------------------------------------------------------------------------


def test_pages_have_no_overlap_and_no_gap(people: Source) -> None:
    ids: list[Any] = []
    for offset in range(0, ROWS, 25):
        page = _page(people, offset=offset, limit=25, sort={"column": "survived", "desc": False})
        assert page["total_rows"] == ROWS
        ids += [row[1] for row in page["rows"]]
    assert len(ids) == ROWS


def test_a_sorted_view_pages_in_one_stable_order(people: Source) -> None:
    sort = {"column": "survived", "desc": True}
    whole = _page(people, limit=ROWS, sort=sort)["rows"]
    paged: list[Any] = []
    for offset in range(0, ROWS, 7):
        paged += _page(people, offset=offset, limit=7, sort=sort)["rows"]
    assert paged == whole
    assert {row[2] for row in whole[:30]} == {1}
    assert len({row[1] for row in whole}) == ROWS


def test_sorting_puts_empty_values_last_both_ways(people: Source) -> None:
    for desc in (False, True):
        rows = _page(people, limit=ROWS, sort={"column": "cabin", "desc": desc})["rows"]
        names = [row[-1] for row in rows]
        assert names[:6].count(None) == 0
        assert names[6:] == [None] * (ROWS - 6)


def test_an_unsorted_view_follows_the_file(people: Source) -> None:
    rows = _page(people, offset=10, limit=5)["rows"]
    assert [row[1] for row in rows] == [11, 12, 13, 14, 15]


def test_a_filter_counts_across_the_whole_table(people: Source) -> None:
    page = _page(people, filters=[{"column": "survived", "op": "=", "value": 1}], limit=10)
    assert page["total_rows"] == 30
    assert len(page["rows"]) == 10
    assert {row[2] for row in page["rows"]} == {1}


def test_filters_add_up_and_is_null_finds_empty_cells(people: Source) -> None:
    both = [
        {"column": "survived", "op": "=", "value": 0},
        {"column": "cabin", "op": "is null"},
    ]
    assert _page(people, filters=both)["total_rows"] == 24
    assert (
        _page(people, filters=[{"column": "cabin", "op": "=", "value": "C10"}])["total_rows"] == 1
    )


def test_a_text_filter_takes_a_number_as_text(people: Source) -> None:
    page = _page(people, filters=[{"column": "name", "op": "=", "value": 5}])
    assert page["total_rows"] == 0


def test_search_finds_text_in_any_case_in_any_text_column(people: Source) -> None:
    assert _page(people, search="PERSON 7")["total_rows"] == 1
    assert _page(people, search="other")["total_rows"] == 20
    assert _page(people, search="   ")["total_rows"] == ROWS


def test_search_is_a_plain_substring_not_a_pattern(people: Source) -> None:
    assert _page(people, search="%")["total_rows"] == 0
    assert _page(people, search="p_r")["total_rows"] == 0


def test_pages_asked_at_the_same_moment_do_not_trip_over_each_other(people: Source) -> None:
    def first_id(start: int) -> Any:
        return _page(people, offset=start, limit=5, count=False)["rows"][0][1]

    for _ in range(5):
        with ThreadPoolExecutor(8) as pool:
            found = list(pool.map(first_id, range(0, 50, 5)))
        assert found == list(range(1, 51, 5))


def test_a_limit_can_be_asked_without_the_count(people: Source) -> None:
    assert _page(people, limit=3, count=False)["total_rows"] is None


# -- what is refused, and what is only text ----------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {"sort": {"column": "nope", "desc": False}},
        {"sort": {"column": 'id"; drop table people; --', "desc": False}},
        {"filters": [{"column": "nope", "op": "=", "value": 1}]},
        {"filters": [{"column": "id", "op": "like", "value": "%"}]},
        {"filters": [{"column": "id", "op": "= 1 or 1 = 1 --", "value": 1}]},
        {"filters": [{"column": "id", "op": "=", "value": None}]},
        {"offset": -1},
        {"limit": 0},
        {"limit": 501},
    ],
)
def test_an_unknown_column_a_bad_operator_or_a_bad_page_is_refused(
    people: Source, bad: dict[str, Any]
) -> None:
    with pytest.raises(DataError):
        _page(people, **bad)


def test_the_refusal_names_the_columns_there_are(people: Source) -> None:
    with pytest.raises(DataError, match=r"no column called nope in this table.*id, survived"):
        _page(people, sort={"column": "nope"})


@pytest.mark.parametrize(
    "text",
    [
        "x' or '1'='1",
        "1 or 1=1",
        "'; drop view people; --",
        "') or true or ('",
        '" or "1"="1',
    ],
)
def test_a_value_or_a_search_with_sql_in_it_is_only_text(people: Source, text: str) -> None:
    by_value = _page(people, filters=[{"column": "name", "op": "=", "value": text}])
    by_search = _page(people, search=text)
    assert (by_value["total_rows"], by_search["total_rows"]) == (0, 0)
    assert _page(people)["total_rows"] == ROWS  # the table is still there


def test_a_value_that_is_not_a_number_is_refused_for_a_number_column(people: Source) -> None:
    with pytest.raises(DataError):
        _page(people, filters=[{"column": "id", "op": "=", "value": "1 or 1=1"}])


def test_a_table_that_is_not_there_is_refused(people: Source) -> None:
    with pytest.raises(DataError, match="no table called"):
        people.browse("people; drop view people", {"offset": 0, "limit": 5})


def test_the_view_never_writes(people: Source) -> None:
    people.browse("people", {"offset": 0, "limit": 5, "search": "'); delete from people; --"})
    assert people.query("select count(*) from people", 1)["rows"] == [[ROWS]]
    assert isinstance(duckdb.__version__, str)


# -- through DataSources: the count is kept ------------------------------------------------------


@pytest.fixture
async def sources(tmp_path: Path) -> AsyncIterator[DataSources]:
    paths = GolemPaths(tmp_path / "home")
    paths.ensure_layout()
    data = tmp_path / "data"
    data.mkdir()
    _csv(data)
    paths.config_file.write_text(f'[data.people]\npath = "{data}/*.csv"\n', encoding="utf-8")
    worker = DataWorker(DataSettings(query_timeout_seconds=20, threads=1), paths, timing=FAST)
    found = DataSources(worker, paths)
    yield found
    await found.close()


async def test_a_page_of_a_table_through_the_sources(sources: DataSources) -> None:
    page = await sources.browse(None, "people", "people", offset=5, limit=3)
    assert page.total_rows == ROWS
    assert [row[1] for row in page.rows] == [6, 7, 8]
    assert [c["name"] for c in page.columns][:2] == ["file", "id"]


async def test_the_count_of_a_view_is_asked_once(
    sources: DataSources, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[bool] = []
    real = sources.worker.browse

    async def spy(source: str, table: str, args: dict[str, Any], **kw: Any) -> dict[str, Any]:
        asked.append(args["count"])
        return await real(source, table, args, **kw)

    monkeypatch.setattr(sources.worker, "browse", spy)
    view: dict[str, Any] = {"filters": [{"column": "survived", "op": "=", "value": 1}]}
    first = await sources.browse(None, "people", "people", offset=0, limit=10, **view)
    second = await sources.browse(None, "people", "people", offset=10, limit=10, **view)
    other = await sources.browse(None, "people", "people", offset=0, limit=10, search="other")
    assert (first.total_rows, second.total_rows, other.total_rows) == (30, 30, 20)
    assert asked == [True, False, True]


async def test_an_unfiltered_view_uses_the_row_count_the_source_already_has(
    sources: DataSources,
) -> None:
    await sources.list(None)
    seen: list[bool] = []
    real = sources.worker.browse

    async def spy(source: str, table: str, args: dict[str, Any], **kw: Any) -> dict[str, Any]:
        seen.append(args["count"])
        return await real(source, table, args, **kw)

    sources.worker.browse = spy  # type: ignore[method-assign]
    page = await sources.browse(None, "people", "people", offset=0, limit=5)
    assert (page.total_rows, seen) == (ROWS, [False])


async def test_a_table_of_another_source_or_a_hidden_one_is_refused(
    sources: DataSources,
) -> None:
    with pytest.raises(DataError, match="no table called secret"):
        await sources.browse(None, "people", "secret", offset=0, limit=5)
    with pytest.raises(DataError, match="no source called"):
        await sources.browse(None, "elsewhere", "people", offset=0, limit=5)


async def test_the_profile_is_kept_with_the_other_stats(sources: DataSources) -> None:
    first = await sources.profile(None, "people", "people")
    second = await sources.profile(None, "people", "people")
    assert second is first
    assert first["rows"] == ROWS
