"""Turn LangGraph stream parts into facts the runner can emit.

The adapter sees LangChain message chunks and golem's own custom-stream
items only. Provider clients stay in the model router.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal, cast

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolMessage

from golem.graphs.partial_args import partial_field, partial_string
from golem_protocol.commands import TraceMessage

STREAM_KEY = "golem"
"""Key of every golem item on the custom stream. The graph writes, the adapter reads."""

PIN_READ_KIND = "skill.pin_read"
"""``STREAM_KEY`` value of a model call's report that it read a pinned skill."""

PIN_SKIPPED_KIND = "skill.pin_skipped"
"""``STREAM_KEY`` value of a model call's report that it left a pinned skill out."""

SKILL_LOADED_KIND = "skill.loaded"
PLAN_PROPOSED_KIND = "plan.proposed"
"""``STREAM_KEY`` value of a tool call that loaded a skill for the model."""

FILE_CHANGED_KIND = "file.changed"
"""``STREAM_KEY`` value of a tool call that wrote a file, with the text before and after."""

APPROVAL_KIND = "approval"
"""``STREAM_KEY`` value of an interrupt that waits for a tool approval."""

CHILD_FACT_KIND = "child.fact"
"""``STREAM_KEY`` value of a fact of a child run, carried on its parent's stream."""


@dataclass(frozen=True, slots=True)
class ModelStarted:
    """A model call began. Its reply will have ``message_id``."""

    message_id: str


@dataclass(frozen=True, slots=True)
class ModelWaiting:
    """The call with this ``message_id`` waits, or stopped waiting, for the local model.

    ``model`` and ``window`` are set while it loads the model again with a larger window.
    """

    message_id: str
    waiting: bool
    model: str | None = None
    window: int | None = None


@dataclass(frozen=True, slots=True)
class ModelRequested:
    """The request of the model call with this ``message_id`` is about to be sent.

    ``system_prompt_sha`` and ``tools_sha`` are the hashes of the stored system
    prompt and tool schemas, and ``message_ids`` the history sent.

    ``context_window`` is the tokens the model can take in, ``num_ctx`` the
    Ollama option sent, and ``system_sections`` the ``(name, chars)`` of each
    non-empty section of the system prompt. Each is None when unknown.
    ``window_estimated`` is true when golem did not send the window and read it
    from Ollama. ``window_planned`` is true when golem chose the ``num_ctx``.

    The size fields are the characters and UTF-8 bytes of what was sent, or None
    when not given. ``profile`` is the profile this call uses, or None when not given.
    ``cleared_ids`` are the tool results sent as a one-line stub. ``summary_chars`` is the
    length of the summary sent as the first message, or None. ``estimated_tokens`` is the
    prompt as golem estimated it before sending, or None.
    """

    message_id: str
    system_prompt_sha: str | None = None
    tools_sha: str | None = None
    message_ids: tuple[str, ...] = ()
    context_window: int | None = None
    num_ctx: int | None = None
    window_estimated: bool = False
    window_planned: bool = False
    system_sections: tuple[tuple[str, int], ...] | None = None
    system_chars: int | None = None
    system_bytes: int | None = None
    tools_chars: int | None = None
    tools_bytes: int | None = None
    message_chars: tuple[int, ...] | None = None
    message_bytes: tuple[int, ...] | None = None
    profile: str | None = None
    cleared_ids: tuple[str, ...] = ()
    summary_chars: int | None = None
    estimated_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class ContextChanged:
    """The context view changed before a model call: old tool results were cleared, old
    turns were summarised, or the window of the local model grew.

    The token counts are rough. ``count`` is the number of results cleared, or of messages
    the summary stands for. For ``grew``, the windows before and after, and the reload time.
    """

    action: Literal["cleared", "summarised", "grew"]
    before_tokens: int | None = None
    after_tokens: int | None = None
    count: int | None = None
    room: int | None = None
    window_from: int | None = None
    window_to: int | None = None
    reload_ms: int | None = None


@dataclass(frozen=True, slots=True)
class ModelRouted:
    """The run moved to another model in the middle of a call sequence.

    ``rejected`` is ``(ref, tier, why)`` for each candidate the pick dropped.
    """

    profile: str
    tier: Literal["local", "budget", "frontier"]
    reason: Literal["escalated", "fallback"]
    detail: str
    rejected: tuple[tuple[str, Literal["local", "budget", "frontier"], str], ...] = ()


