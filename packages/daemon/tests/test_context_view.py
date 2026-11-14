"""The context view: what a model call sends of the stored history."""

from __future__ import annotations

import random
from collections.abc import Mapping
from typing import Any, cast

from fakes import ScriptedChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.context_view import (
    STUB_MIN_CHARS,
    SUMMARY_HEADER,
    ContextView,
    cleared_ids,
    safe_boundary,
    stub,
    summarised_ids,
    view,
)
from golem.models.router import ModelRouter

BIG = "x" * (STUB_MIN_CHARS + 1)


def _pair(n: int, text: str = BIG, status: str = "success") -> list[BaseMessage]:
    return [
        AIMessage(
            content="",
            id=f"a{n}",
            tool_calls=[{"name": "read_file", "args": {"path": "f"}, "id": f"c{n}"}],
        ),
        ToolMessage(
            content=text,
            id=f"t_c{n}",
            tool_call_id=f"c{n}",
            name="read_file",
            status=cast(Any, status),
        ),
    ]


def _history() -> list[BaseMessage]:
    return [
        HumanMessage(content="one", id="h1"),
        *_pair(1),
        AIMessage(content="done one", id="r1"),
        HumanMessage(content="two", id="h2"),
        *_pair(2),
        *_pair(3, "short"),
        AIMessage(content="done two", id="r2"),
    ]


def _ids(messages: list[BaseMessage]) -> list[str | None]:
    return [m.id for m in messages]


def test_an_empty_view_is_the_history() -> None:
    messages = _history()
    contexts: list[ContextView | None] = [None, {}]
    for ctx in contexts:
        sent = view(messages, ctx)
        assert sent == messages
        assert all(a is b for a, b in zip(sent, messages, strict=True))
        assert sent is not messages


def test_clearing_replaces_only_long_results_before_the_id() -> None:
    messages = _history()
    by_id = {m.id: m for m in view(messages, {"cleared_before": "h2"})}
    assert "cleared" in str(by_id["t_c1"].content)
    assert by_id["t_c2"] is messages[6]
    assert by_id["t_c3"].content == "short"
    by_id = {m.id: m for m in view(messages, {"cleared_before": "r2"})}
    assert "cleared" in str(by_id["t_c2"].content)
    assert by_id["t_c3"].content == "short"


def test_an_error_result_is_kept() -> None:
    messages = [
        HumanMessage(content="q", id="h1"),
        *_pair(1, BIG, "error"),
        HumanMessage(content="n", id="h2"),
    ]
    sent = view(messages, {"cleared_before": "h2"})
    assert sent[2].content == BIG
    assert cleared_ids(messages, {"cleared_before": "h2"}) == []


def test_the_stub_names_the_tool_and_the_size_and_keeps_the_ids() -> None:
    original = cast(ToolMessage, _pair(1)[1])
    small = stub(original)
    assert small.content == (
        f"[cleared to save context: read_file returned {len(BIG)} characters. "
        "Call the tool again if you need this.]"
    )
    assert (small.id, small.tool_call_id, small.name, small.status) == (
        "t_c1",
        "c1",
        "read_file",
        "success",
    )
    assert original.content == BIG


def test_clearing_keeps_ids_and_order() -> None:
    messages = _history()
    sent = view(messages, {"cleared_before": "r2"})
    assert _ids(sent) == _ids(messages)
    assert [getattr(m, "tool_call_id", None) for m in sent] == [
        getattr(m, "tool_call_id", None) for m in messages
    ]


def test_a_summary_drops_the_earlier_messages_and_goes_first() -> None:
    messages = _history()
    ctx: ContextView = {"summary": "S", "summarised_before": "h2"}
    sent = view(messages, ctx)
    assert _ids(sent) == ["summary", *_ids(messages[4:])]
    assert isinstance(sent[0], HumanMessage)
    assert sent[0].content == f"{SUMMARY_HEADER}\n\nS"
    assert summarised_ids(messages, ctx) == ["h1", "a1", "t_c1", "r1"]


def test_an_unknown_id_changes_nothing() -> None:
    messages = _history()
    assert view(messages, {"summary": "S", "summarised_before": "nope"}) == messages
    assert view(messages, {"cleared_before": "nope"}) == messages
    assert cleared_ids(messages, {"cleared_before": "nope"}) == []
    assert summarised_ids(messages, {"summary": "S", "summarised_before": "nope"}) == []


def test_a_boundary_on_a_tool_message_moves_to_the_next_human_message() -> None:
    messages = _history()
    ctx: ContextView = {"summary": "S", "summarised_before": "t_c1"}
    assert _ids(view(messages, ctx))[:2] == ["summary", "h2"]
    assert summarised_ids(messages, ctx) == ["h1", "a1", "t_c1", "r1"]


