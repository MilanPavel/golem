"""The tools node parks the lead on ``delegate`` and builds the result when the helpers end.

The host is a fake: no model runs here.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.types import Command
from pydantic import BaseModel

from golem.graphs.adapter import APPROVAL_KIND, HELPERS_KIND, STREAM_KEY, HelpersParked, translate
from golem.graphs.child import ChildLimits
from golem.graphs.state import AgentState
from golem.graphs.tools_node import NO_MORE_HELPERS, Answer, tools_node
from golem.permissions.policy import Policy
from golem.tools.delegate import DELEGATE, HelperOutcome, HelperSpec
from golem.tools.registry import Tool, ToolContext, ToolError, ToolRegistry, ToolResult


class _NoArgs(BaseModel):
    pass


class _Host:
    """Starts nothing: it records the calls, and a test says when the helpers have ended."""

    def __init__(self, max_per_turn: int = 3) -> None:
        self.child_limits = ChildLimits(max_per_turn=max_per_turn)
        self.parks_lead = True
        self.started: dict[str, list[HelperSpec]] = {}
        self.start_calls = 0
        self.ended: set[str] = set()
        self.outcomes: dict[str, list[HelperOutcome]] = {}
        self.refuse: str | None = None

    async def start_helpers(
        self,
        *,
        state: AgentState,
        config: RunnableConfig,
        call_id: str,
        helpers: Sequence[HelperSpec],
    ) -> None:
        del state, config
        self.start_calls += 1
        if self.refuse is not None:
            raise ToolError(self.refuse)
        self.started.setdefault(call_id, list(helpers))

    async def helpers_ended(self, session_id: str, call_id: str) -> bool:
        del session_id
        return call_id in self.ended

    async def helper_results(self, session_id: str, call_id: str) -> list[HelperOutcome]:
        del session_id
        return self.outcomes[call_id]

    async def delegate(self, **kwargs: Any) -> Any:
        raise AssertionError(f"the child run path is not used: {kwargs}")

    def finish(self, call_id: str, *outcomes: HelperOutcome) -> None:
        self.ended.add(call_id)
        self.outcomes[call_id] = list(outcomes)


def _risky(runs: list[str]) -> Tool[_NoArgs]:
    async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        runs.append("risky")
        return ToolResult(output="risky ran", summary="ran")

    return Tool(name="risky", description="risky", args=_NoArgs, run=run, read_only=False)


class _Lead:
    """The tools node alone in a graph, over a checkpointer, so a test can interrupt and resume."""

    def __init__(self, tmp_path: Path, host: _Host, calls: list[ToolCall]) -> None:
        self.runs: list[str] = []
        self.host = host
        self.calls = calls
        node = tools_node(
            ToolRegistry([DELEGATE, _risky(self.runs)]),
            Policy(None, home=tmp_path),
            children=lambda: cast(Any, host),
        )
        builder: Any = StateGraph(AgentState)
        builder.add_node("tools", node)
        builder.add_edge(START, "tools")
        builder.add_edge("tools", END)
        self.graph: Any = builder.compile(checkpointer=InMemorySaver())
        self.config: RunnableConfig = {"configurable": {"thread_id": "s1"}}

    async def start(self) -> dict[str, Any]:
        state = {
            "messages": [HumanMessage(content="go"), AIMessage(content="", tool_calls=self.calls)],
            "session_id": "s1",
            "model_profile": "m",
            "schema_version": 1,
        }
        return await self.graph.ainvoke(cast(Any, state), self.config)

    async def resume(self, answer: Answer) -> dict[str, Any]:
        return await self.graph.ainvoke(Command(resume=answer.to_resume()), self.config)


def _delegate(call_id: str, brief: str = "look") -> ToolCall:
    return {
        "name": "delegate",
        "args": {"agent": "explorer", "brief": brief},
        "id": call_id,
        "type": "tool_call",
    }


def _risky_call(call_id: str) -> ToolCall:
    return {"name": "risky", "args": {}, "id": call_id, "type": "tool_call"}


def _paused(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [cast(dict[str, Any], item.value) for item in result.get("__interrupt__", [])]


def _tool_messages(result: dict[str, Any]) -> list[ToolMessage]:
    messages = cast(list[BaseMessage], result["messages"])
    return [m for m in messages if isinstance(m, ToolMessage)]


async def test_delegate_parks_and_a_wake_gives_the_result(tmp_path: Path) -> None:
    host = _Host()
    lead = _Lead(tmp_path, host, [_delegate("d1", "find the config")])
    first = await lead.start()
    assert [p[STREAM_KEY] for p in _paused(first)] == [HELPERS_KIND]
    assert _paused(first)[0]["call_ids"] == ["d1"]
    assert host.started == {"d1": [HelperSpec(agent="explorer", brief="find the config")]}
    assert not _tool_messages(first)

    host.finish("d1", HelperOutcome("explorer", "done", "it is in a.toml"))
    second = await lead.resume(Answer.helpers_done())
    assert not _paused(second)
    [message] = _tool_messages(second)
    assert message.tool_call_id == "d1"
    assert message.content == "it is in a.toml"
    assert message.status == "success"
    assert set(host.started) == {"d1"}


async def test_the_park_is_a_fact_the_runner_can_read(tmp_path: Path) -> None:
    lead = _Lead(tmp_path, _Host(), [_delegate("d1"), _delegate("d2")])
    paused = (await lead.start())["__interrupt__"]
    fact = translate({"type": "updates", "data": {"__interrupt__": tuple(paused)}})
    assert fact == HelpersParked(("d1", "d2"))


async def test_a_stopped_helper_says_why_and_a_long_answer_is_an_artifact_id(
    tmp_path: Path,
) -> None:
    host = _Host()
    lead = _Lead(tmp_path, host, [_delegate("d1"), _delegate("d2")])
    await lead.start()
    host.finish("d1", HelperOutcome("explorer", "calls", "half of it"))
    host.finish("d2", HelperOutcome("explorer", "done", "head", artifact_id="a_9"))
    done = await lead.resume(Answer.helpers_done())
    first, second = _tool_messages(done)
    assert first.content == "explorer finished: calls\n\nhalf of it"
    assert isinstance(second.content, str)
    assert second.content.startswith("head\n")
    assert "artifact a_9" in second.content


async def test_two_delegates_and_an_approval_keep_the_interrupt_order(tmp_path: Path) -> None:
    host = _Host()
    lead = _Lead(
        tmp_path, host, [_delegate("d1", "one"), _risky_call("r1"), _delegate("d2", "two")]
    )
    first = await lead.start()
    [asked] = _paused(first)
    assert asked[STREAM_KEY] == APPROVAL_KIND
    assert asked["call_id"] == "r1"
    assert set(host.started) == {"d1"}

    second = await lead.resume(Answer(decision="allow"))
    [parked] = _paused(second)
    assert parked[STREAM_KEY] == HELPERS_KIND
    assert parked["call_ids"] == ["d1", "d2"]
    assert lead.runs == []

    host.finish("d1", HelperOutcome("explorer", "done", "one done"))
    still = await lead.resume(Answer.helpers_done())
    assert [p[STREAM_KEY] for p in _paused(still)] == [HELPERS_KIND]

    host.finish("d2", HelperOutcome("explorer", "done", "two done"))
    done = await lead.resume(Answer.helpers_done())
    assert not _paused(done)
    messages = _tool_messages(done)
    assert [m.tool_call_id for m in messages] == ["d1", "r1", "d2"]
    assert [m.content for m in messages] == ["one done", "risky ran", "two done"]
    assert lead.runs == ["risky"]
    assert set(host.started) == {"d1", "d2"}


async def test_a_denied_approval_still_waits_for_the_helpers_started_before_it(
    tmp_path: Path,
) -> None:
    host = _Host()
    lead = _Lead(tmp_path, host, [_delegate("d1"), _risky_call("r1")])
    await lead.start()
    parked = await lead.resume(Answer(decision="deny"))
    assert [p[STREAM_KEY] for p in _paused(parked)] == [HELPERS_KIND]
    host.finish("d1", HelperOutcome("explorer", "done", "ok"))
    done = await lead.resume(Answer.helpers_done())
    [first, *_] = _tool_messages(done)
    assert first.content == "ok"
    assert lead.runs == []


async def test_helpers_that_have_ended_do_not_park(tmp_path: Path) -> None:
    host = _Host()
    host.finish("d1", HelperOutcome("explorer", "done", "quick"))
    lead = _Lead(tmp_path, host, [_delegate("d1")])
    result = await lead.start()
    assert not _paused(result)
    assert [m.content for m in _tool_messages(result)] == ["quick"]


async def test_a_refused_start_is_a_result_the_model_reads(tmp_path: Path) -> None:
    host = _Host()
    host.refuse = "a helper cannot start a helper"
    lead = _Lead(tmp_path, host, [_delegate("d1")])
    result = await lead.start()
    assert not _paused(result)
    [message] = _tool_messages(result)
    assert message.content == "error: a helper cannot start a helper"
    assert message.status == "error"


async def test_bad_arguments_are_refused_before_a_helper_starts(tmp_path: Path) -> None:
    host = _Host()
    bad: ToolCall = {
        "name": "delegate",
        "args": {"agent": "explorer", "brief": ""},
        "id": "d1",
        "type": "tool_call",
    }
    lead = _Lead(tmp_path, host, [bad])
    result = await lead.start()
    [message] = _tool_messages(result)
    assert isinstance(message.content, str)
    assert message.content.startswith("error: invalid arguments for delegate")
    assert host.start_calls == 0


async def test_more_helpers_than_the_turn_allows_get_a_refusal(tmp_path: Path) -> None:
    host = _Host(max_per_turn=1)
    lead = _Lead(tmp_path, host, [_delegate("d1"), _delegate("d2")])
    first = await lead.start()
    assert _paused(first)[0]["call_ids"] == ["d1"]
    assert set(host.started) == {"d1"}
    host.finish("d1", HelperOutcome("explorer", "done", "ok"))
    done = await lead.resume(Answer.helpers_done())
    first_result, second_result = _tool_messages(done)
    assert first_result.content == "ok"
    assert second_result.content == f"error: {NO_MORE_HELPERS}"


@pytest.mark.parametrize("answer", [Answer.helpers_done(), Answer(decision="allow")])
async def test_the_wake_is_only_a_wake(tmp_path: Path, answer: Answer) -> None:
    host = _Host()
    lead = _Lead(tmp_path, host, [_delegate("d1")])
    await lead.start()
    host.finish("d1", HelperOutcome("explorer", "done", "ok"))
    done = await lead.resume(answer)
    assert [m.content for m in _tool_messages(done)] == ["ok"]
