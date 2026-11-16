"""The step-up of a run: the ask a graph makes of the router, and what comes back."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from golem.models.pick import Choice
from golem.models.tiers import Tier


@dataclass(frozen=True, slots=True)
class StepRequest:
    """Why a run asks for a stronger model.

    ``signal`` is a struggle signal of :mod:`golem.graphs.struggle`, or ``context_full``.
    ``need`` is the tokens the prompt and the reply reserve need, for ``context_full``.
    """

    signal: str
    need: int | None = None


@dataclass(frozen=True, slots=True)
class StepUp:
    """The model a run moves to. ``choice`` says why and what was left out."""

    profile: str
    tier: Tier
    choice: Choice


NextModel = Callable[[str, str, StepRequest], Awaitable[StepUp | None]]
"""Given the session id, the current profile and the request: the next model, or None."""

__all__ = ["NextModel", "StepRequest", "StepUp"]
