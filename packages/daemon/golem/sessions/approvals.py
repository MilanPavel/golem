"""What a waiting run's events say: the call it waits on, and what is still open.

A waiting run has no task, so this is read from the log each time someone
answers or cancels it. That is also what makes an approval survive a daemon
restart.
"""

from __future__ import annotations

from dataclasses import dataclass

from golem.sessions.recovery import open_turn
from golem_protocol.commands import PendingItem
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


def pending_item(events: list[ChatEvent]) -> PendingItem | None:
    """What the run of ``events`` waits for, as the session summary carries it.

    An approval wins when both are open. The diff is counted, never copied.
    """
    approval = pending_approval(events)
    if approval is not None:
        added, removed = (None, None) if approval.diff is None else diff_counts(approval.diff)
        return PendingItem(
            kind="approval",
            since=approval.since,
            call_id=approval.call_id,
            name=approval.name,
            subject=approval.subject,
            source=approval.source,
            added=added,
            removed=removed,
        )
    consent = pending_consent(events)
    if consent is not None:
        return PendingItem(
            kind="consent", since=consent.since, alternatives=len(consent.alternatives)
        )
    return None


__all__ = [
    "Pending",
    "PendingConsent",
    "diff_counts",
    "pending_approval",
    "pending_consent",
    "pending_item",
]
