"""Small forms of a step's or a run's result, for the events that go out while a run goes on.

An event stays small: it carries the one-line form of a result, and the result itself only when
it is short. The client reads a large one with ``workflow.status``.
"""

from __future__ import annotations

import json
from typing import Any, cast

__all__ = ["EVENT_VALUE_CHARS", "LINE_CHARS", "one_line", "result_line", "small"]

LINE_CHARS = 120
"""A one-line form is cut at this many characters."""

EVENT_VALUE_CHARS = 4000
"""A value longer than this (as JSON) is not sent in an event."""

EMPTY = "Nothing found"


def one_line(text: str, size: int = LINE_CHARS) -> str:
    """``text`` on one line (white space folded), cut with an ellipsis at ``size``."""
    line = " ".join(text.split())
    return line if len(line) <= size else line[: size - 1].rstrip() + "…"


def small(value: Any) -> tuple[Any, int]:
    """``(value, or None when it is large; its length as JSON)``. The length is 0 for None."""
    if value is None:
        return None, 0
    try:
        size = len(json.dumps(value))
    except (TypeError, ValueError):
        return None, 0
    return (value if size <= EVENT_VALUE_CHARS else None), size


def result_line(value: Any, kind: str = "step") -> str | None:
    """The one line a saved result is, or None when there is no result at all."""
    if value is None:
        return None
    if isinstance(value, str):
        return one_line(value) or EMPTY
    if isinstance(value, list):
        rows = cast("list[object]", value)
        if not rows:
            return EMPTY
        if all(isinstance(item, dict) for item in rows):
            return f"{len(rows)} {'row' if len(rows) == 1 else 'rows'}"
    elif isinstance(value, dict):
        record = cast("dict[str, object]", value)
        if not record:
            return EMPTY
        verdict = record.get("verdict")
        if kind == "review" and isinstance(verdict, str):
            words = {"approve": "approved", "edit": "edited and approved", "reject": "rejected"}
            return words.get(verdict, verdict)
        summary = record.get("summary")
        if isinstance(summary, str):
            return one_line(summary)
        pairs = [
            f"{key} {one_line(str(val), 30)}"
            for key, val in record.items()
            if isinstance(val, str | int | float | bool)
        ][:3]
        if pairs:
            return " · ".join(pairs)
        return f"{len(record)} {'field' if len(record) == 1 else 'fields'}"
    return one_line(json.dumps(value))
