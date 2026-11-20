"""What a helper is made of: its tools, its prompt and its limits (ADR-059).

A helper is a session with a parent, run by the session manager. The chat graph runs it with a
fixed read-only set of tools and the one-section prompt below, and it stops at its limits.
``child_thread`` names the checkpoint thread of a helper of the older shape (ADR-058), which old
logs still point at.
"""

from __future__ import annotations

from dataclasses import dataclass

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


@dataclass(frozen=True, slots=True)
class ChildLimits:
    """What stops a helper. ``max_calls`` counts model calls before the one that must answer."""

    max_calls: int = 15
    timeout_s: float = 300.0
    answer_chars: int = 6_000
    max_per_turn: int = 3
    """How many helpers one run of the parent may start."""


def child_thread(session_id: str, call_id: str) -> str:
    """The checkpoint thread of the helper started by the ``delegate`` call ``call_id``."""
    return f"{session_id}/c/{call_id}"


__all__ = [
    "CHILD_PROMPT",
    "EXPLORER_TOOLS",
    "FINAL_REQUEST",
    "ChildLimits",
    "child_thread",
]
