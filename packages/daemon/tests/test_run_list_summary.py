"""The Runs list says what a finished workflow run came out with, in one line."""

from __future__ import annotations

from typing import Any, cast

from golem.server.routines import _came_out, _value_line  # pyright: ignore[reportPrivateUsage]
from golem.store.workflow_runs import WorkflowOutputRecord


class FakeRuns:
    def __init__(self, outputs: list[WorkflowOutputRecord]) -> None:
        self.outputs = outputs

    async def list_outputs(self, run_id: str) -> list[WorkflowOutputRecord]:
        return self.outputs


def output(value_json: str, summary: str | None = None) -> WorkflowOutputRecord:
    return WorkflowOutputRecord("r", 0, None, value_json, summary)


async def came_out(outputs: list[WorkflowOutputRecord], result_json: str | None = None) -> str:
    return await _came_out(cast(Any, FakeRuns(outputs)), "r", result_json)


def test_a_value_is_one_line_by_its_kind() -> None:
    assert _value_line("first\nsecond") == "first"
    assert _value_line([{"a": 1}, {"a": 2}]) == "2 rows"
    assert _value_line({"summary": "3 PRs"}) == "3 PRs"
    assert _value_line({"a": 1, "b": 2}) == "2 fields"
    assert _value_line([]) is None
    assert _value_line("  ") is None
    assert len(_value_line("x" * 500) or "") == 120


async def test_the_marked_result_summary_comes_first() -> None:
    assert await came_out([output('"body"', "Briefing, 4 items")]) == "Briefing, 4 items"


async def test_an_empty_marked_result_gives_way_to_the_next_then_the_return_value() -> None:
    assert await came_out([output("[]"), output('"later"')]) == "later"
    assert await came_out([], '"returned"') == "returned"


async def test_a_run_with_nothing_says_so() -> None:
    assert await came_out([], None) == "Nothing found"
