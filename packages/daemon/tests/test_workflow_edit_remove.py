"""Take one argument out of a step's call, or `model=` out of `@workflow` (3.13.7, #1930)."""

from __future__ import annotations

import pytest

from golem.workflows.edit import EditError, remove_argument
from golem.workflows.outline import outline

SRC = """\
from golem.workflow import Run, workflow


@workflow(trigger=manual(), model="m/x")
async def a(run: Run) -> None:
    await run.llm("one", model="m/y", key="k1")
    await run.agent(
        "worker",
        "brief",  # keep
        model="m/z",  # goes with its line
        key="k2",
    )
    await run.llm("three", key="k3", model="m/w")
    await run.llm("four", model="m/v", key="k4")
    await run.llm("five", None, "cheapest")
"""


def test_an_argument_goes_with_its_comma_and_a_line_that_held_only_it() -> None:
    one = remove_argument(SRC, "k1", "model")
    assert 'await run.llm("one", key="k1")' in one
    two = remove_argument(SRC, "k2", "model")
    assert '        "brief",  # keep\n        key="k2",' in two
    assert "goes with its line" not in two
    three = remove_argument(SRC, "k3", "model")
    assert 'await run.llm("three", key="k3")' in three
    four = remove_argument(SRC, "k4", "model")
    assert 'await run.llm("four", key="k4")' in four
    for text in (one, two, three, four):
        compile(text.replace("manual()", "None"), "x", "exec")
    assert remove_argument(SRC, "k1", "key") != SRC
    assert remove_argument(SRC, "k3", "title") == SRC  # nothing written, nothing to remove


def test_the_decorators_model_is_removed() -> None:
    assert "@workflow(trigger=manual())" in remove_argument(SRC, "@workflow", "model")
    only = remove_argument('@workflow(model="m/x")\nasync def f(run): ...\n', "@workflow", "model")
    assert only.startswith("@workflow()")
    assert remove_argument(only, "@workflow", "model") == only
    bare = "@workflow\nasync def f(run): ...\n"
    assert remove_argument(bare, "@workflow", "model") == bare


def test_a_positional_computed_or_other_argument_is_refused_in_words() -> None:
    five = next(s.id for s in outline(SRC)[0].steps if s.title.startswith("Ask") and s.key is None)
    with pytest.raises(EditError, match="by position"):
        remove_argument(SRC, five, "model")
    with pytest.raises(EditError, match="only the model"):
        remove_argument(SRC, "@workflow", "title")
    computed = SRC.replace('model="m/v"', "model=pick()")
    with pytest.raises(EditError, match="set in code"):
        remove_argument(computed, "k4", "model")
    with pytest.raises(EditError, match="no step"):
        remove_argument(SRC, "nope", "model")
