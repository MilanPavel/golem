"""When a routine is due: schedules and the next time one fires (ADR-050).

A schedule is a 5-field cron line, or a plain form that parses to one:

=====================  ==============
``every 15m``          ``*/15 * * * *``
``every 1h``           ``0 * * * *``
``daily 08:30``        ``30 8 * * *``
``weekdays 08:30``     ``30 8 * * 1-5``
``weekly mon 06:00``   ``0 6 * * 1``
=====================  ==============

``mon 06:00`` is the same as ``weekly mon 06:00``. Cron fields take ``*``, lists,
ranges, steps (``*/5``, ``10-30/5``), and the names ``mon``-``sun`` and
``jan``-``dec``. When the day of month and the day of week are both restricted,
a day matches if either does (classic cron).

Times are wall-clock times in a time zone, which is the Mac's by default:

- A time that does not exist (the clock jumps forward) fires at the first valid
  instant after it, which is the moment the clock jumps.
- A time that happens twice (the clock goes back) fires once, at its first
  occurrence.

``next_after`` is the one function the scheduler and ``routine.list`` call.
"""

from __future__ import annotations

import os
import re
from calendar import monthrange
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__all__ = ["Schedule", "ScheduleError", "local_zone", "next_after", "parse_schedule"]

MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
DAYS = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
_EVERY_MINUTES = (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30)
_EVERY_HOURS = (1, 2, 3, 4, 6, 8, 12, 24)
_LOOK_AHEAD_YEARS = 12
"""Far enough for a leap day that falls on a given weekday, and no further."""


class ScheduleError(ValueError):
    """A schedule that does not parse, or never fires. The message is for the person."""


@dataclass(frozen=True, slots=True)
class Schedule:
    """A parsed cron line. ``dom_star`` and ``dow_star`` say the field began with ``*``."""

    minutes: frozenset[int]
    hours: frozenset[int]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]  # 0 is Sunday
    dom_star: bool
    dow_star: bool

    def day_matches(self, day: datetime) -> bool:
        in_month = day.day in self.days
        in_week = (day.weekday() + 1) % 7 in self.weekdays
        if self.dom_star or self.dow_star:
            return in_month and in_week
        return in_month or in_week


def parse_schedule(expr: str) -> Schedule:
    """Parse a cron line or a plain form. Raises :class:`ScheduleError`."""
    text = " ".join(expr.split())
    if not text:
        raise ScheduleError("a schedule is empty")
    fields = _cron_of(text.lower()) or text
    parts = fields.split(" ")
    if len(parts) != 5:
        raise ScheduleError(
            f"{expr!r} is not a schedule: use cron (minute hour day month weekday), "
            "or every 15m, daily 08:30, weekdays 08:30, weekly mon 06:00"
        )
    minute, hour, dom, month, dow = parts
    schedule = Schedule(
        minutes=_field(minute, 0, 59, "minute"),
        hours=_field(hour, 0, 23, "hour"),
        days=_field(dom, 1, 31, "day of month"),
        months=_field(month, 1, 12, "month", MONTHS, 1),
        weekdays=frozenset(d % 7 for d in _field(dow, 0, 7, "day of week", DAYS, 0)),
        dom_star=dom.startswith("*"),
        dow_star=dow.startswith("*"),
    )
    _check_fires(expr, schedule)
    return schedule


def _cron_of(text: str) -> str | None:
    """The cron line for a plain form, or None when ``text`` is not one."""
    every = re.fullmatch(r"every (\d+)\s*([mh])", text)
    if every:
        count, unit = int(every.group(1)), every.group(2)
        if unit == "m" and count in _EVERY_MINUTES:
            return "* * * * *" if count == 1 else f"*/{count} * * * *"
        if unit == "h" and count in _EVERY_HOURS:
            if count == 1:
                return "0 * * * *"
            return "0 0 * * *" if count == 24 else f"0 */{count} * * *"
        allowed = _EVERY_MINUTES if unit == "m" else _EVERY_HOURS
        raise ScheduleError(
            f"{text!r}: every takes a step that divides the {'hour' if unit == 'm' else 'day'} "
            f"evenly ({', '.join(f'{n}{unit}' for n in allowed)}); use cron for another one"
        )
    plain = re.fullmatch(r"(daily|weekdays|weekly [a-z]{3}|[a-z]{3}) (\d{1,2}):(\d{2})", text)
    if plain is None:
        return None
    kind, hour, minute = plain.group(1), int(plain.group(2)), int(plain.group(3))
    if hour > 23 or minute > 59:
        raise ScheduleError(f"{text!r}: {hour:02d}:{minute:02d} is not a time of day")
    if kind == "daily":
        day = "*"
    elif kind == "weekdays":
        day = "1-5"
    else:
        name = kind.split(" ")[-1]
        if name not in DAYS:
            return None
        day = str(DAYS.index(name))
    return f"{minute} {hour} * * {day}"


