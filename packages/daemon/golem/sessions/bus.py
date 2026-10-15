"""Live delivery: session events to attached targets, summaries to watchers."""

from __future__ import annotations

import logging
from typing import Protocol

from golem_protocol.commands import SessionSummary
from golem_protocol.events import ChatEvent

log = logging.getLogger("golem.sessions")


class EventTarget(Protocol):
    """Where an attached session's events go. ``deliver`` must not block.

    Raising :class:`ConnectionError` or :class:`OSError` means the target is
    gone. The bus then forgets it for every session.
    """

    def deliver(self, event: ChatEvent) -> None: ...


class SummaryTarget(Protocol):
    """Where a watcher's summaries go. Same rules as :class:`EventTarget`."""

    def deliver_summary(self, summary: SessionSummary) -> None: ...


class EventBus:
    """Which targets follow which session, and which watch them all."""

    def __init__(self) -> None:
        self._targets: dict[str, set[EventTarget]] = {}
        self._watchers: set[SummaryTarget] = set()

    def subscribe(self, session_id: str, target: EventTarget) -> None:
        self._targets.setdefault(session_id, set()).add(target)

    def unsubscribe(self, session_id: str, target: EventTarget) -> None:
        targets = self._targets.get(session_id)
        if targets is None:
            return
        targets.discard(target)
        if not targets:
            del self._targets[session_id]

    def watch(self, target: SummaryTarget) -> None:
        self._watchers.add(target)

    def unsubscribe_all(self, target: object) -> None:
        """Forget ``target`` for every session and as a watcher."""
        kept = {
            session_id: {other for other in targets if other is not target}
            for session_id, targets in self._targets.items()
        }
        self._targets = {session_id: targets for session_id, targets in kept.items() if targets}
        self._watchers = {other for other in self._watchers if other is not target}

    def subscribed(self, session_id: str, target: EventTarget) -> bool:
        return target in self._targets.get(session_id, ())

    @property
    def watched(self) -> bool:
        """True while any target watches the session list."""
        return bool(self._watchers)

    def publish(self, event: ChatEvent) -> None:
        """Hand ``event`` to each target of its session. Drops targets that are gone."""
        for target in list(self._targets.get(event.session_id, ())):
            try:
                target.deliver(event)
            except (ConnectionError, OSError):
                log.debug("dropping a target that went away during %s", event.type)
                self.unsubscribe_all(target)

    def publish_summary(self, summary: SessionSummary) -> None:
        """Hand ``summary`` to every watcher. Drops watchers that are gone."""
        for watcher in list(self._watchers):
            try:
                watcher.deliver_summary(summary)
            except (ConnectionError, OSError):
                log.debug("dropping a watcher that went away")
                self.unsubscribe_all(watcher)


__all__ = ["EventBus", "EventTarget", "SummaryTarget"]
