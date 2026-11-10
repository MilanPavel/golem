"""Turn LangGraph stream parts into facts the runner can emit.

The adapter sees LangChain message chunks and golem's own custom-stream
items only. Provider clients stay in the model router.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, cast

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolMessage

from golem_protocol.commands import TraceMessage

STREAM_KEY = "golem"
"""Key of every golem item on the custom stream. The graph writes, the adapter reads."""

PIN_READ_KIND = "skill.pin_read"
"""``STREAM_KEY`` value of a model call's report that it read a pinned skill."""

PIN_SKIPPED_KIND = "skill.pin_skipped"
"""``STREAM_KEY`` value of a model call's report that it left a pinned skill out."""

APPROVAL_KIND = "approval"
"""``STREAM_KEY`` value of an interrupt that waits for a tool approval."""


@dataclass(frozen=True, slots=True)
class ModelStarted:
    """A model call began. Its reply will have ``message_id``."""

    message_id: str


@dataclass(frozen=True, slots=True)
class ModelRequested:
    """The request of the model call with this ``message_id`` is about to be sent.

    ``system_prompt_sha`` and ``tools_sha`` are the hashes of the stored system
    prompt and tool schemas, and ``message_ids`` the history sent.

    ``context_window`` is the tokens the model can take in, ``num_ctx`` the
    Ollama option sent, and ``system_sections`` the ``(name, chars)`` of each
    non-empty section of the system prompt. Each is None when unknown.
    ``window_estimated`` is true when golem did not send the window and read it
    from Ollama.

    The size fields are the characters and UTF-8 bytes of what was sent, or None
    when not given.
    """

    message_id: str
    system_prompt_sha: str | None = None
    tools_sha: str | None = None
    message_ids: tuple[str, ...] = ()
    context_window: int | None = None
    num_ctx: int | None = None
    window_estimated: bool = False
    system_sections: tuple[tuple[str, int], ...] | None = None
    system_chars: int | None = None
    system_bytes: int | None = None
    tools_chars: int | None = None
    tools_bytes: int | None = None
    message_chars: tuple[int, ...] | None = None
    message_bytes: tuple[int, ...] | None = None


@dataclass(frozen=True, slots=True)
class ModelResponded:
    """The model call with this ``message_id`` returned.

    ``context_window`` is the window it ran with, read from the model server after
    the call. None when it could not be read.
    """

    message_id: str
    context_window: int | None = None


@dataclass(frozen=True, slots=True)
class TextDelta:
    """Incremental assistant text. Empty chunks are not represented."""

    text: str


@dataclass(frozen=True, slots=True)
class ThinkingDelta:
    """Incremental thinking text, kept apart from the answer."""

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
    usage: dict[str, int] | None = None
    stop_reason: str | None = None
    thinking: str | None = None
    """The whole thinking text of the call, None when the model did not think."""


@dataclass(frozen=True, slots=True)
class ToolStarted:
    call_id: str


@dataclass(frozen=True, slots=True)
class ToolOutput:
    call_id: str
    text: str


@dataclass(frozen=True, slots=True)
class ToolFinished:
    call_id: str
    summary: str
    preview: str
    truncated: bool
    artifact_id: str | None = None
    failed: bool = False
    duration_ms: int | None = None


@dataclass(frozen=True, slots=True)
class ToolErrored:
    call_id: str
    message: str
    duration_ms: int | None = None


@dataclass(frozen=True, slots=True)
class TodosChanged:
    """``todo_write`` replaced the agent's todo list."""

    call_id: str
    todos: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class ApprovalAsked:
    """The run paused on a tool call that needs the user's answer."""

    call_id: str
    name: str
    args: dict[str, object]
    source: str
    message_id: str | None = None
    subject: str | None = None
    diff: str | None = None


@dataclass(frozen=True, slots=True)
class PinRead:
    """A model call read a pinned skill's ``SKILL.md``, with this ``hash``."""

    name: str
    source: str
    path: str
    hash: str


@dataclass(frozen=True, slots=True)
class PinSkipped:
    """A model call left a pinned skill out of the system prompt."""

    name: str
    reason: str
    message: str


Fact = (
    ModelStarted
    | ModelRequested
    | ModelResponded
    | TextDelta
    | ThinkingDelta
    | TextCompleted
    | ToolStarted
    | ToolOutput
    | ToolFinished
    | ToolErrored
    | ApprovalAsked
    | TodosChanged
    | PinRead
    | PinSkipped
)


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


