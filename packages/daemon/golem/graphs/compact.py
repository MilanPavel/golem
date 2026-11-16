"""Compaction on request: clear old tool results, or summarise old turns, between turns.

The pure parts of the automatic steps (``plan_clear``, ``plan_summary``) decide what to
change. Here they run with a manual choice of how far to go. Each function returns the
new :class:`~golem.graphs.context_view.ContextView` and the numbers to report, and writes
nothing: the checkpoint keeps every message, and only the view changes.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from golem.graphs.adapter import message_text
from golem.graphs.context_view import ContextView, freed_by, plan_clear, plan_summary, view
from golem.graphs.summarise import Summariser


@dataclass(frozen=True, slots=True)
class Compaction:
    """What a manual compaction did."""

    view: ContextView | None
    """The view to store. None when there was nothing to do."""
    action: Literal["cleared", "summarised"]
    before_tokens: int
    after_tokens: int
    count: int
    """Tool results cleared, or turns summarised."""
    messages: int
    """Messages a summary stands for, or results cleared. This is what ``context.changed`` says."""
    window: int | None = None
    model: str | None = None


def _nothing(action: Literal["cleared", "summarised"], used: int) -> Compaction:
    return Compaction(None, action, used, used, 0, 0)


def clear_now(
    messages: Sequence[BaseMessage],
    ctx: ContextView | None,
    *,
    used: int,
    ratio: float,
    keep_results: int,
) -> Compaction:
    """Clear every tool result but the newest ``keep_results``, whatever ``clear_to`` says."""
    planned = plan_clear(
        messages,
        ctx,
        used=used,
        ratio=ratio,
        room=1,
        clear_at=0.0,
        clear_to=0.0,
        keep_results=keep_results,
    )
    if planned is None:
        return _nothing("cleared", used)
    freed, count = freed_by(messages, ctx, planned, ratio)
    if count == 0:
        return _nothing("cleared", used)
    return Compaction(planned, "cleared", used, max(0, used - freed), count, count)


def _sent_text(message: BaseMessage) -> str:
    text = message_text(message)
    if isinstance(message, AIMessage) and message.tool_calls:
        text += json.dumps(message.tool_calls, ensure_ascii=False, default=str)
    return text


async def summarise_now(
    summariser: Summariser,
    messages: Sequence[BaseMessage],
    ctx: ContextView | None,
    *,
    keep_turns: int,
    focus: str | None,
    used: int,
    ratio: float,
    session_id: str,
    profile: str,
    options: Mapping[str, float | str],
) -> Compaction:
    """Replace every turn but the last ``keep_turns`` (at least one) with a summary.

    Raises when the summary call fails: a person asked for it and should see the error.
    """
    found = plan_summary(messages, ctx, keep_turns=max(1, keep_turns))
    if found is None:
        return _nothing("summarised", used)
    start, end = found
    earlier = (ctx or {}).get("summary") if start > 0 else None
    text = await summariser.make(
        session_id=session_id,
        session_profile=profile,
        options=options,
        messages=messages[start:end],
        earlier=earlier,
        focus=focus,
    )
    planned: ContextView = {
        **(ctx or {}),
        "summary": text,
        "summarised_before": cast(str, messages[end].id),
    }
    before = sum(len(_sent_text(m)) for m in view(messages, ctx))
    after = sum(len(_sent_text(m)) for m in view(messages, planned))
    turns = sum(isinstance(m, HumanMessage) for m in messages[start:end])
    return Compaction(
        planned,
        "summarised",
        used,
        max(0, used - round((before - after) * ratio)),
        turns,
        end - start,
        model=summariser.model_name(profile),
    )
