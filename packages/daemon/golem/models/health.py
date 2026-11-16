"""Which providers failed lately, so the next pick skips them for a minute."""

from __future__ import annotations

import time
from collections.abc import Callable

from golem.models.errors import Failure

HEALTH_SECONDS = 60.0

_WHY: dict[Failure, str] = {
    "rate_limited": "rate-limited",
    "server_error": "rate-limited",
    "unreachable": "server is down",
    "auth": "key rejected",
    "no_credit": "out of credit",
    "other": "failed",
}


class Health:
    """A provider that failed stays marked for :data:`HEALTH_SECONDS`. Kept in memory only."""

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, seconds: float = HEALTH_SECONDS
    ) -> None:
        self._clock = clock
        self._seconds = seconds
        self._until: dict[str, tuple[float, str]] = {}

    def mark(self, provider: str, failure: Failure) -> None:
        self._until[provider] = (self._clock() + self._seconds, _WHY[failure])

    def why(self, provider: str) -> str | None:
        """Why ``provider`` is skipped (``rate-limited``, ...), or None when it is fine."""
        found = self._until.get(provider)
        if found is None:
            return None
        if self._clock() >= found[0]:
            del self._until[provider]
            return None
        return found[1]