def trace_messages(values: Mapping[str, object]) -> list[TraceMessage]:
    """Messages stored for a session with their ids, tool calls, and call ids.

    Unlike :func:`plain_messages`, a reply's tool calls stay apart from its
    text, and system messages are left out.
    """
    raw = values.get("messages")
    if not isinstance(raw, list):
        return []
    found: list[TraceMessage] = []
    for item in cast(list[object], raw):
        if not isinstance(item, BaseMessage):
            continue
        role = _ROLES.get(item.type)
        if role is None or role == "system":
            continue
        calls: list[dict[str, object]] = []
        if isinstance(item, AIMessage):
            calls = [
                {"call_id": call.get("id"), "name": call["name"], "args": call["args"]}
                for call in item.tool_calls
            ]
        found.append(
            TraceMessage(
                id=item.id,
                role=role,
                text=message_text(item),
                tool_calls=calls,
                call_id=item.tool_call_id if isinstance(item, ToolMessage) else None,
            )
        )
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


def _chunk(data: object) -> AIMessageChunk | None:
    """The chunk of a ``messages`` part that the model call streamed, if it is one."""
    pair = _pair(data)
    if pair is None:
        return None
    chunk, metadata = pair
    if isinstance(metadata, dict):
        node = cast(dict[object, object], metadata).get("langgraph_node")
        if isinstance(node, str) and node != "call_model":
            return None
    return chunk if isinstance(chunk, AIMessageChunk) else None


def _delta(data: object) -> TextDelta | None:
    chunk = _chunk(data)
    if chunk is None:
        return None
    text = message_text(chunk)
    if text == "":
        return None
    return TextDelta(text)


def _reasoning(message: BaseMessage) -> str:
    """The thinking a provider returned apart from the content, or an empty string."""
    kept = message.additional_kwargs.get("reasoning_content")
    return kept if isinstance(kept, str) else ""


THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"


def split_think(text: str) -> tuple[str, str]:
    """``(thinking, answer)`` of a whole answer.

    Content that starts with ``<think>`` holds thinking up to ``</think>``. With
    no close tag, all of it is thinking. Otherwise the text is the answer.
    """
    if not text.startswith(THINK_OPEN):
        return "", text
    inner = text[len(THINK_OPEN) :]
    thinking, closed, answer = inner.partition(THINK_CLOSE)
    return (thinking, answer.lstrip()) if closed else (inner, "")


class _ThinkSplitter:
    """Splits streamed content into thinking and answer fragments.

    Only content that *starts* with ``<think>`` holds thinking. The tag can arrive
    split across chunks, so text that could still become the open tag, or the close
    tag, is held back until the next chunk decides it. :meth:`finish` returns what
    is still held.
    """

    def __init__(self) -> None:
        self._mode: Literal["start", "thinking", "answer"] = "start"
        self._held = ""
        self._trim = False

    def feed(self, text: str) -> list[ThinkingDelta | TextDelta]:
        out: list[ThinkingDelta | TextDelta] = []
        self._held += text
        while self._held:
            if self._mode == "start":
                if self._held.startswith(THINK_OPEN):
                    self._held = self._held[len(THINK_OPEN) :]
                    self._mode = "thinking"
                elif THINK_OPEN.startswith(self._held):
                    break
                else:
                    self._mode = "answer"
            elif self._mode == "thinking":
                before, closed, after = self._held.partition(THINK_CLOSE)
                if closed:
                    _add(out, ThinkingDelta, before)
                    self._held = after
                    self._mode = "answer"
                    self._trim = True
                    continue
                keep = _partial_suffix(self._held, THINK_CLOSE)
                _add(out, ThinkingDelta, self._held[: len(self._held) - keep])
                self._held = self._held[len(self._held) - keep :]
                break
            else:
                held, self._held = self._held, ""
                if self._trim:
                    held = held.lstrip()
                    self._trim = held == ""
                _add(out, TextDelta, held)
        return out

    def finish(self) -> list[ThinkingDelta | TextDelta]:
        """What was held when the call ended: an unfinished tag is part of its mode's text."""
        out: list[ThinkingDelta | TextDelta] = []
        held, self._held = self._held, ""
        _add(out, ThinkingDelta if self._mode == "thinking" else TextDelta, held)
        self._mode = "start"
        self._trim = False
        return out


