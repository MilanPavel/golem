"""A reply with one provider's own content parts is sent to another provider as text."""

from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_ollama import ChatOllama

from golem.graphs.chat import _portable  # pyright: ignore[reportPrivateUsage]

_CALL = {"name": "read_file", "args": {"path": "a.py"}, "id": "call_1", "type": "tool_call"}


def _openai_reply() -> AIMessage:
    return AIMessage(
        content=[
            {"type": "reasoning", "id": "rs_1", "summary": []},
            {"type": "text", "text": "I will read the file."},
            {"type": "function_call", "name": "read_file", "arguments": "{}", "call_id": "call_1"},
        ],
        tool_calls=[_CALL],
        response_metadata={"model_provider": "openai"},
        id="m1",
    )


def _history() -> list[BaseMessage]:
    return [
        HumanMessage(content="read a.py"),
        _openai_reply(),
        ToolMessage(content="x = 1", tool_call_id="call_1"),
    ]


def test_ollama_refuses_the_parts_as_they_are_stored() -> None:
    model = ChatOllama(model="llama3.2:3b")
    with pytest.raises(ValueError, match="Unsupported message content type"):
        model._convert_messages_to_ollama_messages(_history())  # pyright: ignore[reportPrivateUsage]


def test_a_reply_of_another_provider_is_sent_as_its_text_with_its_tool_calls() -> None:
    sent = _portable(_history(), "ollama")

    reply = sent[1]
    assert isinstance(reply, AIMessage)
    assert reply.content == "I will read the file."
    assert reply.tool_calls == [_CALL]
    assert reply.id == "m1"
    model = ChatOllama(model="llama3.2:3b")
    wire = model._convert_messages_to_ollama_messages(sent)  # pyright: ignore[reportPrivateUsage]
    assert [m["role"] for m in wire] == ["user", "assistant", "tool"]


def test_the_stored_reply_keeps_its_parts() -> None:
    history = _history()

    _portable(history, "ollama")

    assert isinstance(history[1].content, list)
    assert len(history[1].content) == 3


def test_a_reply_goes_back_to_its_own_provider_unchanged() -> None:
    history = _history()

    assert _portable(history, "openai")[1] is history[1]


def test_google_is_known_by_the_librarys_name() -> None:
    reply = AIMessage(
        content=[{"type": "text", "text": "hi", "extras": {"signature": "s"}}],
        response_metadata={"model_provider": "google_genai"},
    )

    assert _portable([reply], "google")[0] is reply
    assert _portable([reply], "anthropic")[0].content == "hi"


def test_a_reply_with_no_known_writer_and_a_call_with_no_known_kind_stay() -> None:
    unknown = AIMessage(content=[{"type": "text", "text": "hi"}])
    history = _history()

    assert _portable([unknown], "ollama")[0] is unknown
    assert _portable(history, None)[1] is history[1]


def test_a_reply_that_is_plain_text_is_not_copied() -> None:
    reply = AIMessage(content="hi", response_metadata={"model_provider": "openai"})

    assert _portable([reply], "ollama")[0] is reply
