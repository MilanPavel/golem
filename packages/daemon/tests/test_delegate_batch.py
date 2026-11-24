"""``delegate`` takes a batch: validation, the limit per message, and sections per helper (#1351).

The tools node runs over a fake host; two end-to-end tests run scripted helpers, one for a setup
with local models only and one for cloud models only.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages.tool import ToolCall
from pydantic import ValidationError
from test_helper_restart import (  # pyright: ignore
    _LIVE,
    _chat,
    _kinds,
    _Setup,
    _tool_results,
)
from test_tools_node_helpers import (  # pyright: ignore
    _delegate,
    _Host,
    _Lead,
    _paused,
    _tool_messages,
)

from golem.graphs.tools_node import NO_MORE_HELPERS, Answer
from golem.store.database import Database
from golem.tools.delegate import DESCRIPTION, DelegateArgs, HelperOutcome, HelperSpec, describe


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


def _batch(call_id: str, n: int) -> ToolCall:
    items = [
        {"agent": "explorer", "brief": f"job {i}", "label": f"part {i}"} for i in range(1, n + 1)
    ]
    return {"name": "delegate", "args": {"batch": items}, "id": call_id, "type": "tool_call"}


def _outcomes(n: int) -> list[HelperOutcome]:
    return [
        HelperOutcome("explorer", "done", f"answer {i}", label=f"part {i}") for i in range(1, n + 1)
    ]


def test_a_batch_is_one_spec_per_item_and_each_model_is_checked() -> None:
    args = DelegateArgs.model_validate(
        {
            "batch": [
                {"agent": "explorer", "brief": "a", "model": "local"},
                {"agent": "x", "brief": "b"},
            ]
        }
    )
    assert args.helpers() == [
        HelperSpec("explorer", "a", "", "local"),
        HelperSpec("x", "b", "", None),
    ]
    with pytest.raises(ValidationError, match="no spaces"):
        DelegateArgs.model_validate({"batch": [{"agent": "a", "brief": "b", "model": "a b"}]})
    with pytest.raises(ValidationError):
        DelegateArgs.model_validate({"batch": [{"agent": "a", "brief": "b", "label": "x" * 61}]})


@pytest.mark.parametrize(
    ("args", "said"),
    [
        (
            {"agent": "explorer", "brief": "a", "batch": [{"agent": "explorer", "brief": "b"}]},
            "not both",
        ),
        ({}, "agent and brief, or a batch"),
        ({"agent": "explorer"}, "agent and brief, or a batch"),
        ({"batch": []}, "at least 1"),
    ],
)
def test_both_forms_or_neither_are_refused_readably(args: dict[str, Any], said: str) -> None:
    with pytest.raises(ValidationError, match=said):
        DelegateArgs.model_validate(args)


async def test_a_batch_of_three_starts_three_helpers_and_returns_three_sections(
    tmp_path: Path,
) -> None:
    host = _Host()
    lead = _Lead(tmp_path, host, [_batch("d1", 3)])
    first = await lead.start()
    assert _paused(first)[0]["call_ids"] == ["d1"]
    assert [s.brief for s in host.started["d1"]] == ["job 1", "job 2", "job 3"]
    host.finish("d1", *_outcomes(3))
    [message] = _tool_messages(await lead.resume(Answer.helpers_done()))
    assert message.content == (
        "### 1. part 1\nanswer 1\n\n### 2. part 2\nanswer 2\n\n### 3. part 3\nanswer 3"
    )


async def test_both_forms_in_one_call_start_nothing(tmp_path: Path) -> None:
    both: ToolCall = {
        "name": "delegate",
        "args": {"agent": "explorer", "brief": "a", "batch": [{"agent": "explorer", "brief": "b"}]},
        "id": "d1",
        "type": "tool_call",
    }
    host = _Host()
    [message] = _tool_messages(await _Lead(tmp_path, host, [both]).start())
    assert isinstance(message.content, str)
    assert message.content.startswith("error: invalid arguments for delegate")
    assert "not both" in message.content
    assert host.start_calls == 0


async def test_more_helpers_than_the_limit_are_refused_naming_the_limit_and_the_key(
    tmp_path: Path,
) -> None:
    host = _Host(max_per_turn=2)
    [message] = _tool_messages(await _Lead(tmp_path, host, [_batch("d1", 3)]).start())
    assert isinstance(message.content, str)
    assert "limit of 2" in message.content
    assert "max_per_batch" in message.content
    assert host.start_calls == 0


async def test_helpers_are_counted_not_calls(tmp_path: Path) -> None:
    # A batch of two and a single make three helpers: allowed. A fourth, in a third call, is not.
    host = _Host(max_per_turn=3)
    lead = _Lead(tmp_path, host, [_batch("d1", 2), _delegate("d2"), _delegate("d3")])
    first = await lead.start()
    assert _paused(first)[0]["call_ids"] == ["d1", "d2"]
    assert set(host.started) == {"d1", "d2"}
    host.finish("d1", *_outcomes(2))
    host.finish("d2", HelperOutcome("explorer", "done", "ok"))
    results = _tool_messages(await lead.resume(Answer.helpers_done()))
    assert [m.status for m in results] == ["success", "success", "error"]
    assert results[2].content == f"error: {NO_MORE_HELPERS}"


async def test_a_call_that_would_pass_the_limit_is_refused_with_what_is_left(
    tmp_path: Path,
) -> None:
    host = _Host(max_per_turn=3)
    lead = _Lead(tmp_path, host, [_delegate("d1"), _batch("d2", 3)])
    await lead.start()
    assert set(host.started) == {"d1"}
    host.finish("d1", HelperOutcome("explorer", "done", "ok"))
    results = _tool_messages(await lead.resume(Answer.helpers_done()))
    assert isinstance(results[1].content, str)
    assert "start 2 or fewer" in results[1].content


def test_the_description_explains_the_batch_and_promises_no_order() -> None:
    for text in (DESCRIPTION, describe([("explorer", "reads")])):
        assert "batch" in text
        assert "at the same time" in text
        assert "no order is promised" in text


@pytest.mark.parametrize("cloud", [False, True], ids=["local-only", "cloud-only"])
async def test_a_batch_runs_three_scripted_helpers_and_the_lead_gets_three_sections(
    cloud: bool, database: Database, tmp_path: Path
) -> None:
    project = tmp_path / "project"
    project.mkdir()
    (project / "a.py").write_text("x = 1\n", encoding="utf-8")
    items = [{"agent": "explorer", "brief": f"look {i}", "label": f"part {i}"} for i in (1, 2, 3)]
    replies = [[("delegate", {"batch": items})], "found it", "found it", "found it", "all done"]
    chat = _chat(database, replies, _Setup(cloud), project, tmp_path)
    lead = await chat.lead(project)
    await chat.manager.send(lead, "go")
    events = await chat.until(lead, "run.completed")
    assert _kinds(events).count("helper.started") == 3
    assert _kinds(events).count("helper.ended") == 3
    [result] = _tool_results(chat.model)
    assert result.index("### 1. part 1") < result.index("### 2. part 2")
    assert result.index("### 2. part 2") < result.index("### 3. part 3")
    assert result.count("found it") == 3