def _add(
    out: list[ThinkingDelta | TextDelta],
    kind: type[ThinkingDelta] | type[TextDelta],
    text: str,
) -> None:
    if text:
        out.append(kind(text))


def _partial_suffix(text: str, tag: str) -> int:
    """Length of the longest suffix of ``text`` that is a proper prefix of ``tag``."""
    for size in range(min(len(tag) - 1, len(text)), 0, -1):
        if text.endswith(tag[:size]):
            return size
    return 0


class Translator:
    """:func:`translate` that also separates thinking from the answer while streaming.

    A chunk's ``reasoning_content`` becomes a :class:`ThinkingDelta`. Content that
    starts with ``<think>`` is split into thinking and answer, across chunks. One
    translator serves one run, and a new model call starts it over.
    """

    def __init__(self) -> None:
        self._split = _ThinkSplitter()

    def __call__(self, part: object) -> list[Fact]:
        if isinstance(part, dict):
            raw = cast(dict[object, object], part)
            kind = raw.get("type")
            if kind == "messages":
                return self._streamed(raw.get("data"))
            fact = translate(raw)
            if isinstance(fact, TextCompleted):
                return [*self._split.finish(), fact]
            if isinstance(fact, ModelStarted):
                self._split.finish()
            return [] if fact is None else [fact]
        return []

    def _streamed(self, data: object) -> list[Fact]:
        chunk = _chunk(data)
        if chunk is None:
            return []
        facts: list[Fact] = []
        kept = _reasoning(chunk)
        if kept:
            facts.append(ThinkingDelta(kept))
        text = message_text(chunk)
        if text:
            facts.extend(self._split.feed(text))
        return facts


def _completed(data: object) -> TextCompleted | ApprovalAsked | None:
    if not isinstance(data, dict):
        return None
    paused = cast(dict[object, object], data).get("__interrupt__")
    if paused is not None:
        return _approval(paused)
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
            thinking, text = split_think(message_text(message))
            kept = _reasoning(message)
            return TextCompleted(
                text,
                message.id,
                calls,
                _usage(message),
                _stop_reason(message),
                (kept + thinking) or None,
            )
    return None


def _usage(message: AIMessage) -> dict[str, int] | None:
    """Token counts of ``message``: ``input``, ``output``, ``cache_read``, ``cache_write``."""
    raw = message.usage_metadata
    if raw is None:
        return None
    usage: dict[str, int] = {}
    for key, name in (("input_tokens", "input"), ("output_tokens", "output")):
        count = raw.get(key)
        if isinstance(count, int):
            usage[name] = count
    details = raw.get("input_token_details")
    if details:
        for key, name in (("cache_read", "cache_read"), ("cache_creation", "cache_write")):
            count = details.get(key)
            if isinstance(count, int):
                usage[name] = count
    return usage or None


def _stop_reason(message: AIMessage) -> str | None:
    """Why the model stopped: Anthropic's ``stop_reason`` or OpenAI's ``finish_reason``."""
    for key in ("stop_reason", "finish_reason"):
        reason = message.response_metadata.get(key)
        if isinstance(reason, str) and reason:
            return reason
    return None


