"""The session summary carries the open slot, provider or load wait (ADR-060, step 18.4.5)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from fakes import GatedChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_wait_reasons import CLOUD, LOCAL, _fast, _until

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.models.dispatcher import Dispatcher
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.recovery import recover_runs
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.commands import SessionSummary


class _Watch:
    def __init__(self) -> None:
        self.summaries: list[SessionSummary] = []

    def deliver_summary(self, summary: SessionSummary) -> None:
        self.summaries.append(summary)


class _Chat:
    def __init__(self, database: Database, model: Any, default: str, slots: int) -> None:
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        self.runs = RunRecords(database)
        self.watch = _Watch()
        bus = EventBus()
        bus.watch(self.watch)
        self.log = SessionLog(self.events, bus, self.records)
        router = ModelRouter(GolemSettings(default_model=default), model=model)
        dispatcher = Dispatcher(
            lambda call: 2 if call.role != "job" else 4, local_slots=slots, sleep=_fast
        )
        self.manager: SessionManager
        self.runtime = open_chat(
            router,
            InMemorySaver(),
            dispatcher=dispatcher,
            label_of=lambda sid, role: self.manager.label_of(sid, role),
        )
        self.manager = SessionManager(self.runtime, self.log, self.records, self.runs)

    async def send(self, title: str) -> tuple[str, str]:
        session_id = await self.manager.create(None)
        await self.manager.rename(session_id, title)
        return session_id, await self.manager.send(session_id, "hi")

    async def summary(self, session_id: str, log: SessionLog | None = None) -> SessionSummary:
        log = log or self.log
        found = [a for a in await self.records.recent(50) if a.session.session_id == session_id]
        return summarize(found[0], False, await log.pending(found[0]), await log.wait(found[0]))

    def pushed(self, session_id: str) -> list[SessionSummary]:
        return [s for s in self.watch.summaries if s.session_id == session_id]

    async def until(self, session_id: str, check: Callable[[SessionSummary], bool]) -> None:
        async def done() -> bool:
            return check(await self.summary(session_id))

        await _until(done)

    async def finished(self, run_id: str) -> None:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)


async def _two_running(model: GatedChatModel, count: int) -> None:
    async def running() -> bool:
        return len(model.seen) == count

    await _until(running)


async def test_local_only_the_third_chat_is_queued_on_the_model_and_clears_when_it_starts(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, LOCAL, slots=2)
    (_, first), (_, second), (third_session, third) = [
        await chat.send(title) for title in ("Alpha", "Beta", "Gamma")
    ]
    await _two_running(model, 2)
    await chat.until(third_session, lambda s: s.wait_reason == "slot")
    summary = await chat.summary(third_session)
    assert (summary.status, summary.wait_reason, summary.wait_line) == (
        "running",
        "slot",
        "qwen3:8b",
    )
    assert any(s.wait_reason == "slot" for s in chat.pushed(third_session))

    model.release.set()
    for run in (first, second, third):
        await chat.finished(run)
    summary = await chat.summary(third_session)
    assert (summary.wait_reason, summary.wait_line) == (None, None)
    assert chat.pushed(third_session)[-1].wait_reason is None


async def test_a_wait_is_pushed_once_and_a_position_change_pushes_nothing(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, LOCAL, slots=1)
    sent = [await chat.send(title) for title in ("Alpha", "Beta", "Gamma")]
    await _two_running(model, 1)
    third_session = sent[2][0]
    await chat.until(sent[1][0], lambda s: s.wait_reason == "slot")
    await chat.until(third_session, lambda s: s.wait_reason == "slot")
    await asyncio.sleep(0.2)  # room for the dispatcher's later notices
    queued = [s for s in chat.pushed(third_session) if s.wait_reason == "slot"]
    assert len(queued) == 1
    model.release.set()
    for _, run in sent:
        await chat.finished(run)


async def test_cloud_only_a_provider_wait_names_the_provider_and_never_the_local_model(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, CLOUD, slots=2)
    sent = [await chat.send(f"Chat {n}") for n in range(5)]
    await _two_running(model, 4)
    fifth_session = sent[4][0]
    await chat.until(fifth_session, lambda s: s.wait_reason == "provider")
    summary = await chat.summary(fifth_session)
    assert (summary.wait_reason, summary.wait_line) == ("provider", "anthropic")
    assert "local" not in f"{summary.wait_reason} {summary.wait_line}".lower()
    assert "local" not in summary.model_dump_json(exclude={"model_profile", "local_only"}).lower()

    model.release.set()
    for _, run in sent:
        await chat.finished(run)
    assert (await chat.summary(fifth_session)).wait_reason is None


async def test_a_cancelled_run_carries_no_wait(database: Database) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, LOCAL, slots=1)
    _, first = await chat.send("Alpha")
    second_session, second = await chat.send("Beta")
    await _two_running(model, 1)
    await chat.until(second_session, lambda s: s.wait_reason == "slot")

    assert await chat.manager.cancel(second)
    await chat.until(second_session, lambda s: s.status == "idle")
    assert (await chat.summary(second_session)).wait_reason is None
    assert chat.pushed(second_session)[-1].wait_reason is None

    model.release.set()
    await chat.finished(first)


async def test_a_run_recovered_after_a_restart_carries_no_stale_wait(database: Database) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, model, LOCAL, slots=1)
    await chat.send("Alpha")
    second_session, _ = await chat.send("Beta")
    await _two_running(model, 1)
    await chat.until(second_session, lambda s: s.wait_reason == "slot")

    # The daemon starts again over the same database: the open runs are closed.
    again = SessionLog(EventLog(database), EventBus(), SessionRecords(database))
    closed = await recover_runs(RunRecords(database), chat.events, again, chat.runtime)
    assert closed
    summary = await chat.summary(second_session, again)
    assert (summary.wait_reason, summary.wait_line) == (None, None)
    assert summary.status != "running"
    model.release.set()
    await chat.manager.cancel_all()
