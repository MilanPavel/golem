"""A very long session on a small window: no call is cut, recent turns are whole, history is kept.

Run with ``-s`` to see the numbers the PR quotes.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import cast

from fakes import Calls, WindowCall, WindowedChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ContextSettings
from golem.graphs.adapter import message_text
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.summarise import Summariser
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.cut import CallFacts, judge
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.usage import Usage
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    ContextChangedEvent,
    MessageCompletedEvent,
    ModelCallStartedEvent,
)

WINDOW = 32768
TURNS = 200
SETTINGS = ContextSettings()
FILES = 8


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        log = SessionLog(self.events, EventBus(), records)
        self.manager = SessionManager(runtime, log, records, self.runs)
        self.session_id = ""

    async def turn(self, text: str, cwd: str, session_id: str | None = None) -> list[ChatEvent]:
        if session_id is None:
            if not self.session_id:
                self.session_id = await self.manager.create(None, cwd=cwd)
            session_id = self.session_id
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 60) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.001)


def _project(tmp_path: Path) -> str:
    """Eight files whose ``read_file`` output is 6,000 to 9,000 characters."""
    root = tmp_path / "project"
    root.mkdir()
    for n in range(FILES):
        lines = (6000 + 430 * n) // 88
        text = "".join(f"line {i:05d} " + "x" * 70 + "\n" for i in range(lines))
        (root / f"f{n}.txt").write_text(text, encoding="utf-8")
    return str(root)


def _reads(turn: int, count: int) -> Calls:
    return [("read_file", {"path": f"f{(turn + i) % FILES}.txt"}) for i in range(count)]


def _long_script(turn: int, done: int) -> str | Calls:
    count = 0 if turn % 10 == 0 else 2 + turn % 2
    if done == 0 and count:
        return _reads(turn, count)
    return f"answer {turn}: read {done} files"


def _one_turn_script(turn: int, done: int) -> str | Calls:
    # A run may make 25 model calls, so the 40 tool calls come two at a time.
    if done < 40:
        return _reads(done, 2)
    return f"answer {turn}"


def _chat(database: Database, model: WindowedChatModel) -> _Chat:
    router = ModelRouter(model=model)
    runtime = open_chat(
        router,
        InMemorySaver(),
        window_of=lambda _profile, _overrides: ContextWindow(window=WINDOW),
        context=SETTINGS,
        summariser=Summariser(router, usage=Usage(database)),
    )
    return _Chat(database, runtime)


def _changes(events: list[ChatEvent], action: str) -> list[ContextChangedEvent]:
    return [e for e in events if isinstance(e, ContextChangedEvent) and e.data.action == action]


def _ask(n: int) -> str:
    return f"ask {n} " + "q" * 400


def _judged(events: list[ChatEvent], calls: list[WindowCall]) -> list[str]:
    """What ``judge`` says of each call, as the trace does: the call as Ollama with this window."""
    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    assert len(starts) == len(calls)
    seen: list[CallFacts] = []
    says: list[str] = []
    for data, call in zip(starts, calls, strict=True):
        here = CallFacts(
            data.model_copy(update={"provider": "ollama"}), "ollama/m", WINDOW, call.tokens
        )
        says.append(judge(here, seen).cut or "unknown")
        seen.append(here)
    return says


def _stored(values: dict[str, object]) -> list[BaseMessage]:
    return cast(list[BaseMessage], values["messages"])


def _turns_of(stored: list[BaseMessage]) -> list[list[BaseMessage]]:
    turns: list[list[BaseMessage]] = []
    for message in stored:
        if isinstance(message, HumanMessage):
            turns.append([])
        turns[-1].append(message)
    return turns


def _holds_the_recent_turns_whole(model: WindowedChatModel, stored: list[BaseMessage]) -> None:
    turns = _turns_of(stored)
    position = {m.id: i for i, m in enumerate(stored)}
    keep = SETTINGS.keep_turns
    for call in model.calls:
        sent = {m.id: m for m in call.messages}
        last = max(position[m.id] for m in call.messages if m.id in position)
        asks = [m for m in call.messages if isinstance(m, HumanMessage)]
        turn = int(message_text(asks[-1]).split()[1])
        start = turns[max(0, turn - keep + 1)][0]
        for message in stored[position[start.id] : last + 1]:
            assert message.id in sent, f"turn {turn}: {message.type} {message.id} was left out"
        # Clearing may stub older results of these turns, but never the newest few.
        newest = [m for m in call.messages if isinstance(m, ToolMessage)][-SETTINGS.keep_results :]
        assert not any("[cleared to save" in message_text(m) for m in newest), f"turn {turn}"


async def test_two_hundred_turns_on_a_32k_window(database: Database, tmp_path: Path) -> None:
    model = WindowedChatModel(replies=[], window=WINDOW, script=_long_script)
    chat = _chat(database, model)
    project = _project(tmp_path)
    started = time.monotonic()
    events: list[ChatEvent] = []
    for n in range(TURNS):
        events += await chat.turn(_ask(n), project)
    elapsed = time.monotonic() - started

    cleared = _changes(events, "cleared")
    summarised = _changes(events, "summarised")
    peak = max(c.tokens for c in model.calls)
    print(
        f"\n200 turns: peak {peak}/{WINDOW} tokens ({peak / WINDOW:.0%}), "
        f"{len(cleared)} clears, {len(summarised)} summaries, {len(model.calls)} calls, "
        f"{elapsed:.1f}s"
    )

    assert not any(e.type == "run.failed" for e in events)
    assert sum(e.type == "run.completed" for e in events) == TURNS
    assert not [c for c in model.calls if c.cut]
    assert not [c for c in model.summaries if c.cut]
    assert len(cleared) >= 10
    assert len(summarised) >= 3

    values = await chat.runtime.values(chat.session_id)
    stored = _stored(dict(values))
    assert sum(isinstance(m, HumanMessage) for m in stored) == TURNS
    results = [m for m in stored if isinstance(m, ToolMessage)]
    expected = sum(0 if n % 10 == 0 else 2 + n % 2 for n in range(TURNS))
    assert len(results) == expected
    assert all(6000 <= len(message_text(m)) <= 9500 for m in results)
    assert not any("[cleared to save" in message_text(m) for m in results)
    assert sum(isinstance(m, AIMessage) and not m.tool_calls for m in stored) == TURNS

    _holds_the_recent_turns_whole(model, stored)
    assert set(_judged(events, model.calls)) <= {"no", "unknown"}

    last = [e for e in events if isinstance(e, MessageCompletedEvent)][-1]
    fork = await chat.manager.fork(chat.session_id, last.data.message_id)
    after = await chat.runtime.values(fork)
    assert after["context_view"] == values["context_view"]
    assert len(_stored(dict(after))) == len(stored)
    forked = await chat.turn(_ask(TURNS), project, fork)
    assert any(e.type == "run.completed" for e in forked)
    assert not any(e.type == "run.failed" for e in forked)
    assert not model.calls[-1].cut


async def test_one_enormous_turn_ends_by_clearing_alone(database: Database, tmp_path: Path) -> None:
    model = WindowedChatModel(replies=[], window=WINDOW, script=_one_turn_script)
    chat = _chat(database, model)
    project = _project(tmp_path)
    started = time.monotonic()
    events = await chat.turn(_ask(0), project)
    elapsed = time.monotonic() - started

    peak = max(c.tokens for c in model.calls)
    cleared = _changes(events, "cleared")
    print(
        f"\n40 tool calls in one turn: peak {peak}/{WINDOW} tokens ({peak / WINDOW:.0%}), "
        f"{len(cleared)} clears, {elapsed:.1f}s"
    )

    assert len(model.calls) == 21
    assert not [c for c in model.calls if c.cut]
    assert cleared
    assert not _changes(events, "summarised")
    assert not model.summaries
    assert any(e.type == "run.completed" for e in events)
    assert not any(e.type == "run.failed" for e in events)
    assert set(_judged(events, model.calls)) <= {"no", "unknown"}
