"""The limits of a helper that are checked between its model calls (ADR-059, section 10).

Pure: no I/O. What a helper has used is read from its stored events, never guessed.

The order, when several limits are reached together, is fixed: calls, time, cost, tokens.

- ``calls`` and ``tokens`` are counted over every model call of the helper. ``max_tokens`` counts
  the input and the output tokens of each call, summed. It is not the ``TOKEN_FACTOR`` rule of
  :mod:`golem.sessions.helpers`, which counts input only, against the model's window: that rule
  is a ceiling that cuts a run, and ``max_tokens`` is the limit you set.
- ``time`` is working time (:mod:`golem.sessions.helper_clock`). It stops in two steps: at
  ``SOFT_TIME`` of the limit the next model call is the last one, without tools, so the helper
  writes its answer. The manager cancels the run when the clock reaches the limit itself, as
  a last resort.
- ``cost`` is the sum of ``cost_usd`` of its calls. A local model has no price, so its calls have
  none, the sum stays 0 and the limit never fires, whatever it is set to.

For calls, cost and tokens the helper makes one last call without tools, asking for its answer.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass

from golem_protocol.events import (
    AgentLimits,
    ChatEvent,
    HelperStopped,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    ToolCompletedEvent,
    ToolRequestedEvent,
)

ORDER: tuple[HelperStopped, ...] = ("calls", "time", "cost", "tokens")
"""The limits in the order they win when several are reached."""

SOFT_TIME = 0.8
"""The share of ``max-seconds`` of working time after which a helper's next call is its last."""

MAX_LISTED = 20
"""The most paths and searches a stopped helper's result lists."""

SEARCHES = frozenset({"grep", "glob"})
LISTINGS = frozenset({"list_dir"})


@dataclass(frozen=True, slots=True)
class Used:
    """What a helper has used. ``None`` leaves that limit out of the check."""

    calls: int | None = None
    working_ms: int | None = None
    cost_usd: float | None = None
    tokens: int | None = None


def used_of(events: Sequence[ChatEvent], working_ms: int | None = None) -> Used:
    """The model calls, cost and tokens in ``events``. ``working_ms`` is given by the caller."""
    calls = tokens = 0
    cost = 0.0
    for event in events:
        if isinstance(event, ModelCallCompletedEvent):
            calls += 1
            usage = event.data.usage
            if usage is not None:
                tokens += (usage.input or 0) + (usage.output or 0)
            cost += event.data.cost_usd or 0.0
    return Used(calls=calls, working_ms=working_ms, cost_usd=cost, tokens=tokens)


def soft_time_reached(limits: AgentLimits, working_ms: int) -> bool:
    """Whether the helper has worked ``SOFT_TIME`` of its time limit."""
    return limits.max_seconds is not None and working_ms >= SOFT_TIME * limits.max_seconds * 1000


def before_last_call(events: Sequence[ChatEvent]) -> Sequence[ChatEvent]:
    """The events up to where the last model call was sent."""
    for index in range(len(events) - 1, -1, -1):
        if isinstance(events[index], ModelCallStartedEvent):
            return events[:index]
    return events


def reached(
    limits: AgentLimits, used: Used, *, calls_default: int | None = None
) -> HelperStopped | None:
    """The first limit in :data:`ORDER` that ``used`` has reached, or ``None``.

    ``calls_default`` is the call limit of a helper whose file sets none.
    """
    max_calls = limits.max_calls or calls_default
    if max_calls is not None and used.calls is not None and used.calls >= max_calls:
        return "calls"
    if (
        limits.max_seconds is not None
        and used.working_ms is not None
        and used.working_ms >= limits.max_seconds * 1000
    ):
        return "time"
    if (
        limits.max_cost_usd is not None
        and used.cost_usd is not None
        and used.cost_usd > 0
        and used.cost_usd >= limits.max_cost_usd
    ):
        return "cost"
    if (
        limits.max_tokens is not None
        and used.tokens is not None
        and used.tokens >= limits.max_tokens
    ):
        return "tokens"
    return None


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _limit_words(limits: AgentLimits, stopped: HelperStopped, calls_default: int | None) -> str:
    if stopped == "calls":
        n = limits.max_calls or calls_default
        if n is None:
            return "stopped at the call limit"
        return f"stopped at {_plural(n, 'call', 'calls')}"
    if stopped == "time" and limits.max_seconds is not None:
        return f"stopped at {limits.max_seconds} s of working time"
    if stopped == "cost" and limits.max_cost_usd is not None:
        return f"stopped at ${limits.max_cost_usd:.2f} of cost"
    if stopped == "tokens" and limits.max_tokens is not None:
        return f"stopped at {limits.max_tokens} tokens"
    return {
        "time": "stopped at its time limit",
        "cost": "stopped at its cost limit",
        "tokens": "stopped at its token limit",
        "budget": "stopped: a budget cap is spent",
        "cancelled": "stopped: cancelled",
        "failed": "stopped: a model call failed",
    }.get(stopped, f"stopped: {stopped}")