def _approval(paused: object) -> ApprovalAsked | None:
    items = cast(tuple[object, ...], paused) if isinstance(paused, tuple | list) else ()
    for item in items:
        value = getattr(item, "value", None)
        if not isinstance(value, dict):
            continue
        raw = cast(dict[str, object], value)
        call_id, name, source = raw.get("call_id"), raw.get("name"), raw.get("source")
        if raw.get(STREAM_KEY) != APPROVAL_KIND or not isinstance(call_id, str):
            continue
        if not isinstance(name, str) or not isinstance(source, str):
            continue
        args = raw.get("args")
        message_id = raw.get("message_id")
        subject = raw.get("subject")
        diff = raw.get("diff")
        return ApprovalAsked(
            call_id=call_id,
            name=name,
            args=dict(cast(dict[str, object], args)) if isinstance(args, dict) else {},
            source=source,
            message_id=message_id if isinstance(message_id, str) else None,
            subject=subject if isinstance(subject, str) else None,
            diff=diff if isinstance(diff, str) else None,
        )
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
    if kind == "model.request" and isinstance(message_id, str):
        return _request(message_id, item)
    if kind == "model.response" and isinstance(message_id, str):
        return ModelResponded(message_id, _positive(item.get("context_window")))
    if kind in (PIN_READ_KIND, PIN_SKIPPED_KIND):
        return _pin(kind, item)
    if not isinstance(call_id, str):
        return None
    if kind == "tool.started":
        return ToolStarted(call_id)
    if kind == "tool.output":
        text = item.get("text")
        return ToolOutput(call_id, text) if isinstance(text, str) and text else None
    if kind == "tool.completed":
        summary = item.get("summary")
        preview = item.get("preview")
        artifact_id = item.get("artifact_id")
        return ToolFinished(
            call_id,
            summary if isinstance(summary, str) else "",
            preview if isinstance(preview, str) else "",
            item.get("truncated") is True,
            artifact_id if isinstance(artifact_id, str) else None,
            item.get("failed") is True,
            _duration(item),
        )
    if kind == "todos.updated":
        todos = item.get("todos")
        if not isinstance(todos, list):
            return None
        rows = tuple(
            dict(cast(dict[str, object], row))
            for row in cast(list[object], todos)
            if isinstance(row, dict)
        )
        return TodosChanged(call_id, rows)
    if kind == "tool.failed":
        message = item.get("message")
        return ToolErrored(
            call_id, message if isinstance(message, str) and message else "failed", _duration(item)
        )
    return None


def _duration(item: Mapping[str, object]) -> int | None:
    value = item.get("duration_ms")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _request(message_id: str, item: Mapping[str, object]) -> ModelRequested:
    system, tools, ids = (
        item.get("system_prompt_sha"),
        item.get("tools_sha"),
        item.get("message_ids"),
    )
    return ModelRequested(
        message_id,
        system if isinstance(system, str) else None,
        tools if isinstance(tools, str) else None,
        tuple(i for i in cast(list[object], ids) if isinstance(i, str))
        if isinstance(ids, list)
        else (),
        _positive(item.get("context_window")),
        _positive(item.get("num_ctx")),
        item.get("window_estimated") is True,
        _sections(item.get("system_sections")),
        _count(item.get("system_chars")),
        _count(item.get("system_bytes")),
        _count(item.get("tools_chars")),
        _count(item.get("tools_bytes")),
        _counts(item.get("message_chars")),
        _counts(item.get("message_bytes")),
    )


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _counts(value: object) -> tuple[int, ...] | None:
    if not isinstance(value, list):
        return None
    found = [_count(v) for v in cast(list[object], value)]
    return None if any(v is None for v in found) else tuple(v for v in found if v is not None)


def _positive(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _sections(value: object) -> tuple[tuple[str, int], ...] | None:
    if not isinstance(value, list):
        return None
    found: list[tuple[str, int]] = []
    for entry in cast(list[object], value):
        if not isinstance(entry, dict):
            continue
        name, chars = (
            cast(dict[str, object], entry).get("name"),
            cast(dict[str, object], entry).get("chars"),
        )
        if (
            isinstance(name, str)
            and name
            and isinstance(chars, int)
            and not isinstance(chars, bool)
            and chars >= 0
        ):
            found.append((name, chars))
    return tuple(found) or None


def _pin(kind: object, item: Mapping[str, object]) -> PinRead | PinSkipped | None:
    fields = (
        ("name", "source", "path", "hash")
        if kind == PIN_READ_KIND
        else ("name", "reason", "message")
    )
    values = [item.get(key) for key in fields]
    strings = [value for value in values if isinstance(value, str) and value]
    if len(strings) != len(fields):
        return None
    return PinRead(*strings) if kind == PIN_READ_KIND else PinSkipped(*strings)


__all__ = [
    "APPROVAL_KIND",
    "PIN_READ_KIND",
    "PIN_SKIPPED_KIND",
    "STREAM_KEY",
    "ApprovalAsked",
    "Fact",
    "ModelRequested",
    "ModelResponded",
    "ModelStarted",
    "PinRead",
    "PinSkipped",
    "PlainMessage",
    "RequestedCall",
    "TextCompleted",
    "TextDelta",
    "ThinkingDelta",
    "TodosChanged",
    "ToolErrored",
    "ToolFinished",
    "ToolOutput",
    "ToolStarted",
    "Translator",
    "message_text",
    "plain_messages",
    "split_think",
    "translate",
]
