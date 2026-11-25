"""The workflow.* methods over the daemon's socket (3.1.3, #1760)."""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import INVALID_PARAMS
from golem.workflows.registry import WorkflowRegistry

TWO_STEPS = """\
from golem.workflow import workflow, Run, manual


async def add(a, b):
    return a + b


@workflow(trigger=manual(), inputs={"n": int}, description="Adds up.")
async def adder(run: Run, n: int = 1):
    first = await run.step("first", add, n, 1)
    return await run.step("second", add, first, 10)
"""

SLOW = """\
import asyncio
import threading
from golem.workflow import workflow, Run


async def wait():
    await asyncio.sleep(30)


@workflow()
async def slow(run: Run):
    await run.step("wait", wait)
"""

Rows = list[dict[str, object]]


def _write(folder: Path, name: str, text: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_text(text, encoding="utf-8")
    return path


def _by_name(result: dict[str, object]) -> dict[str, dict[str, object]]:
    return {str(w["name"]): w for w in cast(Rows, result["workflows"])}


async def _until(client: RpcClient, run_id: str, status: str) -> dict[str, object]:
    for _ in range(100):
        got = rpc_result(await client.call("workflow.status", {"workflow_run_id": run_id}))
        if cast(dict[str, object], got["run"])["status"] == status:
            return got
        await asyncio.sleep(0.05)
    raise AssertionError(f"run never became {status}")


async def test_list_shows_ok_broken_and_untrusted(short_home: Path, tmp_path: Path) -> None:
    _write(short_home / "workflows", "adder.py", TWO_STEPS)
    _write(short_home / "workflows", "bad.py", "def (:\n")
    project = (tmp_path / "proj").resolve()
    _write(project / "workflows", "mine.py", TWO_STEPS.replace("adder", "mine"))
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = _by_name(rpc_result(await client.call("workflow.list", {}, timeout=20)))
        assert listed["adder"]["state"] == "ok"
        assert listed["adder"]["trigger"] == {"kind": "manual", "expr": None, "path": None}
        assert listed["adder"]["inputs"] == [{"name": "n", "type": "int", "default": None}]
        assert listed["bad"]["state"] == "broken" and listed["bad"]["error"]
        assert "mine" not in listed

        params = {"folders": [str(project)]}
        listed = _by_name(rpc_result(await client.call("workflow.list", params, timeout=20)))
        assert (listed["mine"]["state"], listed["mine"]["project"]) == ("untrusted", str(project))

        (short_home / "config.toml").write_text(
            f'trusted_projects = ["{project}"]\n', encoding="utf-8"
        )
        listed = _by_name(rpc_result(await client.call("workflow.list", params, timeout=20)))
        assert listed["mine"]["state"] == "ok"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_start_sends_the_steps_in_order_and_the_run_is_done(short_home: Path) -> None:
    path = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        started = rpc_result(
            await client.call("workflow.start", {"id": f"{path}::adder", "inputs": {"n": "4"}})
        )
        run_id = str(started["workflow_run_id"])
        got = await _until(client, run_id, "done")
        steps = cast(Rows, got["steps"])
        assert [(s["key"], s["status"]) for s in steps] == [("first", "done"), ("second", "done")]
        assert cast(dict[str, object], got["run"])["inputs"] == {"n": 4}

        await client.take_events()
        names = [
            str(n["method"]) for n in client.notices if str(n["method"]).startswith("workflow.")
        ]
        assert names == [
            "workflow.run.started",
            "workflow.step.started",
            "workflow.step.done",
            "workflow.step.started",
            "workflow.step.done",
            "workflow.run.done",
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_each_run_gets_its_headless_session_before_the_first_event(
    short_home: Path,
) -> None:
    path = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        started = rpc_result(await client.call("workflow.start", {"id": f"{path}::adder"}))
        run_id = str(started["workflow_run_id"])
        got = await _until(client, run_id, "done")
        session_id = cast(dict[str, object], got["run"])["session_id"]
        assert isinstance(session_id, str) and session_id

        await client.take_events()
        first = next(n for n in client.notices if n["method"] == "workflow.run.started")
        assert cast(dict[str, object], first["params"])["session_id"] == session_id

        runs = cast(Rows, rpc_result(await client.call("run.list", {}))["runs"])
        row = next(r for r in runs if r["session_id"] == session_id)
        assert row["origin"] == "workflow:adder"
        assert (row["kind"], row["status"], row["steps"]) == ("workflow", "succeeded", 2)
        assert row["ended_at"] is not None and row["routine"] is None
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_start_refuses_broken_unknown_and_bad_inputs(short_home: Path) -> None:
    good = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    bad = _write(short_home / "workflows", "bad.py", "def (:\n")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        reply = await client.call("workflow.start", {"id": str(bad)})
        assert error_code(reply) == INVALID_PARAMS
        assert "broken" in str(reply["error"])
        assert error_code(await client.call("workflow.start", {"id": "nope"})) == INVALID_PARAMS
        reply = await client.call("workflow.start", {"id": f"{good}::adder", "inputs": {"n": "x"}})
        assert error_code(reply) == INVALID_PARAMS
        reply = await client.call("workflow.start", {"id": f"{good}::adder", "inputs": {"z": 1}})
        assert error_code(reply) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_cancel_stops_a_slow_run(short_home: Path) -> None:
    path = _write(short_home / "workflows", "slow.py", SLOW)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        run_id = str(
            rpc_result(await client.call("workflow.start", {"id": f"{path}::slow"}))[
                "workflow_run_id"
            ]
        )
        await _until(client, run_id, "running")
        cancelled = rpc_result(await client.call("workflow.cancel", {"workflow_run_id": run_id}))
        assert cancelled == {"cancelled": True}
        await _until(client, run_id, "cancelled")
        again = rpc_result(await client.call("workflow.cancel", {"workflow_run_id": run_id}))
        assert again == {"cancelled": False}
        assert (
            error_code(await client.call("workflow.cancel", {"workflow_run_id": "wr_nope"}))
            == INVALID_PARAMS
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_get_returns_the_outline_and_tolerates_a_bad_file(short_home: Path) -> None:
    good = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    bad = _write(short_home / "workflows", "bad.py", "def (:\n")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        got = rpc_result(await client.call("workflow.get", {"id": f"{good}::adder"}))
        steps = cast(Rows, got["steps"])
        assert [s["title"] for s in steps] == ["first", "second"]
        broken = rpc_result(await client.call("workflow.get", {"id": str(bad)}))
        assert cast(dict[str, object], broken["workflow"])["state"] == "broken"
        assert broken["steps"] == []
    finally:
        await client.close()
        await stop_daemon(app, task)


def test_two_threads_can_refresh_the_registry_together(tmp_path: Path) -> None:
    folder = tmp_path / "wf"
    for i in range(20):
        _write(folder, f"w{i}.py", TWO_STEPS.replace("adder", f"w{i}"))
    registry = WorkflowRegistry(user_dir=folder, projects=lambda: [], trusted=lambda _p: True)
    errors: list[BaseException] = []

    def work() -> None:
        try:
            for _ in range(3):
                registry.refresh()
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=work) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []
    assert sorted(e.name for e in registry.entries()) == sorted(f"w{i}" for i in range(20))
