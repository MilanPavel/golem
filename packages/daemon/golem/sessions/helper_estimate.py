"""The estimate before a large batch of helpers (ADR-059, section 5; step 15.6.5).

Pure: briefs, limits and prices in, dollars out. No file, no clock, no network. The manager
reads the picked models and their prices and hands them here; the tools node decides what to do
with the answer (start at once, or park the lead on the batch question).

One helper costs ``(brief + read budget) x input price + answer allowance x output price``.
It is an estimate to decide whether to ask, never a cap: the caps are the helper limits
(``max_cost``, ``max_tokens``) and ``per_message_cost``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from golem.config import ModelPrice
from golem.models.cost import cost_usd

DEFAULT_READ_TOKENS = 30_000
"""What a helper reads when its ``max_tokens`` limit is not set.

A helper reads files and searches, then answers, in at most ``max_calls`` (15 by default)
steps. Each file read is a few thousand tokens, and a typical sweep reads 5 to 10 of them, so
30K is a sum that most helpers stay under and a large one passes. A helper with ``max_tokens``
is estimated at that limit, which is the most it may use."""

ANSWER_TOKENS = 1_500
"""What a helper writes back: its answer is data for the lead, a page at most (~6000 chars)."""

CHARS_PER_TOKEN = 4
"""The usual rough ratio for English and code; the estimate does not need more."""


@dataclass(frozen=True, slots=True)
class HelperPlan:
    """One helper as the estimate needs it: its brief, its limit and the model it would run on.

    ``price`` is None when the model has no known price. ``local`` is a model on this Mac,
    which costs nothing whatever its price says.
    """

    model: str
    brief: str
    local: bool
    price: ModelPrice | None
    max_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class HelperPart:
    """The estimate of one helper. ``usd`` is 0 for a local model."""

    model: str
    usd: float
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True, slots=True)
class BatchEstimate:
    """What a batch is estimated to cost: the sum, the first helper's model, and each part."""

    total_usd: float
    model: str
    parts: tuple[HelperPart, ...]

    def over(self, limit_usd: float) -> bool:
        """Whether the batch is to be asked about: more than ``limit_usd``."""
        return self.total_usd > limit_usd


def brief_tokens(brief: str) -> int:
    """About how many tokens ``brief`` is, at least 1 for a brief with any text."""
    return -(-len(brief) // CHARS_PER_TOKEN)


def estimate_helper(plan: HelperPlan) -> HelperPart | None:
    """The estimate of one helper, None when it is not known (a paid model with no price)."""
    if plan.local:
        return HelperPart(plan.model, 0.0, 0, 0)
    read = DEFAULT_READ_TOKENS if plan.max_tokens is None else plan.max_tokens
    tokens_in = brief_tokens(plan.brief) + read
    usd = cost_usd({"input": tokens_in, "output": ANSWER_TOKENS}, plan.price)
    if usd is None:
        return None
    return HelperPart(plan.model, usd, tokens_in, ANSWER_TOKENS)


def estimate_batch(plans: Sequence[HelperPlan]) -> BatchEstimate | None:
    """The estimate of a batch, or None when there is nothing to say about it.

    None for an empty batch, for a batch of local helpers only (it costs nothing: no estimate,
    no price, no question) and for a batch with a paid helper whose model has no price. An
    unknown price is unknown, not zero: golem cannot tell the batch is large, so it does not
    ask about it. ``model`` is the first helper's model, as ``PendingItem.model`` says.
    """
    if not plans or all(plan.local for plan in plans):
        return None
    parts: list[HelperPart] = []
    for plan in plans:
        part = estimate_helper(plan)
        if part is None:
            return None
        parts.append(part)
    return BatchEstimate(
        total_usd=round(sum(part.usd for part in parts), 6),
        model=parts[0].model,
        parts=tuple(parts),
    )


@dataclass(frozen=True, slots=True)
class EstimateCard:
    """The estimate as the batch question shows it (the fields of ``PendingItem``).

    ``allowed_usd`` is ``[agents] per_message_cost``, ``ask_over_usd`` is ``[agents]
    estimate_over`` and ``cheaper_model`` the model "Use a cheaper model" would start every
    helper on, None when there is none (the helpers already run on the cheapest one).
    """

    estimate_usd: float
    allowed_usd: float
    ask_over_usd: float
    model: str
    cheaper_model: str | None

    @property
    def over(self) -> bool:
        """Whether the batch asks before it starts."""
        return self.estimate_usd > self.ask_over_usd
