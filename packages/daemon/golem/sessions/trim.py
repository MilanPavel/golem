"""Trim finished helpers to a receipt (ADR-059, section 9).

A helper keeps its steps for ``[agents] keep_days`` from its end, then only its brief, its
answer and a ``session.trimmed`` stay. One that failed, was cancelled or asked you something
uses ``keep_problem_days``. The days count from the end of its last run. 0 keeps for ever.

One task runs a pass at start and then once an hour. The settings are read again on every
pass, so a changed ``config.toml`` applies to the next one without a restart. The clock and
the sleep are parameters, so a test drives time itself.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from golem.config import AgentSettings
from golem.sessions.log import SessionLog
from golem.store.records import FinishedHelper, SessionRecords

log = logging.getLogger("golem.sessions")

PASS_EVERY = 3600.0
"""Seconds between two passes."""

BATCH = 20
"""Helpers one pass trims, so a large backlog does not hold the store."""


def is_due(helper: FinishedHelper, settings: AgentSettings, now: datetime) -> bool:
    """Whether ``helper`` ended more days ago than its keep time allows."""
    problem = helper.asked or helper.status != "completed"
    days = settings.keep_problem_days if problem else settings.keep_days
    if days == 0:
        return False
    try:
        ended = datetime.fromisoformat(helper.ended_at)
    except ValueError:
        return False
    if ended.tzinfo is None:
        ended = ended.replace(tzinfo=UTC)
    return now - ended > timedelta(days=days)


class HelperTrimmer:
    """Trims due helpers in small batches, one transaction each."""

    def __init__(
        self,
        records: SessionRecords,
        log_: SessionLog,
        settings: Callable[[], AgentSettings],
        now: Callable[[], datetime],
        drop_thread: Callable[[str], Awaitable[object]] | None = None,
        sleep: Callable[[float], Awaitable[object]] = asyncio.sleep,
        batch: int = BATCH,
    ) -> None:
        self._records = records
        self._log = log_
        self._settings = settings
        self._now = now
        self._drop_thread = drop_thread
        self._sleep = sleep
        self._batch = batch
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop(), name="golem-helper-trim")

    async def aclose(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def run_once(self) -> int:
        """Trim up to one batch of due helpers. Returns how many were trimmed."""
        try:
            settings = self._settings()
        except Exception:
            log.warning("config.toml does not load; no helper is trimmed this time", exc_info=True)
            return 0
        if settings.keep_days == 0 and settings.keep_problem_days == 0:
            return 0
        now = self._now()
        due = [
            helper
            for helper in await self._records.finished_helpers()
            if is_due(helper, settings, now)
        ][: self._batch]
        trimmed = 0
        for helper in due:
            try:
                if self._drop_thread is not None:
                    await self._drop_thread(helper.session_id)
                if await self._log.trim(helper.session_id, now.astimezone(UTC).isoformat()):
                    trimmed += 1
            except Exception:
                log.warning("could not trim helper %s", helper.session_id, exc_info=True)
        if trimmed:
            log.info("trimmed %d finished helpers to a receipt", trimmed)
        return trimmed

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_once()
            except Exception:
                log.exception("the helper trim pass failed")
            await self._sleep(PASS_EVERY)


__all__ = ["BATCH", "PASS_EVERY", "HelperTrimmer", "is_due"]
