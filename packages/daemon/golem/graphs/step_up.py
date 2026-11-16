"""The step-up of a run: the ask a graph makes of the router, and what comes back."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from golem.models.pick import Choice
from golem.models.tiers import Tier
from golem_protocol.events import ConsentAnswer, ConsentCaps


@dataclass(frozen=True, slots=True)
class StepRequest:
    """Why a run asks for a stronger model.

    ``signal`` is a struggle signal of :mod:`golem.graphs.struggle`, or ``context_full``.
    ``need`` is the tokens the prompt and the reply reserve need, for ``context_full``.
    ``prompt`` is the tokens of the run so far, for the estimate of the paid question, and
    ``detail`` says how the model struggles. ``answer`` is the user's yes to that question.
    """

    signal: str
    need: int | None = None
    prompt: int | None = None
    detail: str | None = None
    answer: ConsentAnswer | None = None


@dataclass(frozen=True, slots=True)
class Consent:
    """The paid step-up question: the paid model, and why golem asks."""

    profile: str
    tier: Tier
    why: str
    estimated_usd: float | None
    alternatives: tuple[ConsentAnswer, ...]
    caps: ConsentCaps | None = None
    signal: str | None = None
    """The struggle that makes golem ask in the middle of a run, None before a turn."""
    replaces: str | None = None
    """The model whose answer the user asked to try again on a stronger one."""


@dataclass(frozen=True, slots=True)
class StepAsk:
    """A paid model a run may move to once the user says yes. ``question`` is what to ask."""

    profile: str
    tier: Tier
    choice: Choice
    question: Consent


@dataclass(frozen=True, slots=True)
class StepUp:
    """The model a run moves to. ``choice`` says why and what was left out."""

    profile: str
    tier: Tier
    choice: Choice


NextModel = Callable[[str, str, StepRequest], Awaitable[StepUp | StepAsk | None]]
"""Given the session id, the current profile and the request: the next model, a paid model that
needs a yes, or None."""

__all__ = ["Consent", "NextModel", "StepAsk", "StepRequest", "StepUp"]
