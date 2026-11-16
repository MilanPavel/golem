"""Child runs: a helper that runs the chat graph on its own thread (ADR-058).

``run_child`` starts a fresh checkpoint thread, ``<session_id>/c/<call_id>``, whose first
message is the brief. The helper sees a fixed read-only set of tools and the one-section prompt
below, never asks for approval, and stops at its limits. The facts of its stream go to
``emit_fact``: model calls and tool calls, never text or messages. Its answer is the result.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from contextlib import aclosing
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from golem.graphs.adapter import (
    ModelRequested,
    ModelResponded,
    TextCompleted,
    ToolErrored,
    ToolFinished,
    ToolStarted,
    Translator,
)

if TYPE_CHECKING:
    from golem.graphs.chat import ChatRuntime

EXPLORER_TOOLS = frozenset(
    {
        "read_file",
        "list_dir",
        "glob",
        "grep",
        "git_log",
        "git_diff",
        "git_status",
        "read_artifact",
    }
)
"""The tools a helper has: golem's read-only ones. No ``delegate``, shell, writes, web or MCP."""

CHILD_PROMPT = (
    "You are a helper. Answer the brief. Read only what you need. End with a short answer: "
    "findings first, then the paths that matter. Do not ask questions."
)
"""The helper's whole system prompt."""

FINAL_REQUEST = (
    "You have used all the steps you were given. Answer the brief now from what you know. "
    "Do not call tools."
)
"""Sent after the history, for the last call of a helper that ran out of calls. Not stored."""

Stopped = Literal["done", "calls", "time", "cancelled"]


@dataclass(frozen=True, slots=True)
class ChildLimits:
    """What stops a helper. ``max_calls`` counts model calls before the one that must answer."""

    max_calls: int = 15
    timeout_s: float = 300.0
    answer_chars: int = 6_000


@dataclass(frozen=True, slots=True)
class ChildResult:
    """``text`` is the answer, cut to ``answer_chars``. ``stopped`` is why the helper ended."""

    text: str
    calls: int
    tool_calls: int
    stopped: Stopped


def child_thread(session_id: str, call_id: str) -> str:
    """The checkpoint thread of the helper started by the ``delegate`` call ``call_id``."""
    return f"{session_id}/c/{call_id}"


_SHOWN = (ModelRequested, ModelResponded, TextCompleted, ToolStarted, ToolFinished, ToolErrored)
"""The facts of a helper that reach the log. Its text and thinking never do."""

_ARG_CHARS = 60


class ChildProgress:
    """One short line for each tool call a helper starts, such as ``read_file src/x.py``."""

    def __init__(self) -> None:
        self._lines: dict[str, str] = {}

    def see(self, fact: object) -> str | None:
        """The line for ``fact`` when it is a tool call starting, else None."""
        if isinstance(fact, TextCompleted):
            for call in fact.calls:
                self._lines[call.call_id] = _line(call.name, call.args)
        elif isinstance(fact, ToolStarted):
            return self._lines.pop(fact.call_id, None)
        return None


def _line(name: str, args: Mapping[str, object]) -> str:
    for key in ("path", "pattern", "query", "artifact_id", "ref"):
        value = args.get(key)
        if isinstance(value, str) and value:
            shown = value if len(value) <= _ARG_CHARS else value[:_ARG_CHARS] + "..."
            return f'{name} "{shown}"' if key in ("pattern", "query") else f"{name} {shown}"
    return name


async def run_child(
    runtime: ChatRuntime,
    *,
    session_id: str,
    call_id: str,
    brief: str,
    model_profile: str,
    cwd: str | None,
    emit_fact: Callable[[object], None],
    limits: ChildLimits,
    options: Mapping[str, float | str] | None = None,
) -> ChildResult:
    """Run a helper on ``brief`` until it answers or hits a limit.

    ``model_profile`` is the model of the ``explore`` role. Cancelling the caller cancels the
    helper: its stream is closed before the cancellation goes on. Raises what a failed model
    call raises.
    """
    stream = runtime.stream_child(
        thread_id=child_thread(session_id, call_id),
        session_id=session_id,
        brief=brief,
        model_profile=model_profile,
        cwd=cwd,
        options=options,
        max_calls=limits.max_calls,
    )
    translate = Translator()
    calls = tool_calls = 0
    text = ""
    stopped: Stopped = "done"
    clock = asyncio.timeout(limits.timeout_s)
    try:
        async with clock, aclosing(stream):
            async for part in stream:
                for fact in translate(part):
                    if isinstance(fact, ModelRequested):
                        calls += 1
                    elif isinstance(fact, TextCompleted):
                        tool_calls += len(fact.calls)
                        if fact.text.strip() or not fact.calls:
                            text = fact.text
                    if isinstance(fact, _SHOWN):
                        emit_fact(fact)
    except TimeoutError:
        if not clock.expired():
            raise
        stopped = "time"
    if stopped == "done" and calls > limits.max_calls:
        stopped = "calls"
    return ChildResult(text[: limits.answer_chars], calls, tool_calls, stopped)


__all__ = [
    "CHILD_PROMPT",
    "EXPLORER_TOOLS",
    "FINAL_REQUEST",
    "ChildLimits",
    "ChildProgress",
    "ChildResult",
    "Stopped",
    "child_thread",
    "run_child",
]
