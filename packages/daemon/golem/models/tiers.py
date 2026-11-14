"""Which tier a model is in: local, budget or frontier. Pure; no I/O."""

from __future__ import annotations

from typing import Literal

from golem.config import ModelPrice

Tier = Literal["local", "budget", "frontier"]
TIERS: tuple[Tier, ...] = ("local", "budget", "frontier")

# USD per million tokens, blended. A hosted model at or below this is budget.
BUDGET_MAX_PRICE = 1.50


def blended(price: ModelPrice) -> float | None:
    """``(3 * input + output) / 4``, in USD per million tokens. None when a part is missing.

    An agent's calls read far more than they write, so the input price counts three
    times for each one of the output price.
    """
    if price.input is None or price.output is None:  # pyright: ignore[reportUnnecessaryComparison]
        return None
    return (3 * price.input + price.output) / 4


def tier_of(
    provider: str,
    price: ModelPrice | None,
    *,
    override: Tier | None = None,
    budget_max_price: float = BUDGET_MAX_PRICE,
) -> Tier:
    """The tier of a model. ``override`` wins, then provider ``ollama`` is local.

    A hosted model at or below ``budget_max_price`` blended is budget. Anything else, an
    unknown price included, is frontier: an unknown price must never look cheap.
    """
    if override is not None:
        return override
    if provider == "ollama":
        return "local"
    if price is None:
        return "frontier"
    cost = blended(price)
    if cost is not None and cost <= budget_max_price:
        return "budget"
    return "frontier"
