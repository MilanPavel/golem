"""What a waiting run's events say: the call it waits on, and what is still open.

A waiting run has no task, so this is read from the log each time someone
answers or cancels it. That is also what makes an approval survive a daemon
restart.
"""

from __future__ import annotations

from dataclasses import dataclass

from golem.sessions.recovery import open_turn
from golem_protocol.commands import PendingHelper, PendingItem
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    ConsentAnswer,
    MessageCompletedEvent,
    RouteConsentAnsweredEvent,
    RouteConsentNeededEvent,
    SkillCall,
)


@dataclass(frozen=True, slots=True)
class Pending:
    """The unanswered ``approval.needed`` of a run, and the rest of the run's state."""

    call_id: str
    name: str
    args: dict[str, object]
    subject: str | None
    diff: str | None
    source: str
    since: str
    user_message_id: str | None
    prompt: str | None
    open_calls: tuple[str, ...]
    asked: tuple[str, ...]


def pending_approval(events: list[ChatEvent]) -> Pending | None:
    """The newest ``approval.needed`` without an ``approval.resolved`` after it, or None."""
    waiting: ApprovalNeededEvent | None = None
    prompt: str | None = None
    asked: list[str] = []
    for event in events:
        if isinstance(event, ApprovalNeededEvent):
            waiting = event
            if event.data.call_id not in asked:
                asked.append(event.data.call_id)
        elif isinstance(event, ApprovalResolvedEvent):
            waiting = None
        elif isinstance(event, MessageCompletedEvent) and event.data.role == "user":
            prompt = event.data.text
    if waiting is None:
        return None
    turn = open_turn(events)
    return Pending(
        call_id=waiting.data.call_id,
        name=waiting.data.name,
        args=dict(waiting.data.args),
        subject=waiting.data.subject,
        diff=waiting.data.diff,
        source=waiting.data.source,
        since=waiting.ts,
        user_message_id=turn.user_message_id,
        prompt=prompt,
        open_calls=tuple(turn.open_calls),
        asked=tuple(asked),
    )


@dataclass(frozen=True, slots=True)
class PendingConsent:
    """The unanswered paid step-up question of a run, and the user's message it holds back."""

    user_message_id: str
    text: str
    skill: SkillCall | None
    alternatives: tuple[ConsentAnswer, ...]
    since: str
    signal: str | None = None
    """The struggle that made the run ask in its middle, None for the question before a turn."""
    replaces: str | None = None
    """The model the user asked to try again on a stronger one, None for any other turn."""
    helper_id: str | None = None
    """The helper session that asks, None for the question of a lead's own turn."""
    agent: str | None = None
    label: str | None = None
    sent: tuple[str, ...] | None = None
    not_sent: tuple[str, ...] | None = None
    model_profile: str | None = None
    """The paid model that would run, which is what two questions have in common."""


def pending_consent(events: list[ChatEvent]) -> PendingConsent | None:
    """The newest ``route.consent.needed`` without a ``route.consent.answered`` after it."""
    asked: RouteConsentNeededEvent | None = None
    user: MessageCompletedEvent | None = None
    for event in events:
        if isinstance(event, RouteConsentNeededEvent):
            asked = event
        elif isinstance(event, RouteConsentAnsweredEvent):
            asked = None
        elif isinstance(event, MessageCompletedEvent) and event.data.role == "user":
            user = event
    if asked is None or user is None:
        return None
    return PendingConsent(
        user_message_id=user.data.message_id,
        text=user.data.text,
        skill=user.data.skill,
        alternatives=tuple(asked.data.alternatives),
        since=asked.ts,
        signal=asked.data.signal,
        replaces=asked.data.replaces_model,
        helper_id=asked.data.helper_id,
        agent=asked.data.agent,
        label=asked.data.label,
        sent=None if asked.data.sent is None else tuple(asked.data.sent),
        not_sent=None if asked.data.not_sent is None else tuple(asked.data.not_sent),
        model_profile=asked.data.model_profile,
    )


def diff_counts(diff: str) -> tuple[int, int]:
    """The lines a unified diff adds and removes, without the ``+++`` and ``---`` headers."""
    added = removed = 0
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1
    return added, removed


PendingKey = tuple[str, str | None, str | None]
"""What makes two pending questions the same: the kind, then the tool and its subject for an
approval (the pair an allowance holds) or the paid model for a consent."""


def pending_entry(events: list[ChatEvent]) -> tuple[PendingItem, PendingKey] | None:
    """What the run of ``events`` waits for, with the key that groups the same question.

    An approval wins when both are open. The diff is counted, never copied.
    """
    approval = pending_approval(events)
    if approval is not None:
        added, removed = (None, None) if approval.diff is None else diff_counts(approval.diff)
        item = PendingItem(
            kind="approval",
            since=approval.since,
            call_id=approval.call_id,
            name=approval.name,
            subject=approval.subject,
            source=approval.source,
            added=added,
            removed=removed,
        )
        return item, ("approval", approval.name, approval.subject)
    consent = pending_consent(events)
    if consent is not None:
        item = PendingItem(
            kind="consent",
            since=consent.since,
            alternatives=len(consent.alternatives),
            helper_id=consent.helper_id,
            agent=consent.agent,
            label=consent.label,
            sent=None if consent.sent is None else list(consent.sent),
            not_sent=None if consent.not_sent is None else list(consent.not_sent),
        )
        return item, ("consent", consent.model_profile, None)
    return None


def pending_item(events: list[ChatEvent]) -> PendingItem | None:
    """What the run of ``events`` waits for, as the session summary carries it."""
    found = pending_entry(events)
    return None if found is None else found[0]


def group_helper_items(
    asked: list[tuple[PendingItem, PendingKey, PendingHelper]],
) -> list[PendingItem]:
    """The items of a lead's helpers, oldest first, the same question once with a ``count``.

    ``helper`` of a grouped item is the first helper that asked.
    """
    ordered = sorted(asked, key=lambda found: (found[0].since, found[2].index))
    first: dict[PendingKey, int] = {}
    counts: dict[PendingKey, int] = {}
    items: list[PendingItem] = []
    for item, key, helper in ordered:
        counts[key] = counts.get(key, 0) + 1
        if key not in first:
            first[key] = len(items)
            items.append(item.model_copy(update={"helper": helper}))
    for key, at in first.items():
        if counts[key] > 1:
            items[at] = items[at].model_copy(update={"count": counts[key]})
    return items


__all__ = [
    "Pending",
    "PendingConsent",
    "PendingKey",
    "diff_counts",
    "group_helper_items",
    "pending_approval",
    "pending_consent",
    "pending_entry",
    "pending_item",
]
