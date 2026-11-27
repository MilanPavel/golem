"""The data.* methods over the daemon's socket, and a workflow step that queries a source."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import textwrap
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings
from golem.data.client import DataWorker
from golem.data.sources import DataSources
from golem.paths import GolemPaths
from golem.permissions.policy import Policy
from golem.server.app import DaemonApp
from golem.server.dispatcher import INVALID_PARAMS
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.tools import default_registry
from golem.workflows.service import WorkflowService
from golem.workflows.tools import WorkflowTools

SLOW = "select count(*) from range(1000000000000) a, range(1000000000000) b"


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


def _seed(app: DaemonApp) -> None:
    connection = sqlite3.connect(app.paths.database_file)
    for number, (model, cost) in enumerate([("sonnet", 0.25), ("sonnet", 0.5), ("haiku", 0.05)]):
        connection.execute(
            "INSERT INTO model_calls (call_id, role, model, tier, started_at, day, cost_usd)"
            " VALUES (?, 'chat', ?, 'hosted', '2026-11-25T10:00:00Z', '2026-11-25', ?)",
            (f"c{number}", model, cost),
        )
    connection.commit()
    connection.close()


def _shop(home: Path) -> Path:
    shop = home.parent / "shop"
    shop.mkdir(exist_ok=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n")
    return shop


async def _call(client: RpcClient, method: str, **params: object) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(await client.call(method, dict(params), timeout=20)))


async def test_data_list_describe_and_query_round_trip(short_home: Path) -> None:
    shop = _shop(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "schema"\n', encoding="utf-8"
    )
    async with _daemon(short_home) as (app, client):
        _seed(app)
        listed = (await _call(client, "data.list"))["sources"]
        names = {source["name"]: source for source in listed}
        assert list(names) == ["golem", "shop"]
        assert (names["golem"]["kind"], names["golem"]["scope"], names["golem"]["tables"]) == (
            "builtin",
            "builtin",
            5,
        )
        assert names["golem"]["rows"] == 3 and names["golem"]["privacy"] == "open"
        assert names["shop"]["status"] == "ready" and names["shop"]["rows"] == 2
        assert "password" not in json.dumps(listed)

        golem = await _call(client, "data.describe", source="golem", table="usage")
        assert golem["tables"][0]["name"] == "usage" and golem["tables"][0]["rows"] == 3
        assert {c["name"] for c in golem["tables"][0]["columns"]} >= {"model", "cost_usd"}
        assert len(golem["sample"]["usage"]) == 3
        assert "No message text" in golem["notes"]

        hidden = await _call(client, "data.describe", source="shop")
        assert hidden["sample"] == {}  # privacy "schema": the user sees no rows either
        assert hidden["notes"] is None

        result = await _call(
            client,
            "data.query",
            source="shop",
            sql="select sum(total) as total from orders",
        )
        assert result["rows"] == [[42.5]] and result["columns"][0]["name"] == "total"
        assert result["result_id"].startswith("res_") and result["truncated"] is False

        by_model = await _call(
            client,
            "data.query",
            source="golem",
            sql="select model, sum(cost_usd) from usage group by model order by 1",
            result_id="mine_1",
        )
        assert by_model["result_id"] == "mine_1"
        assert by_model["rows"] == [["haiku", 0.05], ["sonnet", 0.75]]


async def test_data_errors_are_invalid_params_with_a_reason(short_home: Path) -> None:
    async with _daemon(short_home) as (_, client):
        refused = await client.call(
            "data.query", {"source": "golem", "sql": "drop table usage"}, timeout=20
        )
        assert error_code(refused) == INVALID_PARAMS
        assert "Only queries that read" in str(refused["error"])
        missing = await client.call("data.describe", {"source": "nope"}, timeout=20)
        assert error_code(missing) == INVALID_PARAMS and "nope" in str(missing["error"])
        session = await client.call("data.list", {"session_id": "s_nope"}, timeout=20)
        assert error_code(session) == INVALID_PARAMS


async def test_data_result_page_pages_a_kept_result_of_any_source(short_home: Path) -> None:
    shop = _shop(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "schema"\n', encoding="utf-8"
    )
    async with _daemon(short_home) as (_app, client):
        sql = "select id, total from orders order by id"
        query = await _call(client, "data.query", source="shop", sql=sql, result_id="res_page1")
        assert (query["total_rows"], query["rows"]) == (2, [[1, 10.0], [2, 32.5]])
        page = await _call(client, "data.result.page", result_id="res_page1", offset=1, limit=5)
        assert page["source"] == "shop" and page["total_rows"] == 2
        assert page["rows"] == [[2, 32.5]]
        desc = await _call(
            client, "data.result.page", result_id="res_page1", sort_column="id", sort_desc=True
        )
        assert [row[0] for row in desc["rows"]] == [2, 1]
        bad = await client.call("data.result.page", {"result_id": "res_nope"})
        assert error_code(bad) == INVALID_PARAMS


async def test_data_export_writes_a_new_file_and_refuses_what_it_should(short_home: Path) -> None:
    shop = _shop(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "schema"\n', encoding="utf-8"
    )
    async with _daemon(short_home) as (_app, client):
        sql = "select id, total from orders order by id"
        await _call(client, "data.query", source="shop", sql=sql, result_id="res_exp1")
        out = short_home / "out.csv"
        done = await _call(client, "data.export", result_id="res_exp1", path=str(out))
        assert (done["path"], done["rows"]) == (str(out), 2)
        assert out.read_text() == "id,total\n1,10.0\n2,32.5\n"
        again = await client.call("data.export", {"result_id": "res_exp1", "path": str(out)})
        assert error_code(again) == INVALID_PARAMS and "already exists" in str(again["error"])
        inside = await client.call(
            "data.export", {"result_id": "res_exp1", "path": str(shop / "copy.csv")}
        )
        assert error_code(inside) == INVALID_PARAMS and "never written to" in str(inside["error"])
        gone = await client.call("data.export", {"result_id": "res_nope", "path": "/tmp/x.csv"})
        assert error_code(gone) == INVALID_PARAMS
        sheet = await _call(
            client, "data.export", result_id="res_exp1", path=str(short_home / "out.xlsx")
        )
        assert sheet == {"path": "", "rows": 0, "needs_extension": "excel"}
        assert not (short_home / "out.xlsx").exists()


async def test_data_cancel_stops_a_slow_query_by_its_result_id(short_home: Path) -> None:
    async with _daemon(short_home) as (_, client):
        await _call(client, "data.list")  # open the built-in source first
        slow = asyncio.create_task(
            client.call(
                "data.query",
                {"source": "golem", "sql": SLOW, "result_id": "slow_1"},
                timeout=20,
            )
        )
        await asyncio.sleep(0.5)
        assert await _call(client, "data.cancel", result_id="slow_1") == {}
        answer = await slow
        assert error_code(answer) == INVALID_PARAMS and "cancelled" in str(answer["error"])
        assert await _call(client, "data.cancel", result_id="slow_1") == {}  # already gone
        assert (await _call(client, "data.query", source="golem", sql="select 1"))["rows"] == [[1]]


# -- a workflow step -----------------------------------------------------------------------------

FLOW = """
from golem.workflow import workflow, Run

