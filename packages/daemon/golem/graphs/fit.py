"""The check that a prompt fits the window before it is sent.

Clearing and summarising act on thresholds. This is what is left when the prompt is still
too big: an estimate of the whole call, and a ladder of harder steps that runs until it fits.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass

from langchain_core.messages import BaseMessage

from golem.graphs.context_view import (
    ContextView,
    cleared_ids,
    plan_clear,
    plan_stub_newest,
    sent_chars,
    view,
)
from golem.graphs.estimate import TokenRatios
from golem.models.errors import ContextFull

KEEP_RESULTS = 2
"""Tool results the first emergency step leaves in full."""

Summarise = Callable[[ContextView | None], Awaitable[tuple[ContextView, int] | None]]
"""Summarises all but the last turn. Gives the new view and how many messages it covers."""


def prompt_estimate(
    ratios: TokenRatios, model: str, history: Sequence[BaseMessage], fixed_chars: int
) -> int:
    """The tokens of a call that sends ``history`` after ``fixed_chars`` of system and tools."""
    chars = fixed_chars + sum(sent_chars(m) for m in history)
    return ratios.estimate(model, chars, len(history))


def reply_reserve(base: int, num_predict: float | str | None, window: int) -> int:
    """The tokens kept free for the reply: ``base``, or ``num_predict`` when that is more.

    A ``num_predict`` of 0 or less sets no limit and changes nothing. The result is never
    more than half the window.
    """
    if isinstance(num_predict, int | float) and num_predict > 0:
        base = max(base, int(num_predict))
    return min(base, window // 2)


@dataclass(frozen=True, slots=True)
class Fitted:
    """The view to send, the estimate of its prompt, and the ``context.changed`` items."""

    view: ContextView | None
    estimated: int
    items: list[dict[str, object]]


async def fit_prompt(
    plain: Sequence[BaseMessage],
    current: ContextView | None,
    *,
    model: str,
    ratios: TokenRatios,
    fixed_chars: int,
    window: int,
    reserve: int,
    summarise: Summarise,
    item: Callable[[str, int, int, int], dict[str, object]],
) -> Fitted:
    """The view of ``plain`` whose prompt, plus ``reserve``, fits ``window``.

    A prompt that fits is returned as it is. Otherwise each step runs in turn and the prompt
    is estimated again: clear all but the newest two tool results, summarise all but the last
    turn, then stub the newest results too, except those of the last tool call. ``item`` builds
    the ``context.changed`` item from the action and the tokens before and after, and the count.
    Raises :class:`ContextFull` when nothing is left to do.
    """

    def need(ctx: ContextView | None) -> int:
        return prompt_estimate(ratios, model, view(plain, ctx), fixed_chars)

    items: list[dict[str, object]] = []
    used = need(current)
    for action in ("clear", "summarise", "stub"):
        if used + reserve <= window:
            break
        planned: ContextView | None
        count = 0
        if action == "summarise":
            summed = await summarise(current)
            planned, count = (None, 0) if summed is None else summed
        elif action == "clear":
            planned = _clear_but_newest(plain, current)
        else:
            planned = plan_stub_newest(plain, current)
        if planned is None:
            continue
        if action != "summarise":
            count = len(set(cleared_ids(plain, planned)) - set(cleared_ids(plain, current)))
        after = need(planned)
        items.append(item("summarised" if action == "summarise" else "cleared", used, after, count))
        current, used = planned, after
    if used + reserve > window:
        raise ContextFull(used + reserve, window, model)
    return Fitted(current, used, items)


def _clear_but_newest(
    messages: Sequence[BaseMessage], ctx: ContextView | None
) -> ContextView | None:
    return plan_clear(
        messages,
        ctx,
        used=10**9,
        ratio=1.0,
        room=1,
        clear_at=0.0,
        clear_to=0.0,
        keep_results=KEEP_RESULTS,
    )


def num_predict_of(options: Mapping[str, object]) -> float | str | None:
    """The ``num_predict`` among ``options``, or None."""
    value = options.get("num_predict")
    return value if isinstance(value, int | float | str) and not isinstance(value, bool) else None
