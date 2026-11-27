"""The saved queries of a data source: ``queries.toml`` next to its ``DATA.md``.

A person saves a query from a chat result or the Queries tab. The file holds one ``[[query]]``
for each: ``name``, ``sql`` and an optional ``description``. A project's source keeps it in
``<project>/.golem/data/<name>/``, so it is committed with the project. What a run did (when,
how many rows, how long, the error) is machine state and lives apart, in
``<home>/data/queries-runs.json``, so a committed file does not change on every run.
Only queries that read can be saved: the SQL passes the guard that ``data_query`` uses.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
import threading
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import tomlkit

from golem.data import guard
from golem.data.types import DataError

QUERIES_FILE = "queries.toml"
RUNS_FILE = "queries-runs.json"
MAX_NAME = 80
SQL_SHOWN = 300
"""How much of a query's SQL the model reads in a description. A longer one is cut."""


@dataclass(frozen=True, slots=True)
class SavedQuery:
    """One saved query. The last run is machine state, read from the run log."""

    name: str
    sql: str
    description: str | None = None
    last_run_at: str | None = None
    last_rows: int | None = None
    last_ms: int | None = None
    last_error: str | None = None


def queries_file(data_dir: Path, project: Path | None, name: str) -> Path:
    """Where the queries of source ``name`` live: the project's folder, else the user's."""
    base = data_dir if project is None else project / ".golem" / "data"
    return base / name / QUERIES_FILE


def taken(name: str) -> str:
    return f'There is already a query called "{name}" in this source.'


