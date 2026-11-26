"""A lead's request prefix stays the same across a ``delegate`` wait (bug B.69, #1853).

Anthropic binds a signed thinking block to the prefix before it: system prompt, tools and the
messages ahead. If any of them changes after the helpers return, the next call fails with a 400.
The real chat graph, ``delegate`` and session manager run; only the model is scripted.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import json
from dataclasses import replace
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from golem.evals import usecases
from golem.evals.usecases import InProcess, PlanModel, Turn
from golem.graphs.chat import _without_signed_thinking
from golem.graphs.notes import note
from golem.graphs.prompt import PromptContext, SystemPrompt
from golem.store.database import Database

CALLS: list[dict[str, Any]] = []
FLIPPED = [False]


class _Bound:
    def __init__(self, inner: Recording, tools: Any) -> None:
        self.inner, self.tools = inner, tools

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def ainvoke(self, messages: Any, *args: Any, **kwargs: Any) -> Any:
        humans = [m for m in messages if isinstance(m, HumanMessage)]
        if humans and humans[0].text == self.inner.request:
            CALLS.append(
                {
                    "tools": json.dumps(self.tools, default=str, sort_keys=True),
                    "messages": [m.model_dump(exclude={"id"}) for m in messages],
                }
            )
        return await self.inner.ainvoke(messages, *args, **kwargs)


class Recording(PlanModel):
    """Records what each lead call is sent: the tools bound and the messages."""

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return _Bound(self, tools)


def _plan(turn: Turn) -> Any:
    if turn.lead:
        if not turn.tools:
            return [("list_dir", {"path": "."})]
        if turn.names[-1] != "delegate":
            FLIPPED[0] = True  # model discovery finishes while the helpers run
            batch = [{"agent": "explorer", "brief": "read services/api/client.py", "label": "a"}]
            return [("delegate", {"batch": batch})]
        return "done"
    if not turn.tools:
        return [("read_file", {"path": "services/api/client.py"})]
    return "found"


async def test_prefix_is_stable_across_delegate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    CALLS.clear()
    FLIPPED[0] = False
    monkeypatch.setattr(usecases, "PlanModel", Recording)
    scenario = replace(usecases.SCENARIOS["broad-question"], plan=_plan)
    folder, home = tmp_path / "project", tmp_path / "home"
    folder.mkdir()
    home.mkdir()
    scenario.build(folder)
    with usecases._golem_home(home):
        async with (
            Database.open(tmp_path / "g.db") as db,
            InProcess(scenario, "cloud-only", folder, home).open(db) as played,
        ):
            tools = played.manager._runtime.tools  # pyright: ignore
            base = tools.delegate_text
            assert base is not None
            tools.delegate_text = lambda root: base(root) + (" Models: x, y." if FLIPPED[0] else "")
            await played.send(scenario.request)
    assert len(CALLS) == 3, len(CALLS)
    for before, after in pairwise(CALLS):
        assert before["tools"] == after["tools"]
        for x, y in zip(before["messages"], after["messages"], strict=False):
            assert x == y


def test_signed_thinking_parts_are_removed_and_the_text_kept() -> None:
    reply = AIMessage(
        content=[
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "redacted_thinking", "data": "x"},
            {"type": "text", "text": "hi"},
        ]
    )
    kept = _without_signed_thinking([HumanMessage(content="q"), reply])
    assert kept[1].content == [{"type": "text", "text": "hi"}]
    assert len(reply.content) == 3


def test_current_turn_keeps_the_thinking_after_the_last_human_message() -> None:
    def reply(tag: str) -> AIMessage:
        return AIMessage(
            content=[
                {"type": "thinking", "thinking": "", "signature": tag},
                {"type": "text", "text": tag},
            ]
        )

    kept = _without_signed_thinking(
        [HumanMessage(content="a"), reply("old"), HumanMessage(content="b"), reply("new")],
        current_turn=True,
    )
    assert [len(m.content) for m in kept if isinstance(m, AIMessage)] == [1, 2]


def test_a_note_in_the_tool_loop_does_not_start_a_new_turn() -> None:
    signed: list[str | dict[str, Any]] = [{"type": "thinking", "thinking": "", "signature": "s"}]
    kept = _without_signed_thinking(
        [
            HumanMessage(content="q"),
            AIMessage(content=signed, tool_calls=[{"name": "list_dir", "args": {}, "id": "c1"}]),
            ToolMessage(content="x", tool_call_id="c1"),
            note("fill the gaps"),
        ],
        current_turn=True,
    )
    assert kept[1].content == signed


class Thinking(Recording):
    """Signs a thinking part into every reply."""

    def _generate(self, messages: Any, *args: Any, **kwargs: Any) -> Any:
        result = super()._generate(messages, *args, **kwargs)
        message = result.generations[0].message
        text = message.content if isinstance(message.content, str) else ""
        parts: list[Any] = [{"type": "thinking", "thinking": "", "signature": f"s{len(CALLS)}"}]
        if text:
            parts.append({"type": "text", "text": text})
        message.content = parts
        return result


def _thinking(call: dict[str, Any]) -> list[str]:
    return [
        p["signature"]
        for m in call["messages"]
        if m["type"] == "ai" and isinstance(m["content"], list)
        for p in m["content"]
        if p.get("type") == "thinking"
    ]


def _system(call: dict[str, Any]) -> str:
    first = call["messages"][0]
    return str(first["content"]) if first["type"] == "system" else ""


def _sequence(turn: Turn) -> Any:
    if not turn.lead:
        return "found"
    return "done" if turn.tools else [("list_dir", {"path": "."})]


async def _two_messages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, flip_at: str
) -> list[dict[str, Any]]:
    """Two messages in one session. A live section of the system prompt changes ``within``
    the first message (after its first call) or ``between`` the messages."""
    CALLS.clear()
    monkeypatch.setattr(usecases, "PlanModel", Thinking)
    limit = 0 if flip_at == "within" else 1

    def live(_context: PromptContext) -> str:
        return f"Rows: {len(CALLS) if len(CALLS) > limit else 0}."

    real = usecases.open_chat

    def open_chat(*args: Any, **kwargs: Any) -> Any:
        return real(*args, prompt=SystemPrompt((live,)), **kwargs)

    monkeypatch.setattr(usecases, "open_chat", open_chat)
    scenario = replace(usecases.SCENARIOS["broad-question"], plan=_sequence)
    folder, home = tmp_path / "project", tmp_path / "home"
    folder.mkdir()
    home.mkdir()
    scenario.build(folder)
    with usecases._golem_home(home):
        async with (
            Database.open(tmp_path / "g.db") as db,
            InProcess(scenario, "cloud-only", folder, home).open(db) as played,
        ):
            await played.send(scenario.request)
            await played.send(scenario.request)
    return list(CALLS)


async def test_earlier_messages_signed_thinking_is_not_sent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = await _two_messages(tmp_path, monkeypatch, "between")
    assert len(calls) == 3, len(calls)
    assert _thinking(calls[1]) == ["s1"]  # the tool loop of the message keeps its thinking
    assert _system(calls[2]) != _system(calls[0])  # the prompt changed between the messages
    assert _thinking(calls[2]) == []  # the earlier message's thinking is not sent


async def test_system_text_is_pinned_for_the_calls_of_one_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = await _two_messages(tmp_path, monkeypatch, "within")
    assert _system(calls[1]) == _system(calls[0])  # a live part changed; the first text is sent
    assert _thinking(calls[1]) == ["s1"]
