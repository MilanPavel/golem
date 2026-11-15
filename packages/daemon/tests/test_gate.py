"""One generation at a time on a local server, chat ahead of jobs."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from fakes import GatedChatModel, ScriptedChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.models.gate import Priority, ServerGate
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.titles import ModelTitles
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords

A = "http://127.0.0.1:11434"
B = "http://127.0.0.1:11435"


async def _settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


class _Probe:
    """Runs ``hold`` as a task. ``entered`` is set inside, and it leaves on ``leave``."""

    def __init__(
        self, gate: ServerGate, server: str | None, priority: Priority, order: list[str], name: str
    ) -> None:
        self.entered = asyncio.Event()
        self.leave = asyncio.Event()
        self.fail = False
        self._task = asyncio.create_task(self._run(gate, server, priority, order, name))

    async def _run(
        self, gate: ServerGate, server: str | None, priority: Priority, order: list[str], name: str
    ) -> None:
        async with gate.hold(server, priority):
            order.append(name)
            self.entered.set()
            await self.leave.wait()
            if self.fail:
                raise RuntimeError("boom")

    @property
    def task(self) -> asyncio.Task[None]:
        return self._task


async def test_two_holders_on_one_server_run_one_after_the_other() -> None:
    gate, order = ServerGate(), list[str]()
    first = _Probe(gate, A, "chat", order, "first")
    second = _Probe(gate, A, "chat", order, "second")
    await _settle()

    assert order == ["first"]
    assert gate.waiting(A) == 1
    first.leave.set()
    await second.entered.wait()
    assert order == ["first", "second"]
    second.leave.set()
    await asyncio.gather(first.task, second.task)
    assert gate.waiting(A) == 0


async def test_two_servers_run_at_the_same_time() -> None:
    gate, order = ServerGate(), list[str]()
    first = _Probe(gate, A, "chat", order, "a")
    second = _Probe(gate, B, "chat", order, "b")
    await _settle()

    assert order == ["a", "b"]
    first.leave.set()
    second.leave.set()
    await asyncio.gather(first.task, second.task)


async def test_a_hosted_call_never_waits() -> None:
    gate, order = ServerGate(), list[str]()
    local = _Probe(gate, A, "chat", order, "local")
    hosted = [_Probe(gate, None, "chat", order, f"hosted{n}") for n in range(3)]
    await _settle()

    assert order == ["local", "hosted0", "hosted1", "hosted2"]
    for probe in [local, *hosted]:
        probe.leave.set()
    await asyncio.gather(local.task, *(p.task for p in hosted))


async def test_a_chat_waiter_that_arrives_after_a_job_runs_first() -> None:
    gate, order = ServerGate(), list[str]()
    holder = _Probe(gate, A, "chat", order, "holder")
    job = _Probe(gate, A, "job", order, "job")
    chat = _Probe(gate, A, "chat", order, "chat")
    await _settle()

    holder.leave.set()
    await chat.entered.wait()
    assert order == ["holder", "chat"]
    chat.leave.set()
    await job.entered.wait()
    job.leave.set()
    await asyncio.gather(holder.task, job.task, chat.task)
    assert order == ["holder", "chat", "job"]


async def test_waiters_of_one_priority_run_in_arrival_order() -> None:
    gate, order = ServerGate(), list[str]()
    probes = [_Probe(gate, A, "job", order, str(n)) for n in range(4)]
    for probe in probes:
        await _settle()
        probe.leave.set()
    await asyncio.gather(*(p.task for p in probes))

    assert order == ["0", "1", "2", "3"]


async def test_a_cancelled_waiter_does_not_block_the_next_one() -> None:
    gate, order = ServerGate(), list[str]()
    holder = _Probe(gate, A, "chat", order, "holder")
    gone = _Probe(gate, A, "chat", order, "gone")
    next_up = _Probe(gate, A, "chat", order, "next")
    await _settle()
    assert gate.waiting(A) == 2

    gone.task.cancel()
    await _settle()
    assert gate.waiting(A) == 1
    holder.leave.set()
    await next_up.entered.wait()
    next_up.leave.set()
    await asyncio.gather(holder.task, next_up.task)
    assert order == ["holder", "next"]
    assert gone.task.cancelled()


async def test_a_cancel_right_after_the_hand_over_passes_the_slot_on() -> None:
    gate, order = ServerGate(), list[str]()
    holder = _Probe(gate, A, "chat", order, "holder")
    gone = _Probe(gate, A, "chat", order, "gone")
    next_up = _Probe(gate, A, "chat", order, "next")
    await _settle()

    holder.leave.set()
    gone.task.cancel()
    await next_up.entered.wait()
    next_up.leave.set()
    await asyncio.gather(holder.task, next_up.task)
    assert "next" in order


async def test_a_holder_that_raises_frees_the_slot() -> None:
    gate, order = ServerGate(), list[str]()
    first = _Probe(gate, A, "chat", order, "first")
    second = _Probe(gate, A, "chat", order, "second")
    await _settle()

    first.fail = True
    first.leave.set()
    await second.entered.wait()
    second.leave.set()
    results = await asyncio.gather(first.task, second.task, return_exceptions=True)
    assert isinstance(results[0], RuntimeError)
    assert results[1] is None


async def test_two_slots_let_two_run_and_make_the_third_wait() -> None:
    gate, order = ServerGate(slots=2), list[str]()
    probes = [_Probe(gate, A, "chat", order, str(n)) for n in range(3)]
    await _settle()

    assert order == ["0", "1"]
    assert gate.waiting(A) == 1
    probes[0].leave.set()
    await probes[2].entered.wait()
    for probe in probes:
        probe.leave.set()
    await asyncio.gather(*(p.task for p in probes))


async def test_waiting_counts_per_server() -> None:
    gate, order = ServerGate(), list[str]()
    assert gate.waiting(A) == 0
    probes = [_Probe(gate, A, "chat" if n % 2 else "job", order, str(n)) for n in range(4)]
    other = _Probe(gate, B, "chat", order, "other")
    await _settle()

    assert (gate.waiting(A), gate.waiting(B)) == (3, 0)
    for probe in [*probes, other]:
        probe.leave.set()
    await asyncio.gather(*(p.task for p in [*probes, other]))
    assert gate.waiting(A) == 0


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


class _Chat:
    def __init__(self, database: Database, gate: ServerGate, model: GatedChatModel) -> None:
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        router = ModelRouter(GolemSettings(default_model="ollama/qwen3:8b"), model=model)
        runtime = open_chat(router, InMemorySaver(), gate=gate)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def status(self, run_id: str) -> str | None:
        run = await self.runs.get(run_id)
        return None if run is None else run.status

    async def finished(self, run_id: str) -> None:
        async def done() -> bool:
            return await self.status(run_id) not in (None, "running")

        await _until(done)


async def test_two_sessions_on_one_local_model_never_run_two_requests_at_once(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, ServerGate(), model)
    one = await chat.manager.send(await chat.manager.create(None), "first")
    await _until(_started(model))
    two = await chat.manager.send(await chat.manager.create(None), "second")
    await asyncio.sleep(0.1)

    assert len(model.seen) == 1
    model.release.set()
    await chat.finished(one)
    await chat.finished(two)
    assert len(model.seen) == 2
    assert [await chat.status(one), await chat.status(two)] == ["completed", "completed"]


async def test_a_run_cancelled_while_it_waits_for_the_model_ends_cancelled(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, ServerGate(), model)
    one = await chat.manager.send(await chat.manager.create(None), "first")
    await _until(_started(model))
    two = await chat.manager.send(await chat.manager.create(None), "second")
    await asyncio.sleep(0.1)

    assert await chat.manager.cancel(two) is True
    await chat.finished(two)

    assert await chat.status(two) == "cancelled"
    assert len(model.seen) == 1
    model.release.set()
    await chat.finished(one)
    assert await chat.status(one) == "completed"


async def _waiting_events(chat: _Chat, run_id: str) -> list[bool]:
    return [
        event.data.waiting
        for event in await chat.events.for_run(run_id)
        if event.type == "model.waiting"
    ]


async def test_the_second_session_says_it_waits_after_the_threshold_and_clears_it(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, ServerGate(notice_after=0.05), model)
    one = await chat.manager.send(await chat.manager.create(None), "first")
    await _until(_started(model))
    two = await chat.manager.send(await chat.manager.create(None), "second")

    async def told() -> bool:
        return await _waiting_events(chat, two) == [True]

    await _until(told)
    assert await _waiting_events(chat, one) == []
    model.release.set()
    await chat.finished(one)
    await chat.finished(two)
    # message.completed drops the live rows
    assert await _waiting_events(chat, two) == []


async def test_a_call_that_gets_the_gate_at_once_sends_no_notice() -> None:
    told = list[bool]()
    gate = ServerGate(notice_after=0.05)
    async with gate.hold(A, "chat", told.append):
        await asyncio.sleep(0.1)
    assert told == []


async def test_a_waiting_chat_call_is_told_once_and_cleared_when_it_gets_its_turn() -> None:
    told, order = list[bool](), list[str]()
    gate = ServerGate(notice_after=0.05)
    first = _Probe(gate, A, "chat", order, "first")
    await _settle()

    async def second() -> None:
        async with gate.hold(A, "chat", told.append):
            order.append("second")

    task = asyncio.create_task(second())
    await asyncio.sleep(0.15)
    assert told == [True]
    first.leave.set()
    await task
    assert told == [True, False]


async def test_a_short_wait_and_a_job_send_no_notice() -> None:
    told, order = list[bool](), list[str]()
    gate = ServerGate(notice_after=0.2)
    first = _Probe(gate, A, "chat", order, "first")
    await _settle()

    async def waiter(priority: Priority) -> None:
        async with gate.hold(A, priority, told.append):
            pass

    quick = asyncio.create_task(waiter("chat"))
    await _settle()
    first.leave.set()
    await quick
    assert told == []

    second = _Probe(gate, A, "chat", order, "second")
    await _settle()
    job = asyncio.create_task(waiter("job"))
    await asyncio.sleep(0.3)
    second.leave.set()
    await job
    assert told == []


async def test_a_waiter_cancelled_while_it_waits_leaves_no_notice_state() -> None:
    told, order = list[bool](), list[str]()
    gate = ServerGate(notice_after=0.2)
    first = _Probe(gate, A, "chat", order, "first")
    await _settle()

    async def waiter() -> None:
        async with gate.hold(A, "chat", told.append):
            pass

    task = asyncio.create_task(waiter())
    await _settle()
    task.cancel()
    await asyncio.sleep(0.3)
    assert told == [] and gate.waiting(A) == 0
    first.leave.set()
    await first.task


def _started(model: GatedChatModel) -> Callable[[], Awaitable[bool]]:
    async def check() -> bool:
        return model.started.is_set()

    return check


async def test_a_title_on_a_local_model_waits_behind_a_chat_call() -> None:
    gate, order = ServerGate(), list[str]()
    model = ScriptedChatModel(replies=["A title"])
    router = ModelRouter(GolemSettings(default_model="ollama/qwen3:8b"), model=model)
    target = router.ollama_server("ollama/qwen3:8b")
    assert target is not None
    chat = _Probe(gate, target[1], "chat", order, "chat")
    await _settle()

    title = asyncio.create_task(ModelTitles(router, gate).title("ollama/qwen3:8b", "hi", "hello"))
    await asyncio.sleep(0.05)
    assert not title.done()
    assert model.seen == []

    chat.leave.set()
    assert await title == "A title"
    await chat.task
