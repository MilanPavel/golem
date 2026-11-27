"""Step titles are words, never a prompt; ``item=`` and group titles are kept (3.13.1)."""

from __future__ import annotations

import textwrap
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflow import ITEM_CHARS, SPEC_ATTR, Run, workflow
from golem.workflows.engine import WorkflowEngine
from golem.workflows.outline import outline

HEADER = "from golem.workflow import workflow, Run\n"


class Seen:
    """A backend that records what ``Run`` hands it."""

    def __init__(self) -> None:
        self.steps: list[dict[str, Any]] = []

    async def run_step(
        self,
        workflow_run_id: str,
        key: str,
        kind: str,
        title: str,
        group_key: str | None,
        fn: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        keyed: bool = False,
        retries: int = 0,
        backoff: float = 0.0,
        item: str | None = None,
        group_title: str | None = None,
        of: int | None = None,
    ) -> Any:
        self.steps.append(
            {
                "key": key,
                "kind": kind,
                "title": title,
                "group": group_key,
                "kwargs": kwargs,
                "item": item,
                "group_title": group_title,
            }
        )
        return None

    def progress(self, *args: Any) -> None:
        return None

    async def llm(self, *args: Any) -> Any:
        return None

    async def notify(self, *args: Any) -> None:
        return None

    async def review(self, *args: Any) -> Any:
        self.steps.append({"kind": "review", "title": args[5], "group_title": args[6]})
        return {"verdict": "approve", "text": ""}

    async def agent(self, *args: Any) -> dict[str, Any]:
        self.steps.append({"kind": "agent", "title": args[10], "group_title": args[11]})
        return {"answer": ""}

    async def skill(self, *args: Any) -> dict[str, Any]:
        self.steps.append({"kind": "skill", "title": args[5], "group_title": args[6]})
        return {"answer": ""}

    async def tool(self, *args: Any) -> str:
        self.steps.append({"kind": "tool", "group_title": args[6]})
        return ""


async def test_run_step_title_is_its_name_and_item_is_not_passed_on() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.step("project", print, "x", item="golem", key="project-golem")
    (one,) = seen.steps
    assert (one["key"], one["title"], one["item"]) == ("project-golem", "project", "golem")
    assert one["kwargs"] == {}


async def test_an_item_is_part_of_the_key_and_no_item_keeps_the_name() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.step("Count lines", print, item="a.md")
    await run.step("Count lines", print, item="b.md")
    await run.step("add up", print)
    assert [s["key"] for s in seen.steps] == ["Count lines: a.md", "Count lines: b.md", "add up"]
    assert {s["title"] for s in seen.steps[:2]} == {"Count lines"}


async def test_item_is_text_cut_to_a_sensible_length() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.step("a", print, item=42)
    await run.step("b", print, item="x" * 500)
    await run.step("c", print)
    a, b, c = seen.steps
    assert a["item"] == "42"
    assert b["item"] is not None and len(b["item"]) == ITEM_CHARS and b["item"].endswith("…")
    assert c["item"] is None


async def test_llm_title_is_the_title_the_key_or_words_never_the_prompt() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.llm("Summarise this long document please", title="Summary")
    await run.llm("Another long prompt", key="read-invoice")
    await run.llm("A third long prompt")
    assert [s["title"] for s in seen.steps] == ["Summary", "Read-invoice", "Ask the model"]


async def test_notify_title_is_its_title_never_its_text() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.notify("5 ready, 2 need you", title="Digest")
    await run.notify("a second text")
    assert [s["title"] for s in seen.steps] == ["Digest", "Notification"]


async def test_agent_skill_review_and_parallel_titles() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.agent("worker", "a long brief")
    await run.agent("reviewer", "a long brief", key="r2", title="Check the diffs")
    await run.skill("pdf", "x")
    await run.review("draft", key="rv", title="Send it?")
    await run.parallel([run.step("one", print), run.tool("t", key="t1")], title="Both folders")
    kinds = [(s["kind"], s.get("title"), s["group_title"]) for s in seen.steps]
    assert kinds[:4] == [
        ("agent", "Worker agent", None),
        ("agent", "Check the diffs", None),
        ("skill", "pdf", None),
        ("review", "Send it?", None),
    ]
    assert {(k, g) for k, _, g in kinds[4:]} == {("step", "Both folders"), ("tool", "Both folders")}


async def test_a_group_without_a_title_has_none() -> None:
    seen = Seen()
    run = Run(seen, "wr_1")  # type: ignore[arg-type]
    await run.parallel([run.step("one", print)])
    assert seen.steps[0]["group_title"] is None


