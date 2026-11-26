"""One source, read-only, in DuckDB. Runs inside the worker process.

A source is an in-memory DuckDB database of its own. It is filled first (views over
files, or an attached database) and then closed in three steps, in this order:
``allowed_paths`` names only the source's own files (not the folder: DuckDB writes a
file's replacement next to it, and that is refused), ``enable_external_access`` turns off
everything else, and ``lock_configuration`` stops a query from turning either back on or
raising its own memory limit. Views and attached databases made before the lock keep
working. ``guard.refusal`` runs first on every query and gives the model a sentence
instead of a permission error.
"""

from __future__ import annotations

import datetime as dt
import decimal
import glob as globlib
import math
import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import duckdb

from golem.data import guard
from golem.data.types import EXTENSION_FILES, DataError, SourceSpec

_FILE_KINDS = {
    ".csv": "csv",
    ".tsv": "csv",
    ".parquet": "parquet",
    ".json": "json",
    ".jsonl": "json",
    ".ndjson": "json",
}
_READERS = {
    "csv": "read_csv({files}, filename=true)",
    "parquet": "read_parquet({files}, filename=true)",
    "json": "read_json({files}, filename=true)",
}
_WILDCARDS = re.compile(r"[*?\[]")
_NO_SQLITE = (
    "SQLite files need a one-time download of DuckDB's sqlite extension. "
    "golem could not reach extensions.duckdb.org."
)
_SIZE = re.compile(r"^\d+(\.\d+)?\s?(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Limits:
    """What one source's connection may use."""

    memory: str = "2GB"
    threads: int = 4
    extension_dir: Path | None = None
    temp_dir: Path | None = None


def extension_installed(directory: Path, name: str) -> bool:
    """Whether DuckDB's extension ``name`` is in golem's extension folder."""
    file = EXTENSION_FILES.get(name)
    if file is None or not directory.is_dir():
        return False
    return any(directory.glob(f"**/{file}.duckdb_extension"))


def install_extension(directory: Path, name: str) -> None:
    """Download extension ``name`` into ``directory``. The only place that uses the network."""
    if name not in EXTENSION_FILES:
        raise DataError(f"golem has no data extension called {name}.")
    directory.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect()
    try:
        connection.execute("set extension_directory = ?", [str(directory)])
        connection.execute(f"install {_ident(name)}")
    except duckdb.Error as exc:
        raise DataError(
            f"DuckDB's {name} extension needs a one-time download. "
            f"golem could not reach extensions.duckdb.org: {_message(exc)}"
        ) from exc
    finally:
        connection.close()


class Source:
    """An attached source: its connection, its tables, and its queries."""

    def __init__(self, spec: SourceSpec, limits: Limits) -> None:
        self.spec = spec
        self._attached = False
        if not _SIZE.match(limits.memory.strip()):
            raise DataError(f"worker_memory is a size such as 2GB, not {limits.memory!r}.")
        self._connection = duckdb.connect(":memory:")
        try:
            self._open(limits)
        except BaseException:
            self._connection.close()
            raise

    def close(self) -> None:
        self._connection.close()

    def cursor(self) -> Any:
        """A cursor of its own, which ``interrupt()`` stops without touching the others."""
        cursor = self._connection.cursor()
        if self._attached:
            cursor.execute("use src")
        return cursor

    def tables(self) -> list[dict[str, str]]:
        rows = self._connection.execute(
            "select table_name, table_type from information_schema.tables "
            "where table_catalog = current_database() and table_schema = current_schema() "
            "order by table_name"
        ).fetchall()
        return [
            {"name": str(name), "type": "view" if "VIEW" in str(kind) else "table"}
            for name, kind in rows
        ]

    def describe(self, table: str) -> dict[str, Any]:
        if table not in {t["name"] for t in self.tables()}:
            known = ", ".join(t["name"] for t in self.tables()) or "none"
            raise DataError(f"There is no table called {table}. The tables are: {known}.")
        cursor = self.cursor()
        try:
            rows = cursor.execute(f"summarize {_ident(table)}").fetchall()
            count = cursor.execute(f"select count(*) from {_ident(table)}").fetchone()
        finally:
            cursor.close()
        columns = [
            {
                "name": str(row[0]),
                "type": str(row[1]),
                "min": _json(row[2]),
                "max": _json(row[3]),
                "distinct": _json(row[4]),
                "null_percent": _json(row[-1]),
            }
            for row in rows
        ]
        return {"table": table, "rows": int(count[0]) if count else 0, "columns": columns}

    def query(self, sql: str, limit: int, cursor: Any | None = None) -> dict[str, Any]:
        reason = guard.refusal(sql)
        if reason is not None:
            raise DataError(reason)
        if limit < 1:
            raise DataError("The row limit is at least 1.")
        own = cursor is None
        run: Any = cursor if cursor is not None else self.cursor()
        started = time.monotonic()
        try:
            run.execute(sql)
            description: list[Any] = run.description or []
            rows: list[Any] = run.fetchmany(limit + 1)
        except duckdb.InterruptException as exc:
            raise DataError("The query was cancelled.") from exc
        except duckdb.Error as exc:
            raise DataError(_message(exc)) from exc
        finally:
            if own:
                run.close()
        truncated = len(rows) > limit
        return {
            "columns": [{"name": str(d[0]), "type": str(d[1])} for d in description],
            "rows": [[_json(value) for value in row] for row in rows[:limit]],
            "truncated": truncated,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }

    # -- opening ---------------------------------------------------------------------------

    def _open(self, limits: Limits) -> None:
        con = self._connection
        con.execute("set memory_limit = ?", [limits.memory.strip()])
        con.execute("set threads = ?", [limits.threads])
        con.execute("set autoinstall_known_extensions = false")
        con.execute("set autoload_known_extensions = true")
        if limits.extension_dir is not None:
            con.execute("set extension_directory = ?", [str(limits.extension_dir)])
        if limits.temp_dir is not None:
            limits.temp_dir.mkdir(parents=True, exist_ok=True)
            con.execute("set temp_directory = ?", [str(limits.temp_dir)])
        spec = self.spec
        allowed = self._files(spec) if spec.kind == "files" else self._database(spec, limits)
        con.execute("set allowed_paths = ?", [allowed])
        con.execute("set enable_external_access = false")
        con.execute("set lock_configuration = true")

    def _database(self, spec: SourceSpec, limits: Limits) -> list[str]:
        path = Path(spec.location).expanduser()
        if not path.is_file():
            raise DataError(f"There is no file at {path}.")
        real = path.resolve()
        if spec.kind == "sqlite":
            if limits.extension_dir is None or not extension_installed(
                limits.extension_dir, "sqlite"
            ):
                raise DataError(_NO_SQLITE)
            try:
                self._connection.execute("load sqlite_scanner")
            except duckdb.Error as exc:
                raise DataError(f"{_NO_SQLITE} ({_message(exc)})") from exc
            kind = "(type sqlite, read_only)"
        else:
            kind = "(read_only)"
        try:
            self._connection.execute(f"attach {_literal(str(real))} as src {kind}")
            self._connection.execute("use src")
            self._attached = True
        except duckdb.Error as exc:
            raise DataError(
                f"Cannot open {path} as a {spec.kind} database: {_message(exc)}"
            ) from exc
        return [str(real)]

    def _files(self, spec: SourceSpec) -> list[str]:
        base, pattern = _split(spec.location)
        if not base.is_dir():
            raise DataError(f"There is no folder at {base}.")
        real_base = base.resolve()
        found: list[Path] = []
        for name in sorted(globlib.glob(str(real_base / pattern), recursive=True)):
            path = Path(name)
            if path.suffix.lower() not in _FILE_KINDS or not path.is_file():
                continue
            if not _inside(path.resolve(), real_base):
                continue  # a link that leaves the folder is not part of the source
            found.append(path)
        if not found:
            raise DataError(
                f"No CSV, Parquet or JSON files match {spec.location}. "
                "A source reads .csv, .tsv, .parquet, .json, .jsonl and .ndjson."
            )
        groups: dict[tuple[str, tuple[str, ...]], list[Path]] = defaultdict(list)
        for path in found:
            kind = _FILE_KINDS[path.suffix.lower()]
            groups[(kind, self._columns(kind, path))].append(path)
        glob_name = _glob_name(pattern, real_base)
        taken: set[str] = set()
        for (kind, _), paths in groups.items():
            stem = glob_name if len(paths) > 1 else paths[0].stem
            name = _unique(_table_name(stem), taken)
            files = "[" + ", ".join(_literal(str(p)) for p in paths) + "]"
            reader = _READERS[kind].format(files=files)
            self._connection.execute(
                f"create view {_ident(name)} as "
                f"select filename as file, * exclude (filename) from {reader}"
            )
        return [str(path.resolve()) for path in found]

    def _columns(self, kind: str, path: Path) -> tuple[str, ...]:
        reader = _READERS[kind].format(files=_literal(str(path)))
        try:
            cursor = self._connection.execute(f"select * from {reader} limit 0")
        except duckdb.Error as exc:
            raise DataError(f"Cannot read {path.name}: {_message(exc)}") from exc
        return tuple(str(d[0]) for d in cursor.description)


# -- names and values --------------------------------------------------------------------


def _split(location: str) -> tuple[Path, str]:
    """The folder a location starts in, and the rest of it as a glob."""
    path = Path(location).expanduser()
    if not _WILDCARDS.search(location):
        if path.is_dir():
            return path, "*"
        return path.parent, path.name
    parts = path.parts
    index = next(i for i, part in enumerate(parts) if _WILDCARDS.search(part))
    return Path(*parts[:index]), str(Path(*parts[index:]))


def _glob_name(pattern: str, base: Path) -> str:
    """A table's name for a glob: the file pattern's fixed start, else the folder's name."""
    stem = Path(pattern).name.split(".")[0]
    fixed = _WILDCARDS.split(stem)[0].strip("_-. ")
    return fixed or base.name or "data"


def _table_name(text: str) -> str:
    name = re.sub(r"[^0-9a-z_]+", "_", text.lower()).strip("_") or "data"
    return f"t_{name}" if name[0].isdigit() else name


def _unique(name: str, taken: set[str]) -> str:
    candidate, count = name, 1
    while candidate in taken:
        count += 1
        candidate = f"{name}_{count}"
    taken.add(candidate)
    return candidate


def _inside(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _message(exc: Exception) -> str:
    text = str(exc).strip()
    return text.splitlines()[0] if text else type(exc).__name__


def _json(value: Any) -> Any:
    """A value DuckDB returned, as something JSON can carry."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, decimal.Decimal):
        if not value.is_finite():
            return str(value)
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dt.datetime | dt.date | dt.time):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(cast("bytes | bytearray | memoryview[int]", value)).hex()
    if isinstance(value, list | tuple):
        return [_json(item) for item in cast("list[Any]", value)]
    if isinstance(value, dict):
        return {str(key): _json(item) for key, item in cast("dict[Any, Any]", value).items()}
    return str(value)
