"""Turn what the user typed into a word query, for FTS5 or for ``LIKE``."""

from __future__ import annotations

import re

MAX_WORDS = 24

_WORD = re.compile(r"\w+")


def words(query: str) -> list[str]:
    """The distinct words of ``query``, in order, lowercased. Punctuation is dropped."""
    found: list[str] = []
    for word in _WORD.findall(query.lower()):
        if word not in found:
            found.append(word)
    return found[:MAX_WORDS]


def match_expression(query: str) -> str | None:
    """Each word in quotes, joined with OR, so FTS5 syntax in the query is just text.

    None when the query has no word.
    """
    found = words(query)
    return " OR ".join(f'"{word}"' for word in found) if found else None


def like_pattern(word: str) -> str:
    """``%word%`` with the characters ``LIKE`` treats as wild escaped by a backslash."""
    escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
