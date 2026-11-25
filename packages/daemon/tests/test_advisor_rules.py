"""The advisor and reviewer rules (#1358): one advisor call per message, no tools for the
advisor, and a reviewer that only reads.

The tools node runs over a fake host; the end-to-end test runs scripted helpers, one for a setup
with local models only and one for cloud models only. No real model is involved.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from test_helper_restart import (  # pyright: ignore
    _LIVE,
    SETUPS,
    _chat,
    _kinds,
    _Setup,
    _tool_results,
)
from test_tools_node_helpers import (  # pyright: ignore
    _Host,
    _Lead,
    _paused,
    _tool_messages,
)

from golem.agents.model import Agent
from golem.agents.parse import parse_agent
from golem.config import AgentSettings, load_settings
from golem.graphs.child import ChildLimits
from golem.graphs.tools_node import (
    HELPER_AGENTS_KEY,
    HELPER_COUNT_KEY,
    Answer,
    advised_this_turn,
)
from golem.sessions.helpers import unavailable_reason
from golem.store.database import Database
from golem.tools.delegate import HelperOutcome


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


def _advise(call_id: str) -> ToolCall:
    args = {"agent": "advisor", "brief": "which one?"}
    return {"name": "delegate", "args": args, "id": call_id, "type": "tool_call"}


def _two_advisors(call_id: str) -> ToolCall:
    items = [{"agent": "advisor", "brief": f"question {i}"} for i in (1, 2)]
    return {"name": "delegate", "args": {"batch": items}, "id": call_id, "type": "tool_call"}


def _host(advisors: int = 1) -> _Host:
    host = _Host()
    host.child_limits = ChildLimits(max_per_turn=5, advisors_per_message=advisors)
    return host


def _done() -> HelperOutcome:
    return HelperOutcome("advisor", "done", "take the first")


async def test_a_second_advisor_call_in_one_message_is_refused_with_a_reason(
    tmp_path: Path,
) -> None:
    host = _host()
    lead = _Lead(tmp_path, host, [_advise("d1"), _advise("d2")])
    await lead.start()
    assert set(host.started) == {"d1"}
    host.finish("d1", _done())
    first, second = _tool_messages(await lead.resume(Answer.helpers_done()))
    assert first.status == "success"
    assert second.status == "error"
    assert isinstance(second.content, str)
    assert "[agents.advisor] max_per_message = 1" in second.content


def test_advisors_are_counted_from_the_results_since_the_last_user_message() -> None:
    done = ToolMessage(
        content="x",
        tool_call_id="d1",
        name="delegate",
        additional_kwargs={HELPER_COUNT_KEY: 1, HELPER_AGENTS_KEY: ["advisor"]},
    )
    assert advised_this_turn([HumanMessage(content="go"), AIMessage(content=""), done]) == 1
    assert advised_this_turn([done, HumanMessage(content="next")]) == 0


async def test_with_max_per_message_two_a_second_advisor_is_allowed(tmp_path: Path) -> None:
    host = _host(advisors=2)
    lead = _Lead(tmp_path, host, [_advise("d1"), _advise("d2"), _advise("d3")])
    await lead.start()
    assert set(host.started) == {"d1", "d2"}
    host.finish("d1", _done())
    host.finish("d2", _done())
    results = _tool_messages(await lead.resume(Answer.helpers_done()))
    assert [m.status for m in results] == ["success", "success", "error"]


async def test_a_batch_of_two_advisors_with_the_default_is_refused(tmp_path: Path) -> None:
    host = _host()
    [message] = _tool_messages(await _Lead(tmp_path, host, [_two_advisors("d1")]).start())
    assert message.status == "error"
    assert isinstance(message.content, str)
    assert "max_per_message" in message.content
    assert host.start_calls == 0


async def test_a_batch_of_two_advisors_is_allowed_with_two(tmp_path: Path) -> None:
    host = _host(advisors=2)
    result = await _Lead(tmp_path, host, [_two_advisors("d1")]).start()
    assert _paused(result)[0]["call_ids"] == ["d1"]
    assert host.start_calls == 1


def test_the_setting_defaults_to_one_and_is_read_from_config(tmp_path: Path) -> None:
    assert AgentSettings().advisor.max_per_message == 1
    (tmp_path / "config.toml").write_text("[agents.advisor]\nmax_per_message = 2\n")
    loaded = load_settings(home=tmp_path, project_dir=tmp_path)
    assert loaded.agents.advisor.max_per_message == 2


def _agent(tmp_path: Path, name: str, tools: str) -> Agent:
    path = tmp_path / f"{name}.md"
    line = f"tools: {tools}\n" if tools else ""
    path.write_text(f"---\nname: {name}\ndescription: D.\n{line}---\nGo.\n", encoding="utf-8")
    agent = parse_agent(path, known_tools=frozenset({"read_file", "grep", "write_file", "bash"}))
    assert agent.valid, agent.errors
    return agent


def _read_only(name: str) -> bool:
    return name in {"read_file", "grep"}


def test_an_advisor_file_with_tools_is_refused_and_one_without_is_not(tmp_path: Path) -> None:
    reason = unavailable_reason(_agent(tmp_path, "advisor", "read_file"), _read_only)
    assert reason is not None
    assert "advisor has no tools" in reason
    assert unavailable_reason(_agent(tmp_path, "advisor", ""), _read_only) is None


def test_a_reviewer_with_a_writing_tool_is_refused(tmp_path: Path) -> None:
    assert unavailable_reason(_agent(tmp_path, "reviewer", "read_file, grep"), _read_only) is None
    reason = unavailable_reason(_agent(tmp_path, "reviewer", "read_file, write_file"), _read_only)
    assert reason is not None
    assert "reviewer" in reason
    assert "write_file" in reason


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_advisor_runs_with_no_tools_and_a_second_call_is_refused(
    setup: _Setup, database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    ask = ("delegate", {"agent": "advisor", "brief": "which one?"})
    chat = _chat(database, [[ask, ask], "take the first", "thanks"], setup, project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")
    events = await chat.until(lead, "run.completed")
    assert _kinds(events).count("helper.started") == 1
    results = _tool_results(chat.model)
    assert any("take the first" in r for r in results)
    assert any("[agents.advisor] max_per_message" in r for r in results)
    helper_id = next(e.data.helper_id for e in events if e.type == "helper.started")
    created = next(e for e in await chat.stored(helper_id) if e.type == "session.created")
    assert created.data.agent is not None
    assert created.data.agent.name == "advisor"
    assert created.data.agent.tools == []
