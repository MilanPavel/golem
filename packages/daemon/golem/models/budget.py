"""What the caps in ``[budget]`` still allow. A cap is checked before a call, so one call can
pass it by its own cost: the cost is known only when the call ends.

"Today" is the local day of the usage table.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from golem.config import BudgetSettings
from golem.sessions.usage import Usage

Cap = Literal["day", "session"]

_EPSILON = 1e-9
"""Below this many dollars left, a cap counts as spent (float sums of sub-cent amounts)."""

CACHE_SECONDS = 3.0


@dataclass(frozen=True, slots=True)
class Room:
    usd: float | None
    """What the caps leave, the smaller of the two. None: no cap. 0.0: spent."""
    cap: Cap | None
    """The tighter cap, None without one. The day wins a tie."""
    spent_today: float
    spent_session: float

    @property
    def spent(self) -> bool:
        return self.usd is not None and self.usd <= 0


def _left(cap: float | None, spent: float) -> float | None:
    if cap is None:
        return None
    left = cap - spent
    return 0.0 if left < _EPSILON else left


async def room(usage: Usage, settings: BudgetSettings, session_id: str, today: str) -> Room:
    """What the caps leave for ``session_id`` on the local day ``today``."""
    spent_today = await usage.spent(day=today)
    spent_session = await usage.spent(session_id=session_id)
    day = _left(settings.daily_usd, spent_today)
    session = _left(settings.session_usd, spent_session)
    if day is None and session is None:
        return Room(None, None, spent_today, spent_session)
    if session is None or (day is not None and day <= session):
        return Room(day, "day", spent_today, spent_session)
    return Room(session, "session", spent_today, spent_session)


def spent_text(found: Room) -> str:
    """Plain words for a spent cap: ``the daily budget is spent``."""
    return f"the {'daily' if found.cap == 'day' else 'session'} budget is spent"


class Budget:
    """The caps as the daemon asks about them: the room of a session, and a cheap yes or no.

    ``settings`` reads ``[budget]`` each time, so a change in Settings counts at once.
    """

    def __init__(
        self,
        usage: Usage,
        settings: Callable[[], BudgetSettings],
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._usage = usage
        self._settings = settings
        self._clock = clock
        self._seen: dict[str, tuple[float, bool]] = {}

    async def room(self, session_id: str) -> Room:
        """The room now, from the table."""
        return await room(self._usage, self._settings(), session_id, self._usage.today())

    async def paid_ok(self, session_id: str | None) -> bool:
        """False when a cap is spent. The answer is kept for a few seconds."""
        key = session_id or ""
        now = self._clock()
        found = self._seen.get(key)
        if found is not None and now - found[0] < CACHE_SECONDS:
            return found[1]
        for old in [k for k, (at, _) in self._seen.items() if now - at >= CACHE_SECONDS]:
            del self._seen[old]
        ok = not (await self.room(key)).spent
        self._seen[key] = (now, ok)
        return ok
