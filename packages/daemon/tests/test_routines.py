"""Schedules: every plain form, cron, and the next firing across daylight-saving changes."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from golem.routines import ScheduleError, next_after, parse_schedule

PRAGUE = ZoneInfo("Europe/Prague")


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=PRAGUE)


def nxt(expr: str, now: str) -> str:
    return next_after(expr, at(now)).isoformat(timespec="minutes")


@pytest.mark.parametrize(
    ("plain", "cron"),
    [
        ("every 15m", "*/15 * * * *"),
        ("every 1h", "0 * * * *"),
        ("every 6h", "0 0,6,12,18 * * *"),
        ("daily 08:30", "30 8 * * *"),
        ("weekdays 08:30", "30 8 * * 1-5"),
        ("weekly mon 06:00", "0 6 * * 1"),
        ("mon 06:00", "0 6 * * 1"),
        ("Weekdays 8:30", "30 8 * * 1-5"),
    ],
)
def test_a_plain_form_is_the_same_as_its_cron(plain: str, cron: str) -> None:
    assert parse_schedule(plain) == parse_schedule(cron)


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "every 7m",
        "every 90m",
        "daily 25:00",
        "weekly funday 06:00",
        "* * * *",
        "61 * * * *",
        "*/0 * * * *",
        "5-1 * * * *",
        "0 0 30 2 *",
        "a b c d e",
    ],
)
def test_a_bad_schedule_is_refused(bad: str) -> None:
    with pytest.raises(ScheduleError):
        parse_schedule(bad)


def test_cron_takes_lists_ranges_steps_and_names() -> None:
    assert nxt("0,30 9-10 * jan-mar mon-fri", "2026-01-05T09:00") == "2026-01-05T09:30+01:00"
    assert nxt("10-20/5 * * * *", "2026-02-02T10:12") == "2026-02-02T10:15+01:00"
    assert nxt("0 0 * * 7", "2026-02-02T10:00") == "2026-02-08T00:00+01:00"  # 7 is Sunday
    assert nxt("0 0 1 JUN *", "2026-02-02T10:00") == "2026-06-01T00:00+02:00"


def test_next_is_strictly_after_now() -> None:
    assert nxt("30 8 * * *", "2026-02-02T08:30") == "2026-02-03T08:30+01:00"
    assert nxt("30 8 * * *", "2026-02-02T08:29") == "2026-02-02T08:30+01:00"


def test_the_morning_brief_skips_the_weekend() -> None:
    # 2026-02-06 is a Friday.
    assert nxt("weekdays 08:30", "2026-02-06T09:00") == "2026-02-09T08:30+01:00"


def test_a_leap_day_waits_for_the_next_leap_year() -> None:
    assert nxt("0 12 29 2 *", "2026-03-01T00:00") == "2028-02-29T12:00+01:00"
    assert nxt("0 12 29 2 *", "2096-03-01T00:00") == "2104-02-29T12:00+01:00"


def test_the_31st_skips_the_months_without_one() -> None:
    assert nxt("0 0 31 * *", "2026-01-31T00:00") == "2026-03-31T00:00+02:00"
    assert nxt("0 0 31 * *", "2026-04-01T00:00") == "2026-05-31T00:00+02:00"


def test_day_of_month_and_day_of_week_are_or_when_both_are_set() -> None:
    # The 15th, or any Monday. 2026-02-02 is a Monday.
    assert nxt("0 0 15 * 1", "2026-02-02T00:00") == "2026-02-09T00:00+01:00"
    assert nxt("0 0 15 * 1", "2026-02-13T00:00") == "2026-02-15T00:00+01:00"
    # With a star in one of them, the other decides alone.
    assert nxt("0 0 * * 1", "2026-02-02T00:00") == "2026-02-09T00:00+01:00"
    assert nxt("0 0 15 * *", "2026-02-02T00:00") == "2026-02-15T00:00+01:00"


def test_a_time_the_clock_skips_runs_at_the_first_valid_instant() -> None:
    # On 2026-03-29 the clock jumps from 02:00 to 03:00 in Prague.
    when = next_after("30 2 * * *", at("2026-03-28T12:00"))
    assert when.astimezone(UTC) == datetime(2026, 3, 29, 1, 0, tzinfo=UTC)
    assert when.isoformat() == "2026-03-29T03:00:00+02:00"
    # It does not fire twice that morning, and the next day is normal.
    assert nxt("30 2 * * *", "2026-03-29T03:00") == "2026-03-30T02:30+02:00"
    # A run in the gap fires once, not once per skipped slot.
    assert nxt("*/15 * * * *", "2026-03-29T01:45") == "2026-03-29T03:00+02:00"
    assert nxt("*/15 * * * *", "2026-03-29T03:00") == "2026-03-29T03:15+02:00"


def test_a_time_that_happens_twice_runs_once_at_its_first_occurrence() -> None:
    # On 2026-10-25 the clock goes from 03:00 back to 02:00 in Prague.
    first = next_after("30 2 * * *", at("2026-10-24T12:00"))
    assert first.astimezone(UTC) == datetime(2026, 10, 25, 0, 30, tzinfo=UTC)  # still +02:00
    after = next_after("30 2 * * *", first)
    assert after.astimezone(UTC) == datetime(2026, 10, 26, 1, 30, tzinfo=UTC)  # the next day
    # From the second 02:30 (+01:00) the next one is also the next day.
    second = datetime(2026, 10, 25, 1, 30, tzinfo=UTC).astimezone(PRAGUE)
    assert second.hour == 2 and second.utcoffset() is not None
    assert next_after("30 2 * * *", second).astimezone(UTC) == after.astimezone(UTC)


def test_an_hourly_schedule_does_not_repeat_the_ambiguous_hour() -> None:
    # 02:00 +02:00 (00:00Z) fired; the repeated 02:00 +01:00 does not, and 03:00 +01:00 does.
    first = next_after("0 * * * *", datetime(2026, 10, 25, 0, 0, tzinfo=UTC), PRAGUE)
    assert first.astimezone(UTC) == datetime(2026, 10, 25, 2, 0, tzinfo=UTC)


def test_the_zone_is_the_one_asked_for() -> None:
    now = datetime(2026, 2, 2, 12, 0, tzinfo=UTC)
    in_tokyo = next_after("0 9 * * *", now, ZoneInfo("Asia/Tokyo"))
    assert in_tokyo.isoformat() == "2026-02-03T09:00:00+09:00"
