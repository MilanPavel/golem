"""Helper sessions: what the manager decides when it starts one (ADR-059).

A helper is a session with a parent. Its tools, its allowances and whether it may ask you come
from its agent type, as the agent was when the helper started, and never from its lead's run.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime

from golem.config import PermissionMode
from golem.graphs.child import EXPLORER_TOOLS, ChildLimits
from golem.graphs.tools_node import ChildScope
from golem.permissions.engine import Allowance
from golem.tools.registry import ToolError
from golem_protocol.events import (
    AgentLimits,
    AgentSnapshot,
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    HelperStopped,
    HelperWaitEvent,
    MessageCompletedEvent,
    ModelCallCompletedEvent,
    RouteConsentAnsweredEvent,
    RouteConsentNeededEvent,
)

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


def explorer_agent(limits: ChildLimits) -> AgentSnapshot:
    """The explorer as the settings give it, until the agent files registry exists."""
    return AgentSnapshot(
        name="explorer",
        source="bundled",
        tools=sorted(EXPLORER_TOOLS),
        limits=AgentLimits(
            max_calls=limits.max_calls,
            max_seconds=int(limits.timeout_s),
            answer_chars=limits.answer_chars,
        ),
        wish="cheapest",
    )


@dataclass(frozen=True, slots=True)
class RunSummary:
    """What the events of one helper run say about how it went."""

    model_calls: int
    tokens: int
    cost_usd: float
    duration_ms: int
    working_ms: int
    answer: str
    """The text of the newest assistant message, empty when there is none."""


def _seconds(ts: str) -> float | None:
    try:
        return datetime.fromisoformat(ts).timestamp()
    except ValueError:
        return None


def summarize_run(events: Sequence[ChatEvent]) -> RunSummary:
    """Count the model calls, tokens and cost of a run, and time it.

    The time is from the first event to the last. Working time leaves out each wait for you:
    an approval or the paid question, until its answer or the end of the run.
    """
    calls = tokens = 0
    cost = 0.0
    answer = ""
    times = [t for t in (_seconds(e.ts) for e in events) if t is not None]
    waited = 0.0
    waiting_since: float | None = None
    for event in events:
        at = _seconds(event.ts)
        if isinstance(event, ModelCallCompletedEvent):
            calls += 1
            usage = event.data.usage
            if usage is not None:
                tokens += (usage.input or 0) + (usage.output or 0)
            cost += event.data.cost_usd or 0.0
        elif isinstance(event, MessageCompletedEvent) and event.data.role == "assistant":
            answer = event.data.text
        elif isinstance(event, ApprovalNeededEvent | RouteConsentNeededEvent):
            waiting_since = at
        elif isinstance(event, ApprovalResolvedEvent | RouteConsentAnsweredEvent):
            if waiting_since is not None and at is not None:
                waited += at - waiting_since
            waiting_since = None
    if waiting_since is not None and times:
        waited += times[-1] - waiting_since
    duration = int((times[-1] - times[0]) * 1000) if times else 0
    return RunSummary(
        model_calls=calls,
        tokens=tokens,
        cost_usd=cost,
        duration_ms=duration,
        working_ms=max(0, duration - int(waited * 1000)),
        answer=answer.strip(),
    )


def stopped_of(status: str | None) -> HelperStopped:
    """Why a helper ended, from the status of its last run. No run at all is a failure."""
    return "done" if status == "completed" else "cancelled" if status == "cancelled" else "failed"


def parked_calls(events: Sequence[ChatEvent]) -> list[str]:
    """The ``delegate`` calls a lead is parked on, from the ``helper.wait`` events of its run."""
    parked: list[str] = []
    for event in events:
        if isinstance(event, HelperWaitEvent):
            if event.data.state == "parked" and event.data.call_id not in parked:
                parked.append(event.data.call_id)
            elif event.data.state == "resumed" and event.data.call_id in parked:
                parked.remove(event.data.call_id)
    return parked


__all__ = [
    "NO_DELEGATE",
    "NO_NESTED",
    "NO_SEND",
    "ORIGIN_PREFIX",
    "HelperRef",
    "RunSummary",
    "check_agent",
    "cut_allowances",
    "explorer_agent",
    "helper_mode",
    "origin_of",
    "parked_calls",
    "scope_of_agent",
    "stopped_of",
    "summarize_run",
]
