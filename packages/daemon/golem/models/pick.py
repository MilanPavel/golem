"""The routing rules as one pure function: which model takes the next call. No I/O."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from golem.config import LadderSettings, RouteMode
from golem.models.facts import ModelFacts
from golem.models.tiers import TIERS, Tier

Reason = Literal[
    "pinned",
    "privacy",
    "fit",
    "budget",
    "cheapest",
    "escalated",
    "fallback",
    "user",
    # The words of a helper's pick (``pick_helper``), written into ``model.routed`` as they are.
    "same",
    "stronger",
    "tier",
    "named",
    "nearest",
    "lead",
]

MIN_LOCAL_TOOL_SCORE = 0.5
"""A local model whose measured tool score is below this does not take a call that needs tools,
while another candidate can. See ADR-055."""

_RANK = {tier: rank for rank, tier in enumerate(TIERS)}


@dataclass(frozen=True, slots=True)
class Traits:
    prompt_tokens: int | None = None  # estimate of what the call will send
    reply_reserve: int = 4096
    needs_tools: bool = True
    has_image: bool = False
    local_only: bool = False  # the folder is private
    paid_allowed: bool = False  # the user agreed for this session
    paid_room_usd: float | None = None  # what the caps still allow; None no cap; 0 spent
    min_tier: Tier | None = None  # a step-up asks for at least this tier


@dataclass(frozen=True, slots=True)
class Rejected:
    ref: str
    tier: Tier
    why: str  # plain words, shown to the user


@dataclass(frozen=True, slots=True)
class Choice:
    model: ModelFacts | None  # None when nothing passes
    reason: Reason
    detail: str  # one short sentence
    rejected: tuple[Rejected, ...]
    needs_consent: bool = False  # the best candidate is paid and the user has not agreed yet


def size_text(count: int) -> str:
    """A token count the way the UI writes it: ``612``, ``32K``, ``41.5K``."""
    if count < 1000:
        return str(count)
    if count % 1000 == 0:
        return f"{count // 1000}K"
    if count % 1024 == 0:
        return f"{count // 1024}K"
    return f"{count / 1000:.1f}K"


def _unfit(model: ModelFacts, traits: Traits) -> str | None:
    if not model.ready:
        return model.why_not_ready or "not ready"
    if traits.needs_tools and model.tools is False:
        return "does not call tools"
    if traits.has_image and not model.vision:
        return "cannot read images"
    window, prompt = model.window, traits.prompt_tokens
    if window is not None and prompt is not None and prompt + traits.reply_reserve > window:
        return f"does not fit: {size_text(prompt)} of {size_text(window)}"
    return None


def _weak_tools(model: ModelFacts) -> bool:
    score = model.tool_score
    return model.tier == "local" and score is not None and score < MIN_LOCAL_TOOL_SCORE


def _weak_why(model: ModelFacts) -> str:
    ok = round((model.tool_score or 0.0) * 100)
    return f"its tool calls fail too often on this Mac ({ok}% ok)"


def _order(model: ModelFacts) -> tuple[float, ...]:
    """Tier, then blended price, then reply speed, then tool score, then the ref. Best first."""
    return (
        _RANK[model.tier],
        model.blended is None,
        model.blended or 0.0,
        model.reply_tps is None,
        -(model.reply_tps or 0.0),
        model.tool_score is None,
        -(model.tool_score or 0.0),
    )


def _key(model: ModelFacts) -> tuple[tuple[float, ...], str]:
    return _order(model), model.ref


def pick(
    mode: RouteMode,
    session_model: ModelFacts,
    candidates: Sequence[ModelFacts],
    traits: Traits,
) -> Choice:
    if mode == "pinned":
        return Choice(session_model, "pinned", "the model you chose", ())

    rejected: list[Rejected] = []
    last: Reason = "cheapest"
    privacy = False
    budget = False
    unfit: list[ModelFacts] = []  # removed by the fit rule
    left = list(candidates)

    def drop(model: ModelFacts, why: str) -> None:
        rejected.append(Rejected(model.ref, model.tier, why))

    if mode == "local" or traits.local_only:
        kept: list[ModelFacts] = []
        for model in left:
            if model.tier == "local":
                kept.append(model)
            else:
                drop(model, "this chat stays on this Mac")
        if len(kept) < len(left):
            privacy, last = True, "privacy"
        left = kept

    kept = []
    for model in left:
        why = _unfit(model, traits)
        if why is None:
            kept.append(model)
        else:
            drop(model, why)
            unfit.append(model)
    if unfit:
        last = "fit"
    left = kept

    if traits.min_tier is not None:
        floor = _RANK[traits.min_tier]
        kept = []
        for model in left:
            if _RANK[model.tier] >= floor:
                kept.append(model)
            else:
                drop(model, "a stronger model was asked for")
        if len(kept) < len(left):
            last = "fit"
        left = kept

    if traits.paid_room_usd is not None and traits.paid_room_usd <= 0:
        kept = []
        for model in left:
            if model.tier == "local":
                kept.append(model)
            else:
                drop(model, "the budget is spent")
        if len(kept) < len(left):
            budget, last = True, "budget"
        left = kept

    weak: list[ModelFacts] = []  # local models left out for failing tool calls
    if traits.needs_tools:
        weak = [m for m in left if _weak_tools(m)]
        if weak and len(weak) < len(left):
            for model in weak:
                drop(model, _weak_why(model))
            left = [m for m in left if m not in weak]
            last = "fit"
            unfit.extend(weak)
        else:
            weak = []

    if not left:
        return Choice(None, last, _nothing(last), tuple(rejected))

    winner = min(left, key=_key)
    consent = winner.tier != "local" and not traits.paid_allowed
    outranked = [m for m in unfit if _key(m) < _key(winner)]
    if privacy and winner.tier == "local":
        return Choice(winner, "privacy", "this chat stays on this Mac", tuple(rejected), consent)
    if outranked:
        first = outranked[0]
        if first in weak:
            detail = f"{first.ref} {_weak_why(first)}"
        elif first.window is not None and first.ready:
            detail = f"did not fit in {size_text(first.window)} on {first.ref}"
        else:
            detail = f"{first.ref} {rejected_why(rejected, first.ref)}"
        return Choice(winner, "fit", detail, tuple(rejected), consent)
    if budget:
        return Choice(winner, "budget", "the budget is spent", tuple(rejected), consent)
    return Choice(winner, "cheapest", "the cheapest model that fits", tuple(rejected), consent)


def rejected_why(rejected: Sequence[Rejected], ref: str) -> str:
    return next((r.why for r in rejected if r.ref == ref), "was left out")


def _nothing(reason: Reason) -> str:
    if reason == "privacy":
        return "no model on this Mac can take this call"
    if reason == "budget":
        return "the budget is spent"
    return "no model fits this call"


def tier_picks(
    settings: LadderSettings, session_ref: str, all_facts: Sequence[ModelFacts]
) -> dict[Tier, ModelFacts | None]:
    """The model for each tier: the one the ladder names, else the one golem would choose."""
    by_name = {facts.profile: facts for facts in all_facts}
    by_name.update({facts.ref: facts for facts in all_facts})
    session = by_name.get(session_ref)

    local = None if settings.local is None else by_name.get(settings.local)
    if settings.local is None:
        if session is not None and session.tier == "local":
            local = session
        else:
            ready = [f for f in all_facts if f.tier == "local" and f.ready]
            local = max(ready, key=lambda f: (f.window or 0, f.ref), default=None)

    budget = None if settings.budget is None else by_name.get(settings.budget)
    if settings.budget is None:
        cheap = [
            f
            for f in all_facts
            if f.tier == "budget" and f.ready and f.tools is True and f.blended is not None
        ]
        budget = min(cheap, key=lambda f: (f.blended or 0.0, f.ref), default=None)

    frontier = None if settings.frontier is None else by_name.get(settings.frontier)
    if settings.frontier is None and session is not None and session.tier == "frontier":
        frontier = session
    return {"local": local, "budget": budget, "frontier": frontier}


def ladder(
    settings: LadderSettings, session_ref: str, all_facts: Sequence[ModelFacts]
) -> list[ModelFacts]:
    """The candidates for a session: one model per tier. Its own model joins only when its tier
    has no pick."""
    by_name = {facts.profile: facts for facts in all_facts}
    by_name.update({facts.ref: facts for facts in all_facts})
    session = by_name.get(session_ref)
    picks = tier_picks(settings, session_ref, all_facts)
    found: list[ModelFacts] = (
        [] if session is None or picks[session.tier] is not None else [session]
    )
    for model in picks.values():
        if model is not None and all(model.ref != seen.ref for seen in found):
            found.append(model)
    return found
