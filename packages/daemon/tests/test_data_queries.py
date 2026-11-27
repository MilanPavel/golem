"""Saved queries: the store, the data.queries.* methods, and what the model sees."""

from __future__ import annotations

import tomllib
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings
from golem.data.client import DataWorker, Timing
from golem.data.queries import QUERIES_FILE, RUNS_FILE, SavedQuery, read_queries, write_queries
from golem.data.sources import DataSources
from golem.data.tools import DATA_DESCRIBE, DATA_QUERY
from golem.paths import GolemPaths
from golem.server.app import DaemonApp
from golem.server.dispatcher import INVALID_PARAMS
from golem.store.database import Database
from golem.tools.registry import ToolContext, ToolError

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
Make = Callable[..., DataSources]
TOTALS = "select sum(total) as total from orders"


@pytest.fixture
async def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    async with Database.open(found.database_file):
        pass
    return found


@pytest.fixture
async def make(paths: GolemPaths) -> AsyncIterator[Make]:
    opened: list[DataSources] = []

    def build() -> DataSources:
        worker = DataWorker(DataSettings(query_timeout_seconds=10, threads=1), paths, timing=FAST)
        found = DataSources(worker, paths, trusted=lambda _root: True)
        opened.append(found)
        return found

    yield build
    for found in opened:
        await found.close()


