"""The data sources a session folder sees, and the worker that opens them.

A source comes from ``[data.<name>]`` in the user's ``config.toml``, from a trusted project's
``.golem/config.toml`` (which replaces the user's source of the same name in that folder), and
from the built-in ``golem`` source. A source is opened in the worker on first use. Its tables
and their descriptions are kept for :data:`CACHE_SECONDS`. The password of a source never
leaves this file: what goes to a client or a model is a :class:`SourceInfo`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any, Literal

from golem.config import DataSourceSettings, load_data_sources
from golem.data import builtin
from golem.data.client import DataWorker
from golem.data.types import DataError, SourceSpec
from golem.paths import GolemPaths

log = logging.getLogger(__name__)

CACHE_SECONDS = 60.0
"""How long a source's tables and descriptions are kept."""
MAX_DESCRIBED = 30
"""The most tables one ``describe`` of a whole source reads the columns of."""
SAMPLE_ROWS = 5

Kind = Literal["builtin", "files", "sqlite", "duckdb", "postgres", "mysql", "url"]
Scope = Literal["builtin", "user", "project"]
Status = Literal["ready", "reading", "untrusted", "error"]
Privacy = Literal["open", "local", "schema"]
_ENGINE_KINDS = ("files", "sqlite", "duckdb")


@dataclass(frozen=True, slots=True)
class ColumnInfo:
    name: str
    type: str
    min: str | None = None
    max: str | None = None
    distinct: int | None = None
    null_fraction: float | None = None


@dataclass(frozen=True, slots=True)
class TableInfo:
    name: str
    rows: int | None = None
    columns: tuple[ColumnInfo, ...] = ()


@dataclass(frozen=True, slots=True)
class SourceInfo:
    """One source as a client or a model sees it. ``tables`` is None until it was opened."""

    name: str
    kind: Kind
    scope: Scope
    location: str
    privacy: Privacy
    status: Status
    project: str | None = None
    error: str | None = None
    watch: bool = False
    tables: tuple[TableInfo, ...] | None = None
    description: str | None = None

    @property
    def rows(self) -> int | None:
        if self.tables is None or any(table.rows is None for table in self.tables):
            return None
        return sum(table.rows or 0 for table in self.tables)


@dataclass(frozen=True, slots=True)
class Description:
    """A source with the columns of its tables, its notes, and (when asked) sample rows."""

    source: SourceInfo
    tables: tuple[TableInfo, ...]
    notes: str | None = None
    sample: dict[str, list[list[Any]]] = field(default_factory=dict[str, list[list[Any]]])


@dataclass(frozen=True, slots=True)
class QueryResult:
    result_id: str
    source: str
    columns: list[dict[str, str]]
    rows: list[list[Any]]
    truncated: bool
    elapsed_ms: int


@dataclass(frozen=True, slots=True)
class _Entry:
    """One source a folder sees, before it is opened."""

    name: str
    scope: Scope
    settings: DataSourceSettings | None
    project: Path | None = None

    @property
    def key(self) -> str:
        """The name the worker knows it by: a project's source may share a user's name."""
        return self.name if self.project is None else f"{self.name}@{self.project}"

    @property
    def kind(self) -> Kind:
        return "builtin" if self.settings is None else self.settings.resolved_kind

    @property
    def location(self) -> str:
        if self.settings is None:
            return "golem.db"
        place = self.settings.location
        if self.project is not None and self.settings.path is not None:
            expanded = Path(place).expanduser()
            if not expanded.is_absolute():
                return str(self.project / expanded)
        return place


@dataclass
class _Open:
    signature: tuple[str, str]
    at: float
    tables: tuple[TableInfo, ...] = ()
    error: str | None = None
    described: dict[str, tuple[float, TableInfo]] = field(
        default_factory=dict[str, tuple[float, TableInfo]]
    )


