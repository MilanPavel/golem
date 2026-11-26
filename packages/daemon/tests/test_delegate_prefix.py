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
from langchain_core.messages import AIMessage, HumanMessage

from golem.evals import usecases
from golem.evals.usecases import InProcess, PlanModel, Turn
from golem.graphs.chat import _without_signed_thinking
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
