"""``structured()`` asks a model for a shape and retries once."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

from golem.models.structured import StructuredError, extract_json, structured


class Answer(BaseModel):
    title: str
    count: int


class Native(BaseChatModel):
    """Has structured output: each call returns the next item of ``replies``."""

    replies: list[Any]
    seen: list[list[BaseMessage]] = Field(default_factory=list[list[BaseMessage]])

    @property
    def _llm_type(self) -> str:
        return "native"

    def _generate(self, messages: list[BaseMessage], *args: Any, **kwargs: Any) -> ChatResult:
        raise AssertionError("the structured path should not call this")

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:
        async def run(messages: Any) -> Any:
            self.seen.append(list(messages))
            reply = self.replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return reply

        return RunnableLambda(run)


class TextOnly(BaseChatModel):
    """No structured output: answers with text."""

    replies: list[str | Exception]
    seen: list[list[BaseMessage]] = Field(default_factory=list[list[BaseMessage]])

    @property
    def _llm_type(self) -> str:
        return "text"

    def _generate(self, messages: list[BaseMessage], *args: Any, **kwargs: Any) -> ChatResult:
        self.seen.append(list(messages))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=reply))])


ASK = [HumanMessage("go")]


async def test_native_object_is_returned() -> None:
    model = Native(replies=[Answer(title="a", count=1)])
    assert await structured(model, Answer, ASK) == Answer(title="a", count=1)
    assert len(model.seen) == 1


async def test_native_dict_is_validated() -> None:
    model = Native(replies=[{"title": "a", "count": 2}])
    assert (await structured(model, Answer, ASK)).count == 2


async def test_fenced_json_from_a_text_model() -> None:
    model = TextOnly(replies=['```json\n{"title": "a", "count": 3}\n```'])
    assert (await structured(model, Answer, ASK)).count == 3
    assert "JSON schema" in model.seen[0][-1].text


async def test_prose_around_the_json() -> None:
    model = TextOnly(replies=['Here you go: {"title": "a", "count": 4} Hope it helps.'])
    assert (await structured(model, Answer, ASK)).count == 4


async def test_one_retry_carries_the_bad_answer_and_the_problem() -> None:
    model = TextOnly(replies=['{"title": "a", "count": "many"}', '{"title": "a", "count": 5}'])
    assert (await structured(model, Answer, ASK)).count == 5
    assert len(model.seen) == 2
    second = [m.text for m in model.seen[1]]
    assert any("many" in text for text in second)
    assert any("did not match the schema" in text and "count" in text for text in second)


async def test_always_wrong_raises_with_raw() -> None:
    bad = '{"title": "a", "count": "x"}'
    model = TextOnly(replies=[bad, bad, bad])
    with pytest.raises(StructuredError) as caught:
        await structured(model, Answer, ASK, retries=1)
    assert caught.value.raw == bad
    assert len(model.replies) == 1


async def test_no_retries_means_one_call() -> None:
    model = TextOnly(replies=["nope", "nope"])
    with pytest.raises(StructuredError):
        await structured(model, Answer, ASK, retries=0)
    assert len(model.seen) == 1


async def test_native_failure_is_retried() -> None:
    model = Native(replies=[ValueError("bad json"), Answer(title="a", count=1)])
    assert (await structured(model, Answer, ASK)).count == 1
    assert len(model.seen) == 2


async def test_connection_error_is_not_retried() -> None:
    model = TextOnly(replies=[ConnectionError("down"), '{"title": "a", "count": 1}'])
    with pytest.raises(ConnectionError):
        await structured(model, Answer, ASK)
    assert len(model.seen) == 1


async def test_timeout_passes_through() -> None:
    class Slow(Native):
        def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:
            async def run(messages: Any) -> Any:
                await asyncio.sleep(5)

            return RunnableLambda(run)

    with pytest.raises(TimeoutError):
        await structured(Slow(replies=[]), Answer, ASK, timeout=0.05)


def test_extract_json_cases() -> None:
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('```\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('x {"a": {"b": {"c": 2}}} y') == {"a": {"b": {"c": 2}}}
    assert extract_json('{"a": "}{ not a brace"}') == {"a": "}{ not a brace"}
    assert extract_json("no json here") is None
    assert extract_json("{broken") is None
