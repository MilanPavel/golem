"""``OllamaChat`` keeps the thinking Ollama returns and sends nothing new."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage

from golem.models.ollama_chat import OllamaChat

_REPLY: list[dict[str, Any]] = [
    {"message": {"role": "assistant", "content": "", "thinking": "17 times "}},
    {"message": {"role": "assistant", "content": "", "thinking": "23"}},
    {"message": {"role": "assistant", "content": "391"}},
    {"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop"},
]


class _Client:
    def __init__(self, sent: list[dict[str, Any]]) -> None:
        self._sent = sent

    def chat(self, **params: Any) -> Iterator[dict[str, Any]]:
        self._sent.append(params)
        return iter(_REPLY)


class _AsyncClient:
    def __init__(self, sent: list[dict[str, Any]]) -> None:
        self._sent = sent

    async def chat(self, **params: Any) -> AsyncIterator[dict[str, Any]]:
        self._sent.append(params)

        async def stream() -> AsyncIterator[dict[str, Any]]:
            for part in _REPLY:
                yield part

        return stream()


def _model(sent: list[dict[str, Any]], **fields: Any) -> OllamaChat:
    model = OllamaChat(model="qwen3.5:4b", **fields)
    object.__setattr__(model, "_client", _Client(sent))
    object.__setattr__(model, "_async_client", _AsyncClient(sent))
    return model


def test_thinking_is_kept_with_reasoning_unset() -> None:
    sent: list[dict[str, Any]] = []
    chunks = list(_model(sent).stream([HumanMessage("What is 17*23?")]))
    thinking = "".join(c.additional_kwargs.get("reasoning_content", "") for c in chunks)
    assert thinking == "17 times 23"
    assert "".join(c.text for c in chunks) == "391"


def test_the_request_is_the_same_as_before() -> None:
    sent: list[dict[str, Any]] = []
    model = _model(sent, min_p=0.1)
    list(model.stream([HumanMessage("hi")]))
    assert sent[0]["think"] is None
    assert sent[0]["options"] == {"min_p": 0.1}
    assert set(sent[0]) == {
        "messages",
        "stream",
        "model",
        "think",
        "format",
        "logprobs",
        "top_logprobs",
        "options",
        "keep_alive",
    }


def test_the_answer_message_carries_the_thinking() -> None:
    sent: list[dict[str, Any]] = []
    answer = _model(sent).invoke([HumanMessage("What is 17*23?")])
    assert answer.content == "391"
    assert answer.additional_kwargs["reasoning_content"] == "17 times 23"


async def test_thinking_is_kept_when_streaming_async() -> None:
    sent: list[dict[str, Any]] = []
    chunks = [c async for c in _model(sent).astream([HumanMessage("hi")])]
    thinking = "".join(c.additional_kwargs.get("reasoning_content", "") for c in chunks)
    assert thinking == "17 times 23"
    assert sent[0]["think"] is None


def test_a_set_reasoning_is_sent_as_the_library_sends_it() -> None:
    sent: list[dict[str, Any]] = []
    list(_model(sent, reasoning=True).stream([HumanMessage("hi")]))
    assert sent[0]["think"] is True


def test_an_off_reasoning_is_sent_as_off() -> None:
    sent: list[dict[str, Any]] = []
    list(_model(sent, reasoning=False).stream([HumanMessage("hi")]))
    assert sent[0]["think"] is False


def test_earlier_thinking_goes_back_as_the_library_sends_it() -> None:
    sent: list[dict[str, Any]] = []
    history = [
        HumanMessage("q"),
        AIMessage("a", additional_kwargs={"reasoning_content": "hmm"}),
        HumanMessage("again"),
    ]
    list(_model(sent).stream(history))
    assert [m.get("thinking") for m in sent[0]["messages"]] == [None, "hmm", None]


def test_think_false_is_sent_and_a_level_is_sent_as_it_is() -> None:
    for reasoning in (False, True, "high"):
        sent: list[dict[str, Any]] = []
        list(_model(sent, reasoning=reasoning).stream([HumanMessage("What is 17*23?")]))
        assert sent[0]["think"] == reasoning
