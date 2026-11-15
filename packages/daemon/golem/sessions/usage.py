"""What model calls cost, read from the ``model_calls`` table.

Chat calls reach the table through the projection of ``model.call.*`` events. Calls
outside a run, such as a title, are written by :meth:`Usage.record_role_call`.

"Day" is the user's local day, stored as ``YYYY-MM-DD`` when the row is written. Money is a
float on purpose (sub-cent amounts): it is summed in SQL and rounded only for display.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, tzinfo

from golem.config import ModelPrice
from golem.models.cost import cost_usd
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.projection import local_day, project_model_call
from golem_protocol.events import (
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    TokenUsage,
)

EVER = "0000-00-00"
"""A ``since_day`` that reaches every row."""


@dataclass(frozen=True, slots=True)
class Reference:
    """The model whose price says what local tokens would have cost."""

    ref: str
    price: ModelPrice


@dataclass(frozen=True, slots=True)
class Totals:
    calls: int = 0
    input: int = 0
    output: int = 0
    cost_usd: float = 0.0
    saved_usd: float = 0.0


@dataclass(frozen=True, slots=True)
class ModelUsage:
    provider: str | None
    model: str | None
    tier: str | None
    calls: int
    input: int
    output: int
    cost_usd: float


@dataclass(frozen=True, slots=True)
class DayUsage:
    day: str
    local_tokens: int
    paid_tokens: int
    cost_usd: float


@dataclass(frozen=True, slots=True)
class UsageSummary:
    """``totals`` cover the rows from ``since_day`` on. ``by_day`` has one entry for each
    local day from ``since_day`` to today, oldest first, and none when ``since_day`` is
    :data:`EVER`."""

    totals: Totals
    by_model: list[ModelUsage] = field(default_factory=list[ModelUsage])
    by_day: list[DayUsage] = field(default_factory=list[DayUsage])
    saved_reference: str | None = None


class Usage:
    """Reads and writes the ``model_calls`` table of ``golem.db``.

    ``clock`` gives the current UTC time and ``zone`` is the user's time zone (the machine's
    when None). Both are for tests.
    """

    def __init__(
        self,
        database: Database,
        *,
        clock: Callable[[], datetime] | None = None,
        zone: tzinfo | None = None,
    ) -> None:
        self._database = database
        self._clock = clock or (lambda: datetime.now(UTC))
        self._zone = zone

    def today(self) -> str:
        """The local date now."""
        return local_day(self._clock().isoformat(), self._zone)

    def days_back(self, count: int) -> str:
        """The local date ``count`` days before today."""
        return (datetime.fromisoformat(self.today()) - timedelta(days=count)).date().isoformat()

    async def record_role_call(
        self,
        *,
        session_id: str | None,
        role: str,
        provider: str | None,
        model: str | None,
        tier: str | None,
        usage: TokenUsage | None,
        cost_usd: float | None,
        failed: bool = False,
    ) -> None:
        """Write one call made outside a run, such as a title.

        It is written directly and is not rebuilt from events: no event records it, so
        :func:`backfill` never brings it back.
        """
        now = self._clock().isoformat()
        used = usage or TokenUsage()
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO model_calls (call_id, session_id, run_id, role, provider, model, tier,"
                " started_at, day, input, output, cache_read, cache_write, cost_usd, failed)"
                " VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    f"{role}-{uuid.uuid4().hex}",
                    session_id,
                    role,
                    provider,
                    model,
                    tier,
                    now,
                    local_day(now, self._zone),
                    used.input,
                    used.output,
                    used.cache_read,
                    used.cache_write,
                    cost_usd,
                    1 if failed else 0,
                ),
            )

    async def spent(self, *, day: str | None = None, session_id: str | None = None) -> float:
        """USD paid, over one local ``day`` and/or one session. Calls with no cost above 0 are
        not counted. One indexed query."""
        where, params = ["cost_usd > 0"], list[object]()
        if day is not None:
            where.append("day = ?")
            params.append(day)
        if session_id is not None:
            where.append("session_id = ?")
            params.append(session_id)
        row = await self._database.fetch_one(
            f"SELECT COALESCE(SUM(cost_usd), 0) FROM model_calls WHERE {' AND '.join(where)}",
            tuple(params),
        )
        return 0.0 if row is None else float(row[0])

    async def summary(
        self,
        *,
        since_day: str,
        session_id: str | None = None,
        reference: Reference | None = None,
    ) -> UsageSummary:
        """Totals, calls by model, and tokens by day, from ``since_day`` on.

        ``saved_usd`` prices the tokens of ``local`` calls at ``reference``, and is 0 without one.
        """
        where, params = "day >= ?", [since_day]
        if session_id is not None:
            where += " AND session_id = ?"
            params.append(session_id)
        args = tuple(params)
        total = await self._database.fetch_one(
            "SELECT COUNT(*), COALESCE(SUM(input), 0), COALESCE(SUM(output), 0),"
            " COALESCE(SUM(cost_usd), 0),"
            " COALESCE(SUM(CASE WHEN tier = 'local' THEN input END), 0),"
            " COALESCE(SUM(CASE WHEN tier = 'local' THEN output END), 0),"
            " COALESCE(SUM(CASE WHEN tier = 'local' THEN cache_read END), 0),"
            " COALESCE(SUM(CASE WHEN tier = 'local' THEN cache_write END), 0)"
            f" FROM model_calls WHERE {where}",
            args,
        )
        saved = 0.0
        if total is not None and reference is not None:
            saved = (
                cost_usd(
                    {
                        "input": int(total[4]),
                        "output": int(total[5]),
                        "cache_read": int(total[6]),
                        "cache_write": int(total[7]),
                    },
                    reference.price,
                )
                or 0.0
            )
        totals = (
            Totals()
            if total is None
            else Totals(
                calls=int(total[0]),
                input=int(total[1]),
                output=int(total[2]),
                cost_usd=float(total[3]),
                saved_usd=saved,
            )
        )
        models = await self._database.fetch_all(
            "SELECT provider, model, tier, COUNT(*), COALESCE(SUM(input), 0),"
            " COALESCE(SUM(output), 0), COALESCE(SUM(cost_usd), 0) AS spent"
            f" FROM model_calls WHERE {where} GROUP BY provider, model, tier"
            " ORDER BY spent DESC, COUNT(*) DESC, provider, model",
            args,
        )
        return UsageSummary(
            totals=totals,
            by_model=[
                ModelUsage(r[0], r[1], r[2], int(r[3]), int(r[4]), int(r[5]), float(r[6]))
                for r in models
            ],
            by_day=await self._by_day(where, args, since_day),
            saved_reference=None if reference is None else reference.ref,
        )

    async def _by_day(self, where: str, args: tuple[object, ...], since_day: str) -> list[DayUsage]:
        if since_day == EVER:
            return []
        rows = await self._database.fetch_all(
            "SELECT day,"
            " COALESCE(SUM(CASE WHEN tier = 'local' THEN COALESCE(input, 0) + COALESCE(output, 0)"
            " END), 0),"
            " COALESCE(SUM(CASE WHEN tier IS NOT 'local' THEN COALESCE(input, 0)"
            " + COALESCE(output, 0) END), 0), COALESCE(SUM(cost_usd), 0)"
            f" FROM model_calls WHERE {where} GROUP BY day",
            args,
        )
        found = {r[0]: DayUsage(r[0], int(r[1]), int(r[2]), float(r[3])) for r in rows}
        days: list[DayUsage] = []
        day = datetime.fromisoformat(since_day).date()
        last = datetime.fromisoformat(self.today()).date()
        while day <= last:
            key = day.isoformat()
            days.append(found.get(key, DayUsage(key, 0, 0, 0.0)))
            day += timedelta(days=1)
        return days


async def backfill(database: Database) -> int:
    """Fill an empty ``model_calls`` from the stored ``model.call.*`` events.

    Does nothing when the table has a row. Returns the number of events replayed. Old calls
    have no cost, but their tokens count.
    """
    if await database.fetch_one("SELECT 1 FROM model_calls LIMIT 1") is not None:
        return 0
    found = [
        event
        for event in await EventLog(database).of_types(
            ("model.call.started", "model.call.completed")
        )
        if isinstance(event, ModelCallStartedEvent | ModelCallCompletedEvent)
    ]
    async with database.transaction() as tx:
        for event in found:
            await project_model_call(tx, event)
    return len(found)


__all__ = [
    "EVER",
    "DayUsage",
    "ModelUsage",
    "Reference",
    "Totals",
    "Usage",
    "UsageSummary",
    "backfill",
]
