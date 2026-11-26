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
    freed_by,
    plan_clear,
    plan_summary,
    safe_boundary,
    stub,
    stub_text,
    summarised_ids,
    used_tokens,
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


def _used(tokens: int | None, text: str = "hi") -> list[BaseMessage]:
    reply = AIMessage(content=text, id="r")
    if tokens is not None:
        reply.usage_metadata = _count(tokens)
    return [HumanMessage(content="a" * 100, id="h"), reply, HumanMessage(content="b" * 40, id="h2")]


def _count(tokens: int) -> Any:
    return {"input_tokens": tokens, "output_tokens": 0, "total_tokens": tokens}


def test_used_tokens_without_a_count_is_a_quarter_per_character() -> None:
    assert used_tokens(_used(None), 50, 50) == (round(0.25 * (240 + 2)), 0.25)


def test_used_tokens_adds_what_came_after_the_count_by_its_ratio() -> None:
    # The call that made the reply sent 50 + 50 + 100 characters and 40 tokens: ratio 0.2.
    used, ratio = used_tokens(_used(40), 50, 50)
    assert ratio == 0.2
    assert used == round(40 + (2 + 40) * 0.2)


def test_the_ratio_is_clamped() -> None:
    assert used_tokens(_used(1), 50, 50)[1] == 0.15
    assert used_tokens(_used(100_000), 50, 50)[1] == 0.6
    assert used_tokens([AIMessage(content="", usage_metadata=_count(10))], 0, 0)[1] == 0.25


def _long() -> list[BaseMessage]:
    messages: list[BaseMessage] = [HumanMessage(content="go", id="h1")]
    for n in range(1, 7):
        messages += _pair(n, "y" * 1000)
    messages.append(AIMessage(content="end", id="end"))
    return messages


def _plan(ctx: ContextView | None = None, used: int = 800, keep: int = 2) -> ContextView | None:
    return plan_clear(
        _long(),
        ctx,
        used=used,
        ratio=0.25,
        room=1000,
        clear_at=0.7,
        clear_to=0.4,
        keep_results=keep,
    )


def test_nothing_is_cleared_under_the_threshold() -> None:
    assert _plan(used=699) is None


def test_clearing_goes_oldest_first_and_stops_at_the_target() -> None:
    # Each result frees about 940 characters, 235 tokens. 800 down to 400 takes two.
    planned = _plan()
    assert planned == {"cleared_before": "a3"}
    assert cleared_ids(_long(), planned) == ["t_c1", "t_c2"]


def test_the_newest_results_are_kept() -> None:
    planned = _plan(used=10_000, keep=2)
    assert cleared_ids(_long(), planned) == ["t_c1", "t_c2", "t_c3", "t_c4"]
    assert _plan(used=10_000, keep=6) is None
    assert _plan(used=10_000, keep=7) is None


def test_clearing_never_goes_backward() -> None:
    first = _plan(used=10_000, keep=2)
    assert first == {"cleared_before": "a5"}
    assert _plan(first, used=10_000, keep=4) is None
    assert _plan({"cleared_before": "a2"}, used=10_000, keep=2) == {"cleared_before": "a5"}


def test_short_results_and_errors_are_not_candidates() -> None:
    messages = [
        HumanMessage(content="go", id="h1"),
        *_pair(1, "z" * 1000, status="error"),
        *_pair(2, "short"),
        *_pair(3, "y" * 1000),
        *_pair(4, "y" * 1000),
        AIMessage(content="end", id="end"),
    ]
    planned = plan_clear(
        messages, None, used=900, ratio=0.25, room=1000, clear_at=0.7, clear_to=0.4, keep_results=1
    )
    assert planned == {"cleared_before": "a4"}
    assert cleared_ids(messages, planned) == ["t_c3"]


def test_nothing_that_could_be_freed_is_none() -> None:
    messages = [
        HumanMessage(content="go", id="h1"),
        *_pair(1, "short"),
        *_pair(2, "short"),
        AIMessage(content="end", id="end"),
    ]
    planned = plan_clear(
        messages, None, used=900, ratio=0.25, room=1000, clear_at=0.7, clear_to=0.4, keep_results=0
    )
    assert planned is None


def test_freed_by_counts_only_what_is_new() -> None:
    messages = _long()
    tokens, count = freed_by(messages, {"cleared_before": "a3"}, {"cleared_before": "a5"}, 0.25)
    assert count == 2
    assert tokens == round(2 * (1000 - len(stub_text("read_file", 1000))) * 0.25)


def _turns(count: int) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for n in range(1, count + 1):
        messages += [HumanMessage(content=f"ask {n}", id=f"h{n}"), *_pair(n)]
        messages.append(AIMessage(content=f"answer {n}", id=f"r{n}"))
    return messages


def test_plan_summary_stops_before_the_last_turns() -> None:
    messages = _turns(6)
    found = plan_summary(messages, None, keep_turns=4)
    assert found is not None
    start, end = found
    assert start == 0 and messages[end].id == "h3"
    assert [m.id for m in messages[start:end]][-1] == "r2"


def test_plan_summary_needs_more_turns_than_it_keeps() -> None:
    assert plan_summary(_turns(4), None, keep_turns=4) is None
    assert plan_summary(_turns(5), None, keep_turns=4) is not None
    assert plan_summary([], None, keep_turns=4) is None


def test_plan_summary_has_nothing_in_one_long_turn() -> None:
    messages: list[BaseMessage] = [HumanMessage(content="read all", id="h1")]
    for n in range(20):
        messages += _pair(n)
    assert plan_summary(messages, None, keep_turns=4) is None
    assert plan_summary(messages, None, keep_turns=1) is None


def test_plan_summary_starts_where_the_last_summary_ended() -> None:
    messages = _turns(10)
    ctx: ContextView = {"summary": "earlier", "summarised_before": "h4"}
    found = plan_summary(messages, ctx, keep_turns=4)
    assert found is not None
    start, end = found
    assert messages[start].id == "h4" and messages[end].id == "h7"
    # Too few turns are left after the summary.
    late: ContextView = {"summary": "earlier", "summarised_before": "h7"}
    assert plan_summary(messages, late, keep_turns=4) is None


def test_a_clear_that_cannot_reach_the_target_falls_back_to_the_current_round() -> None:
    # Six results, the newest just answered. Keeping four leaves only two to clear, which stops
    # short of 40%; falling back to the round clears five, so the next calls are quiet.
    messages = _long()[:-1]
    planned = plan_clear(
        messages,
        None,
        used=2_000,
        ratio=0.25,
        room=1000,
        clear_at=0.7,
        clear_to=0.4,
        keep_results=4,
    )
    assert cleared_ids(messages, planned) == ["t_c1", "t_c2", "t_c3", "t_c4", "t_c5"]
    kept = plan_clear(
        messages, None, used=800, ratio=0.25, room=1000, clear_at=0.7, clear_to=0.4, keep_results=4
    )
    assert cleared_ids(messages, kept) == ["t_c1", "t_c2"]
