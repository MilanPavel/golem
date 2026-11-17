from __future__ import annotations

from dataclasses import dataclass, replace

import pytest

from golem.config import LadderSettings, ModelPrice, RouteMode
from golem.models.facts import ModelFacts
from golem.models.pick import Traits, ladder, pick
from golem.models.tiers import Tier, blended


def facts(
    ref: str,
    tier: Tier,
    *,
    window: int | None = 32768,
    ready: bool = True,
    why: str | None = None,
    tools: bool | None = True,
    vision: bool = False,
    price: float | None = None,
    reply_tps: float | None = None,
    tool_score: float | None = None,
) -> ModelFacts:
    model_price = None if price is None else ModelPrice(input=price, output=price)
    return ModelFacts(
        ref=ref,
        profile=ref,
        tier=tier,
        ready=ready,
        why_not_ready=why,
        window=window,
        window_exact=window is not None,
        tools=tools,
        vision=vision,
        price=model_price,
        blended=None if model_price is None else blended(model_price),
        prompt_tps=None,
        reply_tps=reply_tps,
        tool_score=tool_score,
    )


LOCAL = facts("ollama/qwen3:27b", "local")
CHEAP = facts("openrouter/cheap", "budget", window=128000, price=0.5)
BIG = facts("anthropic/big", "frontier", window=200000, price=5.0, vision=True)

ALL = [LOCAL, CHEAP, BIG]


def ref(choice_model: ModelFacts | None) -> str | None:
    return None if choice_model is None else choice_model.ref


@dataclass(frozen=True)
class Row:
    name: str
    mode: RouteMode
    session: ModelFacts
    candidates: list[ModelFacts]
    traits: Traits
    model: str | None
    reason: str
    consent: bool
    refs: list[str]


ROWS = [
    Row(
        "pinned ignores state",
        "pinned",
        replace(LOCAL, ready=False, why_not_ready="server is down"),
        ALL,
        Traits(),
        "ollama/qwen3:27b",
        "pinned",
        False,
        [],
    ),
    Row(
        "everything fits",
        "auto",
        LOCAL,
        ALL,
        Traits(prompt_tokens=1000),
        "ollama/qwen3:27b",
        "cheapest",
        False,
        [],
    ),
    Row(
        "local mode keeps hosted out",
        "local",
        LOCAL,
        ALL,
        Traits(prompt_tokens=1000),
        "ollama/qwen3:27b",
        "privacy",
        False,
        ["openrouter/cheap", "anthropic/big"],
    ),
    Row(
        "local mode, nothing fits",
        "local",
        LOCAL,
        ALL,
        Traits(prompt_tokens=41000),
        None,
        "fit",
        False,
        ["openrouter/cheap", "anthropic/big", "ollama/qwen3:27b"],
    ),
    Row(
        "local_only trait",
        "auto",
        CHEAP,
        ALL,
        Traits(local_only=True),
        "ollama/qwen3:27b",
        "privacy",
        False,
        ["openrouter/cheap", "anthropic/big"],
    ),
    Row(
        "too big for local, paid not agreed",
        "auto",
        LOCAL,
        ALL,
        Traits(prompt_tokens=41000),
        "openrouter/cheap",
        "fit",
        True,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "too big for local, paid agreed",
        "auto",
        LOCAL,
        ALL,
        Traits(prompt_tokens=41000, paid_allowed=True),
        "openrouter/cheap",
        "fit",
        False,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "too big for local, budget spent",
        "auto",
        LOCAL,
        ALL,
        Traits(prompt_tokens=41000, paid_allowed=True, paid_room_usd=0),
        None,
        "budget",
        False,
        ["ollama/qwen3:27b", "openrouter/cheap", "anthropic/big"],
    ),
    Row(
        "budget spent, local still fits",
        "auto",
        LOCAL,
        ALL,
        Traits(prompt_tokens=1000, paid_room_usd=0),
        "ollama/qwen3:27b",
        "budget",
        False,
        ["openrouter/cheap", "anthropic/big"],
    ),
    Row(
        "image, no local vision",
        "auto",
        LOCAL,
        ALL,
        Traits(has_image=True),
        "anthropic/big",
        "fit",
        True,
        ["ollama/qwen3:27b", "openrouter/cheap"],
    ),
    Row(
        "image, cheapest hosted vision",
        "auto",
        LOCAL,
        [LOCAL, replace(CHEAP, vision=True), BIG],
        Traits(has_image=True, paid_allowed=True),
        "openrouter/cheap",
        "fit",
        False,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "not ready is skipped with its words",
        "auto",
        LOCAL,
        [replace(LOCAL, ready=False, why_not_ready="server is down"), CHEAP],
        Traits(),
        "openrouter/cheap",
        "fit",
        True,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "no tools",
        "auto",
        LOCAL,
        [replace(LOCAL, tools=False), CHEAP],
        Traits(),
        "openrouter/cheap",
        "fit",
        True,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "unknown window passes",
        "auto",
        LOCAL,
        [replace(LOCAL, window=None)],
        Traits(prompt_tokens=900000),
        "ollama/qwen3:27b",
        "cheapest",
        False,
        [],
    ),
    Row(
        "min_tier skips local",
        "auto",
        LOCAL,
        ALL,
        Traits(min_tier="budget", paid_allowed=True),
        "openrouter/cheap",
        "cheapest",
        False,
        ["ollama/qwen3:27b"],
    ),
    Row(
        "tie: cheaper blended first",
        "auto",
        LOCAL,
        [facts("b/x", "budget", price=0.9, reply_tps=99), facts("a/y", "budget", price=0.4)],
        Traits(paid_allowed=True),
        "a/y",
        "cheapest",
        False,
        [],
    ),
    Row(
        "tie: faster next",
        "auto",
        LOCAL,
        [
            facts("a/x", "budget", price=0.4, reply_tps=10),
            facts("b/y", "budget", price=0.4, reply_tps=20),
        ],
        Traits(paid_allowed=True),
        "b/y",
        "cheapest",
        False,
        [],
    ),
    Row(
        "tie: then the ref",
        "auto",
        LOCAL,
        [facts("b/x", "budget", price=0.4), facts("a/x", "budget", price=0.4)],
        Traits(paid_allowed=True),
        "a/x",
        "cheapest",
        False,
        [],
    ),
]


