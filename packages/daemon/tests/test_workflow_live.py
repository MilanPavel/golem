"""Live progress (3.13.6, #1929): what the events carry, and the total a run counts against."""

from __future__ import annotations

import textwrap
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.engine import WorkflowEngine
from golem.workflows.lines import EVENT_VALUE_CHARS, result_line, small
from golem.workflows.outline import expected_steps

HEADER = "from golem.workflow import workflow, Run\n"


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


class Events:
    def __init__(self) -> None:
        self.items: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, name: str, payload: dict[str, Any]) -> None:
        self.items.append((name, payload))

    def of(self, name: str) -> list[dict[str, Any]]:
        return [payload for n, payload in self.items if n == name]


FEEDS = """
    async def read(url):
        return {"summary": f"read {url}", "n": 1}

    async def big():
        return "x" * 6000

    @workflow()
    async def flow(run: Run):
        urls = ["a.com", "b.com", "c.com"]
        for url in urls:
            await run.step("Read feed", read, url, item=url, of=len(urls))
        await run.step("Big", big)
        await run.output("the briefing", title="Briefing", summary="Three feeds read")
        await run.output("y" * 6000, title="Raw")
        return {"feeds": 3}
"""


async def test_events_carry_what_the_page_needs(store: WorkflowRuns, tmp_path: Path) -> None:
    events = Events()
    run_id = await WorkflowEngine(store, events).start(write(tmp_path, FEEDS), "flow", {})
    started = events.of("workflow.run.started")[0]
    assert started["steps_expected"] == 2  # the loop is one row, then Big
    first = events.of("workflow.step.started")[0]
    assert (first["title"], first["item"], first["of"]) == ("Read feed", "a.com", 3)
    done = events.of("workflow.step.done")
    assert [d["line"] for d in done[:3]] == ["read a.com", "read b.com", "read c.com"]
    assert done[0]["result"] == {"summary": "read a.com", "n": 1}
    # A large result is not sent; its size and its line are.
    assert done[3]["result"] is None
    assert done[3]["result_size"] > EVENT_VALUE_CHARS
    assert done[3]["line"] and done[3]["line"].endswith("…")
    outputs = events.of("workflow.output.added")
    assert [(o["position"], o["title"], o["summary"]) for o in outputs] == [
        (0, "Briefing", "Three feeds read"),
        (1, "Raw", None),
    ]
    assert outputs[0]["value"] == "the briefing"
    assert outputs[1]["value"] is None and outputs[1]["size"] > EVENT_VALUE_CHARS
    end = events.of("workflow.run.done")[0]
    assert end["result"] == {"feeds": 3}
    assert end["summary"] == "Three feeds read"
    assert end["steps_expected"] is None
    assert (await store.get_run(run_id)) is not None


async def test_expected_steps_is_the_outline_count_or_nothing(tmp_path: Path) -> None:
    code = HEADER + textwrap.dedent(FEEDS)
    assert expected_steps(code, "flow") == 2
    assert expected_steps(code, "other") is None
    assert expected_steps("def (", "flow") is None
    guarded = """
        async def f(): return 1

        @workflow()
        async def flow(run: Run, on: bool = True):
            await run.step("a", f)
            if on:
                await run.step("b", f)
    """
    assert expected_steps(HEADER + textwrap.dedent(guarded), "flow") is None
    empty = "\n@workflow()\nasync def flow(run: Run):\n    return 1\n"
    assert expected_steps(HEADER + empty, "flow") is None


def test_one_line_forms() -> None:
    assert result_line(None) is None
    assert result_line("  two\n words ") == "two words"
    assert result_line([]) == "Nothing found"
    assert result_line([{"a": 1}, {"a": 2}]) == "2 rows"
    assert result_line({"verdict": "approve"}, "review") == "approved"
    assert result_line({"a": 1, "b": {"c": 1}}) == "a 1"
    assert result_line({"x": {"y": 1}}) == "1 field"
    assert small(None) == (None, 0)
    assert small("ab") == ("ab", 4)
    assert small("z" * (EVENT_VALUE_CHARS + 1))[0] is None
