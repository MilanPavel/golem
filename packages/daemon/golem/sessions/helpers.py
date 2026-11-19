"""Helper sessions: what the manager decides when it starts one (ADR-059).

A helper is a session with a parent. Its tools, its allowances and whether it may ask you come
from its agent type, as the agent was when the helper started, and never from its lead's run.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from golem.config import PermissionMode
from golem.graphs.child import ChildLimits
from golem.graphs.tools_node import ChildScope
from golem.permissions.engine import Allowance
from golem.tools.registry import ToolError
from golem_protocol.events import AgentSnapshot

NO_NESTED = "a helper cannot start helpers"
NO_DELEGATE = "an agent cannot have the delegate tool: a helper never starts helpers"
NO_SEND = "this is a helper session: it answers its lead, not you"

ORIGIN_PREFIX = "agent:"
"""The origin of a helper session is this and the agent type."""


@dataclass(frozen=True, slots=True)
class HelperRef:
    """A helper session for one ``delegate`` call. ``created`` is False when it was found."""

    session_id: str
    model: str
    created: bool


def origin_of(agent: AgentSnapshot) -> str:
    return f"{ORIGIN_PREFIX}{agent.name}"


def check_agent(agent: AgentSnapshot) -> None:
    """Raises :class:`ToolError` when the agent's tools hold ``delegate``."""
    if "delegate" in agent.tools:
        raise ToolError(NO_DELEGATE)


def scope_of_agent(agent: AgentSnapshot) -> ChildScope:
    """The tools and the limit on model calls of a helper, from its agent snapshot."""
    calls = agent.limits.max_calls or ChildLimits().max_calls
    return ChildScope(tools=frozenset(agent.tools) - {"delegate"}, max_calls=calls, asks=agent.asks)


def cut_allowances(allowed: Iterable[Allowance], agent: AgentSnapshot) -> list[Allowance]:
    """What the lead allows, cut to the tools of ``agent``: a helper has no more than its lead."""
    tools = set(agent.tools) - {"delegate"}
    return sorted(
        (pair for pair in allowed if pair[0] in tools), key=lambda pair: (pair[0], pair[1] or "")
    )


def helper_mode(agent: AgentSnapshot, lead: PermissionMode) -> PermissionMode:
    """The mode of a helper: careful when it never asks you, else its lead's mode."""
    return lead if agent.asks else "careful"


__all__ = [
    "NO_DELEGATE",
    "NO_NESTED",
    "NO_SEND",
    "ORIGIN_PREFIX",
    "HelperRef",
    "check_agent",
    "cut_allowances",
    "helper_mode",
    "origin_of",
    "scope_of_agent",
]
