"""Apply a worker's diff through the change set (ADR-059, step 15.10.6).

No model: scripted replies. The checks run through a fake runner, so no test needs the shell
sandbox. Retry starts a model, so every test runs with local models only and with cloud models
only.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
import test_helper_worker_copy as base
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from test_helper_restart import SETUPS, _Setup  # pyright: ignore
from test_helper_worker_copy import _Daemon, _git, _home, _settled, lead  # pyright: ignore
from test_helper_worker_diff import WORKERS, _configured, _daemon, _fake  # pyright: ignore

from golem.coding.changes import ChangeStore, net_files
from golem.server.dispatcher import HELPER_CONFLICT, RequestContext, RpcCallError
from golem.server.handlers import _changes_revert, _helper_apply, _helper_discard, _helper_retry
from golem.sessions.manager import HelperCopyError
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem_protocol.commands import (
    ChangesRevertParams,
    HelperApplyParams,
    HelperDiscardParams,
    HelperRetryParams,
    RevertTarget,
)
from golem_protocol.events import ChatEvent

__all__ = ["_configured", "_home", "_settled", "lead"]


class _Shared(base._Scripted):  # pyright: ignore
    """Every worker writes its own file and the same ``shared.txt``."""

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        tools = [m for m in messages if isinstance(m, ToolMessage)]
        if humans[0] == "go":
            if not tools:
                batch = [
                    {"agent": self.agent, "brief": f"job {n}", "label": f"w{n}"} for n in range(2)
                ]
                self.replies = [[("delegate", {"batch": batch})]]
            else:
                self.replies = ["all done"]
        else:
            n = humans[0].split("job ")[1].split()[0]
            steps = [("write_file", {"path": f"f{n}.txt", "content": f"{n}\n"})]
            steps.append(("write_file", {"path": "shared.txt", "content": f"by {n}\n"}))
            self.replies = [[steps[len(tools)]]] if len(tools) < len(steps) else ["helper done"]
        return self._generate(messages, stop, run_manager, **kwargs)


class _Ctx:
    """What the handlers read: the daemon's manager and change store."""

    def __init__(self, daemon: _Daemon, database: Database) -> None:
        self.store = ChangeStore(database, BlobStore(database))
        daemon.runtime.changes = self.store
        state = SimpleNamespace(sessions=daemon.manager, changes=self.store)
        self.ctx = cast(RequestContext, SimpleNamespace(state=state, connection=None))
        self.daemon = daemon

    async def apply(self, lead_id: str, helper: str) -> list[str]:
        await self._quiet(lead_id)
        params = HelperApplyParams(session_id=lead_id, helper_id=helper)
        return (await _helper_apply(self.ctx, params)).change_ids

    async def undo(self, lead_id: str, run_id: str) -> list[str]:
        target = RevertTarget(kind="run", run_id=run_id)
        params = ChangesRevertParams(session_id=lead_id, target=target)
        return (await _changes_revert(self.ctx, params)).reverted

    async def _quiet(self, lead_id: str) -> None:
        async with asyncio.timeout(5):
            while await self.daemon.manager.is_busy(lead_id):
                await asyncio.sleep(0.01)


async def _ended_helpers(daemon: _Daemon, lead_id: str) -> list[str]:
    events = await daemon.stored(lead_id)
    return [e.data.helper_id for e in events if e.type == "helper.started"]


async def _copy(daemon: _Daemon, helper: str) -> Path:
    found = await daemon.records.copy_of(helper)
    assert found is not None
    return Path(found[0])


def _types(events: list[ChatEvent]) -> list[str]:
    return [e.type for e in events]


