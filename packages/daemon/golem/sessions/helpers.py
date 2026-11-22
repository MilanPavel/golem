"""Helper sessions: what the manager decides when it starts one (ADR-059).

A helper is a session with a parent. Its tools, its allowances and whether it may ask you come
from its agent type, as the agent was when the helper started, and never from its lead's run.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

from golem.agents.limits import resolve_limits
from golem.agents.model import Agent
from golem.config import AgentSettings, PermissionMode, RoleSettings
from golem.graphs.child import ChildLimits
from golem.graphs.tools_node import ChildScope
from golem.models.facts import ModelFacts
from golem.models.pick import Choice, Traits
from golem.models.pick_helper import HelperChoice, pick_helper
from golem.permissions.engine import Allowance
from golem.sessions.helper_limits import Used, before_last_call, reached, used_of
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


def wish_of(agent: Agent | AgentSnapshot, roles: RoleSettings) -> str:
    """What the helper of ``agent`` wishes for its model (ADR-059, section 5).

    The agent file's wish. ``[routing.roles] explore`` is read as the wish of the explorer, when
    it is set to something other than its default, until the role is retired.
    """
    default = RoleSettings.model_fields["explore"].default
    if agent.name == EXPLORER and roles.explore != default:
        return roles.explore
    return agent.wish


def pick_local(
    wish: str,
    lead: ModelFacts,
    candidates: Sequence[ModelFacts],
    traits: Traits,
    why: str = "you chose to stay local",
) -> HelperChoice:
    """The model of a helper whose user said no to the paid question (ADR-059, section 5).

    The pick is made again among the local models only, so the helper gets a local model, or
    the lead's, with a fresh window, and the reason says so. It is also what the helper would
    get when the question is not asked and a no is the answer that is left.
    """
    local = [m for m in candidates if m.tier == "local"]
    again = pick_helper(wish, lead, local, traits)
    detail = f"{again.detail}; {why}, so it runs on {again.model.profile} with a fresh window"
    return replace(again, detail=detail, fresh_window=True, needs_consent=False)


def routed_of(wish: str, choice: HelperChoice) -> Choice:
    """The pick as a turn writes it into ``model.routed``: the pick's own reason, and the detail
    says what the wish was and why."""
    return Choice(
        choice.model,
        choice.reason,
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
"""The agent type that the ``explore`` role (and its model) is for."""

DEFAULT_PROMPT = "You are a helper. Answer the brief. Do not ask questions."
"""The prompt of a helper whose agent file cannot be found again, such as after a restart."""


def snapshot_of(
    agent: Agent, source: AgentOrigin, tools: Iterable[str], settings: AgentSettings
) -> AgentSnapshot:
    """The agent as its file reads now, with the tools it keeps: what its lead may use.

    Its limits are resolved once, from ``config.toml`` and the file
    (:func:`~golem.agents.limits.resolve_limits`), and stored with the helper.
    """
    resolved = resolve_limits(agent, settings)
    return AgentSnapshot(
        name=agent.name,
        source=source,
        tools=list(tools),
        limits=AgentLimits(
            max_calls=resolved.max_calls,
            max_seconds=resolved.max_seconds,
            max_cost_usd=resolved.max_cost_usd,
            max_tokens=resolved.max_tokens,
            answer_chars=resolved.answer_chars,
        ),
        wish=agent.wish,
        asks=agent.asks,
    )


def writing_tools(agent: Agent, is_read_only: Callable[[str], bool]) -> list[str]:
    """The tools of ``agent`` that are not read-only, or that golem does not know."""
    return [name for name in agent.tools if not is_read_only(name)]


def unavailable_reason(agent: Agent, is_read_only: Callable[[str], bool]) -> str | None:
    """Why ``agent`` cannot be started now, or ``None`` when it can.

    ``delegate`` refuses with this text, and the agents list shows it.
    """
    writes = writing_tools(agent, is_read_only)
    if not writes:
        return None
    return (
        f"agent {agent.name} is not available yet: it has tools that change things "
        f"({', '.join(writes)}), and only agents that read can run now"
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
    events: Sequence[ChatEvent] | None = None,
) -> HelperStopped:
    """Why a helper ended, from its last run: its status, its events and its agent's limits.

    ``timed_out``: the manager stopped the run at its time limit. A run that was cancelled
    after it took in more than ``TOKEN_FACTOR`` windows was stopped for tokens. A run that
    answered after more model calls than the limit allows ended on its last call: ``calls``.
    A run that answered after its calls had reached the cost or token limit set for the helper
    ended on its last call too: ``cost`` or ``tokens``. ``events`` are all the stored events of
    the helper, which those sums are read from; without them, the events of the run.
    A run that failed because a cap in ``[budget]`` is spent ended ``budget``, and any other
    run that failed ended ``failed``.
    """
    if status == "completed":
        limit = (agent.limits.max_calls if agent is not None else None) or ChildLimits().max_calls
        calls = sum(isinstance(e, ModelCallCompletedEvent) for e in run_events)
        if calls > limit:
            return "calls"
        if agent is not None:
            before = before_last_call(run_events if events is None else events)
            used = used_of(before)
            hit = reached(agent.limits, Used(cost_usd=used.cost_usd, tokens=used.tokens))
            return hit if hit in ("cost", "tokens") else "done"
        return "done"
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
    "files_named",
    "helper_mode",
    "origin_of",
    "parked_calls",
    "pick_local",
    "routed_of",
    "scope_of_agent",
    "snapshot_of",
    "started_at",
    "stop_reason",
    "stopped_of",
    "summarize_run",
    "tokens_over",
    "unavailable_reason",
    "wish_of",
    "writing_tools",
]


LINE_MAX = 120
"""The longest line of the paid question (the protocol's limit)."""

LINES_MAX = 10
"""The most lines in the ``sent`` list and in the ``not_sent`` list."""

PATHS_SHOWN = 4
"""How many paths the brief names that the question lists, before "and N more"."""

_READING = frozenset(
    {"read_file", "list_dir", "glob", "grep", "git_log", "git_diff", "git_status", "read_artifact"}
)
_PATH = re.compile(r"[\w@%+~./-]+")
_TOKENS_SEEN = 400


def _cut(text: str, width: int = LINE_MAX) -> str:
    """``text`` cut in the middle with an ellipsis when it is longer than ``width``."""
    if len(text) <= width:
        return text
    keep = width - 1
    head = keep // 2
    return text[:head] + "\u2026" + text[len(text) - (keep - head) :]


def paths_in(brief: str, cwd: str | None) -> list[str]:
    """The paths the brief names that exist under ``cwd``, in order, each once.

    A path is a word of the brief, minus a ``:line`` tail and sentence punctuation. It counts
    only when it resolves to a file or folder inside ``cwd``. Reads no file's content.
    """
    if cwd is None or cwd == "":
        return []
    root = Path(cwd).resolve()
    found: list[str] = []
    for token in _PATH.findall(brief)[:_TOKENS_SEEN]:
        name = token.removeprefix("./").rstrip(".,;:")
        if name == "" or ("/" not in name and "." not in name.strip(".")):
            continue
        try:
            target = (root / name).resolve()
            inside = target.is_relative_to(root) and target != root and target.exists()
        except (OSError, ValueError):
            continue
        shown = target.relative_to(root).as_posix() if inside else ""
        if inside and shown not in found:
            found.append(shown)
    return found


def files_named(brief: str, cwd: str | None) -> list[str]:
    """The files (not folders) the brief names that exist under ``cwd``: see :func:`paths_in`."""
    if not cwd:
        return []
    root = Path(cwd).resolve()
    return [path for path in paths_in(brief, cwd) if (root / path).is_file()]


def what_is_sent(
    agent: AgentSnapshot, brief: str, cwd: str | None = None
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The two lists of a helper's paid question: ``(sent, not_sent)`` (ADR-059, section 5).

    The first call of a helper carries the agent's instructions and the brief, and nothing
    else: no chat, no memory, no diff. What it reads later, with its tools, is not known yet.
    The brief's size is in words. The paths it names that exist under ``cwd`` are listed, at
    most :data:`PATHS_SHOWN`. Every line fits :data:`LINE_MAX`, each list :data:`LINES_MAX`.
    """
    words = len(brief.split())
    sent = [f"the brief, {words} {'word' if words == 1 else 'words'}"]
    sent.append(_cut(f"the instructions of the {agent.name} agent"))
    paths = paths_in(brief, cwd)
    sent.extend(_cut(f"named in the brief: {path}") for path in paths[:PATHS_SHOWN])
    if len(paths) > PATHS_SHOWN:
        sent.append(f"and {len(paths) - PATHS_SHOWN} more paths named in the brief")
    if _READING & set(agent.tools):
        sent.append("what it reads with its tools, as it works")
    not_sent = ["this chat", "your memory"]
    return tuple(sent[:LINES_MAX]), tuple(not_sent[:LINES_MAX])