@pytest.mark.parametrize("row", ROWS, ids=[row.name for row in ROWS])
def test_pick_table(row: Row) -> None:
    choice = pick(row.mode, row.session, row.candidates, row.traits)
    assert ref(choice.model) == row.model
    assert choice.reason == row.reason
    assert choice.needs_consent is row.consent
    assert [r.ref for r in choice.rejected] == row.refs


def test_rejections_use_plain_words() -> None:
    choice = pick("auto", LOCAL, ALL, Traits(prompt_tokens=41000))
    assert choice.rejected[0].why == "does not fit: 41K of 32K"
    assert choice.detail == "did not fit in 32K on ollama/qwen3:27b"
    down = replace(LOCAL, ready=False, why_not_ready="server is down")
    assert pick("auto", LOCAL, [down, CHEAP], Traits()).rejected[0].why == "server is down"
    local = pick("local", LOCAL, ALL, Traits())
    assert {r.why for r in local.rejected} == {"this chat stays on this Mac"}
    assert local.detail == "this chat stays on this Mac"


def test_nothing_left_has_the_reason_of_the_last_rule() -> None:
    choice = pick("auto", LOCAL, ALL, Traits(prompt_tokens=41000, paid_room_usd=0))
    assert choice.model is None
    assert choice.reason == "budget"


# --- ladder


def test_ladder_defaults() -> None:
    other = facts("ollama/small", "local", window=8192)
    found = ladder(LadderSettings(), "ollama/small", [LOCAL, other, CHEAP, BIG])
    assert [m.ref for m in found] == ["ollama/small", "openrouter/cheap"]


def test_ladder_local_is_the_largest_window_for_a_hosted_session() -> None:
    other = facts("ollama/small", "local", window=8192)
    down = facts("ollama/huge", "local", window=999999, ready=False, why="server is down")
    found = ladder(LadderSettings(), "anthropic/big", [other, LOCAL, down, CHEAP, BIG])
    assert [m.ref for m in found] == ["ollama/qwen3:27b", "openrouter/cheap", "anthropic/big"]


