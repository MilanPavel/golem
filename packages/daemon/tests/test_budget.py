"""The caps in ``[budget]``: what is left, and the questions the daemon asks about it."""

from __future__ import annotations

import pytest

from golem.config import BudgetSettings
from golem.models.budget import Budget, Room, room
from golem.sessions.usage import Usage
from golem.store.database import Database
from golem_protocol.events import TokenUsage


async def _spend(usage: Usage, session_id: str, cost: float) -> None:
    await usage.record_role_call(
        session_id=session_id,
        role="titles",
        provider="deepseek",
        model="m",
        tier="budget",
        usage=TokenUsage(input=1, output=1),
        cost_usd=cost,
    )


async def test_no_caps_leave_no_limit(database: Database) -> None:
    usage = Usage(database)
    await _spend(usage, "s_1", 5.0)
    found = await room(usage, BudgetSettings(), "s_1", usage.today())
    assert found == Room(None, None, 5.0, 5.0)
    assert not found.spent


async def test_one_cap_leaves_what_is_under_it(database: Database) -> None:
    usage = Usage(database)
    await _spend(usage, "s_1", 0.25)
    await _spend(usage, "s_2", 0.5)
    today = usage.today()
    day = await room(usage, BudgetSettings(daily_usd=1.0), "s_1", today)
    assert (day.usd, day.cap) == (0.25, "day")
    session = await room(usage, BudgetSettings(session_usd=1.0), "s_1", today)
    assert (session.usd, session.cap) == (0.75, "session")
    assert (session.spent_today, session.spent_session) == (0.75, 0.25)


async def test_with_both_caps_the_tighter_one_wins(database: Database) -> None:
    usage = Usage(database)
    await _spend(usage, "s_1", 0.25)
    await _spend(usage, "s_2", 0.5)
    today = usage.today()
    tight_day = await room(usage, BudgetSettings(daily_usd=1.0, session_usd=5.0), "s_1", today)
    assert (tight_day.usd, tight_day.cap) == (0.25, "day")
    tight_session = await room(usage, BudgetSettings(daily_usd=5.0, session_usd=0.5), "s_1", today)
    assert (tight_session.usd, tight_session.cap) == (0.25, "session")


async def test_a_cap_spent_exactly_or_passed_leaves_zero(database: Database) -> None:
    usage = Usage(database)
    await _spend(usage, "s_1", 0.01)
    today = usage.today()
    exact = await room(usage, BudgetSettings(daily_usd=0.01), "s_1", today)
    assert (exact.usd, exact.cap, exact.spent) == (0.0, "day", True)
    over = await room(usage, BudgetSettings(session_usd=0.005), "s_1", today)
    assert (over.usd, over.cap, over.spent) == (0.0, "session", True)


async def test_a_cap_of_zero_is_spent_from_the_start(database: Database) -> None:
    usage = Usage(database)
    found = await room(usage, BudgetSettings(daily_usd=0.0), "s_1", usage.today())
    assert found.spent


async def test_paid_ok_is_kept_for_a_few_seconds(database: Database) -> None:
    usage = Usage(database)
    now = [100.0]
    budget = Budget(usage, lambda: BudgetSettings(daily_usd=0.5), clock=lambda: now[0])
    assert await budget.paid_ok("s_1")
    await _spend(usage, "s_1", 1.0)
    assert await budget.paid_ok("s_1")  # still the earlier answer
    now[0] += 10.0
    assert not await budget.paid_ok("s_1")


async def test_an_old_answer_of_one_session_is_not_used_for_another(database: Database) -> None:
    usage = Usage(database)
    now = [100.0]
    budget = Budget(usage, lambda: BudgetSettings(session_usd=0.5), clock=lambda: now[0])
    await _spend(usage, "s_1", 1.0)
    assert not await budget.paid_ok("s_1")
    now[0] += 10.0
    # The answer of s_1 is old by now. s_2 has spent nothing, and is asked about itself.
    assert await budget.paid_ok("s_2")
    assert not await budget.paid_ok("s_1")


@pytest.mark.parametrize("daily", [None, 10.0])
async def test_there_is_no_block_while_there_is_room(
    database: Database, daily: float | None
) -> None:
    usage = Usage(database)
    await _spend(usage, "s_1", 1.0)
    budget = Budget(usage, lambda: BudgetSettings(daily_usd=daily))
    assert await budget.paid_ok("s_1")
