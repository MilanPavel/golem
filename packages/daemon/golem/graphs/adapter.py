"""Turn LangGraph stream parts into facts the runner can emit.

The adapter sees LangChain message chunks and golem's own custom-stream
items only. Provider clients stay in the model router.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, cast

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage

STREAM_KEY = "golem"
"""Key of every golem item on the custom stream. The graph writes, the adapter reads."""


@dataclass(frozen=True, slots=True)
class ModelStarted:
    """A model call began. Its reply will have ``message_id``."""

    message_id: str


@dataclass(frozen=True, slots=True)
class TextDelta:
    """Incremental assistant text. Empty chunks are not represented."""

    text: str


@dataclass(frozen=True, slots=True)
class RequestedCall:
    call_id: str
    name: str
    args: dict[str, object]


@dataclass(frozen=True, slots=True)
class TextCompleted:
    """Final text of one model call, from the ``call_model`` update, and the tools it asked for."""

    text: str
    message_id: str | None = None
    calls: tuple[RequestedCall, ...] = field(default=())


@dataclass(frozen=True, slots=True)
class ToolStarted:
    call_id: str


@dataclass(frozen=True, slots=True)
class ToolFinished:
    call_id: str
    summary: str
    preview: str
    truncated: bool


@dataclass(frozen=True, slots=True)
class ToolErrored:
    call_id: str
    message: str


Fact = ModelStarted | TextDelta | TextCompleted | ToolStarted | ToolFinished | ToolErrored


def translate(part: object) -> Fact | None:
    """Map one ``astream(..., version="v2")`` part to a fact, or nothing."""
    if not isinstance(part, dict):
        return None
    raw = cast(dict[object, object], part)
    kind = raw.get("type")
    if kind == "messages":
        return _delta(raw.get("data"))
    if kind == "updates":
        return _completed(raw.get("data"))
    if kind == "custom":
        return _custom(raw.get("data"))
    return None


_ROLES: dict[str, Literal["user", "assistant", "system", "tool"]] = {
    "human": "user",
    "ai": "assistant",
    "system": "system",
    "tool": "tool",
}


@dataclass(frozen=True, slots=True)
class PlainMessage:
    """A checkpoint message with the provider types removed."""

    role: Literal["user", "assistant", "system", "tool"]
    text: str


def plain_messages(values: Mapping[str, object]) -> list[PlainMessage]:
    """Messages stored for a session, in checkpoint order.

    A reply that called tools lists each call as ``→ name(args)`` after its text.
    """
    raw = values.get("messages")
    if not isinstance(raw, list):
        return []
    found: list[PlainMessage] = []
    for item in cast(list[object], raw):
        if not isinstance(item, BaseMessage):
            continue
        role = _ROLES.get(item.type)
        if role is None:
            continue
        text = message_text(item)
        if isinstance(item, AIMessage) and item.tool_calls:
            calls = [f"→ {call['name']}({_args_text(call['args'])})" for call in item.tool_calls]
            text = "\n".join([text, *calls] if text else calls)
        found.append(PlainMessage(role, text))
    return found


def message_text(message: BaseMessage) -> str:
    """Provider-neutral text. List content is read via ``BaseMessage.text``."""
    text = message.text
    if text != "":
        return text
    content = message.content
    if isinstance(content, str):
        return content
    return ""


def _args_text(args: Mapping[str, object]) -> str:
    return ", ".join(
        f"{key}={json.dumps(value, ensure_ascii=False)}" for key, value in args.items()
    )


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
            calls = tuple(
                RequestedCall(
                    call_id=call.get("id") or "",
                    name=call["name"],
                    args=dict(call["args"]),
                )
                for call in message.tool_calls
            )
            return TextCompleted(message_text(message), message.id, calls)
    return None


def _custom(data: object) -> Fact | None:
    if not isinstance(data, dict):
        return None
    item = cast(dict[str, object], data)
    kind = item.get(STREAM_KEY)
    message_id = item.get("message_id")
    call_id = item.get("call_id")
    if kind == "model.started" and isinstance(message_id, str):
        return ModelStarted(message_id)
    if not isinstance(call_id, str):
        return None
    if kind == "tool.started":
        return ToolStarted(call_id)
    if kind == "tool.completed":
        summary = item.get("summary")
        preview = item.get("preview")
        return ToolFinished(
            call_id,
            summary if isinstance(summary, str) else "",
            preview if isinstance(preview, str) else "",
            item.get("truncated") is True,
        )
    if kind == "tool.failed":
        message = item.get("message")
        return ToolErrored(call_id, message if isinstance(message, str) and message else "failed")
    return None


__all__ = [
    "STREAM_KEY",
    "Fact",
    "ModelStarted",
    "PlainMessage",
    "RequestedCall",
    "TextCompleted",
    "TextDelta",
    "ToolErrored",
    "ToolFinished",
    "ToolStarted",
    "message_text",
    "plain_messages",
    "translate",
]
