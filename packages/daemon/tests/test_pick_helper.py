"""``pick_helper``: a wish becomes a model, in a local-only and a cloud-only setup (ADR-059)."""

from __future__ import annotations

from itertools import combinations, product

import pytest

from golem.config import ModelPrice
from golem.models.facts import ModelFacts
from golem.models.pick import Traits
from golem.models.pick_helper import pick_helper
from golem.models.tiers import Tier, blended

LOCAL = "local"
BUDGET = "budget"
FRONTIER = "frontier"


def make(ref: str, tier: Tier, *, ready: bool = True, tools: bool | None = True) -> ModelFacts:
    price = None if tier == "local" else ModelPrice(input=0.5 if tier == "budget" else 5, output=1)
    return ModelFacts(
        ref=ref,
        profile=ref,
        tier=tier,
        ready=ready,
        why_not_ready=None if ready else "not pulled",
        window=32000,
        window_exact=True,
        tools=tools,
        vision=False,
        price=price,
        blended=None if price is None else blended(price),
        prompt_tps=None,
        reply_tps=None,
        tool_score=None,
    )


QWEN = make("ollama/qwen3:27b", "local")
SMALL = make("ollama/qwen3:8b", "local")
DEEP = make("deepseek/deepseek-chat", "budget")
OPUS = make("anthropic/opus", "frontier")
LOCAL_ONLY = [QWEN, SMALL]
CLOUD_ONLY = [DEEP, OPUS]
PRIVATE = Traits(local_only=True)


def test_cheapest_prefers_the_lead_when_it_is_local() -> None:
    got = pick_helper("cheapest", QWEN, LOCAL_ONLY, Traits())
    assert got.model == QWEN and got.reason == "cheapest" and not got.needs_consent


def test_cheapest_in_a_cloud_only_setup_is_the_cheapest_hosted_model_at_or_below_the_lead() -> None:
    assert pick_helper("cheapest", OPUS, CLOUD_ONLY, Traits()).model == DEEP
    assert pick_helper("cheapest", DEEP, CLOUD_ONLY, Traits()).model == DEEP


def test_cheapest_never_goes_above_the_lead_tier() -> None:
    assert pick_helper("cheapest", DEEP, [DEEP, OPUS], Traits()).model == DEEP
    assert pick_helper("cheapest", QWEN, [QWEN, OPUS], Traits()).model == QWEN


def test_same_is_the_lead() -> None:
    assert pick_helper("same", QWEN, LOCAL_ONLY, Traits()).model == QWEN
    got = pick_helper("same", DEEP, CLOUD_ONLY, Traits(paid_allowed=False))
    assert got.model == DEEP and got.reason == "same" and not got.needs_consent


def test_stronger_in_a_local_only_setup_is_the_lead_in_a_fresh_window() -> None:
    got = pick_helper("stronger", QWEN, LOCAL_ONLY, Traits())
    assert got.model == QWEN and got.fresh_window and "fresh window" in got.detail


def test_stronger_in_a_cloud_only_setup_is_one_tier_up() -> None:
    got = pick_helper("stronger", DEEP, CLOUD_ONLY, Traits())
    assert got.model == OPUS and got.reason == "stronger" and got.needs_consent
    assert not pick_helper("stronger", DEEP, CLOUD_ONLY, Traits(paid_allowed=True)).needs_consent


def test_stronger_from_the_top_tier_is_the_lead_in_a_fresh_window() -> None:
    got = pick_helper("stronger", OPUS, CLOUD_ONLY, Traits())
    assert got.model == OPUS and got.fresh_window and "top tier" in got.detail


def test_a_tier_wish_takes_that_tier() -> None:
    assert pick_helper("local", QWEN, LOCAL_ONLY, Traits()).model == QWEN
    assert pick_helper("frontier", DEEP, CLOUD_ONLY, Traits()).model == OPUS
    assert pick_helper("budget", QWEN, [QWEN, DEEP, OPUS], Traits()).model == DEEP


def test_a_missing_tier_falls_to_the_nearest_tier() -> None:
    assert pick_helper("budget", QWEN, LOCAL_ONLY, Traits()).reason == "nearest"
    got = pick_helper("local", DEEP, CLOUD_ONLY, Traits())
    assert got.model == DEEP and got.reason == "nearest"
    assert pick_helper("budget", QWEN, [QWEN, OPUS], Traits()).model == QWEN  # the cheaper tie


def test_a_named_model_is_taken_when_it_is_ready() -> None:
    assert pick_helper(SMALL.ref, QWEN, LOCAL_ONLY, Traits()).model == SMALL
    assert pick_helper(OPUS.ref, DEEP, CLOUD_ONLY, Traits()).reason == "named"


def test_a_named_model_that_is_not_ready_falls_to_its_tier_then_the_lead() -> None:
    down = make("ollama/down", "local", ready=False)
    got = pick_helper(down.ref, QWEN, [QWEN, down], Traits())
    assert got.model == QWEN and any(r.ref == down.ref for r in got.rejected)
    assert pick_helper("nobody/none", DEEP, CLOUD_ONLY, Traits()).model == DEEP


def test_privacy_keeps_every_helper_local() -> None:
    mixed = [QWEN, DEEP, OPUS]
    for wish in ("cheapest", "same", "stronger", "local", "budget", "frontier", OPUS.ref):
        got = pick_helper(wish, QWEN, mixed, PRIVATE)
        assert got.model.tier == "local", wish
        assert {r.ref for r in got.rejected} >= {DEEP.ref, OPUS.ref}
    got = pick_helper("frontier", QWEN, mixed, PRIVATE)
    assert got.fresh_window and not got.needs_consent


def test_privacy_beats_a_hosted_lead() -> None:
    assert pick_helper("same", OPUS, [QWEN, OPUS], PRIVATE).model == QWEN


def test_a_spent_budget_leaves_only_local_models() -> None:
    got = pick_helper("frontier", QWEN, [QWEN, OPUS], Traits(paid_room_usd=0))
    assert got.model == QWEN


def test_the_result_has_a_reason_and_the_rejected_list() -> None:
    got = pick_helper("stronger", QWEN, [QWEN, make("ollama/down", "local", ready=False)], Traits())
    assert got.detail and got.reason
    assert [r.ref for r in got.rejected] == ["ollama/down"]


def _setups() -> list[tuple[ModelFacts, ...]]:
    pool = [QWEN, SMALL, DEEP, OPUS, make("moonshot/kimi", "budget")]
    return [c for n in range(len(pool) + 1) for c in combinations(pool, n)]


@pytest.mark.parametrize("private", [False, True])
def test_a_ready_lead_always_gives_a_model(private: bool) -> None:
    wishes = ["cheapest", "same", "stronger", "local", "budget", "frontier", OPUS.ref, "x/y"]
    for setup, wish, paid in product(_setups(), wishes, (False, True)):
        for lead in (QWEN, DEEP, OPUS):
            traits = Traits(local_only=private, paid_allowed=paid)
            got = pick_helper(wish, lead, setup, traits)
            assert got.model.ready
            assert got.reason and got.detail
            if private and any(m.tier == "local" for m in (*setup, lead)):
                assert got.model.tier == "local"
