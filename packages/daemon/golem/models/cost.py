"""What one model call cost. Pure: tokens and a price in, dollars out."""

from __future__ import annotations

from collections.abc import Mapping

from golem.config import ModelPrice


def cost_usd(usage: Mapping[str, int | None], price: ModelPrice | None) -> float | None:
    """The cost in USD of a call with ``usage`` at ``price``, rounded to 6 decimals.

    ``input`` is the whole input, cached tokens included. Cache reads are charged at
    ``cached_input`` (``input`` when the price has none) and cache writes at ``input``.
    None when there is no price, or no ``input`` and no ``output`` count. A free
    price gives 0.0.
    """
    if price is None or (usage.get("input") is None and usage.get("output") is None):
        return None
    total = usage.get("input") or 0
    read = usage.get("cache_read") or 0
    write = usage.get("cache_write") or 0
    out = usage.get("output") or 0
    rate_in = price.input or 0.0
    rate_out = price.output or 0.0
    rate_read = price.cached_input if price.cached_input is not None else rate_in
    fresh = max(total - read - write, 0)
    cost = fresh * rate_in + read * rate_read + write * rate_in + out * rate_out
    return round(cost / 1_000_000, 6)
