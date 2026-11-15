"""The token ratios learned from finished calls."""

from __future__ import annotations

from golem.graphs.estimate import DEFAULT_RATIO, KEEP, TokenRatios


def test_a_model_with_no_calls_gets_the_default() -> None:
    ratios = TokenRatios()
    assert ratios.learned("m") is None
    assert ratios.ratio("m") == DEFAULT_RATIO == 0.3
    assert ratios.estimate("m", 1000) == 300


def test_a_finished_call_teaches_its_ratio_to_its_model_only() -> None:
    ratios = TokenRatios()
    ratios.note("m", chars=10000, tokens=2500, window=8192)
    assert ratios.ratio("m") == 0.25
    assert ratios.ratio("other") == DEFAULT_RATIO
    assert ratios.estimate("m", 4000) == 1000


def test_small_calls_and_cut_calls_are_ignored() -> None:
    ratios = TokenRatios()
    ratios.note("m", chars=1999, tokens=900, window=8192)
    ratios.note("m", chars=10000, tokens=8192, window=8192)
    ratios.note("m", chars=10000, tokens=7947, window=8192)
    ratios.note("m", chars=10000, tokens=0, window=8192)
    assert ratios.learned("m") is None
    # Just under 97% of the window counts, and so does any call with no known window.
    ratios.note("m", chars=40000, tokens=7946, window=8192)
    ratios.note("n", chars=10000, tokens=8192, window=None)
    assert ratios.learned("m") is not None
    assert ratios.learned("n") is not None


def test_the_ratio_is_the_80th_percentile_of_the_last_twenty() -> None:
    ratios = TokenRatios()
    for tokens in (2000, 2500, 3000, 3500, 4000):
        ratios.note("m", chars=10000, tokens=tokens, window=None)
    # Nearest rank: the 4th of 5.
    assert ratios.ratio("m") == 0.35
    for _ in range(KEEP):
        ratios.note("m", chars=10000, tokens=2000, window=None)
    assert ratios.ratio("m") == 0.2


def test_the_ratio_is_clamped() -> None:
    ratios = TokenRatios()
    ratios.note("low", chars=100000, tokens=1000, window=None)
    ratios.note("high", chars=10000, tokens=9000, window=None)
    assert ratios.ratio("low") == 0.15
    assert ratios.ratio("high") == 0.6


def test_each_message_adds_three_tokens() -> None:
    ratios = TokenRatios()
    assert ratios.estimate("m", 1000, messages=4) == 300 + 12
    assert ratios.estimate("m", 0, messages=2) == 6
