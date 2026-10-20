"""What a waiting run's events say: the call it waits on, and what is still open.

A waiting run has no task, so this is read from the log each time someone
answers or cancels it. That is also what makes an approval survive a daemon
restart.
"""

from __future__ import annotations

from dataclasses import dataclass

from golem.sessions.recovery import open_turn
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    MessageCompletedEvent,
)


@dataclass(frozen=True, slots=True)
class Pending:
    """The unanswered ``approval.needed`` of a run, and the rest of the run's state."""

    call_id: str
    name: str
    args: dict[str, object]
    subject: str | None
    diff: str | None
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
        user_message_id=turn.user_message_id,
        prompt=prompt,
        open_calls=tuple(turn.open_calls),
        asked=tuple(asked),
    )


__all__ = ["Pending", "pending_approval"]
