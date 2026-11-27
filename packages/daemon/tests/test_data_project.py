"""A project's sources without a chat, and the whole view of a table kept to export."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings
from golem.data.client import DataWorker, Timing
from golem.data.sources import DataSources
from golem.paths import GolemPaths
from golem.server.dispatcher import INVALID_PARAMS
from golem.store.database import Database

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
ROWS = "id,team,total\n" + "".join(
    f"{n},{'red' if n % 2 else 'blue'},{n * 10}\n" for n in range(1, 11)
)


def _project(home: Path) -> tuple[Path, Path]:
    """A project folder with one source, and the folder of the data it reads."""
    data = home.parent / f"{home.name}-data"
    data.mkdir(exist_ok=True)
    (data / "orders.csv").write_text(ROWS)
    project = home.parent / f"{home.name}-proj"
    (project / ".golem").mkdir(parents=True, exist_ok=True)
    (project / ".golem" / "config.toml").write_text(f'[data.mine]\npath = "{data}/*.csv"\n')
    return project.resolve(), data


async def _start(home: Path) -> Any:
    app, task = await start_daemon(home)
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


async def _call(client: RpcClient, method: str, **params: object) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(await client.call(method, dict(params), timeout=20)))


async def test_a_trusted_project_source_lists_describes_and_keeps_notes_with_no_session(
    short_home: Path,
) -> None:
    project, _ = _project(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'trusted_projects = ["{project}"]\n')
    app, task, client = await _start(short_home)
    try:
        without = await _call(client, "data.list")
        assert "mine" not in [s["name"] for s in without["sources"]]
        listed = await _call(client, "data.list", project=str(project))
        mine = next(s for s in listed["sources"] if s["name"] == "mine")
        assert mine["scope"] == "project" and mine["project"] == str(project)
        described = await _call(client, "data.describe", source="mine", project=str(project))
        assert [t["name"] for t in described["tables"]] == ["orders"]
        first = await _call(client, "data.notes.get", source="mine", project=str(project))
        assert first["text"] is None
        want = str(project / ".golem" / "data" / "mine" / "DATA.md")
        assert first["path"] == want
        saved = await _call(
            client, "data.notes.set", source="mine", text="Totals are cents.", project=str(project)
        )
        assert saved["path"] == want
        again = await _call(client, "data.notes.get", source="mine", project=str(project))
        assert again["text"] == "Totals are cents.\n"
        page = await _call(
            client, "data.browse", source="mine", table="orders", project=str(project)
        )
        assert page["total_rows"] == 10
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_folder_that_is_not_trusted_is_refused_in_one_sentence(short_home: Path) -> None:
    project, _ = _project(short_home)
    short_home.mkdir(exist_ok=True)
    app, task, client = await _start(short_home)
    try:
        for method, extra in (
            ("data.notes.get", {}),
            ("data.notes.set", {"text": "x"}),
            ("data.describe", {}),
        ):
            refused = await client.call(
                method, {"source": "mine", "project": str(project), **extra}
            )
            assert error_code(refused) == INVALID_PARAMS
            assert "is not trusted" in str(refused["error"])
        assert not (project / ".golem" / "data").exists()
        relative = await client.call("data.notes.get", {"source": "mine", "project": "proj"})
        assert error_code(relative) == INVALID_PARAMS
        # The list a person sees before choosing anything just leaves the project out.
        listed = await _call(client, "data.list", project=str(project))
        assert "mine" not in [s["name"] for s in listed["sources"]]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_session_wins_over_the_project(short_home: Path, tmp_path: Path) -> None:
    project, _ = _project(short_home)
    other = tmp_path / "other"
    other.mkdir()
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'trusted_projects = ["{project}"]\n')
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(other)}))
        session_id = str(created["session_id"])
        # The session's folder has no such source, so the project is not looked at.
        missed = await client.call(
            "data.notes.get", {"source": "mine", "project": str(project), "session_id": session_id}
        )
        assert error_code(missed) == INVALID_PARAMS and "no source called mine" in str(
            missed["error"]
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


@pytest.fixture
async def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    async with Database.open(found.database_file):
        pass
    return found


@pytest.fixture
async def sources(paths: GolemPaths, tmp_path: Path) -> AsyncIterator[DataSources]:
    data = tmp_path / "d"
    data.mkdir()
    (data / "orders.csv").write_text(ROWS)
    paths.config_file.write_text(f'[data.shop]\npath = "{data}/*.csv"\n')
    worker = DataWorker(
        DataSettings(query_timeout_seconds=10, threads=1, max_rows=4), paths, timing=FAST
    )
    found = DataSources(worker, paths)
    yield found
    await found.close()


async def test_the_kept_view_is_the_view_of_the_same_browse_and_is_capped(
    sources: DataSources,
) -> None:
    view: dict[str, Any] = {
        "sort": {"column": "total", "desc": True},
        "filters": [{"column": "team", "op": "=", "value": "red"}],
        "search": None,
    }
    page = await sources.browse(None, "shop", "orders", offset=0, limit=100, **view)
    assert page.total_rows == 5
    kept = await sources.keep_browse(None, "shop", "orders", **view)
    assert kept.stored and kept.truncated
    # The cap is 4 rows; they are the first 4 of the same sorted, filtered view.
    assert kept.rows == page.rows[:4]
    assert [c["name"] for c in kept.columns] == [c["name"] for c in page.columns]
    found = await sources.page(kept.result_id, 0, 10)
    assert found.total_rows == 4
    assert found.rows[0][1] == page.rows[0][1]


async def test_a_kept_view_under_the_cap_is_whole_and_takes_search_and_unknown_names(
    sources: DataSources,
) -> None:
    kept = await sources.keep_browse(
        None, "shop", "orders", search="BLU", filters=[{"column": "id", "op": "=", "value": 2}]
    )
    assert not kept.truncated and len(kept.rows) == 1 and kept.rows[0][1] == 2
    from golem.data.types import DataError

    with pytest.raises(DataError, match="no column called nope"):
        await sources.keep_browse(
            None, "shop", "orders", filters=[{"column": "nope", "op": "is null"}]
        )
    with pytest.raises(DataError, match="no table called nope"):
        await sources.keep_browse(None, "shop", "nope")


async def test_data_browse_keep_answers_with_a_result_that_exports(short_home: Path) -> None:
    project, _ = _project(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'trusted_projects = ["{project}"]\n')
    app, task, client = await _start(short_home)
    try:
        kept = await _call(
            client,
            "data.browse.keep",
            source="mine",
            table="orders",
            filters=[{"column": "team", "op": "=", "value": "red"}],
            project=str(project),
        )
        assert kept["rows"] == 5 and kept["truncated"] is False
        target = project / "red.csv"
        written = await _call(
            client,
            "data.export",
            result_id=kept["result_id"],
            path=str(target),
            project=str(project),
        )
        assert written["rows"] == 5 and target.exists()
        refused = await client.call(
            "data.browse.keep", {"source": "mine", "table": "orders", "project": str(project / "x")}
        )
        assert error_code(refused) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
