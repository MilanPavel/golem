"""The outline of a workflow, read from its code by fixed rules (#1762)."""

from __future__ import annotations

import json

import pytest

from golem.workflows.outline import OutlineError, OutlineStep, outline

UPGRADE = """\
from golem.workflow import Run, schedule, workflow
from .packages import list_outdated, open_pull_request

@workflow(trigger=schedule("mon 06:00"))
async def upgrade_dependencies(run: Run) -> None:
    outdated = await run.step("list outdated", list_outdated, run.repo)
    if not outdated:
        return

    upgrades = await run.parallel(
        run.agent("worker",
                  brief=f"Upgrade {p.name} to {p.latest}. Fix what breaks. Run the tests.",
                  worktree=f"upgrade/{p.name}", budget="$0.50")
        for p in outdated
    )
    notes = await run.agent("reviewer", gets=[u.diff for u in upgrades],
                          brief="Check each diff. One line per package.")

    green = [u for u in upgrades if u.tests_passed]
    await run.notify(f"{len(green)} ready, {len(upgrades)-len(green)} need you")
    approved = await run.review(green, notes, ask="Open these pull requests?")

    for u in approved:
        await run.step(f"PR {u.package}", open_pull_request, u,
                       key=f"pr:{u.package}:{u.version}")
"""

FLAKY = """\
from golem.workflow import Run, workflow
from .tests import run_many

@workflow(inputs={"test": str, "times": int})
async def flaky_test_hunt(run: Run, test: str, times: int = 20) -> None:
    results = await run.step("run it", run_many, test, times)
    if results.failed == 0:
        return
    timing, state = await run.parallel(
        run.agent("explorer", gets=[results], brief=f"Why does {test} fail? Timing."),
        run.agent("explorer", gets=[results], brief=f"Why does {test} fail? Shared state."),
    )
    fix = await run.agent("worker", gets=[results, timing, state], worktree=f"flaky/{test}",
                          brief=f"Make {test} reliable. Run it {times} times.", budget="$0.50")
    if await run.review(fix, ask="Apply this fix?"):
        await run.step("apply", fix.apply, key=f"flaky:{test}")
"""

INVOICES = """\
from golem.workflow import Run, new_file, workflow
from .sheets import Invoice, add_row

@workflow(trigger=new_file("~/Invoices", "*.pdf"))
async def invoices_to_sheet(run: Run, file: str) -> None:
    inv = await run.llm("Read this invoice.", file=file, schema=Invoice)
    if inv.total > 500:
        inv = await run.review(inv, ask="A large invoice. Is this right?")
    await run.step("add row", add_row, "Invoices 2026", inv, key=f"invoice:{inv.number}")
    await run.notify(f"Added {inv.vendor}, {inv.total} €")
"""

DIGEST = """\
from golem.workflow import Run, schedule, workflow
from .digest import assemble, post_to_slack

@workflow(trigger=schedule("weekdays 08:30"), inputs={"repo": str})
async def pr_digest(run: Run, repo: str = "origin") -> None:
    prs = await run.tool("github.list_pull_requests", repo=repo, state="open")
    if not prs:
        return
    summaries = await run.parallel(
        run.agent("explorer", gets=[pr], brief="Summarise this PR in two lines.")
        for pr in prs
    )
    digest = await run.step("assemble", assemble, summaries)
    if await run.review(digest, ask="Post this digest to #standup?"):
        await run.step("post", post_to_slack, "#standup", digest, key=f"digest:{run.date}")
"""


def one(source: str) -> tuple[object, dict[str, OutlineStep]]:
    (wf,) = outline(source)
    return wf, {s.id: s for s in wf.steps}


