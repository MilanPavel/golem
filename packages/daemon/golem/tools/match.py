"""Find where an ``old_string`` belongs in a file, strictly, rung by rung.

Small models often copy text with the wrong indentation or without trailing
spaces. :func:`find` tries three rungs in order (``exact``, ``trailing_space``,
``indent``) and returns the first rung that matches anywhere. It never picks
between matches: the caller sees every span and decides whether the edit is
ambiguous. :func:`nearest` names the closest lines when nothing matches.

Offsets are characters of ``text``, so ``text[:start] + new + text[end:]`` is
the edit. Tabs and line endings are never normalised.
"""

from __future__ import annotations

import difflib
import os
from dataclasses import dataclass
from typing import Literal

Rung = Literal["exact", "trailing_space", "indent"]

_TRAILING = " \t\r"
_INDENT = " \t"
_MIN_SOLID = 3
_MIN_RATIO = 0.5
_BIG_FILE_LINES = 5_000
_GRAM = 12


@dataclass(frozen=True, slots=True)
class Span:
    start: int
    end: int
    remove: str
    """Base indentation of ``old`` (rung ``indent``), else empty."""
    add: str
    """Base indentation in the file (rung ``indent``), else empty."""


@dataclass(frozen=True, slots=True)
class Found:
    rung: Rung
    spans: tuple[Span, ...]


@dataclass(frozen=True, slots=True)
class Nearest:
    first_line: int
    last_line: int
    text: str
    ratio: float


def _blank(line: str) -> bool:
    return not line.strip()


def _base(lines: list[str]) -> str:
    """The longest indentation shared by every non-blank line."""
    prefixes = [line[: len(line) - len(line.lstrip(_INDENT))] for line in lines if not _blank(line)]
    return os.path.commonprefix(prefixes) if prefixes else ""


def _has_solid_line(lines: list[str]) -> bool:
    return any(sum(not c.isspace() for c in line) >= _MIN_SOLID for line in lines)


def _split(text: str) -> list[str]:
    """Lines without their ``\\n``; a final line break adds no empty line."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def _exact(text: str, old: str) -> tuple[Span, ...]:
    spans: list[Span] = []
    at = text.find(old)
    while at != -1:
        spans.append(Span(at, at + len(old), "", ""))
        at = text.find(old, at + len(old))
    return tuple(spans)


def _same_base(window: list[str], old_lines: list[str], remove: str) -> bool:
    """Each line must equal its partner once both bases are cut; blanks pair with blanks."""
    add = _base(window)
    for got, want in zip(window, old_lines, strict=True):
        if _blank(want) != _blank(got):
            return False
        if _blank(want):
            continue
        if got[len(add) :].rstrip(_TRAILING) != want[len(remove) :].rstrip(_TRAILING):
            return False
    return True


def _windows(text: str, old: str, indent: bool) -> tuple[Span, ...]:
    old_lines = _split(old)
    count = len(old_lines)
    if not count or not _has_solid_line(old_lines):
        return ()
    lines = _split(text)
    if count > len(lines):
        return ()
    starts: list[int] = []
    pos = 0
    for line in lines:
        starts.append(pos)
        pos += len(line) + 1
    ends_with_break = old.endswith("\n")
    if indent:
        want = [line.strip(_TRAILING) for line in old_lines]
        have = [line.strip(_TRAILING) for line in lines]
        remove = _base(old_lines)
    else:
        want = [line.rstrip(_TRAILING) for line in old_lines]
        have = [line.rstrip(_TRAILING) for line in lines]
        remove = ""
    spans: list[Span] = []
    i = 0
    while i + count <= len(lines):
        window = lines[i : i + count]
        if have[i : i + count] != want or (indent and not _same_base(window, old_lines, remove)):
            i += 1
            continue
        last = i + count - 1
        end = starts[last] + len(lines[last])
        if ends_with_break:
            if end >= len(text):
                i += 1
                continue
            end += 1
        else:
            end = starts[last] + len(lines[last].rstrip("\r"))
        add = _base(window) if indent else ""
        spans.append(Span(starts[i], end, remove, add))
        i += count
    return tuple(spans)


def find(text: str, old: str) -> Found | None:
    """The first rung with at least one span, or None."""
    if not old.strip():
        return None
    spans = _exact(text, old)
    if spans:
        return Found("exact", spans)
    spans = _windows(text, old, indent=False)
    if spans:
        return Found("trailing_space", spans)
    spans = _windows(text, old, indent=True)
    if spans:
        return Found("indent", spans)
    return None


def reindent(new: str, remove: str, add: str) -> str:
    """Swap the base indentation ``remove`` for ``add`` on every non-blank line."""
    out: list[str] = []
    for line in new.splitlines(keepends=True):
        if _blank(line):
            out.append(line)
            continue
        if remove and line.startswith(remove):
            line = line[len(remove) :]
        out.append(add + line)
    return "".join(out)


def _grams(line: str) -> set[str]:
    return {line[i : i + _GRAM] for i in range(len(line) - _GRAM + 1)}


def nearest(text: str, old: str) -> Nearest | None:
    """The lines of ``text`` closest to ``old``, or None under a ratio of 0.5."""
    old_lines = [line.rstrip("\r") for line in _split(old)]
    lines = [line.rstrip("\r") for line in _split(text)]
    count = len(old_lines)
    if not count or not lines or count > len(lines):
        return None
    wanted = "\n".join(old_lines)
    grams: set[str] | None = None
    if len(lines) > _BIG_FILE_LINES:
        first = next((line for line in old_lines if not _blank(line)), "")
        grams = _grams(first)
    best: Nearest | None = None
    best_ratio = 0.0
    matcher = difflib.SequenceMatcher(None)
    matcher.set_seq2(wanted)
    for i in range(len(lines) - count + 1):
        if grams is not None and grams.isdisjoint(_grams(lines[i])):
            continue
        window = "\n".join(lines[i : i + count])
        matcher.set_seq1(window)
        if matcher.real_quick_ratio() <= best_ratio or matcher.quick_ratio() <= best_ratio:
            continue
        ratio = matcher.ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = Nearest(i + 1, i + count, window, ratio)
    if best is None or best.ratio < _MIN_RATIO:
        return None
    return best