@pytest.mark.parametrize("setup", SETUPS)
async def test_applying_one_of_five_diffs_changes_the_project_and_one_undo_restores_it(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled)
    daemon.manager.check_runner = _fake
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    helpers = await _ended_helpers(daemon, session)
    assert len(helpers) == WORKERS
    first = helpers[0]
    copy = await _copy(daemon, first)
    name = next(p.name for p in copy.glob("f*_0.txt"))

    ids = await tool.apply(session, first)

    assert (lead / name).read_text(encoding="utf-8") == name.split("_")[0].removeprefix("f") + "\n"
    changes = await tool.store.list(session)
    assert [c.change_id for c in changes] == ids and len(ids) == 1
    assert changes[0].source == "helper" and changes[0].before_sha is None
    assert changes[0].run_id is not None and changes[0].call_id is None
    events = await daemon.stored(session)
    applied = next(e for e in events if e.type == "helper.applied")
    assert applied.data.helper_id == first and applied.data.change_ids == ids
    changed = [e for e in events if e.type == "file.changed"]
    assert [(e.data.path, e.data.source, e.data.status) for e in changed] == [
        (name, "helper", "created")
    ]
    assert changed[0].run_id == changes[0].run_id
    # The copy is gone, and the record forgot it.
    assert not copy.exists() and await daemon.records.copy_of(first) is None
    # The four others are untouched.
    for other in helpers[1:]:
        assert await daemon.records.copy_of(other) is not None
    # One undo of that apply restores the folder.
    assert await tool.undo(session, changes[0].run_id) == [name]
    assert not (lead / name).exists()
    assert _git(lead, "status", "--porcelain") == ""


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_diff_that_touches_a_file_the_first_changed_is_a_conflict_and_writes_nothing(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(base, "_Scripted", _Shared)
    daemon = _daemon(setup, database, lead, tmp_path, _settled)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    one, two = await _ended_helpers(daemon, session)
    copy_two = await _copy(daemon, two)

    await tool.apply(session, one)
    assert (lead / "shared.txt").read_text(encoding="utf-8") == "by 0\n"
    before = await tool.store.list(session)
    with pytest.raises(RpcCallError) as caught:
        await tool.apply(session, two)

    assert caught.value.code == HELPER_CONFLICT == -32027
    assert caught.value.data == {"path": "shared.txt"}
    # Nothing was written, not even the worker's own file, and its copy is kept.
    assert not (lead / "f1.txt").exists()
    assert (lead / "shared.txt").read_text(encoding="utf-8") == "by 0\n"
    assert await tool.store.list(session) == before
    assert copy_two.is_dir() and await daemon.records.copy_of(two) is not None
    assert _types(await daemon.stored(session)).count("helper.applied") == 1


@pytest.mark.parametrize("setup", SETUPS)
async def test_created_modified_and_deleted_files_apply_and_undo(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    (lead / "gone.txt").write_text("bye\n", encoding="utf-8")
    _git(lead, "add", "-A")
    _git(lead, "commit", "-q", "-m", "two")
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1, writes=0)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    (helper,) = await _ended_helpers(daemon, session)
    copy = await _copy(daemon, helper)
    (copy / "a.py").write_text("def a():\n    return 2\n", encoding="utf-8")
    (copy / "gone.txt").unlink()
    (copy / "sub").mkdir()
    (copy / "sub" / "new.sh").write_text("#!/bin/sh\n", encoding="utf-8")
    (copy / "sub" / "new.sh").chmod(0o755)
    (copy / "blob.bin").write_bytes(b"\xff\x00\xfe")

    ids = await tool.apply(session, helper)

    assert (lead / "a.py").read_text(encoding="utf-8") == "def a():\n    return 2\n"
    assert not (lead / "gone.txt").exists()
    assert (lead / "sub" / "new.sh").read_text(encoding="utf-8") == "#!/bin/sh\n"
    assert os.access(lead / "sub" / "new.sh", os.X_OK)
    assert (lead / "blob.bin").read_bytes() == b"\xff\x00\xfe"
    changes = await tool.store.list(session)
    # The binary file is written, and has no text to record.
    assert len(changes) == len(ids) == 3
    status = {n.path: n.status for n in net_files(changes)}
    assert status == {"a.py": "modified", "gone.txt": "deleted", "sub/new.sh": "created"}
    (run_id,) = {c.run_id for c in changes}
    assert run_id is not None
    assert sorted(await tool.undo(session, run_id)) == ["a.py", "gone.txt", "sub/new.sh"]
    assert (lead / "a.py").read_text(encoding="utf-8") == "def a():\n    return 1\n"
    assert (lead / "gone.txt").read_text(encoding="utf-8") == "bye\n"
    assert not (lead / "sub" / "new.sh").exists()


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_file_the_lead_has_changed_since_the_copy_is_a_conflict(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1, writes=0)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    (helper,) = await _ended_helpers(daemon, session)
    copy = await _copy(daemon, helper)
    (copy / "a.py").write_text("worker\n", encoding="utf-8")
    (copy / "z.txt").write_text("z\n", encoding="utf-8")
    (lead / "a.py").write_text("lead\n", encoding="utf-8")

    with pytest.raises(RpcCallError) as caught:
        await tool.apply(session, helper)

    assert caught.value.code == HELPER_CONFLICT and caught.value.data == {"path": "a.py"}
    assert (lead / "a.py").read_text(encoding="utf-8") == "lead\n"
    assert not (lead / "z.txt").exists()


@pytest.mark.parametrize("setup", SETUPS)
async def test_discard_removes_the_copy_and_says_so(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=2)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    one, two = await _ended_helpers(daemon, session)
    copy = await _copy(daemon, one)

    params = HelperDiscardParams(session_id=session, helper_id=one)
    await _helper_discard(tool.ctx, params)

    assert not copy.exists() and await daemon.records.copy_of(one) is None
    assert await daemon.records.copy_of(two) is not None
    discarded = [e for e in await daemon.stored(session) if e.type == "helper.discarded"]
    assert [e.data.helper_id for e in discarded] == [one]
    assert _git(lead, "status", "--porcelain") == ""
    # A second discard, or an apply, has no copy to work on.
    with pytest.raises(RpcCallError):
        await _helper_discard(tool.ctx, params)
    with pytest.raises(RpcCallError):
        await tool.apply(session, one)


@pytest.mark.parametrize("setup", SETUPS)
async def test_apply_after_a_restart_finds_the_copy_in_the_record(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    before = _daemon(setup, database, lead, tmp_path, _settled, count=1)
    session, _events = await before.run(lead)
    (helper,) = await _ended_helpers(before, session)
    await before.manager.cancel_all()
    after = _daemon(setup, database, lead, tmp_path, _settled, count=1)
    tool = _Ctx(after, database)
    assert helper not in after.manager._sessions

    ids = await tool.apply(session, helper)

    assert len(ids) == 1
    assert (lead / "f0_0.txt").read_text(encoding="utf-8") == "0\n"
    assert await after.records.copy_of(helper) is None


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_helper_of_another_lead_is_refused(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    (helper,) = await _ended_helpers(daemon, session)
    other = await daemon.manager.create(setup.profile, cwd=str(lead))

    with pytest.raises(HelperCopyError):
        await daemon.manager.apply_helper(other, helper)

    assert await daemon.records.copy_of(helper) is not None
    assert not (lead / "f0_0.txt").exists()
    assert tool.store is not None


@pytest.mark.parametrize("setup", SETUPS)
async def test_retry_starts_the_brief_again_in_a_fresh_copy_and_discards_the_old_one(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1)
    session, _events = await daemon.run(lead)
    tool = _Ctx(daemon, database)
    (old,) = await _ended_helpers(daemon, session)
    old_copy = await _copy(daemon, old)

    await tool._quiet(session)
    params = HelperRetryParams(session_id=session, helper_id=old, model="stronger")
    new = (await _helper_retry(tool.ctx, params)).helper_id

    assert new != old
    new_copy = await _copy(daemon, new)
    assert new_copy != old_copy and new_copy.name == new and new_copy.is_dir()
    assert not old_copy.exists() and await daemon.records.copy_of(old) is None
    events = await daemon.stored(session)
    started = [e.data for e in events if e.type == "helper.started"]
    assert [(d.helper_id, d.index, d.agent, d.label) for d in started] == [
        (old, 0, "worker", "w0"),
        (new, 1, "worker", "w0"),
    ]
    assert started[0].call_id == started[1].call_id
    assert [e.data.helper_id for e in events if e.type == "helper.discarded"] == [old]
    # The brief is the same one.
    messages = (await daemon.manager.inspect(new)).messages
    assert next(m.text for m in messages if m.role == "user") == "job 0"