def test_upgrade_dependencies() -> None:
    (wf,) = outline(UPGRADE)
    assert wf.name == "upgrade_dependencies"
    assert wf.trigger == 'schedule("mon 06:00")'
    assert wf.inputs == ()
    assert wf.lines == (4, 25)
    assert [(s.id, s.kind) for s in wf.steps] == [
        ("step:list-outdated", "step"),
        ("agent:worker", "agent"),
        ("agent:reviewer", "agent"),
        ("notify-1", "notify"),
        ("review-1", "review"),
        ("step-1", "step"),
    ]
    listing, worker, reviewer, notify, review, pr = wf.steps
    assert listing.title == "list outdated"
    assert listing.lines == (6, 6)
    assert listing.after == ()

    assert worker.title == "worker: Upgrade {p.name} to {p.latest}. Fix what breaks. Run the tests."
    assert worker.agent == "worker"
    assert worker.group == "parallel-1"
    assert worker.for_each == "for each p in outdated"
    assert worker.lines == (10, 15)
    assert (worker.brief_line, worker.budget_line, worker.budget) == (12, 13, "$0.50")
    assert worker.after == ("step:list-outdated",)

    assert reviewer.group is None
    assert reviewer.gets == "[u.diff for u in upgrades]"
    assert reviewer.lines == (16, 17)
    assert reviewer.brief_line == 17
    assert reviewer.after == ("agent:worker",)

    assert notify.title.startswith("{len(green)} ready")
    assert notify.lines == (20, 20)
    assert notify.after == ("agent:worker",)

    assert review.title == "Open these pull requests?"
    assert review.after == ("agent:worker", "agent:reviewer")

    assert pr.title == "PR {u.package}"
    assert pr.for_each == "for each u in approved"
    assert pr.lines == (23, 25)
    assert pr.key == "pr:{u.package}:{u.version}"
    assert pr.after == ("review-1",)


def test_flaky_test_hunt() -> None:
    (wf,) = outline(FLAKY)
    assert [(w.name, w.type, w.default) for w in wf.inputs] == [
        ("test", "str", None),
        ("times", "int", "20"),
    ]
    assert wf.trigger is None
    assert [s.kind for s in wf.steps] == ["step", "agent", "agent", "agent", "review", "step"]
    run, timing, state, fix, review, apply = wf.steps
    assert (timing.group, state.group) == ("parallel-1", "parallel-1")
    assert (timing.lines, state.lines) == ((10, 10), (11, 11))
    assert timing.for_each is None
    assert timing.after == (run.id,)
    assert fix.group is None
    assert fix.lines == (13, 14)
    assert fix.after == (run.id, timing.id, state.id)
    assert fix.budget == "$0.50"
    assert review.title == "Apply this fix?"
    assert review.after == (fix.id,)
    assert apply.title == "apply"
    assert apply.condition == 'await run.review(fix, ask="Apply this fix?")'
    assert apply.after == (fix.id, review.id)


def test_invoices_to_sheet() -> None:
    (wf,) = outline(INVOICES)
    assert wf.trigger == 'new_file("~/Invoices", "*.pdf")'
    assert [i.name for i in wf.inputs] == ["file"]
    assert [s.kind for s in wf.steps] == ["llm", "review", "step", "notify"]
    read, review, add, notify = wf.steps
    assert read.title == "Read this invoice."
    assert review.condition == "inv.total > 500"
    assert review.after == (read.id,)
    assert review.lines == (8, 8)
    assert add.condition is None
    assert add.after == (review.id,)  # `inv` was replaced by the review's answer
    assert add.key == "invoice:{inv.number}"
    assert notify.after == (review.id,)


def test_pr_digest() -> None:
    (wf,) = outline(DIGEST)
    assert [(i.name, i.type, i.default) for i in wf.inputs] == [("repo", "str", '"origin"')]
    kinds = [s.kind for s in wf.steps]
    assert kinds == ["tool", "agent", "step", "review", "step"]
    tool, summarise, assemble, review, post = wf.steps
    assert tool.title == "github.list_pull_requests"
    assert tool.id == "tool:github-list-pull-requests"
    assert summarise.for_each == "for each pr in prs"
    assert summarise.lines == (9, 12)
    assert summarise.after == (tool.id,)
    assert assemble.lines == (13, 13)
    assert assemble.after == (summarise.id,)
    assert post.after == (assemble.id, review.id)


def test_to_dict_is_json() -> None:
    for src in (UPGRADE, FLAKY, INVOICES, DIGEST):
        data = [w.to_dict() for w in outline(src)]
        assert json.loads(json.dumps(data)) == data
    step = outline(UPGRADE)[0].to_dict()["steps"][1]
    assert step["lines"] == [10, 15]
    assert step["after"] == ["step:list-outdated"]