@dataclass(frozen=True, slots=True)
class ModelResponded:
    """The model call with this ``message_id`` returned.

    ``context_window`` is the window it ran with, read from the model server after
    the call. None when it could not be read. ``text_tool_calls`` says what became of a
    tool call the model wrote as text: ``recovered`` or ``unread``. None when there was none.
    """

    message_id: str
    context_window: int | None = None
    text_tool_calls: Literal["recovered", "unread"] | None = None
    timings: Mapping[str, int] = field(default_factory=dict[str, int])
    """The model server's own numbers: ``load_ms``, ``prompt_ms``, ``reply_ms``,
    ``prompt_tokens``, ``reply_tokens``. Each may be absent. Ollama only."""


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
class ToolWriting:
    """How far the model got writing a file tool call, from its streamed arguments.

    ``path`` is set once the model has written all of it. ``lines`` and ``chars``
    count the file text so far: ``content`` of ``write_file``, ``new_string`` of ``edit_file``.
    """

    index: int
    name: str
    path: str | None
    lines: int
    chars: int


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
    diff: str | None = None


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
class FileChanged:
    """A tool wrote a file. ``before`` and ``after`` are whole texts, for the store only."""

    call_id: str | None
    path: str
    before: str | None
    after: str | None
    source: Literal["tool", "shell", "revert"]


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
class PlanProposed:
    """``propose_plan`` ended a plan first run with this plan."""

    call_id: str
    plan_id: str
    title: str
    steps: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class PinRead:
    """A model call read a pinned skill's ``SKILL.md``, with this ``hash``."""

    name: str
    source: str
    path: str
    hash: str


@dataclass(frozen=True, slots=True)
class SkillLoaded:
    """``load_skill`` gave the model a skill's body. ``hash`` is that of its ``SKILL.md``."""

    call_id: str
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


@dataclass(frozen=True, slots=True)
class CheckOffered:
    """The turn changed files and the session has not said whether the checks may run."""

    checks: tuple[tuple[str, str], ...]
    """``(name, command)`` of each check."""


@dataclass(frozen=True, slots=True)
class CheckStarted:
    check_id: str
    name: str
    command: str
    round: int = 0


@dataclass(frozen=True, slots=True)
class CheckCompleted:
    check_id: str
    name: str
    status: str
    exit_code: int | None
    duration_ms: int
    output: str
    artifact_id: str | None = None
    round: int = 0


@dataclass(frozen=True, slots=True)
class ChildFact:
    """A fact of the child run started by the ``delegate`` call ``parent_call_id``."""

    parent_call_id: str
    fact: object


