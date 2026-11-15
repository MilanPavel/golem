"""Each file a tool writes is recorded, and sent as `file.changed` before its `tool.completed`."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.coding.changes import ChangeStore
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import (
    ApprovalNeededEvent,
    ChatEvent,
    FileChangedEvent,
    ToolCompletedEvent,
)

Reply = str | list[tuple[str, dict[str, Any]]]


class _Chat:
    def __init__(self, database: Database, replies: list[Reply], home: Path) -> None:
        self.model = ToolCallingChatModel(replies=replies)
        self.runtime: ChatRuntime = open_chat(
            ModelRouter(model=self.model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
        )
        self.store = ChangeStore(database, BlobStore(database))
        self.runtime.changes = self.store
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)

    async def autopilot(self, project: Path) -> str:
        session_id = await self.manager.create(None, cwd=str(project))
        await self.manager.set_mode(session_id, "autopilot")
        return session_id


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    return project


def _changed(events: list[ChatEvent]) -> list[FileChangedEvent]:
    return [event for event in events if isinstance(event, FileChangedEvent)]


def _write(content: str) -> tuple[str, dict[str, Any]]:
    return ("write_file", {"path": "a.py", "content": content})


def _edit(old: str, new: str) -> tuple[str, dict[str, Any]]:
    return ("edit_file", {"path": "a.py", "old_string": old, "new_string": new})


async def test_a_write_then_an_edit_are_recorded_and_sent_before_their_tool_completed(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_write("one\ntwo\n")], [_edit("two", "TWO")], "done"], tmp_path)
    session_id = await chat.autopilot(project)
    run_id = await chat.manager.send(session_id, "make a.py")
    events = await chat.settled(run_id)

    changed = _changed(events)
    assert [(e.data.status, e.data.added, e.data.removed) for e in changed] == [
        ("created", 2, 0),
        ("modified", 1, 1),
    ]
    assert all(e.data.path == "a.py" and e.data.source == "tool" for e in changed)
    assert all(e.run_id == run_id for e in changed)
    completed = [e for e in events if isinstance(e, ToolCompletedEvent)]
    assert [e.data.call_id for e in completed] == [e.data.call_id for e in changed]
    for change, done in zip(changed, completed, strict=True):
        assert events.index(change) < events.index(done)

    stored = await chat.store.list(session_id)
    assert [c.change_id for c in stored] == [e.data.change_id for e in changed]
    assert [c.call_id for c in stored] == [e.data.call_id for e in changed]
    assert {c.run_id for c in stored} == {run_id}
    assert [await chat.store.text(c.after_sha) for c in stored] == ["one\ntwo\n", "one\nTWO\n"]


async def test_the_event_carries_no_file_text(database: Database, tmp_path: Path) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_write("secret text\n")], "done"], tmp_path)
    session_id = await chat.autopilot(project)
    run_id = await chat.manager.send(session_id, "make it")
    events = await chat.settled(run_id)

    [event] = _changed(events)
    assert "secret text" not in event.model_dump_json()


async def test_a_write_of_the_same_content_sends_nothing(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    (project / "a.py").write_text("same\n", encoding="utf-8")
    chat = _Chat(database, [[_write("same\n")], "done"], tmp_path)
    session_id = await chat.autopilot(project)
    run_id = await chat.manager.send(session_id, "write it again")
    events = await chat.settled(run_id)

    assert _changed(events) == []
    assert await chat.store.list(session_id) == []


async def test_a_failed_edit_sends_nothing(database: Database, tmp_path: Path) -> None:
    project = _project(tmp_path)
    (project / "a.py").write_text("one\n", encoding="utf-8")
    chat = _Chat(database, [[_edit("missing", "x")], "sorry"], tmp_path)
    session_id = await chat.autopilot(project)
    run_id = await chat.manager.send(session_id, "edit")
    events = await chat.settled(run_id)

    assert _changed(events) == []
    assert await chat.store.list(session_id) == []


async def test_without_a_store_a_write_sends_nothing(database: Database, tmp_path: Path) -> None:
    project = _project(tmp_path)
    chat = _Chat(database, [[_write("one\n")], "done"], tmp_path)
    chat.runtime.changes = None
    session_id = await chat.autopilot(project)
    run_id = await chat.manager.send(session_id, "make it")
    events = await chat.settled(run_id)

    assert _changed(events) == []
    assert (project / "a.py").read_text(encoding="utf-8") == "one\n"


async def test_a_run_resumed_after_an_approval_records_each_change_once(
    database: Database, tmp_path: Path
) -> None:
    project = _project(tmp_path)
    (project / "a.py").write_text("one\ntwo\n", encoding="utf-8")
    replies: list[Reply] = [[_edit("one", "ONE"), _edit("two", "TWO")], "done"]
    chat = _Chat(database, replies, tmp_path)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "shout")

    first = next(e for e in await chat.settled(run_id) if isinstance(e, ApprovalNeededEvent))
    assert await chat.store.list(session_id) == []
    await chat.manager.respond(session_id, first.data.call_id, "allow")
    second = [e for e in await chat.settled(run_id) if isinstance(e, ApprovalNeededEvent)][-1]
    await chat.manager.respond(session_id, second.data.call_id, "allow")
    events = await chat.settled(run_id)

    assert [e.data.call_id for e in _changed(events)] == [
        first.data.call_id,
        second.data.call_id,
    ]
    stored = await chat.store.list(session_id)
    assert [c.call_id for c in stored] == [first.data.call_id, second.data.call_id]
    assert (project / "a.py").read_text(encoding="utf-8") == "ONE\nTWO\n"
