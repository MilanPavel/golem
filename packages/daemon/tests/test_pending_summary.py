"""``SessionSummary.pending``: what a waiting session waits for (17.3.1)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_paid_consent import (
    LOCAL,
    _answer,  # pyright: ignore[reportPrivateUsage]
    _last_input,  # pyright: ignore[reportPrivateUsage]
    _local_does_not_fit,  # pyright: ignore[reportPrivateUsage]
    _router,  # pyright: ignore[reportPrivateUsage]
    _send,  # pyright: ignore[reportPrivateUsage]
    _session,  # pyright: ignore[reportPrivateUsage]
    _until,  # pyright: ignore[reportPrivateUsage]
)
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.approvals import diff_counts
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.commands import SessionSummary
from golem_protocol.events import ApprovalNeededEvent, ChatEvent

Reply = str | list[tuple[str, dict[str, Any]]]


class _Watch:
    def __init__(self) -> None:
        self.summaries: list[SessionSummary] = []

    def deliver_summary(self, summary: SessionSummary) -> None:
        self.summaries.append(summary)


class _Chat:
    def __init__(self, database: Database, replies: list[Reply], home: Path) -> None:
        self.model = ToolCallingChatModel(replies=replies)
        self.runtime = open_chat(
            ModelRouter(model=self.model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.watch = _Watch()
        self.manager = self.build()

    def build(self) -> SessionManager:
        """A manager over the same database, as after a daemon restart."""
        bus = EventBus()
        bus.watch(self.watch)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, bus, self.records), self.records, self.runs
        )
        return self.manager

    async def summary(self, session_id: str) -> SessionSummary:
        found = [a for a in await self.manager.recent(20) if a.session.session_id == session_id]
        return summarize(found[0], False, await self.manager.pending(found[0]))

    async def asked(self, run_id: str) -> ApprovalNeededEvent:
        async def waiting() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status == "waiting"

        await _wait(waiting)
        events: list[ChatEvent] = await self.events.for_run(run_id)
        return next(e for e in events if isinstance(e, ApprovalNeededEvent))

    async def idle(self, session_id: str) -> bool:
        return (await self.summary(session_id)).status == "idle"


async def _wait(check: Callable[[], Awaitable[bool]]) -> None:
    async with asyncio.timeout(3):
        while not await check():
            await asyncio.sleep(0.01)


def _project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / "a.py").write_text("one\ntwo\nthree\n", encoding="utf-8")
    return project


_EDIT = ("edit_file", {"path": "a.py", "old_string": "two", "new_string": "TWO"})


def test_diff_counts_skip_the_headers() -> None:
    diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n keep\n"
    assert diff_counts(diff) == (2, 1)


async def test_a_write_approval_gives_counts_and_the_event_ts(
    database: Database, tmp_path: Path
) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    run_id = await chat.manager.send(session_id, "shout two")
    asked = await chat.asked(run_id)

    summary = await chat.summary(session_id)
    assert summary.status == "waiting"
    pending = summary.pending
    assert pending is not None
    assert pending.kind == "approval"
    assert pending.call_id == asked.data.call_id
    assert pending.name == "edit_file"
    assert pending.subject == "a.py"
    assert pending.source == asked.data.source
    assert (pending.added, pending.removed) == (1, 1)
    assert pending.alternatives is None
    assert pending.since == asked.ts
    assert "TWO" not in summary.model_dump_json()


async def test_a_shell_approval_has_no_counts(database: Database, tmp_path: Path) -> None:
    chat = _Chat(database, [[("shell", {"command": "echo hi"})], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(tmp_path))
    run_id = await chat.manager.send(session_id, "say hi")
    asked = await chat.asked(run_id)
    pending = (await chat.summary(session_id)).pending
    assert pending is not None
    assert (pending.kind, pending.name, pending.subject) == ("approval", "shell", "echo hi")
    assert (pending.added, pending.removed) == (None, None)
    assert pending.since == asked.ts


async def test_watchers_hear_when_it_appears_and_when_it_is_allowed(
    database: Database, tmp_path: Path
) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    run_id = await chat.manager.send(session_id, "shout two")
    asked = await chat.asked(run_id)
    assert chat.watch.summaries[-1].status == "waiting"
    assert chat.watch.summaries[-1].pending is not None

    await chat.manager.respond(session_id, asked.data.call_id, "allow")
    await _wait(lambda: chat.idle(session_id))
    assert chat.watch.summaries[-1].pending is None


async def test_a_denied_call_clears_it(database: Database, tmp_path: Path) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    run_id = await chat.manager.send(session_id, "shout two")
    asked = await chat.asked(run_id)
    await chat.manager.respond(session_id, asked.data.call_id, "deny")
    await _wait(lambda: chat.idle(session_id))
    assert chat.watch.summaries[-1].pending is None


async def test_a_cancelled_run_clears_it(database: Database, tmp_path: Path) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    run_id = await chat.manager.send(session_id, "shout two")
    await chat.asked(run_id)
    assert chat.watch.summaries[-1].pending is not None
    await chat.manager.cancel(run_id)
    await _wait(lambda: chat.idle(session_id))
    assert chat.watch.summaries[-1].pending is None


async def test_closing_the_session_clears_it(database: Database, tmp_path: Path) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    session_id = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    run_id = await chat.manager.send(session_id, "shout two")
    await chat.asked(run_id)
    await chat.manager.close(session_id)
    last = chat.watch.summaries[-1]
    assert last.status == "closed"
    assert last.pending is None


async def test_the_list_reports_pending_also_after_a_restart(
    database: Database, tmp_path: Path
) -> None:
    chat = _Chat(database, [[_EDIT], "done"], tmp_path)
    waiting = await chat.manager.create(None, cwd=str(_project(tmp_path)))
    other = await chat.manager.create(None, cwd=str(tmp_path))
    run_id = await chat.manager.send(waiting, "shout two")
    asked = await chat.asked(run_id)
    chat.build()
    again = await chat.summary(waiting)
    assert again.pending is not None
    assert again.pending.call_id == asked.data.call_id
    assert again.pending.since == asked.ts
    assert (await chat.summary(other)).pending is None


async def test_a_paid_question_gives_consent_with_alternatives(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=_router(), facts=_local_does_not_fit())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.list", {"limit": 10, "watch": True}))
        session_id = await _session(client, LOCAL)
        _last_input(app, session_id, 20000)
        run_id = await _send(client, session_id)
        asked = await client.wait_for_event("route.consent.needed")
        params: Any = asked["params"]
        listed: Any = rpc_result(await client.call("session.list", {"limit": 10}))
        pending = listed["sessions"][0]["pending"]
        assert pending["kind"] == "consent"
        assert pending["alternatives"] == len(params["data"]["alternatives"])
        assert pending["since"] == params["ts"]
        assert pending["call_id"] is None
        summaries: Any = await client.take_summaries()
        assert summaries[-1]["params"]["pending"]["kind"] == "consent"

        rpc_result(await _answer(client, session_id, run_id, "once"))
        await _until(client, "run.completed")
        after: Any = await client.take_summaries()
        assert after[-1]["params"]["pending"] is None
        listed = rpc_result(await client.call("session.list", {"limit": 10}))
        assert listed["sessions"][0]["pending"] is None
    finally:
        await client.close()
        await stop_daemon(app, task)