def _shop(folder: Path) -> Path:
    shop = folder / "shop"
    shop.mkdir(parents=True, exist_ok=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n3,7\n")
    return shop


def _config(paths: GolemPaths, text: str) -> None:
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    paths.config_file.write_text(text, encoding="utf-8")


def _ctx(sources: DataSources) -> ToolContext:
    return ToolContext(root=None, data=sources.access(None))


def _file(paths: GolemPaths) -> Path:
    return paths.home / "data" / "shop" / QUERIES_FILE


async def test_the_store_round_trips_and_a_project_source_writes_into_the_project(
    make: Make, paths: GolemPaths, tmp_path: Path
) -> None:
    shop = _shop(paths.home.parent)
    project = tmp_path / "proj"
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(
        f'[data.local_shop]\npath = "{shop}/*.csv"\n', encoding="utf-8"
    )
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    sources = make()
    sql = "select id,\n       total\nfrom orders\nwhere total > 8"
    mine = await sources.save_query(None, "shop", "Big orders", sql, "Orders over 8")
    assert (mine.name, mine.sql, mine.description) == ("Big orders", sql, "Orders over 8")
    assert tomllib.loads(_file(paths).read_text())["query"][0]["name"] == "Big orders"
    assert read_queries(_file(paths)) == [SavedQuery("Big orders", sql, "Orders over 8")]
    await sources.save_query(project, "local_shop", "All", "select * from orders", None)
    inside = project.resolve() / ".golem" / "data" / "local_shop" / QUERIES_FILE
    assert inside.is_file() and sources.queries_path(project, "local_shop") == inside
    assert [q.name for q in await sources.list_queries(project, "local_shop")] == ["All"]


async def test_a_taken_name_needs_replace_and_a_rename_works(make: Make, paths: GolemPaths) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\n')
    sources = make()
    await sources.save_query(None, "shop", "Totals", TOTALS, None)
    with pytest.raises(Exception, match=r'already a query called "Totals"'):
        await sources.save_query(None, "shop", "  totals ", "select 1", None)
    again = await sources.save_query(None, "shop", "totals", "select 1", "new", replace=True)
    assert again.name == "totals" and again.sql == "select 1"
    assert [q.name for q in await sources.list_queries(None, "shop")] == ["totals"]
    await sources.save_query(None, "shop", "Other", "select 2", None)
    renamed = await sources.save_query(
        None, "shop", "Sums", "select 3", None, previous_name="Other"
    )
    assert renamed.name == "Sums"
    assert [q.name for q in await sources.list_queries(None, "shop")] == ["totals", "Sums"]
    with pytest.raises(Exception, match="already a query"):
        await sources.save_query(None, "shop", "TOTALS", "select 4", None, previous_name="Sums")
    with pytest.raises(Exception, match="no query called"):
        await sources.save_query(None, "shop", "X", "select 5", None, previous_name="Gone")
    with pytest.raises(Exception, match="1 to 80"):
        await sources.save_query(None, "shop", " ", "select 1", None)
    with pytest.raises(Exception, match="1 to 80"):
        await sources.save_query(None, "shop", "n" * 81, "select 1", None)


async def test_a_writing_sql_is_refused_at_save_with_the_guards_sentence(
    make: Make, paths: GolemPaths
) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\n')
    sources = make()
    with pytest.raises(Exception, match="Only queries that read"):
        await sources.save_query(None, "shop", "Bad", "drop table orders", None)
    assert not _file(paths).exists()


async def test_a_run_is_recorded_apart_and_the_toml_is_not_touched(
    make: Make, paths: GolemPaths
) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\n')
    sources = make()
    await sources.save_query(None, "shop", "Totals", TOTALS, None)
    await sources.save_query(None, "shop", "Broken", "select nope from orders", None)
    before = _file(paths).read_bytes()
    result = await sources.query_saved(None, "shop", "totals")
    assert result.rows == [[49.5]]
    with pytest.raises(Exception, match="nope"):
        await sources.query_saved(None, "shop", "Broken")
    assert _file(paths).read_bytes() == before
    assert (paths.home / "data" / RUNS_FILE).is_file()
    ran = {q.name: q for q in await sources.list_queries(None, "shop")}
    assert ran["Totals"].last_rows == 1 and ran["Totals"].last_run_at is not None
    assert ran["Totals"].last_error is None
    assert ran["Broken"].last_error is not None and "nope" in ran["Broken"].last_error
    await sources.remove_query(None, "shop", "Totals")
    assert [q.name for q in await sources.list_queries(None, "shop")] == ["Broken"]
    with pytest.raises(Exception, match="no query called"):
        await sources.remove_query(None, "shop", "Totals")
    await sources.remove_query(None, "shop", "Broken")
    assert not _file(paths).exists()


async def test_removing_a_source_leaves_its_queries(make: Make, paths: GolemPaths) -> None:
    shop = _shop(paths.home.parent)
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    sources = make()
    await sources.save_query(None, "shop", "Totals", TOTALS, None)
    _config(paths, "")
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    assert [q.name for q in await sources.list_queries(None, "shop")] == ["Totals"]


async def test_data_describe_lists_saved_queries_for_the_model(
    make: Make, paths: GolemPaths
) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\nprivacy = "schema"\n')
    sources = make()
    ctx = _ctx(sources)
    assert "saved queries: none" in (await DATA_DESCRIBE.call({"source": "shop"}, ctx)).output
    await sources.save_query(None, "shop", "Totals", TOTALS, "Money in, all orders")
    await sources.save_query(None, "shop", "Long", "select " + ", ".join(["total"] * 120), None)
    text = (await DATA_DESCRIBE.call({"source": "shop"}, ctx)).output
    assert "saved queries:\n  Totals — Money in, all orders\n    " + TOTALS + "\n" in text
    assert '(run one with data_query(source="shop", saved="Totals"))' in text
    long = next(line for line in text.splitlines() if line.startswith("    select total, total"))
    assert len(long) <= 310 and long.endswith("…")


async def test_data_query_runs_a_saved_query_and_wants_exactly_one_of_sql_and_saved(
    make: Make, paths: GolemPaths
) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\n')
    sources = make()
    ctx = _ctx(sources)
    await sources.save_query(None, "shop", "Totals", TOTALS, None)
    ran = await DATA_QUERY.call({"source": "shop", "saved": "totals"}, ctx)
    assert "49.5" in ran.output
    assert ran.table is not None and ran.table.sql == TOTALS
    plain = await DATA_QUERY.call({"source": "shop", "sql": "select 1 as one"}, ctx)
    assert plain.table is not None and plain.table.sql == "select 1 as one"
    for args in (
        {"source": "shop"},
        {"source": "shop", "sql": "select 1", "saved": "Totals"},
    ):
        with pytest.raises(ToolError, match="either sql or the name"):
            await DATA_QUERY.call(args, ctx)
    with pytest.raises(ToolError, match="no saved query called"):
        await DATA_QUERY.call({"source": "shop", "saved": "Nope"}, ctx)


def test_the_model_has_no_tool_to_save_a_query() -> None:
    from golem.data.tools import DATA_TOOLS

    assert not [t.name for t in DATA_TOOLS if "save" in t.name or "queries" in t.name]


async def test_a_broken_file_does_not_break_a_description(make: Make, paths: GolemPaths) -> None:
    _config(paths, f'[data.shop]\npath = "{_shop(paths.home.parent)}/*.csv"\n')
    sources = make()
    _file(paths).parent.mkdir(parents=True)
    _file(paths).write_text("[[query\nname =", encoding="utf-8")
    assert (await sources.describe(None, "shop")).queries == ()
    with pytest.raises(Exception, match="not valid TOML"):
        await sources.save_query(None, "shop", "Totals", TOTALS, None)
    write_queries(_file(paths), [])
    assert not _file(paths).exists()


# -- over the socket ---------------------------------------------------------------------------


@asynccontextmanager
async def _daemon(home: Path) -> AsyncGenerator[tuple[DaemonApp, RpcClient]]:
    app, task = await start_daemon(home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        yield app, client
    finally:
        await client.close()
        await stop_daemon(app, task)


async def _call(client: RpcClient, method: str, **params: object) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(await client.call(method, dict(params), timeout=20)))


async def test_the_queries_methods_save_describe_run_and_remove(short_home: Path) -> None:
    shop = _shop(short_home.parent)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "schema"\n', encoding="utf-8"
    )
    async with _daemon(short_home) as (_, client):
        saved = await _call(
            client, "data.queries.save", source="shop", name="Totals", sql=TOTALS, description="d"
        )
        assert saved["query"]["name"] == "Totals" and saved["query"]["last_run_at"] is None
        clash = await client.call(
            "data.queries.save", {"source": "shop", "name": "totals", "sql": "select 1"}
        )
        assert error_code(clash) == INVALID_PARAMS and "already a query" in str(clash["error"])
        writes = await client.call(
            "data.queries.save", {"source": "shop", "name": "Bad", "sql": "drop table orders"}
        )
        assert error_code(writes) == INVALID_PARAMS and "Only queries that read" in str(writes)
        renamed = await _call(
            client,
            "data.queries.save",
            source="shop",
            name="Sums",
            sql=TOTALS,
            previous_name="Totals",
        )
        assert renamed["query"]["name"] == "Sums"
        ran = await _call(client, "data.query", source="shop", saved="sums")
        assert ran["rows"] == [[49.5]]
        both = await client.call(
            "data.query", {"source": "shop", "sql": "select 1", "saved": "Sums"}
        )
        neither = await client.call("data.query", {"source": "shop"})
        assert error_code(both) == INVALID_PARAMS and error_code(neither) == INVALID_PARAMS
        described = await _call(client, "data.describe", source="shop")
        (query,) = described["queries"]
        assert query["name"] == "Sums" and query["last_rows"] == 1 and query["last_ms"] >= 0
        await _call(client, "data.queries.remove", source="shop", name="Sums")
        assert (await _call(client, "data.describe", source="shop"))["queries"] == []
        gone = await client.call("data.queries.remove", {"source": "shop", "name": "Sums"})
        assert error_code(gone) == INVALID_PARAMS
        nowhere = await client.call(
            "data.queries.save", {"source": "nope", "name": "A", "sql": "select 1"}
        )
        assert error_code(nowhere) == INVALID_PARAMS
