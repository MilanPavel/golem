"""``for_role`` picks a model for an internal job from what it is given."""

from __future__ import annotations

from golem.config import RoleSettings
from golem.models.roles import for_role
from golem.models.tiers import Tier

_TIERS: dict[str, Tier] = {
    "ollama/qwen": "local",
    "anthropic/opus": "frontier",
    "deepseek/chat": "budget",
}


def _role(
    *, session: str, settings: RoleSettings | None = None, budget: tuple[str, ...] = ()
) -> tuple[str, bool, str]:
    chosen = for_role(
        "titles",
        session_profile=session,
        settings=settings or RoleSettings(),
        tier_of_profile=_TIERS.get,
        budget_models=budget,
    )
    return chosen.profile, chosen.same_as_session, chosen.reason


def test_a_configured_model_wins_over_everything() -> None:
    settings = RoleSettings(titles="openai/mini")
    assert _role(session="ollama/qwen", settings=settings, budget=("deepseek/chat",)) == (
        "openai/mini",
        False,
        "configured",
    )


def test_a_configured_model_equal_to_the_session_is_the_session() -> None:
    settings = RoleSettings(titles="ollama/qwen")
    assert _role(session="ollama/qwen", settings=settings) == ("ollama/qwen", True, "configured")


def test_session_on_a_local_session_is_the_session_model() -> None:
    assert _role(session="ollama/qwen", budget=("deepseek/chat",)) == (
        "ollama/qwen",
        True,
        "session is local",
    )


def test_session_on_a_hosted_session_takes_the_first_budget_model() -> None:
    assert _role(session="anthropic/opus", budget=("deepseek/chat", "openai/mini")) == (
        "deepseek/chat",
        False,
        "cheapest budget model",
    )


def test_session_on_a_hosted_session_without_budget_models_stays() -> None:
    assert _role(session="anthropic/opus") == ("anthropic/opus", True, "no budget model ready")


def test_an_unknown_session_model_stays() -> None:
    assert _role(session="mystery", budget=("deepseek/chat",)) == (
        "mystery",
        True,
        "no budget model ready",
    )


def test_each_role_has_its_own_setting() -> None:
    settings = RoleSettings(explore="ollama/qwen")
    chosen = for_role(
        "explore",
        session_profile="anthropic/opus",
        settings=settings,
        tier_of_profile=_TIERS.get,
        budget_models=("deepseek/chat",),
    )
    assert chosen.profile == "ollama/qwen"
