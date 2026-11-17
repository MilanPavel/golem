"""Decides what to tell you. A :class:`Poster` only shows it (ADR-050, the notifier).

The notifier watches the event bus. It speaks only for a session no client is
attached to, once per session and kind until the cause changes, and a routine
that keeps failing says so once.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from golem_protocol.events import (
    ApprovalNeededEvent,
    ChatEvent,
    RunFailedEvent,
    SessionCompletedEvent,
)

log = logging.getLogger("golem.notify")

Kind = Literal["needs_you", "failed", "finished"]
BODY_CHARS = 160
"""A banner line is short. Longer text is cut with "…"."""


@dataclass(frozen=True, slots=True)
class Notice:
    """One banner. ``session_id`` keys it, so a poster may replace an older one."""

    kind: Kind
    session_id: str
    title: str
    body: str


class Poster(Protocol):
    """Shows a notice. The Mac app replaces the implementation, not the notifier."""

    name: str

    async def post(self, notice: Notice) -> bool:
        """Show ``notice``. False when it could not be shown. Must not raise."""
        ...


@dataclass(frozen=True, slots=True)
class NotifierKinds:
    """Which kinds are on. ``needs_you`` cannot be turned off."""

    failed: bool = True
    finished: bool = False

    def on(self, kind: Kind) -> bool:
        if kind == "failed":
            return self.failed
        if kind == "finished":
            return self.finished
        return True


@dataclass(frozen=True, slots=True)
class SessionFacts:
    title: str | None
    origin: str


Lookup = Callable[[str], Awaitable[SessionFacts | None]]
KindsFor = Callable[[str | None], NotifierKinds]
"""Which kinds are on for a routine (its name), or None for any other session. Called for
each notice, so a change in Settings counts at once."""


def _cut(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= BODY_CHARS else f"{text[: BODY_CHARS - 1].rstrip()}…"


class Notifier:
    """Listens to published events and posts a :class:`Notice` when one is due."""

    def __init__(
        self,
        poster: Poster,
        lookup: Lookup,
        attached: Callable[[str], bool],
        kinds: NotifierKinds | KindsFor | None = None,
    ) -> None:
        self._poster = poster
        self._lookup = lookup
        self._attached = attached
        if kinds is None:
            kinds = NotifierKinds()
        self._kinds: KindsFor = (
            (lambda _routine: kinds) if isinstance(kinds, NotifierKinds) else kinds
        )
        self._said: dict[tuple[str, Kind], str] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    @property
    def poster(self) -> Poster:
        return self._poster

    def on_event(self, event: ChatEvent) -> None:
        """The bus calls this for every event. Cheap and non-blocking."""
        match event:
            case ApprovalNeededEvent():
                data = event.data
                what = data.name if not data.subject else f"{data.name} {data.subject}"
                self._consider(event, "needs_you", data.call_id, f"Allow {what}")
            case RunFailedEvent():
                self._consider(event, "failed", event.data.message, event.data.message)
            case SessionCompletedEvent() if event.data.status == "completed":
                self._consider(
                    event,
                    "finished",
                    event.data.run_id,
                    event.data.summary or "Finished",
                    clears="failed",
                )
            case _:
                return

    def _consider(
        self,
        event: ChatEvent,
        kind: Kind,
        fingerprint: str,
        body: str,
        *,
        clears: Kind | None = None,
    ) -> None:
        if self._attached(event.session_id):
            return
        task = asyncio.create_task(
            self._say(event.session_id, kind, fingerprint, _cut(body), clears),
            name=f"golem-notify-{kind}",
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _say(
        self, session_id: str, kind: Kind, fingerprint: str, body: str, clears: Kind | None
    ) -> None:
        try:
            facts = await self._lookup(session_id)
            origin = "user" if facts is None else facts.origin
            if kind == "needs_you" and origin == "user":
                # ADR-050: a chat you typed into is yours; only headless sessions ping you.
                return
            routine = origin.startswith("routine:")
            # A routine's firings are separate sessions, so the routine is the key.
            key = origin if routine else session_id
            if clears is not None:
                self._said.pop((key, clears), None)
            on = self._kinds(origin.removeprefix("routine:") if routine else None).on(kind)
            if not on or self._said.get((key, kind)) == fingerprint:
                return
            self._said[(key, kind)] = fingerprint
            if facts is not None and facts.title:
                title = facts.title
            elif routine:
                title = origin.removeprefix("routine:")
            else:
                title = "golem"
            await self._poster.post(Notice(kind, session_id, title, body))
        except Exception:
            log.exception("notifying about %s failed", kind)

    async def test(self) -> bool:
        """Post a sample banner, as ``notify.test`` does. True when it was shown."""
        return await self._poster.post(Notice("needs_you", "test", "golem", "Notifications work."))

    async def drain(self) -> None:
        """Wait for notices being posted. For tests and shutdown."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)


__all__ = ["Notice", "Notifier", "NotifierKinds", "Poster", "SessionFacts"]