Fact = (
    ModelStarted
    | ModelWaiting
    | ModelRouted
    | ModelRequested
    | ModelResponded
    | ContextChanged
    | TextDelta
    | ThinkingDelta
    | ToolWriting
    | TextCompleted
    | ToolStarted
    | ToolOutput
    | ToolFinished
    | ToolErrored
    | ApprovalAsked
    | TodosChanged
    | PlanProposed
    | FileChanged
    | PinRead
    | PinSkipped
    | SkillLoaded
    | CheckOffered
    | CheckStarted
    | CheckCompleted
    | ChildFact
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


WRITING_FIELDS = {"write_file": "content", "edit_file": "new_string"}
"""The tools whose writing is reported, and the argument that holds the file text."""

WRITING_EVERY = 1.0
"""Seconds between two :class:`ToolWriting` facts of one call."""


@dataclass
class _Writing:
    """The streamed call at one ``index``: its name, and its argument text in pieces."""

    name: str = ""
    args: list[str] = field(default_factory=list[str])
    sent_at: float | None = None


class Translator:
    """:func:`translate` that also separates thinking from the answer while streaming.

    A chunk's ``reasoning_content`` becomes a :class:`ThinkingDelta`. Content that
    starts with ``<think>`` is split into thinking and answer, across chunks. One
    translator serves one run, and a new model call starts it over.

    The ``tool_call_chunks`` of a ``write_file`` or ``edit_file`` call become a
    :class:`ToolWriting`, at most once per second per call. ``clock`` is in seconds.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._split = _ThinkSplitter()
        self._clock = clock
        self._writing: dict[int, _Writing] = {}

    def __call__(self, part: object) -> list[Fact]:
        if isinstance(part, dict):
            raw = cast(dict[object, object], part)
            kind = raw.get("type")
            if kind == "messages":
                return self._streamed(raw.get("data"))
            fact = translate(raw)
            if isinstance(fact, TextCompleted):
                self._writing.clear()
                return [*self._split.finish(), fact]
            if isinstance(fact, ModelStarted):
                self._split.finish()
                self._writing.clear()
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
        facts.extend(self._writes(chunk))
        return facts

    def _writes(self, chunk: AIMessageChunk) -> list[Fact]:
        """Collect the tool-call pieces of ``chunk``, and report the file calls that are due."""
        due: list[int] = []
        for piece in chunk.tool_call_chunks:
            index = piece.get("index")
            index = index if isinstance(index, int) else 0
            call = self._writing.setdefault(index, _Writing())
            name = piece.get("name")
            if name:
                call.name = name
            args = piece.get("args")
            if args:
                call.args.append(args)
            if call.name in WRITING_FIELDS and index not in due:
                due.append(index)
        facts: list[Fact] = []
        now = self._clock()
        for index in due:
            call = self._writing[index]
            if call.sent_at is not None and now - call.sent_at < WRITING_EVERY:
                continue
            call.sent_at = now
            facts.append(_writing_fact(index, call))
        return facts


def _writing_fact(index: int, call: _Writing) -> ToolWriting:
    """What ``call`` has written so far. The text is read only when a fact is due, not per chunk."""
    text = "".join(call.args)
    path = partial_field(text, "path")
    body = partial_string(text, WRITING_FIELDS[call.name]) or ""
    return ToolWriting(
        index=index,
        name=call.name,
        path=path[0] if path is not None and path[1] else None,
        lines=len(body.splitlines()),
        chars=len(body),
    )


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
                stop_reason_of(message),
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


def stop_reason_of(message: AIMessage) -> str | None:
    """Why the model stopped.

    Anthropic's ``stop_reason``, OpenAI's ``finish_reason``, or Ollama's ``done_reason``,
    in that order.
    """
    for key in ("stop_reason", "finish_reason", "done_reason"):
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


_TIERS = ("local", "budget", "frontier")
_TierName = Literal["local", "budget", "frontier"]


def _routed_fact(item: dict[str, object]) -> ModelRouted | None:
    profile, tier, reason = item.get("profile"), item.get("tier"), item.get("reason")
    detail = item.get("detail")
    if not isinstance(profile, str) or tier not in _TIERS:
        return None
    if reason not in ("escalated", "fallback"):
        return None
    rejected: list[tuple[str, _TierName, str]] = []
    raw = item.get("rejected")
    for entry in cast(list[object], raw) if isinstance(raw, list) else []:
        row = cast(tuple[object, ...], entry) if isinstance(entry, tuple) else ()
        if len(row) == 3 and row[1] in _TIERS:
            rejected.append(cast(tuple[str, _TierName, str], row))
    return ModelRouted(
        profile,
        tier,
        reason,
        detail if isinstance(detail, str) else "",
        tuple(rejected),
    )


def _text_calls(value: object) -> Literal["recovered", "unread"] | None:
    if value == "recovered":
        return "recovered"
    return "unread" if value == "unread" else None


def _timings(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[str, object], value)
    return {
        key: number
        for key in ("load_ms", "prompt_ms", "reply_ms", "prompt_tokens", "reply_tokens")
        if isinstance(number := raw.get(key), int) and not isinstance(number, bool) and number >= 0
    }


def _custom(data: object) -> Fact | None:
    if not isinstance(data, dict):
        return None
    item = cast(dict[str, object], data)
    kind = item.get(STREAM_KEY)
    message_id = item.get("message_id")
    call_id = item.get("call_id")
    if kind == "model.started" and isinstance(message_id, str):
        return ModelStarted(message_id)
    if kind == "model.waiting" and isinstance(message_id, str):
        model = item.get("model")
        return ModelWaiting(
            message_id,
            item.get("waiting") is True,
            model if isinstance(model, str) and model else None,
            _positive(item.get("window")),
        )
    if kind == "model.routed":
        return _routed_fact(item)
    if kind == "model.request" and isinstance(message_id, str):
        return _request(message_id, item)
    if kind == "model.response" and isinstance(message_id, str):
        text_calls = item.get("text_tool_calls")
        return ModelResponded(
            message_id,
            _positive(item.get("context_window")),
            _text_calls(text_calls),
            _timings(item.get("timings")),
        )
    if kind == "context.changed" and item.get("action") in ("cleared", "summarised", "grew"):
        action = cast(Literal["cleared", "summarised", "grew"], item.get("action"))
        return ContextChanged(
            action,
            _count(item.get("before_tokens")),
            _count(item.get("after_tokens")),
            _count(item.get("count")),
            _positive(item.get("room")),
            _positive(item.get("window_from")),
            _positive(item.get("window_to")),
            _count(item.get("reload_ms")),
        )
    if kind in (PIN_READ_KIND, PIN_SKIPPED_KIND):
        return _pin(kind, item)
    if kind == CHILD_FACT_KIND:
        parent, fact = item.get("parent_call_id"), item.get("fact")
        return ChildFact(parent, fact) if isinstance(parent, str) and parent and fact else None
    if kind in ("check.offered", "check.started", "check.completed"):
        return _check(kind, item)
    if not isinstance(call_id, str):
        return None
    if kind == SKILL_LOADED_KIND:
        found = [item.get(key) for key in ("name", "source", "path", "hash")]
        strings = [value for value in found if isinstance(value, str) and value]
        return SkillLoaded(call_id, *strings) if len(strings) == 4 else None
    if kind == "tool.started":
        return ToolStarted(call_id)
    if kind == "tool.output":
        text = item.get("text")
        return ToolOutput(call_id, text) if isinstance(text, str) and text else None
    if kind == "tool.completed":
        summary = item.get("summary")
        preview = item.get("preview")
        artifact_id = item.get("artifact_id")
        diff = item.get("diff")
        return ToolFinished(
            call_id,
            summary if isinstance(summary, str) else "",
            preview if isinstance(preview, str) else "",
            item.get("truncated") is True,
            artifact_id if isinstance(artifact_id, str) else None,
            item.get("failed") is True,
            _duration(item),
            diff if isinstance(diff, str) and diff else None,
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
    if kind == PLAN_PROPOSED_KIND:
        plan_id, title, steps = item.get("plan_id"), item.get("title"), item.get("steps")
        if not (isinstance(plan_id, str) and isinstance(title, str) and isinstance(steps, list)):
            return None
        rows = tuple(
            dict(cast(dict[str, object], row))
            for row in cast(list[object], steps)
            if isinstance(row, dict)
        )
        return PlanProposed(call_id, plan_id, title, rows)
    if kind == FILE_CHANGED_KIND:
        path, before, after = item.get("path"), item.get("before"), item.get("after")
        if not isinstance(path, str) or not path:
            return None
        if not (before is None or isinstance(before, str)):
            return None
        if not (after is None or isinstance(after, str)):
            return None
        source = item.get("source")
        if source not in ("tool", "shell", "revert"):
            return None
        return FileChanged(call_id or None, path, before, after, source)
    if kind == "tool.failed":
        message = item.get("message")
        return ToolErrored(
            call_id, message if isinstance(message, str) and message else "failed", _duration(item)
        )
    return None


def _check(kind: object, item: Mapping[str, object]) -> Fact | None:
    if kind == "check.offered":
        rows = item.get("checks")
        if not isinstance(rows, list):
            return None
        pairs = [
            (row.get("name"), row.get("command"))
            for row in cast(list[object], rows)
            if isinstance(row, dict)
            for row in [cast(dict[str, object], row)]
        ]
        found = tuple((n, c) for n, c in pairs if isinstance(n, str) and isinstance(c, str))
        return CheckOffered(found) if found else None
    check_id, name = item.get("check_id"), item.get("name")
    if not isinstance(check_id, str) or not isinstance(name, str):
        return None
    number = item.get("round")
    round_no = number if isinstance(number, int) else 0
    if kind == "check.started":
        command = item.get("command")
        return CheckStarted(check_id, name, command, round_no) if isinstance(command, str) else None
    status, exit_code = item.get("status"), item.get("exit_code")
    duration, output, artifact_id = (
        item.get("duration_ms"),
        item.get("output"),
        item.get("artifact_id"),
    )
    if not isinstance(status, str) or not isinstance(duration, int) or not isinstance(output, str):
        return None
    return CheckCompleted(
        check_id,
        name,
        status,
        exit_code if isinstance(exit_code, int) else None,
        duration,
        output,
        artifact_id if isinstance(artifact_id, str) else None,
        round_no,
    )


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
        item.get("window_planned") is True,
        _sections(item.get("system_sections")),
        _count(item.get("system_chars")),
        _count(item.get("system_bytes")),
        _count(item.get("tools_chars")),
        _count(item.get("tools_bytes")),
        _counts(item.get("message_chars")),
        _counts(item.get("message_bytes")),
        profile if isinstance(profile := item.get("profile"), str) and profile else None,
        tuple(i for i in cast(list[object], cleared) if isinstance(i, str))
        if isinstance(cleared := item.get("cleared_ids"), list)
        else (),
        _count(item.get("summary_chars")),
        _count(item.get("estimated_tokens")),
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
    "CHILD_FACT_KIND",
    "FILE_CHANGED_KIND",
    "PIN_READ_KIND",
    "PIN_SKIPPED_KIND",
    "PLAN_PROPOSED_KIND",
    "SKILL_LOADED_KIND",
    "STREAM_KEY",
    "ApprovalAsked",
    "ChildFact",
    "ContextChanged",
    "Fact",
    "FileChanged",
    "ModelRequested",
    "ModelResponded",
    "ModelRouted",
    "ModelStarted",
    "ModelWaiting",
    "PinRead",
    "PinSkipped",
    "PlainMessage",
    "PlanProposed",
    "RequestedCall",
    "SkillLoaded",
    "TextCompleted",
    "TextDelta",
    "ThinkingDelta",
    "TodosChanged",
    "ToolErrored",
    "ToolFinished",
    "ToolOutput",
    "ToolStarted",
    "ToolWriting",
    "Translator",
    "message_text",
    "plain_messages",
    "split_think",
    "translate",
]
