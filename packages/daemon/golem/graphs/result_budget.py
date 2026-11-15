"""How much of one tool result the model reads, by the window of the model that reads it."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ResultBudget:
    """``artifact_chars``: above this the output goes to an artifact. The model gets the
    first ``head_chars`` and the last ``tail_chars`` characters of it."""

    artifact_chars: int
    head_chars: int
    tail_chars: int

    @property
    def page_chars(self) -> int:
        return self.head_chars + self.tail_chars


DEFAULT_BUDGET = ResultBudget(20_000, 12_000, 4_000)
SHARE = 0.125
"""One result may take this part of the window."""
MIN_CHARS = 4_000
MAX_CHARS = 48_000
CHARS_PER_TOKEN = 4


def result_budget(window_tokens: int | None) -> ResultBudget:
    """The budget for a window in tokens. An unknown window gets the default.

    A 32K window gets the default numbers.
    """
    if window_tokens is None or window_tokens <= 0:
        return DEFAULT_BUDGET
    wanted = int(window_tokens * CHARS_PER_TOKEN * SHARE)
    total = min(MAX_CHARS, max(MIN_CHARS, wanted)) // 1_000 * 1_000
    head = total * 3 // 4
    return ResultBudget(total * 5 // 4, head, total - head)


__all__ = ["DEFAULT_BUDGET", "ResultBudget", "result_budget"]
