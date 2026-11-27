"""The statement check: a query is one statement, and it only reads.

DuckDB's own settings (see ``engine``) are the wall. This is the first fence: it turns
what would be a permission error into a sentence the model can act on.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Any, cast

import duckdb

ONE_STATEMENT = "Only one statement per query."
ONLY_READS = "Only queries that read: SELECT, WITH, DESCRIBE, SUMMARIZE."
EMPTY = "The query is empty. Write a SELECT."
CONNECTION = (
    "A query cannot attach, detach, switch databases or change settings. "
    "Write a SELECT on the tables of this source."
)
SERVER_SQL = (
    "A query cannot send SQL to the database server itself ({name}). "
    "Write a SELECT on the tables of this source: golem runs it read-only."
)

_FIRST_WORD = re.compile(r"^(?:\s|--[^\n]*\n|/\*.*?\*/)*([A-Za-z_]+)", re.DOTALL)
_CONNECTION_WORDS = frozenset({"attach", "detach", "use", "set", "reset", "pragma"})
SERVER_FUNCTIONS = frozenset(
    {
        "postgres_query", "postgres_execute", "postgres_scan", "postgres_scan_pushdown",
        "postgres_attach", "postgres_configure_pool", "pg_clear_cache",
        "mysql_query", "mysql_execute", "mysql_scan", "mysql_attach", "mysql_clear_cache",
        "mysql_debug_execution_plan", "mysql_explain_federated",
        "sqlite_scan", "sqlite_attach",
    }
)  # fmt: skip
"""Functions of the database extensions that run raw SQL on a server or open a connection.

``postgres_execute`` writes. The others read, but a query would reach a database the user did
not name (``postgres_scan`` takes its own connection string, and DuckDB's lock does not stop it).
"""

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
    word = _FIRST_WORD.match(sql)
    if word is not None and word.group(1).lower() in _CONNECTION_WORDS:
        return CONNECTION
    try:
        answer: Any = json.loads(_serialize(sql))
    except (duckdb.Error, ValueError):
        return ONLY_READS
    if isinstance(answer, dict) and answer.get("error"):  # pyright: ignore[reportUnknownMemberType]
        return ONLY_READS
    named = _server_function(answer)
    if named is not None:
        return SERVER_SQL.format(name=named)
    return None


SERVER_PREFIXES = (
    "postgres_",
    "mysql_",
    "sqlite_",
    "read_postgres_",
    "read_mysql_",
    "read_sqlite_",
)


def is_server_function(name: str) -> bool:
    """Whether a function belongs to a database extension: by its prefix, or the listed extras."""
    lowered = name.lower()
    return lowered.startswith(SERVER_PREFIXES) or lowered in SERVER_FUNCTIONS


def _server_function(node: Any) -> str | None:
    """The first function in a serialized query that talks to a server directly."""
    if isinstance(node, dict):
        fields = cast("dict[str, Any]", node)
        name = fields.get("function_name")
        if isinstance(name, str) and is_server_function(name):
            return name.lower()
        children: list[Any] = list(fields.values())
    elif isinstance(node, list):
        children = list(cast("list[Any]", node))
    else:
        return None
    for child in children:
        found = _server_function(child)
        if found is not None:
            return found
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
