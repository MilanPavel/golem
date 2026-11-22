"""Change the model wish or the limits of an agent file and nothing else.

The wish is the ``model:`` key of the frontmatter. :func:`with_wish` rewrites that one line, or
adds it, and returns the rest of the file byte for byte: comments, key order, line endings and
the prompt stay as they were. :func:`with_limits` does the same for the limit keys.
"""

from __future__ import annotations

import re
from typing import Any

from golem.agents.model import WISHES
from golem.skills.parse import frontmatter_fields

_BOM = "﻿"
_LINES = re.compile(r"[^\n]*\n|[^\n]+")
_KEY = re.compile(r"model[ \t]*:(?P<value>.*?)(?P<eol>\r?\n)?$", re.DOTALL)
_LIMIT_KEYS = ("max-calls", "max-seconds", "max-cost-usd", "max-tokens")
_COMMENT = re.compile(r"[ \t]+#.*$")
_WISH = re.compile(r"\S+")


class AgentEditError(ValueError):
    """The wish or the file cannot be edited; the message says why in plain words."""


def check_wish(wish: str) -> None:
    """Raise :class:`AgentEditError` unless ``wish`` is one the parser accepts."""
    if not _WISH.fullmatch(wish):
        raise AgentEditError(
            f"{wish!r} is not a wish: use one of {', '.join(WISHES)}, or a model name "
            "without spaces"
        )


def with_wish(text: str, wish: str) -> str:
    """``text`` with ``model: <wish>`` in its frontmatter, the rest unchanged.

    Raises :class:`AgentEditError` for a bad wish, for a file without frontmatter, and for a
    wish that YAML would not read back as the same text (such as ``true`` or ``a: b``).
    """
    check_wish(wish)
    start = len(_BOM) if text.startswith(_BOM) else 0
    lines = _LINES.findall(text, start)
    if not lines or lines[0].rstrip() != "---":
        raise AgentEditError("the file has no frontmatter to put the wish in")
    close = next((i for i, line in enumerate(lines) if i > 0 and line.rstrip() == "---"), None)
    if close is None:
        raise AgentEditError("the frontmatter is never closed with ---")
    found = next((i for i in range(1, close) if _KEY.match(lines[i])), None)
    if found is None:
        eol = "\r\n" if lines[close - 1].endswith("\r\n") else "\n"
        if not lines[close - 1].endswith("\n"):  # the opening line is the only one before it
            lines[close - 1] += eol
        lines.insert(close, f"model: {wish}{eol}")
    else:
        match = _KEY.match(lines[found])
        assert match is not None
        value = match["value"].strip()
        comment = ""
        if not value.startswith(("'", '"')):
            tail = _COMMENT.search(match["value"])
            comment = "" if tail is None else tail.group(0)
        eol = match["eol"] or ""
        end = found + 1
        while end < close and lines[end][:1] in (" ", "\t") and lines[end].strip():
            end += 1  # a value that goes on over several lines
        lines[found:end] = [f"model: {wish}{comment}{eol}"]
    result = text[:start] + "".join(lines)
    _read_back(result, wish)
    return result


def _read_back(text: str, wish: str) -> None:
    lines = _LINES.findall(text.removeprefix(_BOM))
    close = next(i for i, line in enumerate(lines) if i > 0 and line.rstrip() == "---")
    errors: list[str] = []
    fields: dict[str, Any] = frontmatter_fields("".join(lines[1:close]), errors)
    if errors or fields.get("model") != wish:
        raise AgentEditError(f"{wish!r} cannot be written as a model wish in the frontmatter")


__all__ = ["AgentEditError", "check_wish", "with_wish"]


def _frontmatter(text: str) -> tuple[int, list[str]]:
    start = len(_BOM) if text.startswith(_BOM) else 0
    lines = _LINES.findall(text, start)
    if not lines or lines[0].rstrip() != "---":
        raise AgentEditError("the file has no frontmatter to put the limit in")
    if not any(i > 0 and line.rstrip() == "---" for i, line in enumerate(lines)):
        raise AgentEditError("the frontmatter is never closed with ---")
    return start, lines


def _set_line(lines: list[str], key: str, value: int | float | None) -> None:
    close = next(i for i, line in enumerate(lines) if i > 0 and line.rstrip() == "---")
    pattern = re.compile(rf"{re.escape(key)}[ \t]*:(?P<value>.*?)(?P<eol>\r?\n)?$", re.DOTALL)
    found = next((i for i in range(1, close) if pattern.match(lines[i])), None)
    if found is None:
        if value is None:
            return
        eol = "\r\n" if lines[close - 1].endswith("\r\n") else "\n"
        if not lines[close - 1].endswith("\n"):
            lines[close - 1] += eol
        lines.insert(close, f"{key}: {value}{eol}")
        return
    end = found + 1
    while end < close and lines[end][:1] in (" ", "\t") and lines[end].strip():
        end += 1
    if value is None:
        del lines[found:end]
        return
    match = pattern.match(lines[found])
    assert match is not None
    tail = _COMMENT.search(match["value"])
    comment = "" if tail is None else tail.group(0)
    lines[found:end] = [f"{key}: {value}{comment}{match['eol'] or ''}"]


def with_limits(text: str, changes: dict[str, int | float | None]) -> str:
    """``text`` with the limit lines of ``changes`` set, or removed for a value of None.

    The keys are ``max-calls``, ``max-seconds``, ``max-cost-usd`` and ``max-tokens``. The rest of
    the file stays as it was. Raises :class:`AgentEditError` for another key and for a file
    without frontmatter.
    """
    unknown = [key for key in changes if key not in _LIMIT_KEYS]
    if unknown:
        raise AgentEditError(f"{unknown[0]} is not a limit of an agent file")
    start, lines = _frontmatter(text)
    for key, value in changes.items():
        _set_line(lines, key, value)
    return text[:start] + "".join(lines)
