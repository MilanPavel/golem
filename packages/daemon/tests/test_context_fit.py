"""The check that a prompt fits the window before it is sent."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ContextSettings
from golem.graphs.adapter import message_text
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.fit import reply_reserve
from golem.models.errors import ContextFull
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import ToolRegistry
from golem_protocol.events import ChatEvent, ModelCallStartedEvent, RunFailedEvent

# Clearing and summarising stay out of the way, so only the fit check acts.
LAX = ContextSettings(reply_reserve=500, clear_at=0.98, clear_to=0.97, compact_at=0.99)
SESSION = "s_fit"


def _runtime(model: ToolCallingChatModel, window: int | None) -> ChatRuntime:
    return open_chat(
        ModelRouter(model=model),
        InMemorySaver(),
        tools=ToolRegistry([]),
        window_of=lambda _profile, _overrides: ContextWindow(window=window),
        context=LAX,
    )


def _pairs(count: int, size: int) -> list[BaseMessage]:
    out: list[BaseMessage] = []
    for n in range(count):
        call = {"name": "read_file", "args": {"path": "f"}, "id": f"c{n}"}
        out += [
            HumanMessage(content=f"ask {n}", id=f"h{n}"),
            AIMessage(content="", id=f"a{n}", tool_calls=[cast(Any, call)]),
            ToolMessage(content=f"{n}" * size, id=f"t{n}", tool_call_id=f"c{n}", name="read_file"),
            AIMessage(content=f"done {n}", id=f"r{n}"),
        ]
    return out


async def _seed(runtime: ChatRuntime, messages: list[BaseMessage]) -> None:
    values = {
        "messages": messages,
        "session_id": SESSION,
        "model_profile": "remote",
        "schema_version": 1,
    }
    await runtime._graph.aupdate_state(  # pyright: ignore[reportPrivateUsage]
        {"configurable": {"thread_id": SESSION}}, values, as_node="call_model"
    )


async def _turn(
    runtime: ChatRuntime,
    text: str,
    options: Mapping[str, float | str] | None = None,
    n: int = 0,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    async for part in runtime.stream(
        session_id=SESSION,
        text=text,
        model_profile="remote",
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        options=options,
    ):
        data = cast(Mapping[str, Any], part).get("data") if isinstance(part, Mapping) else None
        if isinstance(data, Mapping) and "golem" in data:
            items.append(dict(cast(Mapping[str, Any], data)))
    return items


def _of(items: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [i for i in items if i["golem"] == kind]


async def test_a_prompt_that_fits_is_sent_unchanged() -> None:
    model = ToolCallingChatModel(replies=["ok"])
    runtime = _runtime(model, 8192)
    await _seed(runtime, _pairs(2, 600))
    items = await _turn(runtime, "next")

    assert not _of(items, "context.changed")
    (request,) = _of(items, "model.request")
    assert request["cleared_ids"] == []
    assert request["estimated_tokens"] <= 8192 - 500
    assert message_text(model.seen[0][-1]) == "next"
    assert [message_text(m) for m in model.seen[0] if isinstance(m, ToolMessage)] == [
        "0" * 600,
        "1" * 600,
    ]


async def test_a_prompt_too_big_after_clearing_goes_through_the_ladder() -> None:
    model = ToolCallingChatModel(replies=["ok"])
    runtime = _runtime(model, 4800)
    await _seed(runtime, _pairs(5, 3000))
    items = await _turn(runtime, "next")

    (change,) = _of(items, "context.changed")
    assert change["action"] == "cleared" and change["count"] == 3
    assert change["after_tokens"] < change["before_tokens"]
    (request,) = _of(items, "model.request")
    assert request["estimated_tokens"] <= 4800 - 500
    assert len(request["cleared_ids"]) == 3
    results = [message_text(m) for m in model.seen[0] if isinstance(m, ToolMessage)]
    assert [r.startswith("[cleared") for r in results] == [True] * 3 + [False] * 2


async def test_the_newest_results_are_stubbed_last_but_the_last_one_stays() -> None:
    model = ToolCallingChatModel(replies=["ok"])
    runtime = _runtime(model, 2000)
    await _seed(runtime, _pairs(3, 3000))
    items = await _turn(runtime, "next")

    assert [c["action"] for c in _of(items, "context.changed")] == ["cleared", "cleared"]
    (request,) = _of(items, "model.request")
    assert request["estimated_tokens"] <= 2000 - 500
    results = [message_text(m) for m in model.seen[0] if isinstance(m, ToolMessage)]
    assert [r.startswith("[cleared") for r in results] == [True, True, False]
    assert results[-1] == "2" * 3000


async def test_a_message_larger_than_the_window_is_never_sent() -> None:
    model = ToolCallingChatModel(replies=["never"])
    runtime = _runtime(model, 4000)
    with pytest.raises(ContextFull) as caught:
        await _turn(runtime, "x" * 20000)

    assert model.seen == []
    assert caught.value.window == 4000 and caught.value.need > 4000
    assert caught.value.message == (
        "This does not fit remote's 4000 window, even after clearing and summarising."
    )


async def test_the_last_tool_result_alone_can_be_too_big() -> None:
    model = ToolCallingChatModel(replies=["never"])
    runtime = _runtime(model, 2000)
    await _seed(runtime, _pairs(3, 9000))
    with pytest.raises(ContextFull):
        await _turn(runtime, "next")
    assert model.seen == []


async def test_an_unknown_window_skips_the_check() -> None:
    model = ToolCallingChatModel(replies=["ok"])
    runtime = _runtime(model, None)
    items = await _turn(runtime, "x" * 20000)
    (request,) = _of(items, "model.request")
    assert request["estimated_tokens"] > 5000
    assert len(model.seen) == 1


async def test_num_predict_raises_the_reserve() -> None:
    # About 3100 tokens: it fits with the reserve of 500, but not with one of 1500.
    text = "y" * 9500
    model = ToolCallingChatModel(replies=["ok"])
    items = await _turn(_runtime(model, 4000), text)
    assert _of(items, "model.request")[0]["estimated_tokens"] <= 3500

    other = ToolCallingChatModel(replies=["never"])
    with pytest.raises(ContextFull):
        await _turn(_runtime(other, 4000), text, {"num_predict": 1500})
    assert other.seen == []


def test_the_reserve_is_the_larger_one_and_at_most_half_the_window() -> None:
    assert reply_reserve(500, None, 4000) == 500
    assert reply_reserve(500, -1, 4000) == 500
    assert reply_reserve(500, 0, 4000) == 500
    assert reply_reserve(500, 300, 4000) == 500
    assert reply_reserve(500, 1500, 4000) == 1500
    assert reply_reserve(500, 9000, 4000) == 2000


async def test_the_estimate_of_a_learned_model_is_within_15_percent() -> None:
    # The fake reports 0.27 tokens a character, as a model that tokenises prose densely.
    texts = ["p" * 8000, "q" * 9000, "r" * 7000, "s" * 6000]
    model = ToolCallingChatModel(replies=["a", "b", "c", "d"])
    runtime = _runtime(model, 32768)
    estimates: list[int] = []
    reported: list[int] = []
    for n, text in enumerate(texts):
        chars = sum(len(t) for t in texts[: n + 1]) + n
        reported.append(round(0.27 * chars))
        model.usage = {
            "input_tokens": reported[-1],
            "output_tokens": 1,
            "total_tokens": reported[-1] + 1,
        }
        items = await _turn(runtime, text, n=n)
        estimates.append(_of(items, "model.request")[0]["estimated_tokens"])
    # The first call had nothing to learn from. Each later one did.
    for estimate, real in zip(estimates[1:], reported[1:], strict=True):
        assert abs(estimate - real) <= 0.15 * real


async def test_a_run_that_cannot_fit_ends_with_context_full(database: Database) -> None:
    model = ToolCallingChatModel(replies=["never"])
    runtime = _runtime(model, 4000)
    events = EventLog(database)
    runs = RunRecords(database)
    records = SessionRecords(database)
    manager = SessionManager(runtime, SessionLog(events, EventBus(), records), records, runs)
    session_id = await manager.create(None, cwd="/")
    run_id = await manager.send(session_id, "x" * 20000)

    async def done() -> bool:
        run = await runs.get(run_id)
        return run is not None and run.status != "running"

    await _until(done)
    found: list[ChatEvent] = await events.for_run(run_id)
    (failed,) = [e for e in found if isinstance(e, RunFailedEvent)]
    assert failed.data.code == "context_full"
    assert failed.data.message.startswith("This does not fit ")
    assert failed.data.hint is not None and "larger window" in failed.data.hint
    assert not any(isinstance(e, ModelCallStartedEvent) for e in found)
    assert model.seen == []


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 20) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.005)
