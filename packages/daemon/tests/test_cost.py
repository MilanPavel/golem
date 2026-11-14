"""The cost of one model call, from its tokens and a price."""

from __future__ import annotations

import pytest

from golem.config import ModelPrice
from golem.models.cost import cost_usd

PRICE = ModelPrice(input=3.0, output=15.0, cached_input=0.3)


def test_fresh_cached_and_written_input_each_cost_their_own_rate() -> None:
    usage = {"input": 1_000_000, "output": 0, "cache_read": 400_000, "cache_write": 100_000}
    # 500k fresh at 3, 400k read at 0.3, 100k written at 3.
    assert cost_usd(usage, PRICE) == pytest.approx(1.5 + 0.12 + 0.3)


def test_output_is_charged_at_the_output_rate() -> None:
    assert cost_usd({"input": 0, "output": 2_000_000}, PRICE) == 30.0


def test_a_price_without_cached_input_charges_cache_reads_as_input() -> None:
    price = ModelPrice(input=2.0, output=4.0)
    assert cost_usd({"input": 1_000_000, "output": 0, "cache_read": 1_000_000}, price) == 2.0


def test_a_free_price_costs_zero_not_none() -> None:
    assert cost_usd({"input": 500, "output": 20}, ModelPrice(input=0.0, output=0.0)) == 0.0


def test_no_price_is_no_cost() -> None:
    assert cost_usd({"input": 500, "output": 20}, None) is None


def test_no_input_and_no_output_is_no_cost() -> None:
    assert cost_usd({"cache_read": 5}, PRICE) is None
    assert cost_usd({"input": None, "output": None}, PRICE) is None


def test_usage_with_only_output_counts_it() -> None:
    assert cost_usd({"output": 1_000_000}, PRICE) == 15.0


def test_cache_read_larger_than_input_does_not_go_negative() -> None:
    cost = cost_usd({"input": 100, "output": 0, "cache_read": 1_000_000}, PRICE)
    assert cost == pytest.approx(0.3)


def test_the_cost_is_rounded_to_six_decimals() -> None:
    price = ModelPrice(input=0.123456789, output=0)
    assert cost_usd({"input": 1, "output": 0}, price) == 0.0
    assert cost_usd({"input": 7, "output": 0}, price) == 1e-06