def test_safe_boundary_is_the_human_message_at_or_before() -> None:
    messages = _history()
    assert safe_boundary(messages, 5) == 4
    assert safe_boundary(messages, 4) == 4
    assert safe_boundary(messages, 3) == 0
    assert safe_boundary(messages, 99) == 4


def test_clearing_and_summary_together() -> None:
    messages = _history()
    ctx: ContextView = {"cleared_before": "r2", "summary": "S", "summarised_before": "h2"}
    sent = view(messages, ctx)
    assert _ids(sent) == ["summary", *_ids(messages[4:])]
    assert cleared_ids(messages, ctx) == ["t_c2"]
    assert "cleared" in str(sent[3].content)
    # A clear point inside the summarised part clears nothing that is sent.
    ctx = {"cleared_before": "r1", "summary": "S", "summarised_before": "h2"}
    assert cleared_ids(messages, ctx) == []
    assert view(messages, ctx)[3] is messages[6]


def _generated(seed: int) -> list[BaseMessage]:
    rng = random.Random(seed)
    out: list[BaseMessage] = []
    for turn in range(rng.randint(2, 8)):
        out.append(HumanMessage(content=f"q{turn}", id=f"h{turn}"))
        for step in range(rng.randint(0, 3)):
            out.extend(_pair(turn * 10 + step, rng.choice([BIG, "short"])))
        out.append(AIMessage(content=f"r{turn}", id=f"r{turn}"))
    return out


def test_every_view_keeps_each_call_and_its_result_together() -> None:
    for seed in range(40):
        messages = _generated(seed)
        rng = random.Random(seed)
        ids = [m.id for m in messages if m.id]
        ctx: ContextView = {
            "cleared_before": rng.choice(ids),
            "summary": "S",
            "summarised_before": rng.choice(ids),
        }
        sent = view(messages, ctx)
        calls: set[str] = set()
        answered: set[str] = set()
        for m in sent:
            if isinstance(m, AIMessage):
                calls.update(c["id"] or "" for c in m.tool_calls)
            if isinstance(m, ToolMessage):
                assert m.tool_call_id in calls
                answered.add(m.tool_call_id)
        assert calls == answered
        assert isinstance(sent[0], HumanMessage)


async def _turn(runtime: ChatRuntime, text: str, n: int) -> list[dict[str, Any]]:
    requests: list[dict[str, Any]] = []
    async for part in runtime.stream(
        session_id="s_view",
        text=text,
        model_profile="remote",
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
    ):
        data = cast(Mapping[str, Any], part).get("data") if isinstance(part, Mapping) else None
        if isinstance(data, Mapping):
            item = cast(Mapping[str, Any], data)
            if item.get("golem") == "model.request":
                requests.append(dict(item))
    return requests


async def _set(runtime: ChatRuntime, ctx: ContextView) -> None:
    await runtime._graph.aupdate_state(  # pyright: ignore[reportPrivateUsage]
        {"configurable": {"thread_id": "s_view"}}, {"context_view": ctx}, as_node="call_model"
    )


async def test_call_model_sends_the_view_and_reports_it() -> None:
    model = ScriptedChatModel(replies=["alpha", "beta"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    (plain,) = await _turn(runtime, "one", 1)
    assert plain["message_ids"] == ["m_user1"]
    await _set(runtime, {"summary": "S", "summarised_before": "m_unknown"})
    (request,) = await _turn(runtime, "two", 2)
    # An id the history does not have changes nothing.
    assert model.seen[1] == ["one", "alpha", "two"]
    assert request["message_ids"] == ["m_user1", "m_reply1", "m_user2"]

    model.replies.append("gamma")
    await _set(runtime, {"summary": "S", "summarised_before": "m_user2"})
    (request,) = await _turn(runtime, "three", 3)
    assert model.seen[2] == [f"{SUMMARY_HEADER}\n\nS", "two", "beta", "three"]
    assert request["message_ids"] == ["summary", "m_user2", "m_reply2", "m_user3"]
    assert request["message_chars"] == [len(SUMMARY_HEADER) + 3, 3, 4, 5]
    assert len(request["message_bytes"]) == 4


async def test_a_fork_has_the_context_view_of_its_source() -> None:
    model = ScriptedChatModel(replies=["alpha"])
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    await _turn(runtime, "one", 1)
    ctx: ContextView = {"cleared_before": "m_user1"}
    await _set(runtime, ctx)
    assert await runtime.fork("s_view", "s_fork", at_message_id="m_reply1")
    assert (await runtime.values("s_fork")).get("context_view") == ctx