def _normal(path: str) -> str:
    return path.removeprefix("./")


def progress_parts(
    events: Sequence[ChatEvent], named_files: Collection[str] = ()
) -> tuple[str, list[str]]:
    """What the helper covered, from its tool calls that ended well, such as
    ``read 5 of 7 files, ran 3 searches``.

    The ``of N`` is only said when the brief names files (``named_files``): it counts those that
    were read. Empty when it used no tool.
    """
    asked: dict[str, tuple[str, str | None]] = {}
    read: list[str] = []
    queries: list[str] = []
    searches = listings = other = 0
    queries_by_call: dict[str, str] = {}
    for event in events:
        if isinstance(event, ToolRequestedEvent):
            path = event.data.args.get("path")
            asked[event.data.call_id] = (event.data.name, path if isinstance(path, str) else None)
            if event.data.name in SEARCHES:
                pattern = event.data.args.get("pattern")
                where = f" in {_normal(path)}" if isinstance(path, str) else ""
                queries_by_call[event.data.call_id] = (
                    f"{event.data.name} {pattern}{where}"
                    if isinstance(pattern, str)
                    else event.data.name
                )
        elif isinstance(event, ToolCompletedEvent) and not event.data.failed:
            name, path = asked.get(event.data.call_id, ("", None))
            if name == "read_file":
                if path is not None and _normal(path) not in read:
                    read.append(_normal(path))
            elif name in SEARCHES:
                searches += 1
                queries.append(queries_by_call.get(event.data.call_id, name))
            elif name in LISTINGS:
                listings += 1
            elif name != "":
                other += 1
    parts: list[str] = []
    if named_files:
        done = sum(1 for path in named_files if _normal(path) in read)
        parts.append(f"read {done} of {_plural(len(named_files), 'file', 'files')}")
    elif read:
        parts.append(f"read {_plural(len(read), 'file', 'files')}")
    if searches:
        parts.append(f"ran {_plural(searches, 'search', 'searches')}")
    if listings:
        parts.append(f"listed {_plural(listings, 'folder', 'folders')}")
    if other:
        parts.append(f"used {_plural(other, 'other tool', 'other tools')}")
    return ", ".join(parts), [*read, *queries]


def listed_items(items: Sequence[str]) -> str:
    """``items`` joined, at most ``MAX_LISTED``, then ``and N more``."""
    shown = list(items[:MAX_LISTED])
    if len(items) > MAX_LISTED:
        shown.append(f"and {len(items) - MAX_LISTED} more")
    return ", ".join(shown)


def progress_of(events: Sequence[ChatEvent], named_files: Collection[str] = ()) -> str:
    """The counts of :func:`progress_parts`, such as ``read 5 of 7 files, ran 3 searches``."""
    return progress_parts(events, named_files)[0]


def covered_line(
    limits: AgentLimits,
    stopped: HelperStopped,
    events: Sequence[ChatEvent],
    named_files: Collection[str] = (),
    *,
    calls_default: int | None = None,
) -> str:
    """The line a result starts with when the helper did not simply answer: the limit it hit and
    how far it got, such as ``stopped at 25 calls, read 5 of 7 files``. Empty for ``done``."""
    if stopped == "done":
        return ""
    line = _limit_words(limits, stopped, calls_default)
    progress, items = progress_parts(events, named_files)
    if not progress:
        return f"{line}, no tools used"
    text = f"{line}, {progress}"
    return f"{text} ({listed_items(items)})" if items else text


__all__ = [
    "ORDER",
    "Used",
    "before_last_call",
    "covered_line",
    "progress_of",
    "reached",
    "soft_time_reached",
    "used_of",
]
