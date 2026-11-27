"""The workflow.* methods over the daemon's socket (3.1.3, #1760)."""

from __future__ import annotations

import asyncio
import hashlib
import threading
from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import INVALID_PARAMS
from golem.workflows.check import TRIGGER_UNUSED
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
        assert [s["line"] for s in steps] == ["5", "15"]
        assert cast(dict[str, object], got["run"])["inputs"] == {"n": 4}
        assert cast(dict[str, object], got["run"])["steps_expected"] is None  # it is over

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
        events = [n for n in client.notices if str(n["method"]).startswith("workflow.")]
        started = cast(dict[str, object], events[0]["params"])
        assert started["steps_expected"] == 2
        last = cast(dict[str, object], events[-1]["params"])
        assert (last["result"], last["result_size"], last["summary"]) == (15, 2, "15")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_run_of_plain_steps_makes_no_session_and_is_still_in_runs(
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
        assert cast(dict[str, object], got["run"])["session_id"] is None

        await client.take_events()
        first = next(n for n in client.notices if n["method"] == "workflow.run.started")
        assert cast(dict[str, object], first["params"])["session_id"] is None

        runs = cast(Rows, rpc_result(await client.call("run.list", {}))["runs"])
        row = next(r for r in runs if r["workflow_run_id"] == run_id)
        assert row["session_id"] is None and row["origin"] == "workflow:adder"
        assert row["workflow_id"] == f"{path}::adder"
        assert (row["kind"], row["status"], row["steps"]) == ("workflow", "succeeded", 2)
        assert row["ended_at"] is not None and row["routine"] is None
        sessions = cast(Rows, rpc_result(await client.call("session.list", {}))["sessions"])
        assert sessions == []
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_run_that_goes_on_says_how_many_steps_it_expects(short_home: Path) -> None:
    path = _write(short_home / "workflows", "slow.py", SLOW)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        started = rpc_result(await client.call("workflow.start", {"id": f"{path}::slow"}))
        run_id = str(started["workflow_run_id"])
        got = await _until(client, run_id, "running")
        assert cast(dict[str, object], got["run"])["steps_expected"] == 1
        await client.call("workflow.cancel", {"workflow_run_id": run_id})
    finally:
        await client.close()
        await stop_daemon(app, task)


SAYS = """\
import time
from golem.workflow import workflow, Run


def count(run):
    run.progress("3 of 12")
    time.sleep(2)


@workflow()
async def says(run: Run):
    await run.step("Count", count, run)
"""


async def test_a_client_that_opens_the_run_midway_sees_the_text_so_far(short_home: Path) -> None:
    path = _write(short_home / "workflows", "says.py", SAYS)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        started = rpc_result(await client.call("workflow.start", {"id": f"{path}::says"}))
        run_id = str(started["workflow_run_id"])
        seen = None
        got: dict[str, object] = {}
        for _ in range(100):
            got = rpc_result(await client.call("workflow.status", {"workflow_run_id": run_id}))
            steps = cast(Rows, got["steps"])
            seen = steps[0].get("progress") if steps else None
            if seen is not None:
                break
            await asyncio.sleep(0.05)
        assert seen == "3 of 12"
        assert cast(dict[str, object], got["run"])["usual_ms"] is None
        await client.call("workflow.cancel", {"workflow_run_id": run_id})
        await _until(client, run_id, "cancelled")
        ended = rpc_result(await client.call("workflow.status", {"workflow_run_id": run_id}))
        assert cast(Rows, ended["steps"])[0].get("progress") is None
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


async def test_resume_refuses_a_run_in_flight_cancelled_or_unknown(short_home: Path) -> None:
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
        params = {"workflow_run_id": run_id}
        assert error_code(await client.call("workflow.resume", params)) == INVALID_PARAMS
        await client.call("workflow.cancel", params)
        await _until(client, run_id, "cancelled")
        assert error_code(await client.call("workflow.resume", params)) == INVALID_PARAMS
        unknown = {"workflow_run_id": "wr_nope"}
        assert error_code(await client.call("workflow.resume", unknown)) == INVALID_PARAMS
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
        assert got["code"] == TWO_STEPS
        broken = rpc_result(await client.call("workflow.get", {"id": str(bad)}))
        assert cast(dict[str, object], broken["workflow"])["state"] == "broken"
        assert broken["steps"] == []
        assert broken["code"] is None
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_starters_are_listed_and_added(short_home: Path, tmp_path: Path) -> None:
    project = (tmp_path / "proj").resolve()
    project.mkdir()
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = cast(Rows, rpc_result(await client.call("workflow.starters", {}))["starters"])
        assert [(s["id"], s["needs_folder"], s["schedule"]) for s in listed] == [
            ("morning_briefing", False, None),
            ("data_report", False, None),
        ]
        assert listed[0]["routine"] == {
            "name": "morning-briefing",
            "schedule": "weekdays 07:30",
            "words": "every weekday at 07:30",
        }
        added = rpc_result(await client.call("workflow.add_starter", {"id": "morning_briefing"}))
        path = short_home / "workflows" / "morning_briefing.py"
        assert (added["name"], added["path"]) == ("morning_briefing", str(path))
        assert path.is_file() and added["id"] == f"{path}::morning_briefing"
        assert (added["routine"], added["routine_problem"]) == (None, None)
        none = rpc_result(await client.call("routine.list", {}))
        assert none["routines"] == []
        got = rpc_result(await client.call("workflow.get", {"id": added["id"]}, timeout=20))
        info = cast(dict[str, object], got["workflow"])
        assert info["state"] == "ok"
        assert info["trigger"] is None

        for params in (
            {"id": "morning_briefing"},
            {"id": "nope"},
            {"id": "morning_briefing", "folder": "relative"},
        ):
            assert error_code(await client.call("workflow.add_starter", params)) == INVALID_PARAMS
        assert not (project / "workflows").exists()
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_starter_comes_with_its_routine_and_a_taken_name_does_not_stop_it(
    short_home: Path,
) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        added = rpc_result(
            await client.call(
                "workflow.add_starter", {"id": "morning_briefing", "routine": True}, timeout=20
            )
        )
        assert (added["routine"], added["routine_problem"]) == ("morning-briefing", None)
        listed = rpc_result(await client.call("routine.list", {}))
        [routine] = cast(Rows, listed["routines"])
        config = cast(dict[str, object], routine["config"])
        assert (config["name"], config["schedule"], config["workflow"]) == (
            "morning-briefing",
            "weekdays 07:30",
            "morning_briefing",
        )
        # The workflow goes away; the routine stays, so a second add finds its name taken.
        (short_home / "workflows" / "morning_briefing.py").unlink()
        again = rpc_result(
            await client.call(
                "workflow.add_starter", {"id": "morning_briefing", "routine": True}, timeout=20
            )
        )
        assert again["routine"] is None
        assert "morning-briefing" in str(again["routine_problem"])
        assert (short_home / "workflows" / "morning_briefing.py").is_file()
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_check_and_save(short_home: Path, tmp_path: Path) -> None:
    good = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    bad = _write(short_home / "workflows", "bad.py", "def (:\n")
    project = (tmp_path / "proj").resolve()
    other = _write(project / "workflows", "mine.py", TWO_STEPS.replace("adder", "mine"))
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {"folders": [str(project)]}, timeout=20)
        ident = f"{good}::adder"
        got = rpc_result(await client.call("workflow.get", {"id": ident}))
        digest = str(got["code_hash"])
        assert len(digest) == 64

        saved_file = rpc_result(await client.call("workflow.check", {"id": ident}))
        assert [p["message"] for p in cast(Rows, saved_file["problems"])] == [TRIGGER_UNUSED]
        assert len(cast(Rows, saved_file["steps"])) == 2

        broken_code = TWO_STEPS.replace("run.step(", "run.llm(", 1).replace(
            '"first", add, n, 1', '"x", modle="local"'
        )
        checked = rpc_result(
            await client.call("workflow.check", {"id": ident, "code": broken_code})
        )
        problems = [p for p in cast(Rows, checked["problems"]) if p["severity"] == "error"]
        assert len(problems) == 1
        assert problems[0]["line"] == 10 and problems[0]["step_id"]
        assert good.read_text(encoding="utf-8") == TWO_STEPS

        refused = await client.call(
            "workflow.save", {"id": ident, "code": broken_code, "base_hash": digest}
        )
        assert error_code(refused) == INVALID_PARAMS
        assert good.read_text(encoding="utf-8") == TWO_STEPS

        changed = TWO_STEPS.replace("Adds up.", "Adds more.")
        stale = await client.call(
            "workflow.save", {"id": ident, "code": changed, "base_hash": "0" * 64}
        )
        assert error_code(stale) == INVALID_PARAMS
        assert good.read_text(encoding="utf-8") == TWO_STEPS

        done = rpc_result(
            await client.call("workflow.save", {"id": ident, "code": changed, "base_hash": digest})
        )
        assert good.read_text(encoding="utf-8") == changed
        assert cast(dict[str, object], done["workflow"])["description"] == "Adds more."
        assert done["code_hash"] != digest and len(cast(Rows, done["steps"])) == 2

        fixed = rpc_result(
            await client.call(
                "workflow.save",
                {"id": str(bad), "code": TWO_STEPS.replace("adder", "bad"), "base_hash": _sha(bad)},
            )
        )
        assert cast(dict[str, object], fixed["workflow"])["state"] == "ok"

        untrusted = str(other)
        text = other.read_text(encoding="utf-8")
        again = await client.call(
            "workflow.save", {"id": untrusted, "code": text, "base_hash": _sha(other)}
        )
        assert error_code(again) == INVALID_PARAMS
        check_only = rpc_result(
            await client.call("workflow.check", {"id": untrusted, "code": text})
        )
        assert [p["message"] for p in cast(Rows, check_only["problems"])] == [TRIGGER_UNUSED]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_edit_step_returns_new_code_and_writes_nothing(
    short_home: Path,
) -> None:
    good = _write(short_home / "workflows", "adder.py", TWO_STEPS)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await client.call("workflow.list", {}, timeout=20)
        ident = f"{good}::adder"
        step = cast(Rows, rpc_result(await client.call("workflow.get", {"id": ident}))["steps"])[0]
        assert [a["name"] for a in cast(Rows, step["args"])][:1] == ["name"]
        edit = {"id": ident, "code": TWO_STEPS, "step_id": step["id"], "name": "key", "value": "k"}
        done = rpc_result(await client.call("workflow.edit_step", edit))
        assert done["code"] == TWO_STEPS.replace("n, 1)", 'n, 1, key="k")')
        assert cast(Rows, done["steps"])[0]["key"] == "k"
        assert good.read_text(encoding="utf-8") == TWO_STEPS
        refused = await client.call("workflow.edit_step", {**edit, "name": "model"})
        assert error_code(refused) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
