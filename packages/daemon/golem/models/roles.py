"""Which model an internal job runs on. Pure; no I/O."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from golem.config import Role, RoleSettings
from golem.models.tiers import Tier

RoleReason = Literal[
    "configured",
    "session is local",
    "cheapest budget model",
    "no budget model ready",
    "no local model",
]


@dataclass(frozen=True, slots=True)
class RoleModel:
    profile: str  # what to pass to router.chat_model
    same_as_session: bool
    reason: RoleReason


def for_role(
    role: Role,
    *,
    session_profile: str,
    settings: RoleSettings,
    tier_of_profile: Callable[[str], Tier | None],
    budget_models: Sequence[str],
    local_only: bool = False,
) -> RoleModel:
    """The model for ``role``.

    1. A model named in the settings. 2. The session's model when it is local, since a second
    local model would compete for memory. 3. The first of ``budget_models`` when the session's
    model is hosted. ``budget_models`` are ready budget models that take tools, cheapest first.
    4. The session's model.

    With ``local_only`` only a local model qualifies: a configured model or the session's own
    when it is local, else the session's model with the reason ``no local model``. The caller
    then asks for it with ``chat_model(..., local_only=True)``, which refuses a hosted one.
    """
    configured: str = getattr(settings, role)
    if local_only:
        if configured != "session" and tier_of_profile(configured) == "local":
            return RoleModel(configured, configured == session_profile, "configured")
        if tier_of_profile(session_profile) == "local":
            return RoleModel(session_profile, True, "session is local")
        return RoleModel(session_profile, True, "no local model")
    if configured != "session":
        return RoleModel(configured, configured == session_profile, "configured")
    if tier_of_profile(session_profile) == "local":
        return RoleModel(session_profile, True, "session is local")
    if budget_models and tier_of_profile(session_profile) is not None:
        first = budget_models[0]
        return RoleModel(first, first == session_profile, "cheapest budget model")
    return RoleModel(session_profile, True, "no budget model ready")


__all__ = ["Role", "RoleModel", "for_role"]
