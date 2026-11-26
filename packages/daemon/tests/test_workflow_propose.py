"""Ask golem: a proposed change to a workflow file, checked and never saved (3.11.4, #1881)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import json
from typing import Any

import pytest
from test_workflow_llm import (  # pyright: ignore[reportUnknownVariableType]
    BIG,
    LOCAL,
    _llm,
    _Router,
)

from golem.workflows.check import CheckEnv, check
from golem.workflows.llm import LlmAnswer
from golem.workflows.propose import ProposeError, api_reference, propose

HEAD = "from golem.workflow import workflow, Run\n\n\n"
OLD = HEAD + '@workflow()\nasync def flow(run: Run):\n    await run.notify("hi")\n'
NEW = OLD + '    await run.notify("again")\n'
BAD = OLD + '    await run.fly("x")\n'
ENV = CheckEnv(agents=lambda folder: {"worker": "same"})


class Fake:
    """An ``Llm`` that answers from a list and keeps what it was asked."""

    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.asked: list[tuple[str, dict[str, Any] | None, str | None, str | None]] = []

    async def __call__(
        self, prompt: str, schema: dict[str, Any] | None, wish: str | None, folder: str | None
    ) -> LlmAnswer:
        self.asked.append((prompt, schema, wish, folder))
        return LlmAnswer(self.answers.pop(0), "fake/model", None)


def reply(code: str, note: str = "I added a line.") -> str:
    return json.dumps({"code": code, "note": note})


def _check(text: str) -> list[Any]:
    return check(text, "/p", ENV)


async def test_a_proposal_comes_back_checked_with_its_note() -> None:
    llm = Fake(reply(NEW))
    made = await propose(
        llm=llm, folder="/p", code=OLD, ask="say it twice", check=_check, agents={"worker": "same"}
    )
    assert made.code == NEW and made.note == "I added a line." and made.model == "fake/model"
    assert made.problems == []
    prompt, schema, _, folder = llm.asked[0]
    assert len(llm.asked) == 1 and folder == "/p" and schema is not None
    assert "say it twice" in prompt and OLD in prompt
    assert "run.agent" in prompt and "- worker" in prompt


async def test_the_problems_of_a_bad_proposal_come_with_it() -> None:
    made = await propose(llm=Fake(reply(BAD)), folder=None, code=OLD, ask="x", check=_check)
    assert [p.severity for p in made.problems] == ["error"]
    assert "run has no fly" in made.problems[0].message


async def test_a_fenced_file_is_unfenced_and_ends_with_a_newline() -> None:
    fenced = reply("```python\n" + NEW.rstrip("\n") + "\n```")
    made = await propose(llm=Fake(fenced), folder=None, code=OLD, ask="x", check=_check)
    assert made.code == NEW


async def test_a_refine_sends_the_previous_proposal_and_its_note() -> None:
    llm = Fake(reply(NEW + '    await run.notify("third")\n'))
    await propose(
        llm=llm,
        folder=None,
        code=OLD,
        ask="and once more",
        check=_check,
        previous=(NEW, "first change"),
    )
    prompt = llm.asked[0][0]
    assert NEW in prompt and "first change" in prompt and "and once more" in prompt


async def test_no_model_or_an_empty_ask_or_a_bad_answer_is_a_clear_error() -> None:
    with pytest.raises(ProposeError, match="no model is available"):
        await propose(llm=None, folder=None, code=OLD, ask="x", check=_check)
    with pytest.raises(ProposeError, match="say what to change"):
        await propose(llm=Fake(), folder=None, code=OLD, ask="  ", check=_check)
    with pytest.raises(ProposeError, match="did not answer"):
        await propose(llm=Fake("no json"), folder=None, code=OLD, ask="x", check=_check)
    with pytest.raises(ProposeError, match="no file"):
        await propose(
            llm=Fake('{"code": "", "note": "n"}'), folder=None, code=OLD, ask="x", check=_check
        )


async def test_a_model_failure_is_a_proposal_error() -> None:
    async def boom(*_: Any) -> LlmAnswer:
        raise RuntimeError("down")

    with pytest.raises(ProposeError, match="down"):
        await propose(llm=boom, folder=None, code=OLD, ask="x", check=_check)


async def test_a_local_only_folder_never_calls_a_cloud_model() -> None:
    router = _Router(BIG)
    router.replies = [reply(NEW)]
    router.models.clear()
    llm = _llm(router, local_only=True)
    with pytest.raises(ProposeError, match="stays on this Mac"):
        await propose(llm=llm, folder="/private", code=OLD, ask="x", check=_check)
    assert router.asked(BIG) == 0

    local = _Router(LOCAL)
    local.replies = [reply(NEW)]
    made = await propose(
        llm=_llm(local, local_only=True), folder="/private", code=OLD, ask="x", check=_check
    )
    assert made.model == "ollama/small" and made.code == NEW
    assert local.asked(LOCAL) == 1 and local.asked(BIG) == 0


def test_the_api_reference_lists_the_run_methods() -> None:
    text = api_reference()
    for name in ("run.step(", "run.agent(", "run.llm(", "run.notify("):
        assert name in text