def test_ladder_own_model_is_no_extra_candidate_when_its_tier_has_a_pick() -> None:
    other = facts("ollama/small", "local", window=8192)
    found = ladder(LadderSettings(local="ollama/small"), "ollama/qwen3:27b", [LOCAL, other])
    assert [m.ref for m in found] == ["ollama/small"]


def test_ladder_own_model_joins_when_its_tier_has_no_pick() -> None:
    found = ladder(LadderSettings(), "anthropic/big", [CHEAP, BIG])
    assert [m.ref for m in found] == ["openrouter/cheap", "anthropic/big"]


def test_ladder_budget_needs_tools_and_the_lowest_price() -> None:
    no_tools = facts("x/notools", "budget", price=0.1, tools=False)
    unknown = facts("x/unknown", "budget", price=0.1, tools=None)
    pricey = facts("x/pricey", "budget", price=1.0)
    found = ladder(LadderSettings(), "ollama/qwen3:27b", [LOCAL, no_tools, unknown, pricey, CHEAP])
    assert [m.ref for m in found] == ["ollama/qwen3:27b", "openrouter/cheap"]


def test_ladder_has_no_frontier_by_default() -> None:
    found = ladder(LadderSettings(), "ollama/qwen3:27b", ALL)
    assert all(m.tier != "frontier" for m in found)


def test_ladder_frontier_when_configured_or_the_session_model() -> None:
    settings = LadderSettings(frontier="anthropic/big")
    assert "anthropic/big" in [m.ref for m in ladder(settings, "ollama/qwen3:27b", ALL)]
    assert ladder(LadderSettings(), "anthropic/big", ALL)[-1].ref == "anthropic/big"


def test_ladder_uses_configured_refs() -> None:
    other = facts("ollama/small", "local", window=8192)
    settings = LadderSettings(local="ollama/small", budget="x/mine")
    mine = facts("x/mine", "budget", price=1.4)
    found = ladder(settings, "anthropic/big", [LOCAL, other, CHEAP, BIG, mine])
    assert [m.ref for m in found] == ["ollama/small", "x/mine", "anthropic/big"]


def test_ladder_has_no_duplicates() -> None:
    settings = LadderSettings(local="ollama/qwen3:27b", budget="anthropic/big")
    found = ladder(settings, "ollama/qwen3:27b", ALL)
    assert [m.ref for m in found] == ["ollama/qwen3:27b", "anthropic/big"]


def test_a_local_model_with_a_poor_tool_score_loses_to_a_model_that_passes() -> None:
    weak = replace(LOCAL, tool_score=0.4)
    choice = pick("auto", weak, [weak, CHEAP], Traits(paid_allowed=True))
    assert ref(choice.model) == "openrouter/cheap"
    assert choice.reason == "fit"
    assert [(r.ref, r.why) for r in choice.rejected] == [
        ("ollama/qwen3:27b", "its tool calls fail too often on this Mac (40% ok)")
    ]
    assert "fail too often" in choice.detail


def test_a_local_model_with_a_poor_tool_score_is_used_when_nothing_else_passes() -> None:
    weak = replace(LOCAL, tool_score=0.4)
    choice = pick("auto", weak, [weak, CHEAP], Traits(paid_room_usd=0.0))
    assert ref(choice.model) == "ollama/qwen3:27b"
    assert pick("auto", weak, [weak], Traits()).model == weak


def test_a_poor_tool_score_does_not_matter_for_a_call_without_tools() -> None:
    weak = replace(LOCAL, tool_score=0.4)
    choice = pick("auto", weak, [weak, CHEAP], Traits(needs_tools=False))
    assert ref(choice.model) == "ollama/qwen3:27b"


def test_a_good_or_unknown_tool_score_is_not_rejected() -> None:
    for score in (0.5, 0.9, None):
        model = replace(LOCAL, tool_score=score)
        assert ref(pick("auto", model, [model, CHEAP], Traits()).model) == "ollama/qwen3:27b"
