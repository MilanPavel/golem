"""When a helper is worth starting: the three reasons of ADR-059, section 2. Pure; no I/O.

The answer is to fold, to do the work in the chat, unless one reason holds. There is no model
call and no classifier: the lead's window, what it has used, an estimate of the job and the
prices decide. Thresholds are shares of the window and a price ratio (``DelegateSettings``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from golem.config import DelegateSettings
from golem.models.tiers import Tier

Setting = Literal["when_needed", "ask", "never"]
Reason = Literal["window", "at_once", "model"]
Shape = Literal["fold", "single", "batch", "one after the other"]


@dataclass(frozen=True, slots=True)
class JobEstimate:
    """What the job will read, from the model's own plan or a cheap guess."""

    read_tokens: int  # all the reading of the job
    jobs: int = 1  # independent jobs that need no order; a chain (find, fix, check) is 1
    hard: bool = False  # one hard question that a stronger model answers better


@dataclass(frozen=True, slots=True)
class Prices:
    """Blended USD per million tokens. None: local, or not known."""

    lead: float | None = None
    cheaper: float | None = None  # the cheapest ready model a helper could use
    stronger: float | None = None  # the model one tier above the lead; None when there is none


@dataclass(frozen=True, slots=True)
class Decision:
    reason: Reason | None  # None: fold
    shape: Shape
    ask: bool = False  # the setting is "ask": put the question to the user first


def _fits_badly(window: int, used: int, read: int, cfg: DelegateSettings) -> bool:
    return read >= cfg.read_share * window or used + read >= cfg.fill_share * window


def _cheaper(prices: Prices, cfg: DelegateSettings) -> bool:
    lead, other = prices.lead, prices.cheaper
    return lead is not None and other is not None and other > 0 and lead / other >= cfg.price_ratio


def _reason(
    window: int,
    used: int,
    estimate: JobEstimate,
    prices: Prices,
    tier: Tier,
    cfg: DelegateSettings,
) -> Reason | None:
    if _fits_badly(window, used, estimate.read_tokens, cfg):
        return "window"
    if estimate.hard and prices.stronger is not None and tier != "frontier":
        return "model"  # a local lead too, when a stronger model is ready; never with local only
    if tier == "local":  # several helpers on one local model take turns; nothing is cheaper
        return None
    each = estimate.read_tokens / max(estimate.jobs, 1)
    big = each >= cfg.job_share * window
    if estimate.jobs >= 2 and big:
        return "at_once"
    if big and _cheaper(prices, cfg):
        return "model"
    return None


def _shape(estimate: JobEstimate, slots: int) -> Shape:
    if slots < 1 or (estimate.jobs >= 2 and slots < 2):
        return "one after the other"
    return "batch" if estimate.jobs >= 2 else "single"


def should_delegate(
    window: int,
    used: int,
    estimate: JobEstimate,
    prices: Prices,
    tier: Tier,
    slots: int,
    setting: Setting,
    settings: DelegateSettings | None = None,
) -> Decision:
    """Whether to start helpers for ``estimate``, why, and in which shape.

    ``window`` and ``used`` are the lead's, in tokens. ``slots`` is how many helpers can run at
    once right now. With no helper the shape is ``fold``. When nothing can run at once the
    helpers run ``one after the other``, never as a batch. ``never`` always folds; ``ask`` gives
    the same answer with ``ask`` set.
    """
    if setting == "never" or window <= 0:
        return Decision(None, "fold")
    reason = _reason(window, used, estimate, prices, tier, settings or DelegateSettings())
    if reason is None:
        return Decision(None, "fold")
    return Decision(reason, _shape(estimate, slots), ask=setting == "ask")
