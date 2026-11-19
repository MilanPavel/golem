"""``quote_matches``: the check that a quote is the user's own words (ADR-061)."""

from __future__ import annotations

import pytest

from golem.memory.quote import quote_matches


@pytest.mark.parametrize(
    ("quote", "message", "expected"),
    [
        ("I prefer pnpm", "Please remember that I prefer pnpm over npm", True),
        ("i PREFER   pnpm", "remember that I prefer\npnpm", True),
        ("  I prefer pnpm  ", "I prefer pnpm", True),
        ("prefer yarn", "I prefer pnpm", False),
        ("pnpm", "I prefer pnpm", False),  # under 8 characters
        ("12345678", "12345678", True),
        ("1234567", "1234567 and more", False),
        ("I prefer pnpm over npm always", "I prefer pnpm", False),  # longer than the message
        ("", "anything at all", False),
    ],
)
def test_quote_matches(quote: str, message: str, expected: bool) -> None:
    assert quote_matches(quote, message) is expected