def test_workflow_title_is_kept_on_the_spec() -> None:
    @workflow(title="Weekly digest")
    async def named(run: Run) -> None: ...

    @workflow()
    async def plain(run: Run) -> None: ...

    assert getattr(named, SPEC_ATTR).title == "Weekly digest"
    assert getattr(plain, SPEC_ATTR).title is None


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


async def test_the_engine_saves_title_item_and_group_title(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    events: list[tuple[str, dict[str, Any]]] = []
    path = write(
        tmp_path,
        """
        async def work(f):
            return f

        @workflow(title="Folders")
        async def flow(run: Run):
            await run.parallel(
                [run.step("project", work, f, item=f, key=f"p-{f}") for f in ("a", "b")],
                title="All folders",
            )
        """,
    )
    engine = WorkflowEngine(store, lambda name, payload: events.append((name, payload)))
    rid = await engine.start(path, "flow")
    steps = await store.list_steps(rid)
    assert [(s.title, s.item, s.group_title) for s in steps] == [
        ("project", "a", "All folders"),
        ("project", "b", "All folders"),
    ]
    done = [p for n, p in events if n == "workflow.step.done"]
    assert [(p["title"], p["item"], p["group_title"]) for p in done] == [
        ("project", "a", "All folders"),
        ("project", "b", "All folders"),
    ]


async def test_a_file_with_no_new_argument_resumes_a_run_made_before(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    path = write(
        tmp_path,
        """
        @workflow()
        async def flow(run: Run):
            return await run.step("one", lambda: 1)
        """,
    )
    engine = WorkflowEngine(store)
    rid = await store.create_run("w", "flow", str(path), "t")
    # A step row as the old engine wrote it: no item, no group title.
    await store.begin_step(rid, "one", "step", "one", None, "t")
    await store.finish_step(rid, "one", "7", "t")
    await engine.execute(rid)
    (step,) = await store.list_steps(rid)
    assert (step.step_key, step.result_json, step.item, step.group_title) == (
        "one",
        "7",
        None,
        None,
    )
    run = await store.get_run(rid)
    assert run is not None and run.status == "done"


def test_outline_titles_follow_the_same_rules() -> None:
    src = '''\
from golem.workflow import workflow, Run

def project(f):
    """Check one folder. It is slow."""

@workflow(title="Folders")
async def flow(run: Run, folders):
    await run.llm("Summarise this long document", key="summary")
    await run.llm("Another prompt", title="Own title")
    await run.llm("Yet another prompt")
    await run.agent("worker", brief="Do a long thing")
    await run.agent("reviewer", "Brief", title="Check it")
    await run.skill("pdf", "x")
    await run.tool("github.list", title="a tool argument")
    await run.notify("The whole text", title="Digest")
    await run.notify("The whole text")
    await run.review("d", ask="Send it?")
    await run.review("d", title="Look")
    for f in folders:
        await run.step("project", project, f, item=f.name)
    await run.parallel(
        [run.step("a", project, item="x"), run.step("b", project)], title="Both"
    )
    await run.parallel([run.step("c", project)])
'''
    (wf,) = outline(src)
    titles = [s.title for s in wf.steps]
    assert titles == [
        "Summary",
        "Own title",
        "Ask the model",
        "Worker agent",
        "Check it",
        "pdf",
        "github.list",
        "Digest",
        "Notification",
        "Send it?",
        "Look",
        "project",
        "a",
        "b",
        "c",
    ]
    step = wf.steps[11]
    assert (step.item, step.does) == ("f.name", "Check one folder.")
    a, b, c = wf.steps[12:]
    assert (a.group_title, a.item, b.group_title, c.group_title) == ("Both", '"x"', "Both", None)
    assert b.does == "Check one folder."
    assert wf.steps[0].item is None and wf.steps[0].group_title is None


def test_the_new_arguments_are_known_to_check_and_edit() -> None:
    from golem.workflows.check import check
    from golem.workflows.edit import set_argument

    src = """\
from golem.workflow import workflow, Run

@workflow(title="Folders")
async def flow(run: Run, folders):
    await run.llm("Ask", title="Ask it", key="k")
    await run.agent("worker", "Brief", title="Fix it")
    await run.skill("pdf", title="Read it")
    await run.review("d", title="Look")
    await run.parallel([run.step("a", print, item="x")], title="Both")
"""
    assert [p for p in check(src) if "title" in p.message or "item" in p.message] == []
    new = set_argument(src, "step:a", "item", "y")
    assert 'item="y"' in new
    new = set_argument(src, "k", "title", "Other")
    assert 'title="Other"' in new


def test_outline_does_is_none_for_a_function_from_elsewhere() -> None:
    src = """\
from golem.workflow import workflow, Run
from .x import other

@workflow
async def flow(run: Run):
    await run.step("one", other)
"""
    (wf,) = outline(src)
    assert wf.steps[0].does is None
