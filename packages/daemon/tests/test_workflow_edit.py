"""Edit one argument of a step in place (#1882)."""

from __future__ import annotations

import ast

import pytest

from golem.workflows.edit import EditError, set_argument
from golem.workflows.outline import OutlineStep, outline

SRC = '''\
"""Dnes: žluťoučký kůň."""
from golem.workflow import Run, workflow


@workflow()
async def wf(run: Run) -> None:
    # keep this comment
    a = await run.agent("worker", brief="Pošli 🙂 hotovo", budget="$0.50")  # trailing
    b = await run.agent(
        "reviewer",
        brief=f"Check {a}",   # computed
        model="same",
    )
    c = await run.agent("worker", "Positional brief")
    await run.notify("hi")
    await run.review(draft, ask="OK?",
    )
    x = await run.agent("žluť", brief="ž" + "k")
    helper()
'''


def step(code: str, sid: str) -> OutlineStep:
    return next(s for s in outline(code)[0].steps if s.id == sid)


def changed_lines(old: str, new: str) -> list[int]:
    a, b = old.splitlines(), new.splitlines()
    assert len(a) == len(b)
    return [i + 1 for i, (x, y) in enumerate(zip(a, b, strict=True)) if x != y]


def test_args_have_spans_in_characters() -> None:
    s = step(SRC, "agent:worker")
    brief = next(a for a in s.args if a.name == "brief")
    assert brief.literal and brief.value == "Pošli 🙂 hotovo"
    line = SRC.splitlines()[brief.line - 1]
    assert line[brief.col : brief.end_col] == '"Pošli 🙂 hotovo"'
    assert [a.name for a in s.args][:2] == ["type", "brief"]


def test_fstring_with_expressions_is_not_literal() -> None:
    s = step(SRC, "agent:reviewer")
    brief = next(a for a in s.args if a.name == "brief")
    assert not brief.literal and brief.value is None and brief.source == 'f"Check {a}"'


def test_replaces_brief_after_non_ascii_and_keeps_the_rest() -> None:
    new = set_argument(SRC, "agent:worker", "brief", 'Řekni "ahoj"')
    assert changed_lines(SRC, new) == [8]
    assert '"Řekni \\"ahoj\\""' in new
    assert "# trailing" in new and "# keep this comment" in new
    ast.parse(new)


def test_replaces_positional_agent_budget_and_adds_model() -> None:
    new = set_argument(SRC, "agent:worker", "type", "reviewer")
    assert 'run.agent("reviewer", brief="Pošli' in new
    new = set_argument(SRC, "agent:worker", "budget", "$2")
    assert 'budget="$2")  # trailing' in new
    new = set_argument(SRC, "agent:worker", "model", "local")
    assert 'budget="$0.50", model="local")  # trailing' in new


def test_positional_brief_by_name() -> None:
    second = next(s.id for s in outline(SRC)[0].steps if s.id.startswith("agent:worker~"))
    new = set_argument(SRC, second, "brief", "Other")
    assert 'run.agent("worker", "Other")' in new


def test_adds_missing_argument_keeping_trailing_comma() -> None:
    new = set_argument(SRC, "agent:reviewer", "budget", "$1")
    assert 'model="same", budget="$1",\n    )' in new
    ast.parse(new)
    new = set_argument(SRC, "notify-1", "title", "Done")
    assert 'run.notify("hi", title="Done")' in new
    review = next(s.id for s in outline(SRC)[0].steps if s.kind == "review")
    new = set_argument(SRC, review, "key", "r1")
    assert 'ask="OK?", key="r1",\n    )' in new
    ast.parse(new)


def test_adds_to_a_call_with_no_arguments() -> None:
    src = "@workflow()\nasync def w(run: Run):\n    await run.notify()\n"
    assert 'run.notify(text="hi")' in set_argument(src, "notify-1", "text", "hi")


def test_refuses_computed_code_and_bad_values() -> None:
    with pytest.raises(EditError, match="set in code"):
        set_argument(SRC, "agent:reviewer", "brief", "x")
    with pytest.raises(EditError, match="code step"):
        set_argument(SRC, "code-1", "brief", "x")
    with pytest.raises(EditError, match="no step"):
        set_argument(SRC, "nope", "brief", "x")
    with pytest.raises(EditError, match="no argument"):
        set_argument(SRC, "notify-1", "model", "same")
    with pytest.raises(EditError, match="name of a model"):
        set_argument(SRC, "agent:worker", "model", "  ")
    with pytest.raises(EditError, match="money"):
        set_argument(SRC, "agent:worker", "budget", "lots")
    with pytest.raises(EditError, match="more than"):
        set_argument(SRC, "agent:worker", "budget", "$0")
    with pytest.raises(EditError, match="empty"):
        set_argument(SRC, "agent:worker", "brief", "  ")


def test_crlf_and_multiline_value() -> None:
    src = SRC.replace("\n", "\r\n")
    new = set_argument(src, "agent:worker", "brief", "two\nlines")
    assert new.count("\r\n") == src.count("\r\n")
    assert '"two\\nlines"' in new
