from __future__ import annotations

import pytest

from golem.config import ModelPrice
from golem.models.tiers import blended, tier_of


def test_ollama_is_local_whatever_the_price() -> None:
    assert tier_of("ollama", ModelPrice(input=0.0, output=0.0)) == "local"
    assert tier_of("ollama", ModelPrice(input=30.0, output=60.0)) == "local"
    assert tier_of("ollama", None) == "local"


def test_a_cheap_hosted_price_is_budget_and_a_dear_one_is_frontier() -> None:
    cheap = ModelPrice(input=0.28, output=1.10)
    assert blended(cheap) == pytest.approx(0.485)
    assert tier_of("deepseek", cheap) == "budget"
    dear = ModelPrice(input=3.0, output=15.0)
    assert blended(dear) == pytest.approx(6.0)
    assert tier_of("anthropic", dear) == "frontier"


def test_exactly_the_limit_is_budget() -> None:
    assert tier_of("openai", ModelPrice(input=1.5, output=1.5)) == "budget"
    assert tier_of("openai", ModelPrice(input=1.5, output=1.6)) == "frontier"


def test_an_unknown_or_partial_price_is_frontier() -> None:
    assert tier_of("openai", None) == "frontier"
    partial = ModelPrice.model_construct(input=0.1, output=None)
    assert blended(partial) is None
    assert tier_of("openai", partial) == "frontier"


def test_the_override_wins_both_ways() -> None:
    assert tier_of("deepseek", ModelPrice(input=0.1, output=0.1), override="frontier") == (
        "frontier"
    )
    assert tier_of("anthropic", ModelPrice(input=3.0, output=15.0), override="budget") == "budget"
    assert tier_of("ollama", None, override="budget") == "budget"


def test_a_custom_limit_moves_the_line() -> None:
    price = ModelPrice(input=3.0, output=15.0)
    assert tier_of("anthropic", price, budget_max_price=6.0) == "budget"
    assert tier_of("anthropic", price, budget_max_price=5.99) == "frontier"
