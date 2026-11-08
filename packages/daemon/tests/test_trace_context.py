"""The context breakdown: pure, on hand-made prompts, tools and messages."""

from __future__ import annotations

import json

from golem.sessions.context import _split, context_breakdown  # pyright: ignore[reportPrivateUsage]
from golem_protocol.commands import TraceContext, TraceMessage
from golem_protocol.events import PromptSectionInfo


def _tool(name: str, size: int = 10) -> dict[str, object]:
    return {"type": "function", "function": {"name": name, "description": "d" * size}}


def _messages() -> list[TraceMessage]:
    return [
        TraceMessage(role="user", text="u" * 300),
        TraceMessage(
            role="assistant",
            text="a" * 50,
            tool_calls=[{"call_id": "c1", "name": "read_file", "args": {"path": "x"}}],
        ),
        TraceMessage(role="tool", text="t" * 700, call_id="c1"),
        TraceMessage(role="user", text="u" * 77),
    ]


def _part(context: TraceContext, key: str) -> int:
    return next(p.tokens for p in context.parts if p.key == key)


def test_split_gives_the_rest_to_the_largest_remainders() -> None:
    assert _split(10, [1, 1, 1]) == [4, 3, 3]
    assert _split(7, [0, 0]) == [0, 0]
    shares = _split(5, [3, 0, 1])
    assert sum(shares) == 5 and shares[1] == 0


def test_the_parts_add_up_to_the_tokens_the_provider_counted() -> None:
    sections = [
        PromptSectionInfo(name="base", chars=900),
        PromptSectionInfo(name="skill", chars=298),
    ]
    tools = [
        _tool("read_file", 50),
        _tool("mcp__github__create_issue", 400),
        _tool("mcp__github__list_prs", 200),
    ]
    context, messages = context_breakdown(
        used=31500,
        window=128000,
        window_estimated=False,
        num_ctx=None,
        system_prompt="s" * 1200,
        sections=sections,
        tools=tools,
        messages=_messages(),
    )
    assert [p.key for p in context.parts] == [
        "system",
        "tools",
        "user",
        "assistant",
        "tool_results",
    ]
    assert sum(p.tokens for p in context.parts) == 31500
    assert context.used == 31500 and context.window == 128000 and context.estimated is True
    system, tool_part = context.parts[0], context.parts[1]
    assert [i.name for i in system.items] == ["base", "skill"]
    assert sum(i.tokens for i in system.items) == system.tokens
    assert system.chars == 1200
    assert sum(i.tokens for i in tool_part.items) == tool_part.tokens
    assert [i.group for i in tool_part.items] == ["github", "github", None]
    assert [i.name for i in tool_part.items] == [
        "mcp__github__create_issue",
        "mcp__github__list_prs",
        "read_file",
    ]
    counts = [i.tokens for i in tool_part.items]
    assert counts == sorted(counts, reverse=True)
    for role, key in (("user", "user"), ("assistant", "assistant"), ("tool", "tool_results")):
        total = sum(m.tokens or 0 for m in messages if m.role == role)
        assert total == _part(context, key)
    assert messages[0].tokens is not None and _messages()[0].tokens is None
    expected = 50 + len(
        json.dumps(_messages()[1].tool_calls, sort_keys=True, separators=(",", ":"))
    )
    assert context.parts[3].chars == expected


def test_without_a_count_the_parts_add_up_to_four_characters_a_token() -> None:
    context, _ = context_breakdown(
        used=None,
        window=None,
        window_estimated=False,
        num_ctx=None,
        system_prompt="s" * 100,
        sections=None,
        tools=None,
        messages=[TraceMessage(role="user", text="u" * 203)],
    )
    assert context.used is None
    assert sum(p.tokens for p in context.parts) == round(303 / 4)


def test_nothing_sent_is_all_zero() -> None:
    context, messages = context_breakdown(
        used=None,
        window=None,
        window_estimated=False,
        num_ctx=None,
        system_prompt=None,
        sections=None,
        tools=None,
        messages=[],
    )
    assert messages == []
    assert len(context.parts) == 5
    assert all(p.tokens == 0 and p.chars == 0 and p.items == [] for p in context.parts)


def test_a_prompt_without_sections_has_no_system_items() -> None:
    context, _ = context_breakdown(
        used=100,
        window=None,
        window_estimated=False,
        num_ctx=None,
        system_prompt="s" * 40,
        sections=None,
        tools=None,
        messages=[],
    )
    assert context.parts[0].tokens == 100 and context.parts[0].items == []


def test_a_schema_without_a_name_is_called_question_mark() -> None:
    context, _ = context_breakdown(
        used=10,
        window=None,
        window_estimated=False,
        num_ctx=None,
        system_prompt=None,
        sections=None,
        tools=[{"type": "function"}, {"function": {"name": ""}}],
        messages=[],
    )
    assert [i.name for i in context.parts[1].items] == ["?", "?"]


def test_num_ctx_and_an_estimated_window_pass_through() -> None:
    context, _ = context_breakdown(
        used=10,
        window=None,
        window_estimated=True,
        num_ctx=4096,
        system_prompt=None,
        sections=None,
        tools=None,
        messages=[],
    )
    assert (context.window, context.window_estimated, context.num_ctx) == (None, True, 4096)
