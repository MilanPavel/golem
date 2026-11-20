"""A helper's model from a wish (ADR-059, section 5). Pure; no clock, no file, no I/O.

The order: privacy first, then the wished tier, then the nearest tier there is, then the lead's
model. It never fails on an empty tier.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Literal

from golem.models.facts import ModelFacts
from golem.models.pick import (
    _RANK,  # pyright: ignore[reportPrivateUsage]
    Rejected,
    Traits,
    _key,  # pyright: ignore[reportPrivateUsage]
    _unfit,  # pyright: ignore[reportPrivateUsage]
    _weak_tools,  # pyright: ignore[reportPrivateUsage]
    _weak_why,  # pyright: ignore[reportPrivateUsage]
)
from golem.models.tiers import TIERS, Tier

Wish = Literal["cheapest", "same", "stronger", "local", "budget", "frontier"] | str
"""``cheapest``, ``same``, ``stronger``, a tier, or the ref or profile of a model."""

HelperReason = Literal[
    "same", "cheapest", "stronger", "tier", "named", "nearest", "privacy", "lead"
]


@dataclass(frozen=True, slots=True)
class HelperChoice:
    model: ModelFacts  # never none
    reason: HelperReason
    detail: str  # plain words: what was picked and why
    rejected: tuple[Rejected, ...]
    fresh_window: bool = False  # the lead's (or a local) model, standing in for what was wished
    needs_consent: bool = False  # a paid model and the chat has not agreed yet


def pick_helper(
    wish: Wish,
    lead: ModelFacts,
    candidates: Sequence[ModelFacts],
    traits: Traits,
) -> HelperChoice:
    """The model of one helper.

    ``candidates`` are the models of the setup; the lead's model joins when it is not among
    them. ``traits.local_only`` keeps every helper local. When nothing qualifies the answer is
    the lead's model (or, in a private chat whose lead is hosted, the best local one), so a
    ready lead always gives a model.
    """
    pool: list[ModelFacts] = list(candidates)
    if all(m.ref != lead.ref for m in pool):
        pool.append(lead)

    rejected: list[Rejected] = []

    def drop(model: ModelFacts, why: str) -> None:
        rejected.append(Rejected(model.ref, model.tier, why))

    private = traits.local_only
    if private:
        kept: list[ModelFacts] = []
        for model in pool:
            if model.tier == "local":
                kept.append(model)
            else:
                drop(model, "this chat stays on this Mac")
        pool = kept

    kept = []
    for model in pool:
        why = _unfit(model, traits)
        if why is None:
            kept.append(model)
        else:
            drop(model, why)
    pool = kept

    if traits.paid_room_usd is not None and traits.paid_room_usd <= 0:
        kept = []
        for model in pool:
            if model.tier == "local":
                kept.append(model)
            else:
                drop(model, "the budget is spent")
        pool = kept

    if traits.needs_tools:
        weak = [m for m in pool if _weak_tools(m)]
        if weak and len(weak) < len(pool):
            for model in weak:
                drop(model, _weak_why(model))
            pool = [m for m in pool if m not in weak]

    rejects = tuple(rejected)

    def done(
        model: ModelFacts, reason: HelperReason, detail: str, *, fresh: bool = False
    ) -> HelperChoice:
        consent = model.tier != "local" and model.ref != lead.ref and not traits.paid_allowed
        return HelperChoice(model, reason, detail, rejects, fresh, consent)

    def lead_model(reason: HelperReason, detail: str) -> HelperChoice:
        """The lead's model with a fresh window. In a private chat it is a local model."""
        if private and lead.tier != "local":
            local = sorted((m for m in pool if m.tier == "local"), key=_key)
            if local:
                return done(
                    local[0], "privacy", f"{detail}; this chat stays on this Mac", fresh=True
                )
        return done(lead, reason, detail, fresh=True)

    def at(tier: Tier) -> ModelFacts | None:
        return min((m for m in pool if m.tier == tier), key=_key, default=None)

    def nearest(tier: Tier) -> ModelFacts | None:
        """The model of ``tier``, else of the closest tier; the cheaper one on a tie."""
        rank = _RANK[tier]
        for distance in range(len(TIERS)):
            for step in (-distance, distance):
                if 0 <= rank + step < len(TIERS):
                    found = at(TIERS[rank + step])
                    if found is not None:
                        return found
        return None

    def wished_tier(tier: Tier, name: str) -> HelperChoice:
        if private and tier != "local":
            return lead_model("privacy", f"a {name} model is not allowed in this chat")
        found = nearest(tier)
        if found is None:
            return lead_model("lead", f"no {name} model is ready, so the lead's model")
        if found.tier == tier:
            return done(found, "tier", f"the {name} model")
        return done(
            found, "nearest", f"no {tier} model is ready, so the nearest tier, {found.tier}"
        )

    if wish == "same":
        if private and lead.tier != "local":
            return lead_model("privacy", "the lead's model is hosted")
        return done(lead, "same", "the lead's model")

    if wish == "cheapest":
        floor = _RANK[lead.tier]
        low = [m for m in pool if _RANK[m.tier] <= floor]
        if not low:
            return lead_model("lead", "no cheaper model is ready, so the lead's model")
        best = min(low, key=lambda m: (not (m.tier == "local" and m.ref == lead.ref), _key(m)))
        if best.tier == "local":
            return done(best, "cheapest", "a local model, which costs nothing")
        return done(best, "cheapest", "the cheapest hosted model at or below the lead's tier")

    if wish == "stronger":
        for rank in range(_RANK[lead.tier] + 1, len(TIERS)):
            found = at(TIERS[rank])
            if found is not None:
                return done(found, "stronger", f"the {found.tier} tier, above the lead's")
        why = (
            "the lead is on the top tier"
            if _RANK[lead.tier] == len(TIERS) - 1
            else "no stronger model is ready"
            if not private
            else "this chat stays on this Mac"
        )
        return lead_model("lead", f"{why}, so the lead's model with a fresh window")

    if wish in TIERS:
        return wished_tier(wish, wish)  # pyright: ignore[reportArgumentType]

    named = next((m for m in pool if wish in (m.ref, m.profile)), None)
    if named is not None:
        return done(named, "named", f"the model you named, {named.ref}")
    known = next((m for m in candidates if wish in (m.ref, m.profile)), None)
    if known is not None:
        # The named model is known but not usable now: its tier, and the line says why.
        choice = wished_tier(known.tier, known.tier)
        return replace(choice, detail=f"{known.ref} cannot be used now; {choice.detail}")
    return lead_model("lead", f"{wish} is not a model that is ready, so the lead's model")
