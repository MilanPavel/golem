"""How many tokens a prompt will be, learned from the calls that already finished.

There is no tokenizer for a local model, so golem keeps the tokens per character each
model showed on its latest calls. Code and JSON take more tokens per character than prose.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque

MIN_CHARS = 2000
"""A call with fewer characters says too little about the ratio."""
CUT_AT = 0.97
"""A call whose input reached this share of the window was probably cut by the server."""
KEEP = 20
PERCENTILE = 0.8
MIN_RATIO, MAX_RATIO = 0.15, 0.6
DEFAULT_RATIO = 0.3
MESSAGE_TOKENS = 3
"""Tokens each message adds on top of its text."""


class TokenRatios:
    """Tokens per character, learned per model from finished calls. In memory only."""

    def __init__(self) -> None:
        self._seen: defaultdict[str, deque[float]] = defaultdict(lambda: deque(maxlen=KEEP))

    def note(self, model: str, *, chars: int, tokens: int, window: int | None) -> None:
        """Learn from a finished call of ``model``: ``chars`` sent, ``tokens`` the server counted.

        A call with few characters is ignored, and so is one whose ``tokens`` are at the
        window, which the server probably cut.
        """
        if chars < MIN_CHARS or tokens <= 0:
            return
        if window is not None and tokens >= CUT_AT * window:
            return
        self._seen[model].append(tokens / chars)

    def learned(self, model: str) -> float | None:
        """The ratio of ``model`` when it has samples, else None."""
        seen = self._seen.get(model)
        if not seen:
            return None
        ordered = sorted(seen)
        # Nearest rank: over- rather than underestimate.
        found = ordered[max(0, math.ceil(PERCENTILE * len(ordered)) - 1)]
        return min(MAX_RATIO, max(MIN_RATIO, found))

    def ratio(self, model: str) -> float:
        """Tokens per character for ``model``: the learned one, else the default."""
        found = self.learned(model)
        return DEFAULT_RATIO if found is None else found

    def estimate(self, model: str, chars: int, messages: int = 0) -> int:
        """The tokens ``chars`` characters in ``messages`` messages will be."""
        return round(chars * self.ratio(model)) + MESSAGE_TOKENS * messages


__all__ = ["TokenRatios"]
