"""Turn LangGraph stream parts into text facts.

The adapter sees LangChain message chunks only. Provider clients stay in the
model router.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage


@dataclass(frozen=True, slots=True)
class TextDelta:
    """Incremental assistant text. Empty chunks are not represented."""

    text: str


@dataclass(frozen=True, slots=True)
class TextCompleted:
    """Final assistant text from the ``call_model`` update."""

    text: str


def translate(part: object) -> TextDelta | TextCompleted | None:
    """Map one ``astream(..., version="v2")`` part to a text fact, or nothing."""
    if not isinstance(part, dict):
        return None
    raw = cast(dict[object, object], part)
    kind = raw.get("type")
    if kind == "messages":
        return _delta(raw.get("data"))
    if kind == "updates":
        return _completed(raw.get("data"))
    return None


def message_text(message: BaseMessage) -> str:
    """Provider-neutral text. List content is read via ``BaseMessage.text``."""
    text = message.text
    if text != "":
        return text
    content = message.content
    if isinstance(content, str):
        return content
    return ""


def _pair(data: object) -> tuple[object, object] | None:
    if isinstance(data, tuple):
        items = cast(tuple[object, ...], data)
    elif isinstance(data, list):
        items = tuple(cast(list[object], data))
    else:
        return None
    if len(items) < 2:
        return None
    return items[0], items[1]


def _delta(data: object) -> TextDelta | None:
    pair = _pair(data)
    if pair is None:
        return None
    chunk, metadata = pair
    if isinstance(metadata, dict):
        node = cast(dict[object, object], metadata).get("langgraph_node")
        if isinstance(node, str) and node != "call_model":
            return None
    if not isinstance(chunk, AIMessageChunk):
        return None
    text = message_text(chunk)
    if text == "":
        return None
    return TextDelta(text)


def _completed(data: object) -> TextCompleted | None:
    if not isinstance(data, dict):
        return None
    update = cast(dict[object, object], data).get("call_model")
    if not isinstance(update, dict):
        return None
    messages = cast(dict[object, object], update).get("messages")
    if not isinstance(messages, list):
        return None
    for message in reversed(cast(list[object], messages)):
        if isinstance(message, AIMessage):
            return TextCompleted(message_text(message))
    return None