def _field(
    text: str,
    low: int,
    high: int,
    label: str,
    names: tuple[str, ...] = (),
    name_base: int = 0,
) -> frozenset[int]:
    def number(value: str) -> int:
        lowered = value.lower()
        if names and lowered in names:
            return names.index(lowered) + name_base
        if not value.isdigit():
            raise ScheduleError(f"{value!r} is not a valid {label}")
        return int(value)

    values: set[int] = set()
    for item in text.split(","):
        if not item:
            raise ScheduleError(f"the {label} field has an empty item")
        base, _, step_text = item.partition("/")
        if "/" in item:
            if not step_text.isdigit() or int(step_text) < 1:
                raise ScheduleError(f"{item!r}: the step of the {label} must be 1 or more")
            step = int(step_text)
        else:
            step = 1
        if base == "*":
            start, end = low, high
            if label == "day of week":
                end = 6
        elif "-" in base:
            first, _, last = base.partition("-")
            start, end = number(first), number(last)
        else:
            start = number(base)
            end = high if "/" in item else start
        if start < low or end > high or start > end:
            raise ScheduleError(f"{item!r} is outside the {label} range {low}-{high}")
        values.update(range(start, end + 1, step))
    return frozenset(values)


def _check_fires(expr: str, schedule: Schedule) -> None:
    """Refuse a day-of-month that no chosen month has, such as ``0 0 30 2 *``."""
    if schedule.dom_star or not schedule.dow_star:
        return  # a weekday can match, or the days are all of them
    longest = {m: monthrange(2024, m)[1] for m in schedule.months}  # 2024 is a leap year
    if not any(day <= longest[m] for m in schedule.months for day in schedule.days):
        raise ScheduleError(f"{expr!r} never fires: no chosen month has those days")


def local_zone() -> tzinfo:
    """The Mac's time zone, with its daylight-saving rules when they can be found."""
    name = os.environ.get("TZ", "").lstrip(":")
    if not name:
        try:
            target = Path(os.path.realpath("/etc/localtime")).as_posix()
        except OSError:
            target = ""
        if "zoneinfo/" in target:
            name = target.split("zoneinfo/", 1)[1]
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            pass
    return datetime.now().astimezone().tzinfo or UTC


def next_after(expr: str | Schedule, now: datetime, tz: tzinfo | None = None) -> datetime:
    """The first firing strictly after ``now``, as an aware time in ``tz``.

    ``tz`` is ``now``'s own zone when left out. Raises :class:`ScheduleError`
    for a bad ``expr`` or one that does not fire in the next twelve years.
    """
    schedule = expr if isinstance(expr, Schedule) else parse_schedule(expr)
    if now.tzinfo is None:
        raise ValueError("now must be a time with a zone")
    zone = tz or now.tzinfo
    local = now.astimezone(zone)
    wall = local.replace(tzinfo=None)
    while True:
        wall = _next_wall(schedule, wall)
        instant = _resolve(wall, zone)
        # Compared in UTC: two times in one zone compare by wall clock, and ignore ``fold``.
        if instant.astimezone(UTC) > now.astimezone(UTC):
            return instant


def _next_wall(schedule: Schedule, after: datetime) -> datetime:
    """The first wall-clock time after ``after`` that the schedule names. No zone is involved."""
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    limit = after.year + _LOOK_AHEAD_YEARS
    while t.year <= limit:
        if t.month not in schedule.months:
            t = _first_of_next_month(t)
        elif not schedule.day_matches(t):
            t = (t + timedelta(days=1)).replace(hour=0, minute=0)
        elif t.hour not in schedule.hours:
            later = [h for h in schedule.hours if h > t.hour]
            if later:
                t = t.replace(hour=min(later), minute=0)
            else:
                t = (t + timedelta(days=1)).replace(hour=0, minute=0)
        elif t.minute not in schedule.minutes:
            later = [m for m in schedule.minutes if m > t.minute]
            if later:
                t = t.replace(minute=min(later))
            else:
                t = (t + timedelta(hours=1)).replace(minute=0)
        else:
            return t
    raise ScheduleError("the schedule does not fire in the next twelve years")


def _first_of_next_month(t: datetime) -> datetime:
    if t.month == 12:
        return t.replace(year=t.year + 1, month=1, day=1, hour=0, minute=0)
    return t.replace(month=t.month + 1, day=1, hour=0, minute=0)


def _resolve(wall: datetime, zone: tzinfo) -> datetime:
    """The instant for a wall-clock time: its first occurrence, or the end of a gap it falls in."""
    first = wall.replace(tzinfo=zone, fold=0)
    # A time the clock skips does not survive a trip through UTC.
    if first.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == wall:
        return first
    after = wall.replace(tzinfo=zone, fold=1).utcoffset() or timedelta(0)
    probe = first.astimezone(UTC) - abs((first.utcoffset() or timedelta(0)) - after)
    # Walk forward from before the jump to the first minute that uses the new offset.
    while probe.astimezone(zone).utcoffset() != after:
        probe += timedelta(minutes=1)
    return probe.astimezone(zone)
