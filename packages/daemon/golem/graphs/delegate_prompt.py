"""The system prompt section that says when to call ``delegate``, and for which agent types.

The text is short, because a small local lead pays for every token on every call. It says to
fold (do the work in the chat) by default, names the reasons of ADR-059, section 2 that can hold
for this lead, and gives one line for each agent type that fits one of them. Which reasons can
hold is asked of the policy of step 15.4 (:func:`~golem.graphs.delegate_policy.should_delegate`)
with a probe job for each reason, so the thresholds are the policy's and none is repeated here.
Pure: no I/O.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from golem.agents.model import Agent
from golem.config import DelegateSettings
from golem.graphs.delegate_policy import JobEstimate, Prices, should_delegate, working_window
from golem.graphs.prompt import PromptContext, Section
from golem.models.tiers import TIERS, Tier, blended

if TYPE_CHECKING:
    from golem.models.discovery import ListedModel

DELEGATE_SECTION = "delegate"

SMALL_WINDOW = 65_536
"""A local lead with a window at or below this many tokens is told when to use a helper. A local
lead with a larger one is told nothing. A cloud lead is told by the policy."""

_STRONGER = frozenset({"stronger", "frontier", "budget"})
"""Wishes that name a paid model above a local one."""
_PLAIN = frozenset({"cheapest", "same", "local"})


@dataclass(frozen=True, slots=True)
class Reasons:
    """Which of the three reasons can hold for a lead, as the policy answers."""

    window: bool = False
    at_once: bool = False
    hard: bool = False  # reason 3, one hard question to a stronger model
    cheaper: bool = False  # reason 3, a large read on a cheaper model


def reasons_for(
    window: int, tier: Tier, prices: Prices, settings: DelegateSettings | None = None
) -> Reasons:
    """The reasons that can hold for a lead of this ``window`` and ``tier``, from the policy.

    Each reason gets a probe job that sits just over its threshold, and the policy decides.
    A local lead gets the window reason only with a small window, and of the others only the
    hard question, when a stronger model is ready.
    """
    cfg = settings or DelegateSettings()

    def reason(estimate: JobEstimate) -> str | None:
        return should_delegate(window, 0, estimate, prices, tier, 2, "when_needed", cfg).reason

    work = working_window(window, cfg)
    each = math.ceil(cfg.job_share * work)
    return Reasons(
        window=(tier != "local" or window <= SMALL_WINDOW)
        and reason(JobEstimate(math.ceil(cfg.read_share * work))) == "window",
        at_once=reason(JobEstimate(2 * each, jobs=2)) == "at_once",
        hard=reason(JobEstimate(0, hard=True)) == "model",
        cheaper=reason(JobEstimate(each)) == "model",
    )


def _kind(agent: Agent, writes: Callable[[str], bool]) -> str:
    """The reason an agent type serves: ``window``, ``at_once`` or ``hard``.

    A type that wishes for a paid or a named model serves ``hard``, one that changes something
    serves ``at_once``, and any other reads for the window.
    """
    if agent.wish in _STRONGER or agent.wish not in _STRONGER | _PLAIN:
        return "hard"
    return "at_once" if any(writes(name) for name in agent.tools) else "window"


def line_of(agent: Agent) -> str:
    """What the prompt says of ``agent``: its ``line``, else the first sentence of its
    description, so a user's file without a ``line`` still gets a sensible one."""
    if agent.line:
        return agent.line
    first = agent.description.split(". ")[0].strip().rstrip(".")
    return first[:1].lower() + first[1:]


def delegate_text(
    agents: Sequence[Agent],
    window: int,
    tier: Tier,
    prices: Prices,
    writes: Callable[[str], bool],
    settings: DelegateSettings | None = None,
) -> str | None:
    """The text for a lead, or None when nothing is on offer for it."""
    reasons = reasons_for(window, tier, prices, settings)
    served = {
        "window": reasons.window,
        "at_once": reasons.at_once,
        "hard": reasons.hard,
    }
    offered = [a for a in agents if served[_kind(a, writes)]]
    if not offered:
        return None
    holds = [
        text
        for on, text in (
            (
                reasons.window,
                "a question needs many files read or searched "
                "(what a project is, where something is used)",
            ),
            (reasons.at_once, "independent jobs can run at once"),
            (reasons.hard, "a hard question needs a stronger model"),
            (reasons.cheaper, "a large read can go to a cheaper model"),
        )
        if on
    ]
    lines = "\n".join(f"- {a.name}: {line_of(a)}" for a in offered)
    head = "Do the work here by default. Call delegate with a clear brief only when"
    return f"{head} {'; '.join(holds)}.\n{lines}"


def prices_of(
    lead_ref: str, lead_tier: Tier, lead_price: float | None, listed: Sequence[ListedModel]
) -> Prices:
    """The prices the policy reads, from the ready models of the last listing.

    ``cheaper`` is the cheapest ready model at or below the lead's tier that is not the lead
    (a local one counts as free), ``stronger`` the cheapest ready model of the first tier above.
    """
    rank = TIERS.index(lead_tier)
    cheaper: list[float] = []
    above: dict[Tier, list[float]] = {}
    for model in listed:
        if model.status != "ready" or model.tools is False or model.ref == lead_ref:
            continue
        cost = (
            0.0 if model.tier == "local" else None if model.price is None else blended(model.price)
        )
        if cost is None:
            continue
        if TIERS.index(model.tier) <= rank:
            cheaper.append(cost)
        else:
            above.setdefault(model.tier, []).append(cost)
    stronger = next((min(above[t]) for t in TIERS[rank + 1 :] if t in above), None)
    return Prices(lead_price, min(cheaper, default=None), stronger)


def delegate_prompt(
    agents_of: Callable[[Path | None], Sequence[Agent]],
    writes: Callable[[str], bool],
    settings: DelegateSettings | Callable[[], DelegateSettings] | None = None,
) -> Section:
    """The section, for the agent types ``agents_of`` gives for a session folder.

    ``writes`` says whether a tool changes something. ``settings`` may be a function, read each
    time the section is built, so a new ``[agents.delegate]`` applies without a restart. The
    section is left out when ``delegate`` is not offered (a helper, or a model that takes no
    tools) or the window is unknown.
    """

    def build(context: PromptContext) -> str | None:
        if "delegate" not in context.tools or context.window is None:
            return None
        root = None if context.cwd is None else Path(context.cwd)
        return delegate_text(
            agents_of(root),
            context.window,
            context.tier or "frontier",  # a model of unknown tier is hosted
            context.prices or Prices(),
            writes,
            settings() if callable(settings) else settings,
        )

    return Section(DELEGATE_SECTION, build)


__all__ = [
    "DELEGATE_SECTION",
    "SMALL_WINDOW",
    "Reasons",
    "delegate_prompt",
    "delegate_text",
    "line_of",
    "prices_of",
    "reasons_for",
]
