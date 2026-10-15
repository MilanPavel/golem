"""Live delivery of session events to the connections attached to them."""

from __future__ import annotations

import logging
from typing import Protocol

from golem_protocol.events import ChatEvent

log = logging.getLogger("golem.sessions")


class EventTarget(Protocol):
    """Where an attached session's events go. ``deliver`` must not block.

    Raising :class:`ConnectionError` or :class:`OSError` means the target is
    gone. The bus then forgets it for every session.
    """

    def deliver(self, event: ChatEvent) -> None: ...


class EventBus:
    """Which targets follow which session."""

    def __init__(self) -> None:
        self._targets: dict[str, set[EventTarget]] = {}

    def subscribe(self, session_id: str, target: EventTarget) -> None:
        self._targets.setdefault(session_id, set()).add(target)

    def unsubscribe(self, session_id: str, target: EventTarget) -> None:
        targets = self._targets.get(session_id)
        if targets is None:
            return
        targets.discard(target)
        if not targets:
            del self._targets[session_id]

    def unsubscribe_all(self, target: EventTarget) -> None:
        for session_id in [sid for sid, targets in self._targets.items() if target in targets]:
            self.unsubscribe(session_id, target)

    def subscribed(self, session_id: str, target: EventTarget) -> bool:
        return target in self._targets.get(session_id, ())

    def publish(self, event: ChatEvent) -> None:
        """Hand ``event`` to each target of its session. Drops targets that are gone."""
        for target in list(self._targets.get(event.session_id, ())):
            try:
                target.deliver(event)
            except (ConnectionError, OSError):
                log.debug("dropping a target that went away during %s", event.type)
                self.unsubscribe_all(target)


__all__ = ["EventBus", "EventTarget"]
