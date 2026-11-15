"""changes.revert: undo a change, a file, a hunk or a turn, and keep a record of it."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import GatedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.coding.changes import ChangeStore
from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SESSION_BUSY, SESSION_NOT_FOUND


@dataclass
class Setup:
    client: RpcClient
    store: ChangeStore
    folder: Path
    session_id: str

    async def record(
        self, run_id: str | None, path: str, before: str | None, after: str | None
    ) -> str:
        """Record a change and put its text on disk, as a tool would have."""
        change = await self.store.record(
            session_id=self.session_id,
            run_id=run_id,
            call_id=None,
            path=path,
            before=before,
            after=after,
            source="tool",
        )
        target = self.folder / path
        if after is None:
            target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(after, "utf-8")
        return change.change_id

    async def revert(self, target: dict[str, Any], *, force: bool = False) -> dict[str, object]:
        params = {"session_id": self.session_id, "target": target, "force": force}
        return await self.client.call("changes.revert", params)

    def read(self, path: str) -> str:
        return (self.folder / path).read_text("utf-8")


@pytest.fixture
async def setup(short_home: Path) -> AsyncIterator[Setup]:
    folder = short_home / "work"
    folder.mkdir()
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        session_id = str(created["session_id"])
        await client.call("session.attach", {"session_id": session_id})
        store = app.state.changes
        assert store is not None
        yield Setup(client, store, folder, session_id)
    finally:
        await client.close()
        await stop_daemon(app, task)


def _result(payload: dict[str, object]) -> tuple[list[str], list[tuple[str, str]]]:
    result = rpc_result(payload)
    conflicts = cast("list[dict[str, str]]", result["conflicts"])
    return cast("list[str]", result["reverted"]), [(c["path"], c["reason"]) for c in conflicts]


async def test_a_change_is_taken_back(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", None, "one\n")
    second = await setup.record("r_1", "a.txt", "one\n", "two\n")

    reply = await setup.revert({"kind": "change", "change_id": second})

    assert _result(reply) == (["a.txt"], [])
    assert setup.read("a.txt") == "one\n"


async def test_a_file_goes_back_to_before_its_first_change(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", "zero\n", "one\n")
    await setup.record("r_2", "a.txt", "one\n", "two\n")

    reply = await setup.revert({"kind": "file", "path": "a.txt"})

    assert _result(reply) == (["a.txt"], [])
    assert setup.read("a.txt") == "zero\n"


async def test_a_hunk_goes_back_and_the_others_stay(setup: Setup) -> None:
    before = "".join(f"line {n}\n" for n in range(1, 31))
    lines = before.splitlines(keepends=True)
    lines[1], lines[14], lines[28] = "TWO\n", "FIFTEEN\n", "TWENTY NINE\n"
    await setup.record("r_1", "a.txt", before, "".join(lines))

    reply = await setup.revert({"kind": "hunk", "path": "a.txt", "hunk": 1})

    assert _result(reply) == (["a.txt"], [])
    lines[14] = "line 15\n"
    assert setup.read("a.txt") == "".join(lines)


async def test_a_hunk_that_does_not_exist_is_refused(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", "one\n", "two\n")

    reply = await setup.revert({"kind": "hunk", "path": "a.txt", "hunk": 1})

    assert error_code(reply) == INVALID_PARAMS
    assert setup.read("a.txt") == "two\n"


async def test_a_run_rewinds_files_a_later_run_changed_too(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", "a0\n", "a1\n")
    await setup.record("r_2", "a.txt", "a1\n", "a2\n")
    await setup.record("r_2", "b.txt", None, "b1\n")
    await setup.record("r_3", "a.txt", "a2\n", "a3\n")

    reply = await setup.revert({"kind": "run", "run_id": "r_2"})

    reverted, conflicts = _result(reply)
    assert sorted(reverted) == ["a.txt", "b.txt"]
    assert conflicts == []
    assert setup.read("a.txt") == "a1\n"
    assert not (setup.folder / "b.txt").exists()


async def test_undoing_a_new_file_deletes_it_and_not_its_folder(setup: Setup) -> None:
    created = await setup.record("r_1", "sub/new.txt", None, "x\n")

    reply = await setup.revert({"kind": "change", "change_id": created})

    assert _result(reply) == (["sub/new.txt"], [])
    assert not (setup.folder / "sub" / "new.txt").exists()
    assert (setup.folder / "sub").is_dir()


async def test_undoing_a_delete_brings_the_file_back(setup: Setup) -> None:
    (setup.folder / "a.txt").write_text("bye\n", "utf-8")
    deleted = await setup.record("r_1", "a.txt", "bye\n", None)

    reply = await setup.revert({"kind": "change", "change_id": deleted})

    assert _result(reply) == (["a.txt"], [])
    assert setup.read("a.txt") == "bye\n"


async def test_a_file_changed_on_disk_is_a_conflict_until_forced(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", "one\n", "two\n")
    await setup.record("r_1", "b.txt", "one\n", "two\n")
    (setup.folder / "a.txt").write_text("someone else\n", "utf-8")

    reply = await setup.revert({"kind": "run", "run_id": "r_1"})

    assert _result(reply) == (["b.txt"], [("a.txt", "changed_on_disk")])
    assert setup.read("a.txt") == "someone else\n"
    assert setup.read("b.txt") == "one\n"

    forced = await setup.revert({"kind": "file", "path": "a.txt"}, force=True)

    assert _result(forced) == (["a.txt"], [])
    assert setup.read("a.txt") == "one\n"


async def test_a_file_that_is_already_back_is_skipped(setup: Setup) -> None:
    await setup.record("r_1", "a.txt", "one\n", "two\n")
    (setup.folder / "a.txt").write_text("one\n", "utf-8")

    reply = await setup.revert({"kind": "file", "path": "a.txt"})

    assert _result(reply) == ([], [])


async def test_the_undo_is_a_change_and_can_be_undone(setup: Setup) -> None:
    first = await setup.record("r_1", "a.txt", "one\n", "two\n")
    await setup.revert({"kind": "change", "change_id": first})
    undo = (await setup.store.list(setup.session_id))[-1]
    assert (undo.source, undo.reverts, undo.run_id, undo.call_id) == ("revert", first, None, None)

    reply = await setup.revert({"kind": "change", "change_id": undo.change_id})

    assert _result(reply) == (["a.txt"], [])
    assert setup.read("a.txt") == "two\n"


async def test_the_event_says_it_is_a_revert(setup: Setup) -> None:
    first = await setup.record("r_1", "a.txt", "one\n", "two\n")
    await setup.revert({"kind": "change", "change_id": first})

    event = await setup.client.wait_for_event("file.changed")

    params = cast("dict[str, Any]", event["params"])
    data = cast("dict[str, Any]", params["data"])
    assert data["source"] == "revert"
    assert data["reverts"] == first
    assert data["call_id"] is None
    assert (data["path"], data["status"], data["added"], data["removed"]) == (
        "a.txt",
        "modified",
        1,
        1,
    )


@pytest.mark.parametrize(
    "target",
    [
        {"kind": "change"},
        {"kind": "file"},
        {"kind": "file", "path": "a.txt", "run_id": "r_1"},
        {"kind": "hunk", "path": "a.txt"},
        {"kind": "run", "path": "a.txt"},
        {"kind": "change", "change_id": "c_nope"},
        {"kind": "file", "path": "nope.txt"},
    ],
)
async def test_a_bad_target_is_refused(setup: Setup, target: dict[str, Any]) -> None:
    await setup.record("r_1", "a.txt", "one\n", "two\n")

    reply = await setup.revert(target)

    assert error_code(reply) == INVALID_PARAMS
    assert setup.read("a.txt") == "two\n"


async def test_a_path_that_left_the_folder_is_refused(setup: Setup) -> None:
    outside = setup.folder.parent / "outside"
    outside.mkdir()
    (setup.folder / "sub").symlink_to(outside)
    await setup.store.record(
        session_id=setup.session_id,
        run_id="r_1",
        call_id=None,
        path="sub/x.txt",
        before="a\n",
        after="b\n",
        source="tool",
    )

    reply = await setup.revert({"kind": "file", "path": "sub/x.txt"}, force=True)

    assert error_code(reply) == INVALID_PARAMS
    assert not (outside / "x.txt").exists()


async def test_an_unknown_session_is_refused(setup: Setup) -> None:
    params = {"session_id": "s_nope", "target": {"kind": "run", "run_id": "r_1"}}

    reply = await setup.client.call("changes.revert", params)

    assert error_code(reply) == SESSION_NOT_FOUND


async def test_a_revert_during_a_run_is_refused(short_home: Path) -> None:
    folder = short_home / "work"
    folder.mkdir()
    model = GatedChatModel()
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        session_id = str(created["session_id"])
        store = app.state.changes
        assert store is not None
        change = await store.record(
            session_id=session_id,
            run_id="r_1",
            call_id=None,
            path="a.txt",
            before="one\n",
            after="two\n",
            source="tool",
        )
        (folder / "a.txt").write_text("two\n", "utf-8")
        await client.call("message.send", {"session_id": session_id, "text": "hi"})
        await model.started.wait()

        reply = await client.call(
            "changes.revert",
            {
                "session_id": session_id,
                "target": {"kind": "change", "change_id": change.change_id},
            },
        )

        assert error_code(reply) == SESSION_BUSY
        assert (folder / "a.txt").read_text("utf-8") == "two\n"
    finally:
        model.release.set()
        await client.close()
        await stop_daemon(app, task)
