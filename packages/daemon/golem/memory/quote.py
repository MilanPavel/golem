"""Whether a quote is the user's own words. Pure: no file, no clock, no network (ADR-061)."""

from __future__ import annotations

MIN_QUOTE_CHARS = 8


def _squash(text: str) -> str:
    """Lowercase, with each run of white space as one space and none at the ends."""
    return " ".join(text.lower().split())


def quote_matches(quote: str, message: str) -> bool:
    """Whether ``quote`` appears in ``message``, ignoring case and runs of white space.

    A quote under 8 characters is too short to prove anything, and one longer than the
    message cannot be in it.
    """
    wanted, held = _squash(quote), _squash(message)
    if len(wanted) < MIN_QUOTE_CHARS or len(wanted) > len(held):
        return False
    return wanted in held


__all__ = ["MIN_QUOTE_CHARS", "quote_matches"]
