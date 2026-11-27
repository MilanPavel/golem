"""Ask golem: a proposed change to a workflow file, checked and never saved (3.11.4, #1881)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, cast

import pytest
from test_workflow_llm import (  # pyright: ignore[reportUnknownVariableType]
    BIG,
    LOCAL,
    _llm,
    _Router,
)

from golem.server.dispatcher import RequestContext
from golem.server.workflows import workflow_propose
from golem.workflows.check import CheckEnv, check
from golem.workflows.llm import LlmAnswer
from golem.workflows.propose import ProposeError, api_reference, numbered_outline, propose
from golem_protocol.commands import WorkflowProposeParams

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


def answer_reply(text: str = "It says hi in step 1.") -> str:
    return json.dumps({"kind": "answer", "answer": text})


async def test_a_question_comes_back_as_an_answer_and_the_file_is_untouched() -> None:
    llm = Fake(answer_reply())
    made = await propose(
        llm=llm, folder=None, code=OLD, ask="what does it do?", check=_check, steps="1. notify: hi"
    )
    assert made.kind == "answer" and made.answer == "It says hi in step 1."
    assert made.code == OLD and made.problems == [] and made.note == ""
    prompt = llm.asked[0][0]
    assert "1. notify: hi" in prompt and "step 3" in prompt


async def test_an_explicit_change_is_a_change() -> None:
    text = json.dumps({"kind": "change", "code": NEW, "note": "Added."})
    made = await propose(llm=Fake(text), folder=None, code=OLD, ask="x", check=_check)
    assert made.kind == "change" and made.code == NEW and made.answer == ""


async def test_a_reply_without_a_kind_but_with_a_file_is_a_change() -> None:
    made = await propose(llm=Fake(reply(NEW)), folder=None, code=OLD, ask="x", check=_check)
    assert made.kind == "change" and made.code == NEW


async def test_a_reply_that_cannot_be_read_is_an_error_not_a_change() -> None:
    for bad in (
        '{"kind": "answer", "answer": "  "}',
        '{"kind": "answer"}',
        '{"kind": "maybe", "code": "x = 1"}',
        '{"kind": "change", "note": "n"}',
        '{"note": "only a note"}',
        "[]",
    ):
        with pytest.raises(ProposeError):
            await propose(llm=Fake(bad), folder=None, code=OLD, ask="x", check=_check)


def test_the_outline_is_numbered_for_the_prompt() -> None:
    text = (
        HEAD
        + '@workflow()\nasync def flow(run: Run):\n    await run.notify("a")\n'
        + '    await run.notify("b")\n'
    )
    lines = numbered_outline(text, "flow").splitlines()
    assert len(lines) == 2 and lines[0].startswith("1. ") and lines[1].startswith("2. ")
    assert numbered_outline(text, "other") == "" and numbered_outline("def (:", "flow") == ""


class _Service:
    def __init__(self, made: Any) -> None:
        self.made = made

    async def refresh(self, folders: list[Any]) -> list[Any]:
        return [SimpleNamespace(id="w1", name="flow")]

    async def propose_code(self, *args: Any) -> Any:
        return self.made


def _ctx(service: _Service) -> RequestContext:
    return cast(RequestContext, SimpleNamespace(state=SimpleNamespace(workflows=service)))


async def test_the_handler_returns_an_answer_and_a_change() -> None:
    llm = Fake(answer_reply("Step 1 says hi."), reply(NEW))
    params = WorkflowProposeParams(id="w1", code=OLD, ask="what is this?")
    answered = await propose(llm=llm, folder=None, code=OLD, ask="q", check=_check)
    got = await workflow_propose(_ctx(_Service(answered)), params)
    assert got.kind == "answer" and got.answer == "Step 1 says hi." and got.code == OLD
    assert got.note == "Step 1 says hi." and len(got.steps) == 1

    changed = await propose(llm=llm, folder=None, code=OLD, ask="x", check=_check)
    got = await workflow_propose(_ctx(_Service(changed)), params)
    assert got.kind == "change" and got.answer is None and got.code == NEW
    assert got.note == "I added a line." and len(got.steps) == 2


def test_the_api_reference_lists_the_run_methods() -> None:
    text = api_reference()
    for name in ("run.step(", "run.agent(", "run.llm(", "run.notify("):
        assert name in text
