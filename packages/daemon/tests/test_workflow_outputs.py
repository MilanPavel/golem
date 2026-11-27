"""A run's result: the return value, ``run.output`` and ``workflow.read_output`` (3.13.3)."""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import INVALID_PARAMS
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.engine import WorkflowEngine
from golem.workflows.outputs import OutputError, read_marked_file

HEADER = "from golem.workflow import workflow, Run\nimport calls\n"


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Any:
    module = types.ModuleType("calls")
    module.log = []  # type: ignore[attr-defined]
    module.hold = False  # type: ignore[attr-defined]
    module.gate = asyncio.Event()  # type: ignore[attr-defined]
    module.reached = asyncio.Event()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "calls", module)
    return module


def write(folder: Path, body: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


async def new_run(store: WorkflowRuns, path: Path) -> str:
    return await store.create_run(f"{path}::flow", "flow", str(path), "2026-11-27T10:00:00Z")


RETURNS = """
    async def one():
        return 1

    @workflow()
    async def flow(run: Run):
        await run.step("one", one)
        return {"answer": 42}
"""

OUTPUTS = """
    async def one():
        calls.log.append("one")
        return 1

    async def two():
        if calls.hold:
            calls.reached.set()
            await calls.gate.wait()
        return 2

    @workflow()
    async def flow(run: Run):
        await run.step("one", one)
        await run.output("first text", title="First", summary="one line")
        await run.step("two", two)
        await run.output({"rows": [1, 2]})
        return "done"
"""


async def test_a_workflow_without_output_reports_its_return_value_as_result(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await new_run(store, write(tmp_path, RETURNS))
    await WorkflowEngine(store).execute(run_id)
    run = await store.get_run(run_id)
    assert run is not None and run.status == "done"
    assert json.loads(run.result_json or "null") == {"answer": 42}
    assert await store.list_outputs(run_id) == []


async def test_outputs_are_saved_in_order_with_title_and_summary(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    run_id = await new_run(store, write(tmp_path, OUTPUTS))
    await WorkflowEngine(store).execute(run_id)
    first, second = await store.list_outputs(run_id)
    assert (first.position, first.title, first.summary) == (0, "First", "one line")
    assert json.loads(first.value_json) == "first text"
    assert (second.position, second.title, second.summary) == (1, None, None)
    assert json.loads(second.value_json) == {"rows": [1, 2]}
    run = await store.get_run(run_id)
    assert run is not None and json.loads(run.result_json or "null") == "done"


async def test_outputs_survive_a_restart_and_a_resume_does_not_repeat_them(
    tmp_path: Path, calls: Any
) -> None:
    path = write(tmp_path, OUTPUTS)
    calls.hold = True
    async with Database.open(tmp_path / "golem.db") as db:
        store = WorkflowRuns(db)
        run_id = await new_run(store, path)
        task = asyncio.create_task(WorkflowEngine(store).execute(run_id))
        await asyncio.wait_for(calls.reached.wait(), 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert [o.position for o in await store.list_outputs(run_id)] == [0]
    # The daemon starts again: a new database handle, the run executed from the top.
    calls.hold = False
    async with Database.open(tmp_path / "golem.db") as db:
        store = WorkflowRuns(db)
        assert [o.position for o in await store.list_outputs(run_id)] == [0]
        await WorkflowEngine(store).execute(run_id)
        outputs = await store.list_outputs(run_id)
        assert [o.position for o in outputs] == [0, 1]
        assert [json.loads(o.value_json) for o in outputs] == ["first text", {"rows": [1, 2]}]
        # A second resume of a finished run marks the same two again; still two.
        await WorkflowEngine(store).execute(run_id)
        assert len(await store.list_outputs(run_id)) == 2
    assert calls.log == ["one"]


async def test_an_output_that_is_not_json_fails_the_run_with_words(
    tmp_path: Path, store: WorkflowRuns, calls: Any
) -> None:
    body = """
        @workflow()
        async def flow(run: Run):
            await run.output(object())
    """
    run_id = await new_run(store, write(tmp_path, body))
    await WorkflowEngine(store).execute(run_id)
    run = await store.get_run(run_id)
    assert run is not None and run.status == "failed"
    assert "not JSON" in (run.error or "")


def test_read_marked_file_gives_text_and_says_when_it_cut(tmp_path: Path) -> None:
    note = tmp_path / "note.md"
    note.write_text("abcdefghij")
    assert read_marked_file(str(note), tmp_path) == (str(note.resolve()), "abcdefghij", False, 10)
    _path, text, truncated, size = read_marked_file(str(note), tmp_path, limit=4)
    assert (text, truncated, size) == ("abcd", True, 10)


def test_read_marked_file_refuses_what_it_should(tmp_path: Path) -> None:
    secret = tmp_path / ".ssh"
    secret.mkdir()
    (secret / "notes.txt").write_text("private")
    link = tmp_path / "innocent.txt"
    link.symlink_to(secret / "notes.txt")
    binary = tmp_path / "data.txt"
    binary.write_bytes(b"ab\0cd")
    image = tmp_path / "pic.png"
    image.write_bytes(b"png")
    for marked, why in (
        (str(secret / "notes.txt"), "private"),
        (str(link), "private"),
        (str(binary), "text files"),
        (str(image), "text files"),
        (str(tmp_path / "missing.txt"), "no file"),
        ("relative.txt", "absolute"),
        ("https://example.com/a.md", "absolute"),
        (42, "not a file path"),
    ):
        with pytest.raises(OutputError, match=why):
            read_marked_file(marked, tmp_path)


SERVED = """\
from golem.workflow import workflow, Run


@workflow(description="Writes a note.")
async def noter(run: Run):
    await run.output("{marked}", title="The note", summary="A short note")
    await run.output("{secret}", title="Hidden")
    await run.output("plain words")
    return "ok"
"""


async def _until_done(client: RpcClient, run_id: str) -> dict[str, Any]:
    for _ in range(100):
        got = rpc_result(await client.call("workflow.status", {"workflow_run_id": run_id}))
        if cast(dict[str, Any], got["run"])["status"] == "done":
            return got
        await asyncio.sleep(0.05)
    raise AssertionError("run never became done")


async def test_status_sends_the_outputs_and_read_output_only_reads_what_the_run_marked(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", lambda: short_home)
    note = short_home / "note.md"
    note.write_text("# Note\n", encoding="utf-8")
    (short_home / ".ssh").mkdir()
    secret = short_home / ".ssh" / "key.txt"
    secret.write_text("secret", encoding="utf-8")
    folder = short_home / "workflows"
    folder.mkdir()
    (folder / "noter.py").write_text(SERVED.format(marked=note, secret=secret), encoding="utf-8")
    app, task = await start_daemon(short_home)
    try:
        client = await RpcClient.connect(app.paths.socket_path)
        try:
            await client.call("hello", HELLO)
            listed = rpc_result(await client.call("workflow.list", {}, timeout=20))
            entry = cast(list[dict[str, Any]], listed["workflows"])[0]
            started = rpc_result(await client.call("workflow.start", {"id": entry["id"]}))
            run_id = str(started["workflow_run_id"])
            run = cast(dict[str, Any], (await _until_done(client, run_id))["run"])
            assert (run["description"], run["result"]) == ("Writes a note.", "ok")
            assert [o["title"] for o in run["outputs"]] == ["The note", "Hidden", None]
            assert run["summary"] == "A short note"

            def read(index: int) -> Any:
                return client.call(
                    "workflow.read_output", {"workflow_run_id": run_id, "index": index}
                )

            got = rpc_result(await read(0))
            assert (got["text"], got["truncated"]) == ("# Note\n", False)
            assert error_code(await read(1)) == INVALID_PARAMS  # marked, but in a secret folder
            assert error_code(await read(2)) == INVALID_PARAMS  # text, not a path
            assert error_code(await read(3)) == INVALID_PARAMS  # the run marked no such output
            assert (
                error_code(
                    await client.call(
                        "workflow.read_output", {"workflow_run_id": "nope", "index": 0}
                    )
                )
                == INVALID_PARAMS
            )
        finally:
            await client.close()
    finally:
        await stop_daemon(app, task)