def test_unknown_code_is_a_grey_step_and_consecutive_ones_merge() -> None:
    src = """\
@workflow
async def w(run):
    x = 1
    helper(x)
    other = compute(x)
    await run.notify("hi")
    with open("f") as f:
        f.read()
    try:
        risky()
    except Exception:
        pass
"""
    (wf,) = outline(src)
    assert [(s.kind, s.lines) for s in wf.steps] == [
        ("code", (4, 5)),
        ("notify", (6, 6)),
        ("code", (7, 12)),
    ]
    assert wf.steps[0].title == "helper(x)"
    assert wf.steps[0].id == "code-1"
    assert wf.steps[1].after == ()


def test_plain_assignments_are_not_steps() -> None:
    src = '''\
@workflow
async def w(run):
    """Say hi."""
    a = 1
    b = [x for x in range(3)]
    n = len(b)
    return n
'''
    (wf,) = outline(src)
    assert wf.steps == ()
    assert wf.docstring == "Say hi."


def test_nested_if_and_for() -> None:
    src = """\
@workflow
async def w(run, items):
    got = await run.step("load", load)
    for a in got:
        if a.ok:
            for b in a.children:
                await run.agent("worker", brief="Fix it\\nmore", budget=1)
        else:
            await run.notify("bad")
"""
    (wf,) = outline(src)
    load, agent, notify = wf.steps
    assert agent.for_each == "for each a in got; for each b in a.children"
    assert agent.condition == "a.ok"
    assert agent.lines == (4, 7)
    assert agent.title == "worker: Fix it"
    assert agent.budget == "1"
    assert agent.after == (load.id,)
    assert notify.condition == "not (a.ok)"
    assert notify.for_each == "for each a in got"
    assert notify.lines == (4, 9)
    assert [i.name for i in wf.inputs] == ["items"]


def test_run_parameter_may_have_any_name_and_calls_need_no_await() -> None:
    src = """\
import golem.workflow

@golem.workflow.workflow()
async def w(r: Run):
    r.notify("a")
    await r.step("b", f)
    run.notify("not this one")
"""
    (wf,) = outline(src)
    # `run` is not the parameter here, so that call is just code
    assert [(s.kind, s.title) for s in wf.steps] == [
        ("notify", "a"),
        ("step", "b"),
        ("code", 'run.notify("not this one")'),
    ]


def test_gather_groups_run_calls() -> None:
    src = """\
import asyncio

@workflow
async def w(run, xs):
    await asyncio.gather(*[run.agent("worker", brief=x) for x in xs])
    await asyncio.gather(run.llm("a"), run.llm("b"))
"""
    (wf,) = outline(src)
    groups = [s.group for s in wf.steps]
    assert groups == ["parallel-1", "parallel-2", "parallel-2"]
    assert wf.steps[0].for_each == "for each x in xs"


def test_dynamic_calls_still_make_a_step() -> None:
    src = """\
@workflow
async def w(run, which, name):
    await getattr(run, which)("x")
    await run.mystery(1)
    await run.step(name, f)
    await run.agent(which)
"""
    (wf,) = outline(src)
    assert [s.kind for s in wf.steps] == ["code", "code", "step", "agent"]
    assert wf.steps[0].title == 'getattr(run, which)("x")'
    assert wf.steps[1].title == "run.mystery(1)"
    assert wf.steps[2].title == "name"
    assert wf.steps[3].agent == "which"


def test_ids_are_unique() -> None:
    src = """\
@workflow
async def w(run):
    await run.step("same", f)
    await run.step("same", f)
    await run.step("a", f, key="k")
    await run.step("b", f, key="k")
"""
    (wf,) = outline(src)
    ids = [s.id for s in wf.steps]
    assert len(set(ids)) == 4
    assert ids[2] == "k"


def test_only_workflow_functions_and_several_per_file() -> None:
    src = """\
async def helper(run):
    await run.notify("no")

@workflow
async def a(run):
    await run.notify("a")

@workflow(trigger=schedule(when))
async def b(run):
    await run.notify("b")
"""
    first, second = outline(src)
    assert (first.name, second.name) == ("a", "b")
    assert second.trigger is None
    assert outline("x = 1\n") == []


def test_syntax_error_has_a_line() -> None:
    with pytest.raises(OutlineError) as e:
        outline("@workflow\nasync def w(run):\n    await run.step(\n")
    assert e.value.line is not None
    assert "line" in str(e.value)
