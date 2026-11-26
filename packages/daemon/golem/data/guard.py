"""The statement check: a query is one statement, and it only reads.

DuckDB's own settings (see ``engine``) are the wall. This is the first fence: it turns
what would be a permission error into a sentence the model can act on.
"""

from __future__ import annotations

import json
import threading
from typing import Any

import duckdb

ONE_STATEMENT = "Only one statement per query."
ONLY_READS = "Only queries that read: SELECT, WITH, DESCRIBE, SUMMARIZE."
EMPTY = "The query is empty. Write a SELECT."

_lock = threading.Lock()
_connection: Any = None


def refusal(sql: str) -> str | None:
    """Why ``sql`` may not run, as a sentence, or ``None`` when it may."""
    try:
        statements = duckdb.extract_statements(sql)
    except duckdb.Error as exc:
        return f"The query does not parse: {_first_line(exc)}"
    if not statements:
        return EMPTY
    if len(statements) > 1:
        return ONE_STATEMENT
    try:
        answer: Any = json.loads(_serialize(sql))
    except (duckdb.Error, ValueError):
        return ONLY_READS
    if isinstance(answer, dict) and answer.get("error"):  # pyright: ignore[reportUnknownMemberType]
        return ONLY_READS
    return None


def _serialize(sql: str) -> str:
    global _connection
    with _lock:
        if _connection is None:
            _connection = duckdb.connect()
        cursor = _connection.cursor()
    try:
        row = cursor.execute("select json_serialize_sql(?)", [sql]).fetchone()
    finally:
        cursor.close()
    return str(row[0]) if row else ""


def _first_line(exc: Exception) -> str:
    text = str(exc).strip()
    return text.splitlines()[0] if text else "syntax error"
