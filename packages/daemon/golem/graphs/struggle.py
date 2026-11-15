"""Does the model struggle in this run, and which way? A pure look at the run's messages.

Every signal is a fact in the messages or in the last model call, never a guess
about the answer's quality. A tool that failed for its own reasons, a denied
call and a cancelled call are the world's answer and never count.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.graphs.notes import is_note
from golem.graphs.tools_node import ERROR_KEY

Signal = Literal[
    "invalid_tool_calls", "unread_text_call", "repeated_call", "empty_reply", "cut_reply"
]

INVALID_IN_A_ROW = 2
"""Invalid or unknown-tool calls in a row that count as a struggle."""

REPEATS = 3
"""The same call with the same arguments this many times in one run."""

CUT_REASONS = frozenset({"length", "max_tokens"})


@dataclass(frozen=True, slots=True)
class Struggle:
    signal: Signal
    detail: str
    """One short sentence for the user."""
    count: int


def detect(
    messages: Sequence[BaseMessage],
    *,
    stop_reason: str | None = None,
    text_tool_calls: str | None = None,
) -> Struggle | None:
    """The first struggle signal of the current run, or None."""
    run = _current_run(messages)
    last = run[-1] if run else None
    plain_reply = isinstance(last, AIMessage) and not last.tool_calls

    if text_tool_calls == "unread":
        return Struggle("unread_text_call", "a tool call written as text could not be read", 1)
    if plain_reply and stop_reason in CUT_REASONS:
        return Struggle("cut_reply", "the reply was cut at the length limit", 1)
    if isinstance(last, AIMessage) and plain_reply and last.text.strip() == "":
        return Struggle("empty_reply", "an empty reply with no tool call", 1)
    invalid = _invalid_in_a_row(run)
    if invalid >= INVALID_IN_A_ROW:
        return Struggle("invalid_tool_calls", f"{invalid} invalid tool calls in a row", invalid)
    repeated = _repeats(run)
    if repeated >= REPEATS:
        return Struggle("repeated_call", f"the same tool call {repeated} times", repeated)
    return None


def error_kind(message: ToolMessage) -> str | None:
    """Why a tool result failed, or None for a success.

    Old checkpoints have no marker: an error without one is read from its text.
    """
    marker = message.additional_kwargs.get(ERROR_KEY)
    if isinstance(marker, str):
        return marker
    if message.status != "error":
        return None
    text = message.text.strip().removeprefix("error:").lstrip()
    if text.startswith("invalid arguments for"):
        return "invalid_args"
    if text.startswith("unknown tool"):
        return "unknown_tool"
    return "tool_error"


def _current_run(messages: Sequence[BaseMessage]) -> Sequence[BaseMessage]:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage) and not is_note(messages[index]):
            return messages[index + 1 :]
    return messages


def _invalid_in_a_row(run: Sequence[BaseMessage]) -> int:
    count = 0
    for message in reversed(run):
        if not isinstance(message, ToolMessage):
            continue
        if error_kind(message) not in ("invalid_args", "unknown_tool"):
            break
        count += 1
    return count


def _repeats(run: Sequence[BaseMessage]) -> int:
    """How often the newest reply's most repeated call appears in the run."""
    replies = [message for message in run if isinstance(message, AIMessage)]
    if not replies:
        return 0
    seen = Counter(
        _key(call["name"], call["args"]) for reply in replies for call in reply.tool_calls
    )
    return max((seen[_key(c["name"], c["args"])] for c in replies[-1].tool_calls), default=0)


def _key(name: str, args: object) -> tuple[str, str]:
    return name, json.dumps(args, sort_keys=True, default=str)


__all__ = ["INVALID_IN_A_ROW", "REPEATS", "Signal", "Struggle", "detect", "error_kind"]
