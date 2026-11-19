"""Chat, titles and checks take their slot from the dispatcher (ADR-060, step 18.2.3)."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any

from fakes import GatedChatModel, ScriptedChatModel
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import GolemSettings, ProviderSettings
from golem.graphs.chat import open_chat
from golem.models.dispatcher import Call, Dispatcher, LineKey
from golem.models.router import ModelRouter
from golem.server.app import class_of
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.titles import ModelTitles
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords

LOCAL = "ollama/qwen3:8b"
CLOUD = "anthropic/claude-sonnet-4-5"


def _rank(call: Call) -> int:
    return {"chat": 2, "helper": 2, "job": 4}[call.role]


async def _fast(seconds: float) -> None:
    """A sleep that runs 50 times faster, so a one second notice takes 20 ms."""
    await asyncio.sleep(seconds / 50)


def _dispatcher(slots: int = 1) -> Dispatcher:
    return Dispatcher(_rank, local_slots=slots, sleep=_fast)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _started(model: GatedChatModel) -> Callable[[], Awaitable[bool]]:
    async def check() -> bool:
        return model.started.is_set()

    return check


class _Chat:
    def __init__(
        self,
        database: Database,
        dispatcher: Dispatcher,
        model: Any,
        default: str = LOCAL,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.router = ModelRouter(GolemSettings(default_model=default), model=model)
        if sleep is not None:
            self.router.sleep = sleep
        runtime = open_chat(self.router, InMemorySaver(), dispatcher=dispatcher)
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

    async def send(self, text: str) -> str:
        return await self.manager.send(await self.manager.create(None), text)


async def test_two_sessions_on_one_local_model_never_run_two_requests_at_once(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, _dispatcher(), model)
    one = await chat.send("first")
    await _until(_started(model))
    two = await chat.send("second")
    await asyncio.sleep(0.1)

    assert len(model.seen) == 1
    model.release.set()
    await chat.finished(one)
    await chat.finished(two)
    assert len(model.seen) == 2
    assert [await chat.status(one), await chat.status(two)] == ["completed", "completed"]


async def test_two_chats_run_at_once_with_two_slots_and_the_third_waits(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    dispatcher = _dispatcher(slots=2)
    chat = _Chat(database, dispatcher, model)
    runs = [await chat.send(text) for text in ("one", "two", "three")]

    async def two_run() -> bool:
        return len(model.seen) == 2

    await _until(two_run)
    await asyncio.sleep(0.1)
    assert len(model.seen) == 2
    [line] = dispatcher.snapshot()
    assert (len(line.holders), len(line.waiting)) == (2, 1)

    model.release.set()
    for run in runs:
        await chat.finished(run)
    assert len(model.seen) == 3


async def test_a_title_goes_after_a_chat_on_the_same_model() -> None:
    dispatcher = _dispatcher()
    model = ScriptedChatModel(replies=["A title"])
    router = ModelRouter(GolemSettings(default_model=LOCAL), model=model)
    line = router.local_line(LOCAL)
    assert line is not None
    held = asyncio.Event()
    leave = asyncio.Event()

    async def chat() -> None:
        async with dispatcher.hold(Call(line, "s1", "chat", "a chat")):
            held.set()
            await leave.wait()

    holder = asyncio.create_task(chat())
    await held.wait()
    title = asyncio.create_task(ModelTitles(router, dispatcher).title(LOCAL, "hi", "hello"))
    await asyncio.sleep(0.05)
    assert not title.done()
    assert model.seen == []
    assert [w.label for w in dispatcher.snapshot()[0].waiting] == ["a title job"]

    leave.set()
    assert await title == "A title"
    await holder


async def test_a_run_cancelled_while_it_waits_for_the_model_ends_cancelled(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, _dispatcher(), model)
    one = await chat.send("first")
    await _until(_started(model))
    two = await chat.send("second")
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


async def test_the_second_session_says_it_waits_after_a_second_and_clears_it(
    database: Database,
) -> None:
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, _dispatcher(), model)
    one = await chat.send("first")
    await _until(_started(model))
    two = await chat.send("second")

    async def told() -> bool:
        return await _waiting_events(chat, two) == [True]

    await _until(told)
    assert await _waiting_events(chat, one) == []
    model.release.set()
    await chat.finished(one)
    await chat.finished(two)
    # message.completed drops the live rows
    assert await _waiting_events(chat, two) == []


class _Http(Exception):
    """What a provider SDK raises on a rate limit."""

    def __init__(self) -> None:
        super().__init__("Error code: 429")
        self.status_code = 429
        self.response = SimpleNamespace(status_code=429, headers={})


class _Flaky(GatedChatModel):
    """Fails its first call with a rate limit, then answers."""

    calls: int = 0

    async def _astream(
        self, messages: list[BaseMessage], *args: Any, **kwargs: Any
    ) -> AsyncIterator[ChatGenerationChunk]:
        self.calls += 1
        if self.calls == 1:
            raise _Http()
        self.release.set()
        async for chunk in super()._astream(messages, *args, **kwargs):
            yield chunk


async def test_a_retry_waits_for_its_backoff_with_no_slot_and_takes_one_again(
    database: Database,
) -> None:
    dispatcher = _dispatcher()
    backoff = asyncio.Event()
    entered = asyncio.Event()

    async def sleep(seconds: float) -> None:
        entered.set()
        await backoff.wait()

    chat = _Chat(database, dispatcher, _Flaky(reply="ok"), sleep=sleep)
    run = await chat.send("hi")
    await asyncio.wait_for(entered.wait(), 3)

    # The first call failed and the retry is in its backoff: nobody holds the line.
    assert all(not line.holders for line in dispatcher.snapshot())
    backoff.set()
    await chat.finished(run)
    assert await chat.status(run) == "completed"


async def test_a_cloud_only_chat_takes_no_local_line(database: Database) -> None:
    dispatcher = _dispatcher()
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, dispatcher, model, default=CLOUD)
    runs = [await chat.send(text) for text in ("one", "two")]

    async def both_run() -> bool:
        return len(model.seen) == 2

    await _until(both_run)
    assert [line.kind for line in dispatcher.snapshot()] == ["provider"]
    model.release.set()
    for run in runs:
        await chat.finished(run)
    assert [await chat.status(run) for run in runs] == ["completed", "completed"]


async def test_five_hosted_calls_with_a_cap_of_four_run_four_and_wait_one(
    database: Database,
) -> None:
    dispatcher = _dispatcher()
    model = GatedChatModel(reply="ok")
    chat = _Chat(database, dispatcher, model, default=CLOUD)
    runs = [await chat.send(str(n)) for n in range(5)]

    async def four_run() -> bool:
        return len(model.seen) == 4

    await _until(four_run)
    await asyncio.sleep(0.1)
    assert len(model.seen) == 4
    [line] = dispatcher.snapshot()
    assert (line.line, line.slots, len(line.holders), len(line.waiting)) == (
        "provider:anthropic",
        4,
        4,
        1,
    )
    model.release.set()
    for run in runs:
        await chat.finished(run)
    assert len(model.seen) == 5
    assert [await chat.status(run) for run in runs] == ["completed"] * 5


async def test_a_rate_limited_hosted_call_backs_off_and_succeeds_on_retry(
    database: Database,
) -> None:
    model = _Flaky(reply="ok")
    chat = _Chat(database, _dispatcher(), model, default=CLOUD)
    run = await chat.send("hi")
    await chat.finished(run)

    assert await chat.status(run) == "completed"
    assert model.calls == 2


class _Limited(GatedChatModel):
    """Refuses every call with a rate limit."""

    calls: int = 0

    async def _astream(
        self, messages: list[BaseMessage], *args: Any, **kwargs: Any
    ) -> AsyncIterator[ChatGenerationChunk]:
        self.calls += 1
        raise _Http()
        yield  # pragma: no cover


async def test_a_hosted_call_retries_three_times_through_the_line_then_fails(
    database: Database,
) -> None:
    model = _Limited(reply="ok")
    start = time.monotonic()
    # Time runs 50 times faster, like the sleep, so the 2, 4 and 8 second backoffs are short.
    dispatcher = Dispatcher(_rank, sleep=_fast, clock=lambda: (time.monotonic() - start) * 50)
    chat = _Chat(database, dispatcher, model, default=CLOUD)
    run = await chat.send("hi")
    await chat.finished(run)

    assert model.calls == 4
    assert await chat.status(run) == "failed"


def test_a_hosted_profile_takes_a_provider_line_with_its_cap_and_a_local_one_never_does() -> None:
    model = ScriptedChatModel(replies=[])
    router = ModelRouter(GolemSettings(default_model=CLOUD), model=model)
    assert router.provider_line(CLOUD) == (LineKey.provider("anthropic"), 4)
    assert router.provider_line(LOCAL) is None
    capped = ModelRouter(
        GolemSettings(default_model=CLOUD, providers={"anthropic": ProviderSettings(at_once=2)}),
        model=model,
    )
    assert capped.provider_line(CLOUD) == (LineKey.provider("anthropic"), 2)


async def test_a_cloud_title_takes_no_local_line() -> None:
    dispatcher = _dispatcher()
    router = ModelRouter(
        GolemSettings(default_model=CLOUD), model=ScriptedChatModel(replies=["A title"])
    )
    assert router.local_line(CLOUD) is None
    assert await ModelTitles(router, dispatcher).title(CLOUD, "hi", "hello") == "A title"
    assert dispatcher.snapshot() == []


def test_a_local_model_has_a_line_by_engine_server_and_model() -> None:
    router = ModelRouter(GolemSettings(default_model=LOCAL), model=ScriptedChatModel(replies=[]))
    server = router.ollama_server(LOCAL)
    assert server is not None
    assert router.local_line(LOCAL) == LineKey.local("ollama", server[1], "qwen3:8b")


async def test_a_new_parallel_gives_every_local_line_its_slots_at_once() -> None:
    dispatcher = _dispatcher(slots=1)
    line = LineKey.local("ollama", "http://127.0.0.1:11434", "m")
    held, leave = asyncio.Event(), asyncio.Event()
    order: list[str] = []

    async def run(name: str) -> None:
        async with dispatcher.hold(Call(line, None, "chat", name)):
            order.append(name)
            held.set()
            await leave.wait()

    tasks = [asyncio.create_task(run(name)) for name in ("a", "b")]
    await held.wait()
    await asyncio.sleep(0.01)
    assert order == ["a"]
    dispatcher.set_local_slots(2)
    await asyncio.sleep(0.01)
    assert order == ["a", "b"]
    leave.set()
    await asyncio.gather(*tasks)
    # A line made after the change starts with the new count.
    fresh = LineKey.local("ollama", "http://127.0.0.1:11435", "m")
    leave.clear()
    got: list[str] = []

    async def again(name: str) -> None:
        async with dispatcher.hold(Call(fresh, None, "chat", name)):
            got.append(name)
            await leave.wait()

    more = [asyncio.create_task(again(name)) for name in ("c", "d")]
    await asyncio.sleep(0.01)
    assert got == ["c", "d"]
    leave.set()
    await asyncio.gather(*more)


class _Bus:
    def __init__(self, attached: set[str]) -> None:
        self._attached = attached

    def attached(self, session_id: str) -> bool:
        return session_id in self._attached


class _Sessions:
    def __init__(self, origins: dict[str, str]) -> None:
        self._origins = origins

    def origin_of(self, session_id: str) -> str | None:
        return self._origins.get(session_id)


def test_the_class_of_a_call_follows_the_session_it_serves() -> None:
    line = LineKey.local("ollama", "u", "m")
    bus: Any = _Bus({"seen"})
    sessions: Any = _Sessions({"seen": "user", "quiet": "user", "nightly": "routine:nightly"})

    def rank(role: Any, session: str | None) -> int:
        return class_of(Call(line, session, role, "x"), bus, sessions)

    assert rank("chat", "seen") == 0
    assert rank("helper", "seen") == 1
    assert rank("chat", "quiet") == 2
    assert rank("helper", "quiet") == 2
    assert rank("chat", "nightly") == 3
    assert rank("helper", "nightly") == 3
    assert rank("job", "seen") == 4
    assert rank("job", None) == 4
    assert rank("chat", None) == 2