class DataSources:
    """Resolves and opens the sources of a folder. One per daemon."""

    def __init__(
        self,
        worker: DataWorker,
        paths: GolemPaths,
        *,
        trusted: Callable[[Path], bool] = lambda _root: False,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._worker = worker
        self._paths = paths
        self._trusted = trusted
        self._clock = clock
        self._open: dict[str, _Open] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._loaded_at = 0.0
        self._warming: set[asyncio.Task[None]] = set()

    @property
    def worker(self) -> DataWorker:
        return self._worker

    def access(self, root: Path | None) -> DataAccess:
        """The sources of ``root``, for a tool of that session."""
        return DataAccess(self, root)

    async def close(self) -> None:
        for task in list(self._warming):
            task.cancel()
        await self._worker.close()

    # -- what a folder sees -------------------------------------------------------------------

    def _entries(self, root: Path | None) -> list[_Entry]:
        """The sources of ``root``: the built-in one, the user's, then the project's."""
        found: dict[str, _Entry] = {builtin.NAME: _Entry(builtin.NAME, "builtin", None)}
        for name, settings in self._load(self._paths.config_file).items():
            found[name] = _Entry(name, "user", settings)
        if root is not None:
            folder = root.expanduser().resolve()
            for name, settings in self._load(folder / ".golem" / "config.toml").items():
                found[name] = _Entry(name, "project", settings, folder)
        return [found[name] for name in sorted(found, key=lambda n: (n != builtin.NAME, n))]

    def _load(self, path: Path) -> dict[str, DataSourceSettings]:
        try:
            return load_data_sources(path)
        except (OSError, ValueError) as exc:
            log.warning("%s has invalid data sources: %s", path, exc)
            return {}

    def _untrusted(self, entry: _Entry) -> bool:
        return entry.project is not None and not self._trusted(entry.project)

    def _info(self, entry: _Entry) -> SourceInfo:
        """The source as the cache knows it. No I/O."""
        opened = self._open.get(entry.key)
        settings = entry.settings
        base = SourceInfo(
            name=entry.name,
            kind=entry.kind,
            scope=entry.scope,
            location=entry.location,
            privacy="open" if settings is None else settings.privacy,
            status="ready",
            project=None if entry.project is None else str(entry.project),
            watch=False if settings is None else settings.watch,
            description=builtin.DESCRIPTION if settings is None else None,
        )
        if self._untrusted(entry):
            return replace(
                base,
                status="untrusted",
                error="This project is not trusted, so its source is not opened.",
            )
        if opened is None:
            return base
        if opened.error is not None:
            return replace(base, status="error", error=opened.error)
        return replace(base, tables=self._visible(entry, opened.tables))

    def _visible(self, entry: _Entry, tables: tuple[TableInfo, ...]) -> tuple[TableInfo, ...]:
        if entry.settings is None:
            return tables
        include, exclude = entry.settings.tables.include, entry.settings.tables.exclude
        return tuple(
            table
            for table in tables
            if (not include or any(fnmatchcase(table.name, p) for p in include))
            and not any(fnmatchcase(table.name, p) for p in exclude)
        )

    def snapshot(self, root: Path | None) -> list[SourceInfo]:
        """The sources of ``root`` with what is cached. No I/O beyond the config files."""
        return [self._info(entry) for entry in self._entries(root)]

    def warm(self, root: Path | None) -> None:
        """Open the folder's sources in the background, so the next ``snapshot`` has counts."""
        entries = [
            entry
            for entry in self._entries(root)
            if entry.settings is not None
            and not self._untrusted(entry)
            and entry.key not in self._open
        ]
        if not entries:
            return
        try:
            task = asyncio.get_running_loop().create_task(self._warm(entries))
        except RuntimeError:
            return
        self._warming.add(task)
        task.add_done_callback(self._warming.discard)

    async def _warm(self, entries: list[_Entry]) -> None:
        for entry in entries:
            with contextlib.suppress(DataError):
                await self._ensure(entry)

    # -- opening ------------------------------------------------------------------------------

    def _entry(self, root: Path | None, name: str) -> _Entry:
        for entry in self._entries(root):
            if entry.name == name:
                return entry
        known = ", ".join(entry.name for entry in self._entries(root))
        raise DataError(f"There is no source called {name}. The sources are: {known}.")

    async def _ensure(self, entry: _Entry) -> _Open:
        """Open ``entry`` in the worker when it is not open, and read its tables."""
        if self._untrusted(entry):
            raise DataError(
                f"The source {entry.name} comes from a project that is not trusted, "
                "so it is not opened."
            )
        lock = self._locks.setdefault(entry.key, asyncio.Lock())
        async with lock:
            signature = (entry.kind, entry.location)
            opened = self._open.get(entry.key)
            now = self._clock()
            fresh = opened is not None and now - opened.at < CACHE_SECONDS
            if opened is not None and opened.signature == signature and fresh:
                if opened.error is not None:
                    raise DataError(opened.error)
                if entry.settings is None:
                    await self._load_builtin(entry, opened)
                return opened
            opened = _Open(signature, now)
            try:
                opened.tables = await self._attach(entry)
            except DataError as exc:
                opened.error = str(exc)
                self._open[entry.key] = opened
                raise
            self._open[entry.key] = opened
            return opened

    async def _attach(self, entry: _Entry) -> tuple[TableInfo, ...]:
        if entry.kind == "builtin":
            spec = SourceSpec(entry.key, "builtin", str(self._paths.database_file))
            await self._worker.attach(spec)
            self._loaded_at = 0.0
            await self._load_tables()
            return await self._count(entry.key, [table.name for table in builtin.TABLES])
        if entry.kind not in _ENGINE_KINDS:
            raise DataError(f"golem cannot open {entry.kind} sources yet.")
        spec = SourceSpec(entry.key, entry.kind, entry.location)  # type: ignore[arg-type]
        listed = await self._worker.attach(spec)
        return await self._count(entry.key, [item["name"] for item in listed])

    async def _count(self, key: str, names: list[str]) -> tuple[TableInfo, ...]:
        found: list[TableInfo] = []
        for name in names:
            try:
                answer = await self._worker.query(key, f"select count(*) from {_quote(name)}", 1)
                rows: int | None = int(answer["rows"][0][0])
            except (DataError, IndexError, TypeError, ValueError):
                rows = None
            found.append(TableInfo(name, rows))
        return tuple(found)

    async def _load_builtin(self, entry: _Entry, opened: _Open) -> None:
        """Reload the built-in tables when they are older than :data:`builtin.REFRESH_SECONDS`."""
        if self._clock() - self._loaded_at < builtin.REFRESH_SECONDS:
            return
        await self._load_tables()
        opened.tables = await self._count(entry.key, [table.name for table in builtin.TABLES])

    async def _load_tables(self) -> None:
        database = self._paths.database_file
        for table in builtin.TABLES:
            rows = (
                await asyncio.to_thread(builtin.read_table, database, table)
                if database.is_file()
                else []
            )
            columns = [{"name": n, "type": t} for n, t in table.columns]
            await self._worker.load_table(builtin.NAME, table.name, columns, rows)
        self._loaded_at = self._clock()

    # -- what a caller asks for ---------------------------------------------------------------

    async def list(self, root: Path | None) -> list[SourceInfo]:
        """Every source of ``root``, each opened once. A source that cannot open has an error."""
        infos: list[SourceInfo] = []
        for entry in self._entries(root):
            if not self._untrusted(entry):
                with contextlib.suppress(DataError):
                    await self._ensure(entry)
            infos.append(self._info(entry))
        return infos

    async def describe(
        self, root: Path | None, name: str, table: str | None = None, *, sample: int = 0
    ) -> Description:
        """A source and the columns of its tables (of ``table`` only, when it is given).

        With ``sample``, up to that many rows of each described table go along. Raises
        :class:`DataError`.
        """
        entry = self._entry(root, name)
        opened = await self._ensure(entry)
        visible = self._visible(entry, opened.tables)
        names = [item.name for item in visible]
        if table is not None and table not in names:
            known = ", ".join(names) or "none"
            raise DataError(f"There is no table called {table} in {name}. The tables are: {known}.")
        wanted = [t for t in visible if t.name == table] if table else list(visible[:MAX_DESCRIBED])
        described = [await self._table(entry, opened, item) for item in wanted]
        rest = () if table else tuple(item for item in visible if item not in wanted)
        rows: dict[str, list[list[Any]]] = {}
        if sample > 0:
            for item in described:
                rows[item.name] = await self._sample(entry, item.name, sample)
        notes = builtin.NOTES if entry.settings is None else None
        return Description(self._info(entry), (*described, *rest), notes, rows)

    async def _table(self, entry: _Entry, opened: _Open, table: TableInfo) -> TableInfo:
        cached = opened.described.get(table.name)
        if cached is not None and self._clock() - cached[0] < CACHE_SECONDS:
            return cached[1]
        answer = await self._worker.describe(entry.key, table.name)
        info = TableInfo(
            table.name,
            int(answer["rows"]),
            tuple(
                ColumnInfo(
                    name=str(column["name"]),
                    type=str(column["type"]),
                    min=_text(column.get("min")),
                    max=_text(column.get("max")),
                    distinct=_whole(column.get("distinct")),
                    null_fraction=_fraction(column.get("null_percent")),
                )
                for column in answer["columns"]
            ),
        )
        opened.described[table.name] = (self._clock(), info)
        return info

    async def _sample(self, entry: _Entry, table: str, count: int) -> list[list[Any]]:
        answer = await self._worker.query(entry.key, f"select * from {_quote(table)}", count)
        return answer["rows"]

    async def query(
        self,
        root: Path | None,
        name: str,
        sql: str,
        limit: int | None = None,
        result_id: str | None = None,
    ) -> QueryResult:
        """Run ``sql`` on one source. Raises :class:`DataError` with a sentence."""
        entry = self._entry(root, name)
        await self._ensure(entry)
        ident = result_id or f"res_{uuid.uuid4().hex[:12]}"
        answer = await self._worker.query(entry.key, sql, limit, result_id=ident)
        return QueryResult(
            result_id=ident,
            source=name,
            columns=answer["columns"],
            rows=answer["rows"],
            truncated=bool(answer["truncated"]),
            elapsed_ms=int(answer["elapsed_ms"]),
        )

    async def cancel(self, result_id: str) -> bool:
        """Stop the query running with ``result_id``. False when there is none."""
        return await self._worker.cancel(result_id)


class DataAccess:
    """The sources of one session folder: what a tool reaches through its context."""

    def __init__(self, sources: DataSources, root: Path | None) -> None:
        self._sources = sources
        self._root = root

    async def list(self) -> list[SourceInfo]:
        return await self._sources.list(self._root)

    async def describe(
        self, name: str, table: str | None = None, *, sample: int = 0
    ) -> Description:
        return await self._sources.describe(self._root, name, table, sample=sample)

    async def query(self, name: str, sql: str, limit: int | None = None) -> QueryResult:
        return await self._sources.query(self._root, name, sql, limit)

    def source(self, name: str) -> SourceInfo:
        """The source called ``name``, without opening it. Raises :class:`DataError`."""
        for info in self._sources.snapshot(self._root):
            if info.name == name:
                return info
        known = ", ".join(info.name for info in self._sources.snapshot(self._root))
        raise DataError(f"There is no source called {name}. The sources are: {known}.")

    async def columns(self, name: str) -> dict[str, list[str]]:
        """The tables of a source and their column names, for an error that names them."""
        description = await self._sources.describe(self._root, name)
        return {t.name: [c.name for c in t.columns] for t in description.tables if t.columns}


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _text(value: object) -> str | None:
    return None if value is None else str(value)


def _whole(value: object) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _fraction(value: object) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return min(max(float(value) / 100, 0.0), 1.0)
    return None


__all__ = [
    "CACHE_SECONDS",
    "ColumnInfo",
    "DataAccess",
    "DataSources",
    "Description",
    "QueryResult",
    "SourceInfo",
    "TableInfo",
]
