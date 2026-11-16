"""Summarising old turns when clearing is not enough."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, cast

from fakes import ToolCallingChatModel
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from golem.config import ContextSettings
from golem.graphs.adapter import message_text
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.context_view import SUMMARY_HEADER
from golem.graphs.summarise import Summariser
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.sessions.usage import Usage
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import ChatEvent, ContextChangedEvent, ModelCallStartedEvent


def _no_asks() -> list[str]:
    return []


class _Summing(ToolCallingChatModel):
    """A chat model that also answers summary requests, without using up ``replies``.

    It reports a quarter of the characters it was sent as input tokens.
    """

    asked: list[str] = Field(default_factory=_no_asks)
    broken: bool = False

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:
        raise NotImplementedError

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        chars = sum(len(message_text(m)) for m in messages)
        self.usage = {
            "input_tokens": chars // 4,
            "output_tokens": 1,
            "total_tokens": chars // 4 + 1,
        }
        systems = [message_text(m) for m in messages if isinstance(m, SystemMessage)]
        if any("Reply with one JSON object" in text for text in systems):
            if self.broken:
                raise RuntimeError("the summary model is down")
            self.asked.append("\n".join(message_text(m) for m in messages[:-1]))
            body = {
                "request": f"SUMMARY-{len(self.asked)}",
                "done": ["did things"],
                "files": [],
                "facts": [],
                "open": [],
            }
            reply = AIMessage(content=json.dumps(body))
            reply.usage_metadata = {"input_tokens": 30, "output_tokens": 10, "total_tokens": 40}
            return ChatResult(generations=[ChatGeneration(message=reply)])
        return super()._generate(messages, stop, run_manager, **kwargs)


class _Chat:
    def __init__(self, database: Database, runtime: ChatRuntime) -> None:
        self.runtime = runtime
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        log = SessionLog(self.events, EventBus(), records)
        self.manager = SessionManager(runtime, log, records, self.runs)
        self.session_id = ""

    async def turn(self, text: str, cwd: str) -> list[ChatEvent]:
        if not self.session_id:
            self.session_id = await self.manager.create(None, cwd=cwd)
        run_id = await self.manager.send(self.session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 20) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.005)


def _chat(database: Database, model: _Summing, window: int, settings: ContextSettings) -> _Chat:
    router = ModelRouter(model=model)
    runtime = open_chat(
        router,
        InMemorySaver(),
        window_of=lambda _profile, _overrides: ContextWindow(window=window),
        context=settings,
        summariser=Summariser(router, usage=Usage(database)),
    )
    return _Chat(database, runtime)


def _name(message: BaseMessage) -> str:
    return " ".join(message_text(message).split()[:2])


def _ask(n: int) -> str:
    return f"ask {n} " + "w" * 1500


def _replies(turns: int) -> list[str | list[Any]]:
    out: list[str | list[Any]] = []
    for n in range(turns):
        out += [[("read_file", {"path": "f.txt"})], f"answer {n} " + "v" * 1000]
    return out


SETTINGS = ContextSettings(reply_reserve=1000, keep_results=2)


def _project(tmp_path: Path) -> str:
    root = tmp_path / "project"
    root.mkdir()
    (root / "f.txt").write_text("small file\n", encoding="utf-8")
    return str(root)


def _changes(events: list[ChatEvent], action: str) -> list[ContextChangedEvent]:
    return [e for e in events if isinstance(e, ContextChangedEvent) and e.data.action == action]


async def test_old_turns_become_a_summary_and_the_checkpoint_keeps_everything(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(12))
    chat = _chat(database, model, 8192, SETTINGS)
    project = _project(tmp_path)
    events: list[ChatEvent] = []
    for n in range(12):
        events += await chat.turn(_ask(n), project)

    summed = _changes(events, "summarised")
    assert summed
    first = summed[0].data
    assert (first.count or 0) > 0
    assert first.before_tokens is not None and first.after_tokens is not None
    assert first.after_tokens < first.before_tokens
    assert first.before_tokens >= 0.85 * (8192 - 1000)

    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    later = [s for s in starts if s.summary_chars]
    assert later and starts[0].summary_chars is None
    # The request starts with the summary and holds the last four turns in full.
    sent = model.seen[-1]
    head = sent[0]
    assert isinstance(head, HumanMessage) and message_text(head).startswith(SUMMARY_HEADER)
    asks = [_name(m) for m in sent if isinstance(m, HumanMessage)][1:]
    assert asks[-4:] == [f"ask {n}" for n in range(8, 12)]
    assert starts[-1].summary_chars == len(message_text(head))

    values = await chat.runtime.values(chat.session_id)
    stored = cast(list[BaseMessage], values["messages"])
    assert sum(isinstance(m, HumanMessage) for m in stored) == 12
    assert [m.id for m in stored].count("summary") == 0
    assert sum(m.type == "tool" for m in stored) == 12


async def test_a_second_summary_builds_on_the_first(database: Database, tmp_path: Path) -> None:
    model = _Summing(replies=_replies(30))
    chat = _chat(database, model, 8192, SETTINGS)
    project = _project(tmp_path)
    for n in range(30):
        await chat.turn(_ask(n), project)

    assert len(model.asked) >= 2
    assert "Earlier summary" not in model.asked[0]
    assert "Earlier summary:\nRequest:\nSUMMARY-1" in model.asked[1]
    values = await chat.runtime.values(chat.session_id)
    assert cast(dict[str, str], values["context_view"])["summary"].startswith("Request:\nSUMMARY-")


async def test_sixty_turns_in_a_32k_window_keep_answering(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(60))
    chat = _chat(database, model, 32768, ContextSettings(keep_results=2))
    project = _project(tmp_path)
    events: list[ChatEvent] = []
    big = "q" * 4000
    for n in range(60):
        events += await chat.turn(f"ask {n} {big}", project)

    assert len(_changes(events, "summarised")) >= 2
    for seen in model.seen:
        assert sum(len(message_text(m)) for m in seen) / 4 < 32768
    # The last four turns were always sent in full.
    last = [_name(m) for m in model.seen[-1] if isinstance(m, HumanMessage)]
    assert last[-4:] == [f"ask {n}" for n in range(56, 60)]
    assert not any(e.type == "run.failed" for e in events)


async def test_a_failing_summariser_does_not_fail_the_run(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(12), broken=True)
    chat = _chat(database, model, 8192, SETTINGS)
    project = _project(tmp_path)
    events: list[ChatEvent] = []
    for n in range(12):
        events += await chat.turn(_ask(n), project)

    assert not _changes(events, "summarised")
    assert any(e.type == "run.completed" for e in events)
    assert not any(e.type == "run.failed" for e in events)
    assert not any(isinstance(e, ModelCallStartedEvent) and e.data.summary_chars for e in events)
    rows = await database.fetch_all(
        "SELECT failed FROM model_calls WHERE role = 'summarise' AND session_id = ?",
        (chat.session_id,),
    )
    assert rows and all(r[0] == 1 for r in rows)


async def test_the_summary_call_is_written_to_the_usage_table(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(12))
    chat = _chat(database, model, 8192, SETTINGS)
    project = _project(tmp_path)
    for n in range(12):
        await chat.turn(_ask(n), project)

    rows = await database.fetch_all(
        "SELECT session_id, input, output, failed FROM model_calls WHERE role = 'summarise'"
    )
    assert rows
    assert all(r[0] == chat.session_id and r[3] == 0 for r in rows)
    assert rows[0][1] == 30 and rows[0][2] == 10


async def test_one_long_turn_has_nothing_to_summarise_and_clears_harder(
    database: Database, tmp_path: Path
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    for n in range(14):
        (root / f"f{n}.txt").write_text("line of a file\n" * 400, encoding="utf-8")
    reads: list[str | list[Any]] = [[("read_file", {"path": f"f{n}.txt"})] for n in range(14)]
    model = _Summing(replies=[*reads, "done"])
    chat = _chat(database, model, 8192, SETTINGS)
    events = await chat.turn("read them all", str(root))

    assert not model.asked
    assert not _changes(events, "summarised")
    assert _changes(events, "cleared")
    assert any(e.type == "run.completed" for e in events)


async def test_the_trace_says_how_many_messages_a_summary_stands_for(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(12))
    chat = _chat(database, model, 8192, SETTINGS)
    project = _project(tmp_path)
    events: list[ChatEvent] = []
    for n in range(12):
        events += await chat.turn(_ask(n), project)

    starts = [e.data for e in events if isinstance(e, ModelCallStartedEvent)]
    first = await chat.manager.trace_span(chat.session_id, starts[0].message_id)
    assert first.summary_of is None
    last = next(s for s in reversed(starts) if s.summary_chars)
    result = await chat.manager.trace_span(chat.session_id, last.message_id)
    assert result.summary_of is not None and result.summary_of > 0
    assert result.context is not None
    summary = next(p for p in result.context.parts if p.key == "summary")
    assert summary.tokens > 0
    assert result.context.reserve == SETTINGS.reply_reserve