def read_queries(path: Path) -> list[SavedQuery]:
    """The queries in ``path``. No file is no queries. Raises :class:`DataError` on bad TOML."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return []
    except OSError as exc:
        raise DataError(f"Could not read {path}: {exc}") from exc
    try:
        doc = tomllib.loads(raw.decode("utf-8"))
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        raise DataError(f"{path} is not valid TOML: {exc}") from exc
    found: list[SavedQuery] = []
    entries: Any = doc.get("query", [])
    for entry in cast("list[Any]", entries if isinstance(entries, list) else []):
        if not isinstance(entry, dict):
            continue
        fields = cast("dict[str, Any]", entry)
        name, sql = fields.get("name"), fields.get("sql")
        if not isinstance(name, str) or not isinstance(sql, str) or not name.strip():
            continue
        text = fields.get("description")
        found.append(
            SavedQuery(
                name.strip(), sql.strip(), text if isinstance(text, str) and text.strip() else None
            )
        )
    return found


def write_queries(path: Path, queries: list[SavedQuery]) -> None:
    """Save the queries so a reader sees the old file or the new one. None left deletes it."""
    if not queries:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        return
    doc = tomlkit.document()
    table_list: Any = tomlkit.aot()
    for query in queries:
        table = tomlkit.table()
        table.add("name", query.name)
        if query.description:
            table.add("description", query.description)
        table.add("sql", tomlkit.string(query.sql.strip() + "\n", multiline=True))
        table_list.append(table)
    doc.add("query", table_list)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(dir=path.parent, prefix=".queries-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as out:
            out.write(tomlkit.dumps(doc))  # pyright: ignore[reportUnknownMemberType]
        os.replace(name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(name)
        raise


def clean_name(name: str) -> str:
    text = name.strip()
    if not text or len(text) > MAX_NAME:
        raise DataError(f"A query's name is 1 to {MAX_NAME} characters.")
    return text


def with_saved(
    queries: list[SavedQuery],
    name: str,
    sql: str,
    description: str | None,
    *,
    replace: bool = False,
    previous_name: str | None = None,
) -> list[SavedQuery]:
    """``queries`` with ``name`` created, replaced, or renamed from ``previous_name``.

    Raises :class:`DataError`: for a name out of range, for SQL that writes (with the guard's own
    sentence), for a taken name without ``replace``, and for a ``previous_name`` that is gone.
    """
    name = clean_name(name)
    why = guard.refusal(sql)
    if why is not None:
        raise DataError(why)
    entry = SavedQuery(name, sql.strip(), (description or "").strip() or None)
    same = name.casefold()
    old = None if previous_name is None else previous_name.strip().casefold()
    out: list[SavedQuery] = []
    placed = False
    found_previous = old is None
    for query in queries:
        key = query.name.casefold()
        if old is not None and key == old:
            found_previous = True
            out.append(entry)
            placed = True
        elif key == same:
            if not replace:
                raise DataError(taken(query.name))
            if not placed and old is None:
                out.append(entry)
                placed = True
        else:
            out.append(query)
    if not found_previous:
        raise DataError(f'There is no query called "{previous_name}" to change.')
    if not placed:
        out.append(entry)
    return out


def without(queries: list[SavedQuery], name: str) -> list[SavedQuery]:
    """``queries`` minus ``name``. Raises :class:`DataError` when it is not there."""
    key = name.strip().casefold()
    kept = [q for q in queries if q.name.casefold() != key]
    if len(kept) == len(queries):
        raise DataError(f'There is no query called "{name}".')
    return kept


def find(queries: list[SavedQuery], name: str) -> SavedQuery:
    key = name.strip().casefold()
    for query in queries:
        if query.name.casefold() == key:
            return query
    known = ", ".join(q.name for q in queries) or "none"
    raise DataError(f'There is no saved query called "{name}". The saved queries are: {known}.')


class RunLog:
    """What the last run of each saved query did, kept in one small JSON file."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    @staticmethod
    def key(project: Path | None, source: str, name: str) -> str:
        return f"{'' if project is None else project}|{source}|{name.strip().casefold()}"

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            data: Any = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}  # pyright: ignore[reportUnknownVariableType]

    def _save(self, data: dict[str, dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        handle, name = tempfile.mkstemp(dir=self._path.parent, prefix=".runs-", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as out:
                json.dump(data, out)
            os.replace(name, self._path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(name)
            raise

    def last(self, key: str) -> dict[str, Any]:
        with self._lock:
            return self._load().get(key, {})

    def record(
        self, key: str, *, rows: int | None = None, ms: int | None = None, error: str | None = None
    ) -> None:
        """Note a run that just finished. Failing to write the note never fails the run."""
        entry: dict[str, Any] = {
            "at": datetime.now(UTC).isoformat(timespec="seconds"),
            "rows": rows,
            "ms": ms,
            "error": error,
        }
        with self._lock, contextlib.suppress(OSError):
            data = self._load()
            data[key] = entry
            self._save(data)

    def move(self, old: str, new: str) -> None:
        """Keep the last run of a query that was renamed."""
        if old == new:
            return
        with self._lock, contextlib.suppress(OSError):
            data = self._load()
            if old in data:
                data[new] = data.pop(old)
                self._save(data)

    def forget(self, key: str) -> None:
        with self._lock, contextlib.suppress(OSError):
            data = self._load()
            if data.pop(key, None) is not None:
                self._save(data)


def with_last_run(query: SavedQuery, last: dict[str, Any]) -> SavedQuery:
    """``query`` with the facts of its last run from the log."""
    if not last:
        return query
    rows, ms, error, at = last.get("rows"), last.get("ms"), last.get("error"), last.get("at")
    return SavedQuery(
        query.name,
        query.sql,
        query.description,
        at if isinstance(at, str) else None,
        rows if isinstance(rows, int) else None,
        ms if isinstance(ms, int) else None,
        error if isinstance(error, str) else None,
    )


def shown_sql(sql: str) -> str:
    """The SQL as the model reads it: spaces collapsed, cut at :data:`SQL_SHOWN` characters."""
    one = " ".join(sql.split())
    return one if len(one) <= SQL_SHOWN else one[: SQL_SHOWN - 1].rstrip() + " …"


__all__ = [
    "MAX_NAME",
    "QUERIES_FILE",
    "RUNS_FILE",
    "RunLog",
    "SavedQuery",
    "clean_name",
    "find",
    "queries_file",
    "read_queries",
    "shown_sql",
    "taken",
    "with_last_run",
    "with_saved",
    "without",
    "write_queries",
]
