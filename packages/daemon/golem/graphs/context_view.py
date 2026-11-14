"""What a model call sends of the stored history.

The checkpoint keeps every message. A :class:`ContextView` is a small record of
what to leave out or shorten when the history is sent, and :func:`view` applies
it. With no record the view is the history itself.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage

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


def stub(message: ToolMessage) -> ToolMessage:
    """``message`` with its content replaced by one line that says what it was.

    An error result keeps its content: errors are short and they matter.
    """
    if message.status == "error":
        return message.model_copy()
    size = len(message_text(message))
    name = message.name or "tool"
    note = (
        f"[cleared to save context: {name} returned {size} characters. "
        "Call the tool again if you need this.]"
    )
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
