"""One page of a table, sorted and filtered, for a person looking at their own data.

The SQL is built here from pieces golem checks: every column name must be one of the table's
columns and is quoted, a filter's operator must be one of :data:`OPS`, and every value is
bound, never written into the text. The browser sends no SQL. Runs inside the worker.
"""

from __future__ import annotations

import time
from typing import Any

import duckdb

from golem.data.profile import ident
from golem.data.types import DataError

OPS = ("=", "is null")
"""What a filter can ask."""
MAX_LIMIT = 500
MAX_FILTERS = 20


def _known(columns: list[tuple[str, str]], name: object) -> tuple[str, str]:
    for column in columns:
        if column[0] == name:
            return column
    shown = ", ".join(c[0] for c in columns) or "none"
    raise DataError(f"There is no column called {name} in this table. The columns are: {shown}.")


def where_of(
    columns: list[tuple[str, str]], filters: list[dict[str, Any]], search: str | None
) -> tuple[str, list[Any]]:
    """The ``where`` text of a view, and its bound values in order."""
    if len(filters) > MAX_FILTERS:
        raise DataError(f"A view takes at most {MAX_FILTERS} filters.")
    where: list[str] = []
    params: list[Any] = []
    for item in filters:
        name, kind = _known(columns, item.get("column"))
        op = item.get("op")
        if op not in OPS:
            raise DataError(f"A filter can ask {' or '.join(OPS)}, not {op!r}.")
        if op == "is null":
            where.append(f"{ident(name)} is null")
            continue
        value = item.get("value")
        if value is None:
            raise DataError(f"A filter on {name} needs a value. Use is null to find empty ones.")
        where.append(f"{ident(name)} = ?")
        params.append(str(value) if kind == "VARCHAR" else value)
    needle = (search or "").strip()
    if needle:
        text = [name for name, kind in columns if kind == "VARCHAR"]
        if text:
            tests = " or ".join(f"contains(lower({ident(n)}), lower(?))" for n in text)
            where.append(f"({tests})")
            params.extend([needle] * len(text))
        else:
            where.append("false")
    return (f" where {' and '.join(where)}" if where else ""), params


def order_of(columns: list[tuple[str, str]], sort: dict[str, Any] | None, *, fixed: bool) -> str:
    """The ``order by`` text. Every column breaks a tie, so pages never overlap or skip a row.

    ``fixed`` gives a view with no sort an order too (a database keeps none of its own).
    """
    if sort is not None:
        name, _ = _known(columns, sort.get("column"))
        first = f"{ident(name)} {'desc' if sort.get('desc') else 'asc'} nulls last"
        rest = [f"{ident(n)} asc nulls last" for n, _ in columns if n != name]
        return " order by " + ", ".join([first, *rest])
    if fixed:
        return " order by " + ", ".join(f"{ident(n)} asc nulls last" for n, _ in columns)
    return ""


def browse(
    cursor: Any,
    table: str,
    columns: list[tuple[str, str]],
    *,
    offset: int,
    limit: int,
    sort: dict[str, Any] | None,
    filters: list[dict[str, Any]],
    search: str | None,
    count: bool,
    fixed_order: bool,
) -> dict[str, Any]:
    """The rows ``offset`` on of the view, and how many rows the view has when ``count``."""
    from golem.data.engine import json_value, message

    if offset < 0:
        raise DataError("The first row of a page is at least 0.")
    if not 1 <= limit <= MAX_LIMIT:
        raise DataError(f"A page has 1 to {MAX_LIMIT} rows.")
    if not columns:
        raise DataError("The table has no columns.")
    clause, params = where_of(columns, filters, search)
    order = order_of(columns, sort, fixed=fixed_order)
    select = ", ".join(ident(n) for n, _ in columns)
    started = time.monotonic()
    try:
        rows = cursor.execute(
            f"select {select} from {table}{clause}{order} limit {int(limit)} offset {int(offset)}",
            params,
        ).fetchall()
        total = None
        if count:
            total = int(
                cursor.execute(f"select count(*) from {table}{clause}", params).fetchone()[0]
            )
    except duckdb.InterruptException as exc:
        raise DataError("The query was cancelled.") from exc
    except duckdb.Error as exc:
        raise DataError(message(exc)) from exc
    return {
        "columns": [{"name": n, "type": t} for n, t in columns],
        "rows": [[json_value(v) for v in row] for row in rows],
        "total_rows": total,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }
