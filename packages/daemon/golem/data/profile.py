"""The shape of each column of a table: what a person sees as a small chart.

One pass of SQL gives the counts, the distinct count, the extremes and the mean of every
column. A second, small query per column then draws what its shape needs: the bins of a
histogram, the top values of a category, the most frequent text. Runs inside the worker, on a
cursor, over a table name the engine already checked, so no text from a caller is in the SQL.
"""

from __future__ import annotations

import re
from typing import Any

import duckdb

from golem.data.types import DataError

BINS = 24
"""How many equal-width bins a histogram has."""
CATEGORY_MAX = 12
"""A column with at most this many distinct values is a category."""
TOP_VALUES = 4
"""How many values of a category are listed. The rest are counted together."""

_INTEGER = re.compile(r"^U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?$")
_NUMBER = re.compile(r"^(FLOAT|DOUBLE|REAL|DECIMAL(\(.*\))?)$")
_DATE = re.compile(r"^(DATE|TIMESTAMP.*)$")
_COLUMNS_PER_ROW = 6


def ident(name: str) -> str:
    """``name`` as a quoted SQL identifier."""
    return '"' + name.replace('"', '""') + '"'


def _is_integer(kind: str) -> bool:
    return _INTEGER.match(kind) is not None or kind in ("HUGEINT", "UHUGEINT")


def _is_number(kind: str) -> bool:
    return _is_integer(kind) or _NUMBER.match(kind) is not None


def _is_date(kind: str) -> bool:
    return _DATE.match(kind) is not None


def _is_plain(kind: str) -> bool:
    """A type DuckDB can count, order and compare: not a list, a struct, a map or a blob."""
    return (
        _is_number(kind)
        or _is_date(kind)
        or kind in ("VARCHAR", "BOOLEAN", "UUID", "TIME", "TIME WITH TIME ZONE")
    )


def _can_be_key(kind: str) -> bool:
    return _is_integer(kind) or kind in ("VARCHAR", "UUID")


def profile(cursor: Any, table: str, columns: list[tuple[str, str]]) -> dict[str, Any]:
    """The profile of ``table`` (an SQL name) with ``columns`` as ``(name, type)`` pairs."""
    from golem.data import engine
    from golem.data.engine import json_value

    try:
        total = int(cursor.execute(f"select count(*) from {table}").fetchone()[0])
        approximate = total > engine.EXACT_DISTINCT_ROWS
        parts: list[str] = []
        for name, kind in columns:
            c = ident(name)
            if not _is_plain(kind):
                parts += [f"count({c})", "null", "null", "null", "null", "null"]
                continue
            counted = f"approx_count_distinct({c})" if approximate else f"count(distinct {c})"
            mean = f"avg(cast({c} as double))" if _is_number(kind) else "null"
            length = f"avg(length({c}))" if kind == "VARCHAR" else "null"
            parts += [f"count({c})", counted, f"min({c})", f"max({c})", mean, length]
        row = None
        if total and parts:
            row = cursor.execute(f"select {', '.join(parts)} from {table}").fetchone()
        out: list[dict[str, Any]] = []
        for index, (name, kind) in enumerate(columns):
            base = index * _COLUMNS_PER_ROW
            if row is None:
                present, unique, low, high, mean, length = 0, 0, None, None, None, None
            else:
                present, unique, low, high, mean, length = row[base : base + _COLUMNS_PER_ROW]
            present, unique = int(present or 0), int(unique or 0)
            exact = not approximate
            if approximate and present == total and unique >= total * 0.9 and _can_be_key(kind):
                # An estimate must not call a column a key, so a likely key is counted exactly.
                unique = _exact_distinct(cursor, table, name)
                exact = True
            item: dict[str, Any] = {
                "name": name,
                "type": kind,
                "shape": _shape(kind, total, present, unique),
                "empty": 0.0 if total == 0 else round(1 - present / total, 6),
                "distinct": unique,
                "distinct_estimate": not exact,
                "min": json_value(low),
                "max": json_value(high),
                "mean": None if mean is None else float(mean),
                "bins": None,
                "top": [],
                "more_values": 0,
                "more_rows": 0,
                "unique_ratio": None,
                "avg_length": None,
                "most_common": None,
            }
            _fill(cursor, table, item, present, length)
            out.append(item)
    except duckdb.InterruptException as exc:
        raise DataError("The profile was cancelled.") from exc
    except duckdb.Error as exc:
        raise DataError(_first_line(exc)) from exc
    return {"rows": total, "distinct_estimate": approximate, "columns": out}


def _shape(kind: str, total: int, present: int, unique: int) -> str:
    if total >= 2 and present == total and unique == total and _can_be_key(kind):
        return "key"
    if present and _is_plain(kind) and (kind == "BOOLEAN" or unique <= CATEGORY_MAX):
        return "category"
    if present and _is_number(kind):
        return "number"
    if present and _is_date(kind):
        return "date"
    return "text"


def _fill(cursor: Any, table: str, item: dict[str, Any], present: int, length: Any) -> None:
    from golem.data.engine import json_value

    c = ident(item["name"])
    shape = item["shape"]
    if shape in ("number", "date"):
        item["bins"] = _bins(cursor, table, c, shape == "date")
    elif shape == "category":
        rows = _top(cursor, table, c, TOP_VALUES)
        item["top"] = [{"value": json_value(v), "count": int(n)} for v, n in rows]
        if item["distinct"] > TOP_VALUES:
            item["more_values"] = item["distinct"] - TOP_VALUES
            item["more_rows"] = max(0, present - sum(int(n) for _, n in rows))
    elif shape == "text" and present:
        item["unique_ratio"] = min(1.0, item["distinct"] / present)
        item["avg_length"] = None if length is None else float(length)
        if item["distinct"] < present and item["type"] == "VARCHAR":
            rows = _top(cursor, table, c, 1)
            if rows and int(rows[0][1]) > 1:
                item["most_common"] = {"value": json_value(rows[0][0]), "count": int(rows[0][1])}


def _top(cursor: Any, table: str, c: str, count: int) -> list[Any]:
    return cursor.execute(
        f"select {c}, count(*) from {table} where {c} is not null "
        f"group by 1 order by 2 desc, 1 limit {int(count)}"
    ).fetchall()


def _bins(cursor: Any, table: str, c: str, date: bool) -> list[int] | None:
    value = f"epoch(cast({c} as timestamp))" if date else f"cast({c} as double)"
    rows = cursor.execute(
        f"with s as (select {value} as v from {table} where {c} is not null), "
        "r as (select min(v) as lo, max(v) as hi from s where isfinite(v)) "
        f"select least({BINS - 1}, cast(floor(coalesce((v - lo) / nullif(hi - lo, 0), 0) * {BINS}) "
        "as integer)) as b, count(*) from s, r where isfinite(v) group by 1"
    ).fetchall()
    bins = [0] * BINS
    for index, count in rows:
        if index is not None:
            bins[max(0, min(BINS - 1, int(index)))] += int(count)
    return bins if any(bins) else None


def _exact_distinct(cursor: Any, table: str, name: str) -> int:
    row = cursor.execute(f"select count(distinct {ident(name)}) from {table}").fetchone()
    return int(row[0])


def _first_line(exc: Exception) -> str:
    from golem.data.engine import redact

    text = redact(str(exc).strip())
    return text.splitlines()[0] if text else type(exc).__name__
