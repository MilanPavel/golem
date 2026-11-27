"""``workflow.start {from_run, from_key}``: run again from a step (3.13.13, #1936)."""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import INVALID_PARAMS

FLOW = """\
from golem.workflow import workflow, Run

LOG = {log!r}


async def note(name, value):
    with open(LOG, "a") as handle:
        handle.write(name + "\\n")
    return value


@workflow()
async def flow(run: Run):
    one = await run.step("one", note, "one", 1)
    two = await run.step("two", note, "two", one + 1)
    for name in ("x", "y"):
        await run.step("each", note, "each-" + name, two, item=name)
    return await run.step("last", note, "last", two + 1)
"""

GROUPED = """\
from golem.workflow import workflow, Run

LOG = {log!r}


async def note(name, value):
    with open(LOG, "a") as handle:
        handle.write(name + "\\n")
    return value


@workflow()
async def flow(run: Run):
    one = await run.step("one", note, "one", 1)
    await run.parallel([run.step("p", note, "p", one), run.step("q", note, "q", one)])
    return await run.step("last", note, "last", 3)
"""

Rows = list[dict[str, object]]


def _write(home: Path, text: str, log: Path) -> Path:
    folder = home / "workflows"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "flow.py"
    path.write_text(text.format(log=str(log)), encoding="utf-8")
    return path


async def _until(client: RpcClient, run_id: str, status: str) -> dict[str, object]:
    for _ in range(100):
        got = rpc_result(await client.call("workflow.status", {"workflow_run_id": run_id}))
        if cast(dict[str, object], got["run"])["status"] == status:
            return got
        await asyncio.sleep(0.05)
    raise AssertionError(f"run never became {status}")


def _ran(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").split() if log.exists() else []


def _message(reply: dict[str, object]) -> str:
    return str(cast(dict[str, object], reply["error"])["message"])


async def _first_run(client: RpcClient, path: Path) -> str:
    await client.call("hello", HELLO)
    await client.call("workflow.list", {}, timeout=20)
    started = rpc_result(await client.call("workflow.start", {"id": f"{path}::flow"}))
    run_id = str(started["workflow_run_id"])
    await _until(client, run_id, "done")
    return run_id


async def test_a_run_again_takes_the_steps_before_and_runs_the_rest(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, FLOW, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        assert _ran(log) == ["one", "two", "each-x", "each-y", "last"]
        before = rpc_result(await client.call("workflow.status", {"workflow_run_id": old_id}))
        log.unlink()

        params = {"from_run": old_id, "from_key": "two"}
        again = rpc_result(await client.call("workflow.start", params))
        new_id = str(again["workflow_run_id"])
        assert new_id != old_id
        got = await _until(client, new_id, "done")

        assert _ran(log) == ["two", "each-x", "each-y", "last"]
        steps = {str(s["key"]): s for s in cast(Rows, got["steps"])}
        assert steps["one"]["reused_from"] == old_id
        assert steps["two"]["reused_from"] is None and steps["two"]["status"] == "done"
        assert steps["last"]["result"] == 3
        run = cast(dict[str, object], got["run"])
        origin = cast(dict[str, object], run["from_run"])
        assert origin["workflow_run_id"] == old_id and origin["step_key"] == "two"
        assert (origin["step_title"], origin["step_number"]) == ("two", 2)

        # The old run is as it was.
        after = rpc_result(await client.call("workflow.status", {"workflow_run_id": old_id}))
        assert after["steps"] == before["steps"]
        quiet = {"usual_ms"}  # the new run changes how long a run usually takes
        old_run = cast(dict[str, object], before["run"])
        new_run = cast(dict[str, object], after["run"])
        assert {k: v for k, v in new_run.items() if k not in quiet} == {
            k: v for k, v in old_run.items() if k not in quiet
        }
        assert cast(dict[str, object], after["run"])["from_run"] is None
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_from_one_item_of_a_repeating_step_runs_that_item_and_what_follows(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, FLOW, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        log.unlink()
        params = {"from_run": old_id, "from_key": "each: y"}
        new_id = str(rpc_result(await client.call("workflow.start", params))["workflow_run_id"])
        got = await _until(client, new_id, "done")
        assert _ran(log) == ["each-y", "last"]
        reused = [s["key"] for s in cast(Rows, got["steps"]) if s["reused_from"]]
        assert reused == ["one", "two", "each: x"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def _again(client: RpcClient, old_id: str, key: str) -> dict[str, object]:
    params = {"from_run": old_id, "from_key": key}
    new_id = str(rpc_result(await client.call("workflow.start", params))["workflow_run_id"])
    return await _until(client, new_id, "done")


def _origin(got: dict[str, object]) -> dict[str, object]:
    return cast(dict[str, object], cast(dict[str, object], got["run"])["from_run"])


async def test_a_file_changed_below_the_step_starts_and_is_not_flagged(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, FLOW, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        log.unlink()
        path.write_text(
            path.read_text(encoding="utf-8").replace('"last", note, "last"', '"last", note, "end"'),
            encoding="utf-8",
        )
        got = await _again(client, old_id, "two")
        assert _ran(log)[-1] == "end"
        assert _origin(got)["file_changed"] is False
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_file_changed_above_the_step_starts_reuses_and_is_flagged(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, FLOW, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        log.unlink()
        path.write_text(
            path.read_text(encoding="utf-8").replace('note, "one", 1', 'note, "one", 5'),
            encoding="utf-8",
        )
        got = await _again(client, old_id, "two")
        assert _ran(log) == ["two", "each-x", "each-y", "last"]
        assert _origin(got)["file_changed"] is True
        steps = {str(s["key"]): s for s in cast(Rows, got["steps"])}
        assert steps["one"]["reused_from"] == old_id and steps["one"]["result"] == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_an_old_run_with_no_stored_text_is_flagged_only_when_the_file_changed(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, FLOW, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        with sqlite3.connect(app.paths.database_file) as db:
            db.execute("UPDATE workflow_runs SET source_text = NULL")
        same = await _again(client, old_id, "two")
        assert _origin(same)["file_changed"] is False
        path.write_text(
            path.read_text(encoding="utf-8").replace('note, "one", 1', 'note, "one", 5'),
            encoding="utf-8",
        )
        changed = await _again(client, old_id, "two")
        assert _origin(changed)["file_changed"] is True
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_step_in_a_group_and_bad_params_are_refused(
    short_home: Path, tmp_path: Path
) -> None:
    log = tmp_path / "log.txt"
    path = _write(short_home, GROUPED, log)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        old_id = await _first_run(client, path)
        for key in ("p", "q"):
            got = await client.call("workflow.start", {"from_run": old_id, "from_key": key})
            assert error_code(got) == INVALID_PARAMS
            assert "group" in _message(got)
        missing = await client.call("workflow.start", {"from_run": old_id, "from_key": "nope"})
        assert error_code(missing) == INVALID_PARAMS
        alone = await client.call("workflow.start", {"from_run": old_id})
        assert error_code(alone) == INVALID_PARAMS
        fine = rpc_result(
            await client.call("workflow.start", {"from_run": old_id, "from_key": "last"})
        )
        assert fine["workflow_run_id"]
    finally:
        await client.close()
        await stop_daemon(app, task)
