"""The built-in ``golem`` source: golem's own usage and runs, read from ``golem.db``.

The daemon reads a few curated tables of ``golem.db`` itself (``sqlite3``, read-only) and
loads them into the source's in-memory DuckDB database, so the source needs no DuckDB
extension. Only counts, names, times, status and cost go in: never a message, an event, a
tool's output or an error text.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from golem.data.types import DataError

NAME = "golem"
REFRESH_SECONDS = 60.0
"""A loaded table is reloaded when it is older than this."""
DESCRIPTION = "your own usage and runs"


@dataclass(frozen=True, slots=True)
class Curated:
    """One table of the source: its columns and the query that reads them from ``golem.db``."""

    name: str
    columns: tuple[tuple[str, str], ...]
    select: str


TABLES: tuple[Curated, ...] = (
    Curated(
        "usage",
        (
            ("day", "DATE"),
            ("started_at", "TIMESTAMP"),
            ("session_id", "VARCHAR"),
            ("provider", "VARCHAR"),
            ("model", "VARCHAR"),
            ("tier", "VARCHAR"),
            ("role", "VARCHAR"),
            ("input", "BIGINT"),
            ("output", "BIGINT"),
            ("cache_read", "BIGINT"),
            ("cache_write", "BIGINT"),
            ("cost_usd", "DOUBLE"),
            ("failed", "BOOLEAN"),
        ),
        "SELECT day, started_at, session_id, provider, model, tier, role, input, output, "
        "cache_read, cache_write, cost_usd, failed <> 0 FROM model_calls ORDER BY started_at",
    ),
    Curated(
        "sessions",
        (
            ("id", "VARCHAR"),
            ("title", "VARCHAR"),
            ("model", "VARCHAR"),
            ("route", "VARCHAR"),
            ("agent", "VARCHAR"),
            ("folder", "VARCHAR"),
            ("parent", "VARCHAR"),
            ("created_at", "TIMESTAMP"),
            ("updated_at", "TIMESTAMP"),
            ("closed_at", "TIMESTAMP"),
        ),
        "SELECT session_id, title, model_profile, route, agent, cwd, parent_session_id, "
        "created_at, updated_at, closed_at FROM sessions ORDER BY created_at",
    ),
    Curated(
        "runs",
        (
            ("id", "VARCHAR"),
            ("session_id", "VARCHAR"),
            ("status", "VARCHAR"),
            ("started_at", "TIMESTAMP"),
            ("ended_at", "TIMESTAMP"),
        ),
        "SELECT run_id, session_id, status, started_at, ended_at FROM runs ORDER BY started_at",
    ),
    Curated(
        "routine_runs",
        (
            ("id", "VARCHAR"),
            ("name", "VARCHAR"),
            ("status", "VARCHAR"),
            ("started", "TIMESTAMP"),
            ("ended", "TIMESTAMP"),
        ),
        "SELECT routine_run_id, routine, status, started_at, ended_at FROM routine_runs "
        "ORDER BY started_at",
    ),
    Curated(
        "workflow_runs",
        (
            ("id", "VARCHAR"),
            ("name", "VARCHAR"),
            ("status", "VARCHAR"),
            ("started", "TIMESTAMP"),
            ("ended", "TIMESTAMP"),
        ),
        "SELECT workflow_run_id, name, status, started_at, finished_at FROM workflow_runs "
        "ORDER BY started_at",
    ),
)

NOTES = """\
golem's own usage and runs, read from golem's database. No message text and no tool output.
Cost is in US dollars (cost_usd). It is 0 for a local model and empty when a price is unknown.
Times are UTC, and a day is a calendar day in UTC.
- usage: one row per model call. day, started_at, provider, model, tier (local or hosted),
  role (what the call was for), input and output tokens, cache_read and cache_write tokens,
  cost_usd, failed (the call did not finish).
- sessions: one row per chat. model is the model profile, route how it was routed, agent the
  helper type (empty for a chat), parent the chat that started a helper, folder where it ran.
- runs: one row per run of a chat. status says how it ended.
- routine_runs, workflow_runs: one row per run, with name, status, started and ended.
"""
"""What the built-in source's tables mean, as ``data_describe`` shows it."""


def read_table(database: Path, table: Curated) -> list[list[Any]]:
    """The rows of ``table`` from ``golem.db``, read-only. Raises :class:`DataError`."""
    try:
        connection = sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=5)
    except sqlite3.Error as exc:
        raise DataError(f"Cannot read golem's own data: {exc}") from exc
    try:
        kinds = [kind for _, kind in table.columns]
        return [_convert(list(row), kinds) for row in connection.execute(table.select)]
    except sqlite3.Error as exc:
        raise DataError(f"Cannot read golem's own data: {exc}") from exc
    finally:
        connection.close()


def _convert(row: list[Any], kinds: list[str]) -> list[Any]:
    return [_value(value, kind) for value, kind in zip(row, kinds, strict=True)]


def _value(value: Any, kind: str) -> Any:
    """A stored text time as UTC text DuckDB reads as a date or timestamp. Unreadable: empty."""
    if value is None or kind not in ("DATE", "TIMESTAMP"):
        return value
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    return moment.date().isoformat() if kind == "DATE" else moment.isoformat(sep=" ")


__all__ = ["DESCRIPTION", "NAME", "NOTES", "REFRESH_SECONDS", "TABLES", "Curated", "read_table"]
