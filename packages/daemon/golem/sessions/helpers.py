"""Helper sessions: what the manager decides when it starts one (ADR-059).

A helper is a session with a parent. Its tools, its allowances and whether it may ask you come
from its agent type, as the agent was when the helper started, and never from its lead's run.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime

from golem.agents.model import Agent
from golem.config import PermissionMode, RoleSettings
from golem.graphs.child import ChildLimits
from golem.graphs.tools_node import ChildScope
from golem.models.facts import ModelFacts
from golem.models.pick import Choice, Traits
from golem.models.pick_helper import HelperChoice, pick_helper
from golem.permissions.engine import Allowance
from golem.tools.registry import ToolError
from golem_protocol.events import (
    AgentLimits,
    AgentOrigin,
    AgentSnapshot,
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    HelperStopped,
    HelperWaitEvent,
    MessageCompletedEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    RouteConsentAnsweredEvent,
    RouteConsentNeededEvent,
    RunFailedEvent,
    SessionCreatedEvent,
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


def wish_of(agent: AgentSnapshot, roles: RoleSettings) -> str:
    """What the helper of ``agent`` wishes for its model (ADR-059, section 5).

    The agent file's wish. ``[routing.roles] explore`` is read as the wish of the explorer, when
    it is set to something other than its default, until the role is retired.
    """
    default = RoleSettings.model_fields["explore"].default
    if agent.name == EXPLORER and roles.explore != default:
        return roles.explore
    return agent.wish


def pick_without_paid(
    wish: str, lead: ModelFacts, candidates: Sequence[ModelFacts], traits: Traits
) -> HelperChoice:
    """The model of a helper while it cannot ask the paid question.

    This is the one place that stands in for the question of 15.3.4 (#1303): a pick that needs
    the user's yes, which the chat has not given, is made again without the paid models, so the
    helper gets the local or the lead's model with a fresh window, and the reason says so. When
    the helper can ask, this is replaced by the question, and a "no" lands on the same answer.
    """
    choice = pick_helper(wish, lead, candidates, traits)
    if not choice.needs_consent:
        return choice
    local = [m for m in candidates if m.tier == "local"]
    again = pick_helper(wish, lead, local, traits)
    detail = (
        f"{again.detail}; the paid model it wished for needs your yes, "
        "which a helper cannot ask yet"
    )
    return replace(again, detail=detail, fresh_window=True, needs_consent=False)


_ROUTED_REASON = {"privacy": "privacy", "cheapest": "cheapest"}


def routed_of(wish: str, choice: HelperChoice) -> Choice:
    """The pick as a turn writes it into ``model.routed``: the log's reasons are the turn's.

    Only ``privacy`` and ``cheapest`` have a word of their own there; the rest read as ``pinned``,
    and the detail says what the wish was and why.
    """
    return Choice(
        choice.model,
        _ROUTED_REASON.get(choice.reason, "pinned"),  # pyright: ignore[reportArgumentType]
        f"{wish}: {choice.detail}",
        choice.rejected,
    )


def origin_of(agent: AgentSnapshot) -> str:
    return f"{ORIGIN_PREFIX}{agent.name}"


def check_agent(agent: AgentSnapshot) -> None:
    """Raises :class:`ToolError` when the agent's tools hold ``delegate``."""
    if "delegate" in agent.tools:
        raise ToolError(NO_DELEGATE)


def scope_of_agent(agent: AgentSnapshot, prompt: str) -> ChildScope:
    """The tools, the prompt and the limit on model calls of a helper, from its agent snapshot."""
    calls = agent.limits.max_calls or ChildLimits().max_calls
    return ChildScope(
        tools=frozenset(agent.tools) - {"delegate"},
        max_calls=calls,
        asks=agent.asks,
        prompt=prompt,
    )


def cut_allowances(allowed: Iterable[Allowance], agent: AgentSnapshot) -> list[Allowance]:
    """What the lead allows, cut to the tools of ``agent``: a helper has no more than its lead."""
    tools = set(agent.tools) - {"delegate"}
    return sorted(
        (pair for pair in allowed if pair[0] in tools), key=lambda pair: (pair[0], pair[1] or "")
    )


def helper_mode(agent: AgentSnapshot, lead: PermissionMode) -> PermissionMode:
    """The mode of a helper: careful when it never asks you, else its lead's mode."""
    return lead if agent.asks else "careful"


EXPLORER = "explorer"
"""The one agent type whose limits ``[agents.explorer]`` sets."""

DEFAULT_PROMPT = "You are a helper. Answer the brief. Do not ask questions."
"""The prompt of a helper whose agent file cannot be found again, such as after a restart."""


def snapshot_of(
    agent: Agent, source: AgentOrigin, tools: Iterable[str], limits: ChildLimits
) -> AgentSnapshot:
    """The agent as its file reads now, with the tools it keeps: what its lead may use.

    ``[agents.explorer]`` overrides the limits of the explorer's file.
    """
    if agent.name == EXPLORER:
        cut = AgentLimits(
            max_calls=limits.max_calls,
            max_seconds=int(limits.timeout_s),
            max_cost_usd=agent.limits.max_cost_usd,
            answer_chars=limits.answer_chars,
        )
    else:
        cut = AgentLimits(
            max_calls=agent.limits.max_calls,
            max_seconds=agent.limits.max_seconds,
            max_cost_usd=agent.limits.max_cost_usd,
            answer_chars=agent.limits.answer_chars,
        )
    return AgentSnapshot(
        name=agent.name,
        source=source,
        tools=list(tools),
        limits=cut,
        wish=agent.wish,
        asks=agent.asks,
    )


def writing_tools(agent: Agent, is_read_only: Callable[[str], bool]) -> list[str]:
    """The tools of ``agent`` that are not read-only, or that golem does not know."""
    return [name for name in agent.tools if not is_read_only(name)]


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


TOKEN_FACTOR = 8
"""A helper stops when its calls took in more than this many times its window, in all."""


def tokens_over(events: Sequence[ChatEvent]) -> bool:
    """Whether the model calls of the run took in more than ``TOKEN_FACTOR`` windows."""
    window: int | None = None
    taken = 0
    for event in events:
        if isinstance(event, ModelCallStartedEvent):
            window = event.data.context_window or window
        elif isinstance(event, ModelCallCompletedEvent) and event.data.usage is not None:
            taken += event.data.usage.input or 0
    return window is not None and taken > TOKEN_FACTOR * window


def started_at(events: Sequence[ChatEvent]) -> float | None:
    """When the helper session was made, in seconds, from its ``session.created``."""
    for event in events:
        if isinstance(event, SessionCreatedEvent):
            return _seconds(event.ts)
    return None


def stop_reason(
    status: str | None,
    run_events: Sequence[ChatEvent],
    agent: AgentSnapshot | None,
    *,
    timed_out: bool = False,
) -> HelperStopped:
    """Why a helper ended, from its last run: its status, its events and its agent's limits.

    ``timed_out``: the manager stopped the run at its time limit. A run that was cancelled
    after it took in more than ``TOKEN_FACTOR`` windows was stopped for tokens. A run that
    answered after more model calls than the limit allows ended on its last call: ``calls``.
    A run that failed because a cap in ``[budget]`` is spent ended ``budget``.
    """
    if status == "completed":
        limit = (agent.limits.max_calls if agent is not None else None) or ChildLimits().max_calls
        calls = sum(isinstance(e, ModelCallCompletedEvent) for e in run_events)
        return "calls" if calls > limit else "done"
    if status == "cancelled":
        if timed_out:
            return "time"
        return "tokens" if tokens_over(run_events) else "cancelled"
    if any(isinstance(e, RunFailedEvent) and e.data.code == "budget_spent" for e in run_events):
        return "budget"
    return "failed"


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
    "DEFAULT_PROMPT",
    "EXPLORER",
    "NO_DELEGATE",
    "NO_NESTED",
    "NO_SEND",
    "ORIGIN_PREFIX",
    "TOKEN_FACTOR",
    "HelperRef",
    "RunSummary",
    "check_agent",
    "cut_allowances",
    "helper_mode",
    "origin_of",
    "parked_calls",
    "pick_without_paid",
    "routed_of",
    "scope_of_agent",
    "snapshot_of",
    "started_at",
    "stop_reason",
    "stopped_of",
    "summarize_run",
    "tokens_over",
    "wish_of",
    "writing_tools",
]
