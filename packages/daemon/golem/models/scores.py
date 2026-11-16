"""A scoreboard per model, from real use on this Mac.

The counts are written by the store's projection (``model_calls`` and ``model_outcomes``).
This module reads them. ``golem models check`` leaves a seed (``model_check_seeds``): until a
model has :data:`MIN_TOOL_CALLS` real tool calls, its tool score is the check's pass rate.
Tool failures that are the world's fault (a tool that raised, a denied call, a cancelled
call) never count against a model.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from golem.store.database import Database

WINDOW = 200
"""The score reads the newest model calls that hold this many tool calls."""

MIN_TOOL_CALLS = 20
"""Fewer tool calls than this and the score is unknown."""

CACHE_SECONDS = 60.0

_MODEL_FAULTS = ("invalid arguments for", "unknown tool")
_UNAVAILABLE = " is not available in this session"


def is_model_fault(message: str) -> bool:
    """Whether a ``tool.failed`` message says the model asked wrongly: bad arguments or no such
    tool. A tool that raised, a denied call and a cancelled call are the world's answer."""
    text = message.strip().removeprefix("error:").lstrip()
    return text.startswith(_MODEL_FAULTS) or _UNAVAILABLE in text.split("\n", 1)[0]


@dataclass(frozen=True, slots=True)
class Score:
    calls: int  # model calls since the last reset
    tool_calls: int  # tool calls in the window
    bad_tool_calls: int  # of those, invalid arguments, unknown tool, or an unread text call
    stepped_up: int  # runs that left this model for a stronger one
    retried: int  # answers the user asked another model to redo
    tool_score: float | None  # 1 - bad / tool_calls over the window; None under the minimum
    runs: int  # runs that called this model
    seeded: bool = False  # tool_score is the check's pass rate, not real use


def tool_score_of(tool_calls: int, bad: int) -> float | None:
    if tool_calls < MIN_TOOL_CALLS:
        return None
    return max(0.0, 1 - bad / tool_calls)


_WINDOWED = """
WITH kept AS (
    SELECT m.provider || '/' || m.model AS ref, m.tool_calls, m.bad_tool_calls,
        SUM(m.tool_calls) OVER (
            PARTITION BY m.provider, m.model ORDER BY m.started_at DESC, m.rowid DESC
        ) AS running
    FROM model_calls m LEFT JOIN model_score_resets r ON r.ref = m.provider || '/' || m.model
    WHERE m.tool_calls > 0 AND m.model IS NOT NULL AND m.provider IS NOT NULL
        AND (r.reset_at IS NULL OR julianday(m.started_at) > julianday(r.reset_at))
)
SELECT ref, SUM(tool_calls), SUM(COALESCE(bad_tool_calls, 0)) FROM kept
WHERE running - tool_calls < ? GROUP BY ref
"""

_CALLS = """
SELECT m.provider || '/' || m.model AS ref, COUNT(*), COUNT(DISTINCT m.run_id)
FROM model_calls m LEFT JOIN model_score_resets r ON r.ref = m.provider || '/' || m.model
WHERE m.model IS NOT NULL AND m.provider IS NOT NULL
    AND (r.reset_at IS NULL OR julianday(m.started_at) > julianday(r.reset_at))
GROUP BY ref
"""

_OUTCOMES = """
SELECT o.provider || '/' || o.model AS ref, o.outcome, COUNT(*)
FROM model_outcomes o LEFT JOIN model_score_resets r ON r.ref = o.provider || '/' || o.model
WHERE r.reset_at IS NULL OR julianday(o.at) > julianday(r.reset_at)
GROUP BY ref, o.outcome
"""


_SEEDS = """
SELECT s.ref, s.working, s.total
FROM model_check_seeds s LEFT JOIN model_score_resets r ON r.ref = s.ref
WHERE r.reset_at IS NULL OR julianday(s.at) > julianday(r.reset_at)
"""


@dataclass(slots=True)
class _Cache:
    at: float | None = None
    found: dict[str, Score] = field(default_factory=dict[str, Score])


class Scores:
    """The score of each model ref, read from ``golem.db`` and kept for a minute."""

    def __init__(
        self,
        database: Database,
        *,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._database = database
        self._clock = clock
        self._now = now or (lambda: datetime.now(UTC))
        self._cache = _Cache()

    async def of(self, ref: str) -> Score | None:
        return (await self.all()).get(ref)

    async def all(self) -> dict[str, Score]:
        at = self._cache.at
        if at is not None and self._clock() - at < CACHE_SECONDS:
            return self._cache.found
        found = await self._read()
        self._cache = _Cache(self._clock(), found)
        return found

    async def reset(self, ref: str) -> None:
        """Start the score of ``ref`` from nothing. The usage rows stay."""
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT OR REPLACE INTO model_score_resets (ref, reset_at) VALUES (?, ?)",
                (ref, self._now().isoformat()),
            )
        self._cache = _Cache()

    async def seed(self, ref: str, working: int, total: int) -> None:
        """Keep a check's result for ``ref``: ``working`` of ``total`` cases passed or recovered."""
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT OR REPLACE INTO model_check_seeds (ref, working, total, at) "
                "VALUES (?, ?, ?, ?)",
                (ref, working, total, self._now().isoformat()),
            )
        self._cache = _Cache()

    async def _read(self) -> dict[str, Score]:
        window = {
            str(r[0]): (int(r[1]), int(r[2]))
            for r in await self._database.fetch_all(_WINDOWED, (WINDOW,))
        }
        calls = {str(r[0]): (int(r[1]), int(r[2])) for r in await self._database.fetch_all(_CALLS)}
        outcomes: dict[str, dict[str, int]] = {}
        for row in await self._database.fetch_all(_OUTCOMES):
            outcomes.setdefault(str(row[0]), {})[str(row[1])] = int(row[2])
        seeds = {
            str(r[0]): int(r[1]) / int(r[2])
            for r in await self._database.fetch_all(_SEEDS)
            if int(r[2]) > 0
        }
        found: dict[str, Score] = {}
        for ref in sorted(calls.keys() | outcomes.keys() | seeds.keys()):
            count, runs = calls.get(ref, (0, 0))
            tools, bad = window.get(ref, (0, 0))
            counted = outcomes.get(ref, {})
            real = tool_score_of(tools, bad)
            seed = seeds.get(ref)
            found[ref] = Score(
                calls=count,
                tool_calls=tools,
                bad_tool_calls=bad,
                stepped_up=counted.get("stepped_up", 0),
                retried=counted.get("retried_by_user", 0),
                tool_score=real if real is not None or seed is None else seed,
                runs=runs,
                seeded=real is None and seed is not None,
            )
        return found


__all__ = [
    "CACHE_SECONDS",
    "MIN_TOOL_CALLS",
    "WINDOW",
    "Score",
    "Scores",
    "is_model_fault",
    "tool_score_of",
]
