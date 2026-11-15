"""What a model call sends of the stored history.

The checkpoint keeps every message. A :class:`ContextView` is a small record of
what to leave out or shorten when the history is sent, and :func:`view` applies
it. With no record the view is the history itself.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.graphs.adapter import message_text


class ContextView(TypedDict, total=False):
    cleared_before: str
    """A message id. Tool results before it are sent as a stub."""
    summary: str
    """Stands for every message before ``summarised_before``."""
    summarised_before: str
    """A message id. The first message still sent in full."""


STUB_MIN_CHARS = 400
SUMMARY_HEADER = "Summary of the conversation so far. The messages it covers are not shown."
SUMMARY_ID = "summary"


def stub_text(name: str | None, size: int) -> str:
    """The line that stands for a cleared tool result of ``size`` characters."""
    return (
        f"[cleared to save context: {name or 'tool'} returned {size} characters. "
        "Call the tool again if you need this.]"
    )


def stub(message: ToolMessage) -> ToolMessage:
    """``message`` with its content replaced by one line that says what it was.

    An error result keeps its content: errors are short and they matter.
    """
    if message.status == "error":
        return message.model_copy()
    note = stub_text(message.name, len(message_text(message)))
    return message.model_copy(update={"content": note})


def safe_boundary(messages: Sequence[BaseMessage], index: int) -> int:
    """The largest index at or below ``index`` where a view may start, a human message.

    Returns 0 when there is none.
    """
    for i in range(min(index, len(messages) - 1), -1, -1):
        if isinstance(messages[i], HumanMessage):
            return i
    return 0


def _find(messages: Sequence[BaseMessage], message_id: str | None) -> int | None:
    if not message_id:
        return None
    for i, message in enumerate(messages):
        if message.id == message_id:
            return i
    return None


def _summary_start(messages: Sequence[BaseMessage], ctx: ContextView) -> int | None:
    """Index of the first message the summary leaves in, or None when there is no summary."""
    if not ctx.get("summary"):
        return None
    at = _find(messages, ctx.get("summarised_before"))
    if at is None:
        return None
    for i in range(at, len(messages)):
        if isinstance(messages[i], HumanMessage):
            return i
    return None


def _clearable(message: BaseMessage) -> bool:
    return (
        isinstance(message, ToolMessage)
        and message.status != "error"
        and len(message_text(message)) > STUB_MIN_CHARS
    )


def summarised_ids(messages: Sequence[BaseMessage], ctx: ContextView | None) -> list[str]:
    """Ids of the messages the summary stands for."""
    if not ctx:
        return []
    start = _summary_start(messages, ctx)
    if start is None:
        return []
    return [m.id for m in messages[:start] if m.id]


def cleared_ids(messages: Sequence[BaseMessage], ctx: ContextView | None) -> list[str]:
    """Ids of the tool results :func:`view` sends as a stub, leaving out summarised ones."""
    if not ctx:
        return []
    before = _find(messages, ctx.get("cleared_before"))
    if before is None:
        return []
    start = _summary_start(messages, ctx) or 0
    return [m.id for m in messages[start:before] if m.id and _clearable(m)]


def view(messages: Sequence[BaseMessage], ctx: ContextView | None) -> list[BaseMessage]:
    """``messages`` as a model call sends them.

    The summary replaces everything before ``summarised_before``, and tool
    results before ``cleared_before`` that are long become stubs. An id that is
    not in ``messages`` is ignored. Order is kept, and a tool call and its
    result are never split.
    """
    if not ctx:
        return list(messages)
    start = _summary_start(messages, ctx) or 0
    before = _find(messages, ctx.get("cleared_before"))
    sent: list[BaseMessage] = []
    for i in range(start, len(messages)):
        message = messages[i]
        if (
            before is not None
            and i < before
            and isinstance(message, ToolMessage)
            and _clearable(message)
        ):
            message = stub(message)
        sent.append(message)
    if start > 0:
        text = f"{SUMMARY_HEADER}\n\n{ctx.get('summary', '')}"
        sent.insert(0, HumanMessage(content=text, id=SUMMARY_ID))
    return sent


DEFAULT_RATIO = 0.25
MIN_RATIO, MAX_RATIO = 0.15, 0.6


def sent_chars(message: BaseMessage) -> int:
    """Characters of a message as a call sends it: its text and a reply's tool calls."""
    size = len(message_text(message))
    if isinstance(message, AIMessage) and message.tool_calls:
        size += len(json.dumps(message.tool_calls, ensure_ascii=False, default=str))
    return size