@workflow()
async def flow(run: Run):
    sql = "select model, sum(cost_usd) as c from usage group by model order by 1"
    return await run.tool("data_query", source="golem", sql=sql)
"""


async def test_a_workflow_step_calls_data_query(tmp_path: Path) -> None:
    paths = GolemPaths(tmp_path / "home")
    paths.ensure_layout()
    async with Database.open(paths.database_file) as database:
        connection = sqlite3.connect(paths.database_file)
        connection.execute(
            "INSERT INTO model_calls (call_id, role, model, tier, started_at, day, cost_usd)"
            " VALUES ('c1', 'chat', 'sonnet', 'hosted', '2026-11-25T10:00:00Z', '2026-11-25', 0.5)"
        )
        connection.commit()
        connection.close()
        sources = DataSources(DataWorker(DataSettings(threads=1), paths), paths)
        store = WorkflowRuns(database)
        service = WorkflowService(
            runs=store,
            user_dir=tmp_path / "workflows",
            user_file=tmp_path / "config.toml",
            trusted=lambda _p: True,
            broadcast=lambda _m: None,
            tools=WorkflowTools(
                registry=default_registry(),
                policy=Policy(tmp_path / "config.toml", home=tmp_path),
                data=sources,
            ),
        )
        path = tmp_path / "wf.py"
        path.write_text(textwrap.dedent(FLOW))
        run_id = await store.create_run(f"{path}::flow", "flow", str(path), "2026-11-25T10:00:00Z")
        await store.set_run_session(run_id, "s_wf")
        service.launch(run_id)
        run = None
        try:
            for _ in range(300):
                run = await store.get_run(run_id)
                if run is not None and run.status in ("done", "failed"):
                    break
                await asyncio.sleep(0.05)
        finally:
            await service.aclose()
            await sources.close()
        step = await store.get_step(run_id, "tool:data_query")
        assert run is not None and run.status == "done", run.error if run else None
        assert step is not None and step.status == "done"
        text = json.loads(step.result_json or "null")
        assert "model" in text and "sonnet  0.5" in text and "<data_rows" in text
