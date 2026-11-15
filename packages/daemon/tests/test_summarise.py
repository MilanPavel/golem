"""Summarising old turns: the text sent to the model, the chunks, and the fallback."""

from __future__ import annotations

import json
from typing import Any

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from golem.graphs.adapter import message_text
from golem.graphs.summarise import RESULT_CHARS, Summary, render, render_summary, summarise


def _answer(request: str) -> str:
    return json.dumps(
        {
            "request": request,
            "done": ["read a.py"],
            "files": ["a.py"],
            "facts": [],
            "open": ["fix the test"],
        }
    )


def _no_calls() -> list[list[BaseMessage]]:
    return []


class _Fake(BaseChatModel):
    """Answers with ``answers`` in order and keeps what it was asked. No native structure."""

    answers: list[str]
    calls: list[list[BaseMessage]] = Field(default_factory=_no_calls)

    @property
    def _llm_type(self) -> str:
        return "fake-summary"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        self.calls.append(list(messages))
        if not self.answers:
            raise RuntimeError("the model is down")
        reply = AIMessage(content=self.answers.pop(0))
        return ChatResult(generations=[ChatGeneration(message=reply)])


def _asked(call: list[BaseMessage]) -> str:
    return "\n".join(message_text(m) for m in call if isinstance(m, HumanMessage))


def test_messages_are_rendered_as_text_lines() -> None:
    long = "y" * (RESULT_CHARS + 500)
    lines = render(
        [
            HumanMessage(content="fix the build"),
            AIMessage(
                content="looking",
                tool_calls=[{"name": "read_file", "args": {"path": "a.py"}, "id": "c1"}],
            ),
            ToolMessage(content=long, tool_call_id="c1", name="read_file"),
            AIMessage(content="done"),
        ]
    )
    assert lines[0] == "User: fix the build"
    assert lines[1] == 'Assistant: looking\n→ read_file({"path": "a.py"})'
    assert lines[2].startswith("Tool read_file: yyy")
    assert len(lines[2]) < RESULT_CHARS + 100 and "500 more characters" in lines[2]
    assert lines[3] == "Assistant: done"


def test_a_summary_is_plain_text_with_five_headings() -> None:
    text = render_summary(Summary(request="fix it", done=["a"], files=[], facts=["b"], open=["c"]))
    assert text.startswith("Request:\nfix it")
    for heading in ("Done:", "Files:", "Facts:", "Open:"):
        assert heading in text
    assert "Files:\n- none" in text


async def test_one_call_summarises_and_the_earlier_summary_goes_first() -> None:
    model = _Fake(answers=[_answer("fix the build")])
    text = await summarise(model, [HumanMessage(content="next ask")], "OLD SUMMARY")
    assert text.startswith("Request:\nfix the build")
    assert len(model.calls) == 1
    asked = _asked(model.calls[0])
    assert asked.startswith("Earlier summary:\nOLD SUMMARY")
    assert asked.index("OLD SUMMARY") < asked.index("User: next ask")


async def test_a_slice_too_big_for_the_room_is_summarised_in_chunks() -> None:
    results = [ToolMessage(content="z" * 1400, tool_call_id=f"c{n}", name="grep") for n in range(8)]
    model = _Fake(answers=[_answer(f"part {n}") for n in range(1, 8)])
    text = await summarise(model, results, "OLD SUMMARY", room=2500)
    chunks, final = model.calls[:-1], model.calls[-1]
    assert len(chunks) >= 3
    assert "OLD SUMMARY" in _asked(chunks[0])
    assert not any("OLD SUMMARY" in _asked(c) for c in chunks[1:])
    # The last call summarises the summaries, and nothing goes past two levels.
    assert f"Part 1 of {len(chunks)}:" in _asked(final)
    assert text.startswith("Request:\npart ")


async def test_a_model_that_cannot_give_the_shape_is_asked_for_plain_text() -> None:
    model = _Fake(answers=["no json", "still none", "The user wants the build fixed."])
    text = await summarise(model, [HumanMessage(content="fix the build")], None)
    assert text == "The user wants the build fixed."
    system = [m for m in model.calls[-1] if isinstance(m, SystemMessage)]
    assert "Summarise for someone who must continue this work" in message_text(system[0])


async def test_a_failing_model_raises() -> None:
    with pytest.raises(RuntimeError):
        await summarise(_Fake(answers=[]), [HumanMessage(content="x")], None)
    with pytest.raises(ValueError):
        await summarise(_Fake(answers=[]), [], None)