def used_tokens(
    messages: Sequence[BaseMessage],
    system_chars: int,
    tools_chars: int,
    learned: float | None = None,
) -> tuple[int, float]:
    """Tokens the next call would send, and the tokens-per-character ratio used.

    The newest reply with a provider token count anchors it: that count is the
    size of the call that made the reply, and what came after is added by the
    ratio the count implies. Without such a reply every character counts 0.25. A ``learned``
    ratio, the one the model showed on its latest calls, replaces both.
    """
    for i in range(len(messages) - 1, -1, -1):
        message = messages[i]
        usage = message.usage_metadata if isinstance(message, AIMessage) else None
        tokens = usage.get("input_tokens") if usage else None
        if not tokens:
            continue
        before = system_chars + tools_chars + sum(sent_chars(m) for m in messages[:i])
        ratio = min(MAX_RATIO, max(MIN_RATIO, tokens / before)) if before > 0 else DEFAULT_RATIO
        ratio = ratio if learned is None else learned
        added = sum(sent_chars(m) for m in messages[i:])
        return round(tokens + added * ratio), ratio
    total = system_chars + tools_chars + sum(sent_chars(m) for m in messages)
    ratio = DEFAULT_RATIO if learned is None else learned
    return round(total * ratio), ratio


def _saved_chars(message: BaseMessage) -> int:
    size = len(message_text(message))
    return size - len(stub_text(getattr(message, "name", None), size))


def plan_clear(
    messages: Sequence[BaseMessage],
    ctx: ContextView | None,
    *,
    used: int,
    ratio: float,
    room: int,
    clear_at: float,
    clear_to: float,
    keep_results: int,
) -> ContextView | None:
    """A view that clears old tool results, or None when there is nothing to do.

    None when ``used`` is under ``clear_at`` of ``room``, or when nothing can be
    freed. Results are cleared oldest first until ``used`` is down to ``clear_to``
    of ``room``. The newest ``keep_results`` results that could be cleared stay.
    ``cleared_before`` only moves forward.
    """
    if used < clear_at * room:
        return None
    current = ctx or ContextView()
    start = _summary_start(messages, current) or 0
    before = _find(messages, current.get("cleared_before")) or 0
    found = [i for i in range(start, len(messages)) if _clearable(messages[i])]
    older = found[: max(0, len(found) - keep_results)]
    freed = 0.0
    last: int | None = None
    for i in older:
        if used - freed <= clear_to * room:
            break
        if i >= before and _saved_chars(messages[i]) > 0:
            freed += _saved_chars(messages[i]) * ratio
            last = i
    if last is None or last + 1 >= len(messages):
        return None
    after = messages[last + 1].id
    return {**current, "cleared_before": after} if after else None


def freed_by(
    messages: Sequence[BaseMessage], old: ContextView | None, new: ContextView, ratio: float
) -> tuple[int, int]:
    """The tokens and the number of results that ``new`` clears beyond ``old``."""
    now = set(cleared_ids(messages, new)) - set(cleared_ids(messages, old))
    fresh = [m for m in messages if m.id in now]
    return round(sum(_saved_chars(m) for m in fresh) * ratio), len(fresh)


def plan_summary(
    messages: Sequence[BaseMessage], ctx: ContextView | None, *, keep_turns: int
) -> tuple[int, int] | None:
    """The slice ``(start, end)`` of ``messages`` to summarise, or None.

    ``start`` is where the current summary ends (0 with none). ``end`` is the human
    message that starts the ``keep_turns``-th turn from the end, so the last ``keep_turns``
    turns, the running one included, are never summarised. None when fewer than
    ``keep_turns + 1`` turns are left after ``start``, which is also the case of one long
    turn, and when the slice would be empty.
    """
    if keep_turns < 1:
        return None
    start = (_summary_start(messages, ctx) if ctx else None) or 0
    turns = [i for i in range(start, len(messages)) if isinstance(messages[i], HumanMessage)]
    if len(turns) < keep_turns + 1:
        return None
    end = turns[-keep_turns]
    if end <= start or not messages[end].id:
        return None
    return start, end


def plan_stub_newest(
    messages: Sequence[BaseMessage], ctx: ContextView | None
) -> ContextView | None:
    """A view that stubs every long tool result but the last tool call's, or None.

    The results of the last tool call stay in full, so the model sees what it asked for last.
    ``cleared_before`` only moves forward, and None means no result is left to stub.
    """
    last = next(
        (i for i in range(len(messages) - 1, -1, -1) if isinstance(messages[i], ToolMessage)), None
    )
    if last is None:
        return None
    first = last
    while first > 0 and isinstance(messages[first - 1], ToolMessage):
        first -= 1
    current = ctx or ContextView()
    start = _summary_start(messages, current) or 0
    before = _find(messages, current.get("cleared_before")) or 0
    if not any(_clearable(messages[i]) for i in range(max(start, before), first)):
        return None
    after = messages[first].id
    return {**current, "cleared_before": after} if after else None
