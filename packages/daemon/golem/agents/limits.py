"""The limits of one helper, resolved from ``config.toml`` and its agent file."""

from __future__ import annotations

from golem.agents.model import Agent, AgentLimits
from golem.config import AgentModelSettings, AgentSettings

DEFAULT_MAX_CALLS = 15
"""Model calls of a helper that no table and no file limits."""


def _first[T](*values: T | None) -> T | None:
    return next((value for value in values if value is not None), None)


def resolve_limits(agent: Agent, settings: AgentSettings) -> AgentLimits:
    """What stops a helper of ``agent``, from the first place that sets each limit.

    The order is ``[agents.<type>]``, the front matter of the agent file, ``[agents]``, and
    then the built-in default. Only ``max_calls`` has one: a limit nobody sets stays ``None``.
    A key counts only when ``config.toml`` writes it, so the explorer's old defaults never win
    over its file. ``answer_chars`` has no key in ``[agents]``; only ``[agents.explorer]`` sets
    it.
    """
    table = settings.table_for(agent.name) or AgentModelSettings()
    own = agent.limits
    answer = table.given("answer_chars")
    return AgentLimits(
        max_calls=_first(
            table.given("max_calls"), own.max_calls, settings.max_calls, DEFAULT_MAX_CALLS
        ),
        max_seconds=_first(
            table.given("working_seconds"), own.max_seconds, settings.working_seconds
        ),
        max_cost_usd=_first(table.given("max_cost"), own.max_cost_usd, settings.max_cost),
        max_tokens=_first(table.given("max_tokens"), own.max_tokens, settings.max_tokens),
        answer_chars=_first(answer, own.answer_chars),
    )
