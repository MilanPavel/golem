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
import re
import tempfile
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any, Literal

from golem.config import DATA_RESERVED, DataSourceSettings, load_data_sources
from golem.data import builtin
from golem.data.client import DataWorker
from golem.data.database import (
    WRITE_WARNING,
    DatabaseTarget,
    build_url,
    parse_url,
    read_only_howto,
)
from golem.data.notes import MAX_BYTES, Notes, notes_file, read_notes
from golem.data.privacy import guess_privacy
from golem.data.results import ResultStore
from golem.data.types import DATABASE_KINDS, DataError, NeedsExtension, SourceSpec
from golem.paths import GolemPaths
from golem.secrets import SecretMissingError, SecretStore, SecretStoreError, resolve

log = logging.getLogger(__name__)

CACHE_SECONDS = 60.0
"""How long a source's tables and descriptions are kept."""
MAX_DESCRIBED = 30
"""The most tables one ``describe`` of a whole source reads the columns of."""
SAMPLE_ROWS = 5
INSPECT_ROWS = 20
"""Sample rows of each table ``inspect`` returns."""
WATCH_SECONDS = 5.0
"""How often a watched source's files are looked at."""
_SYSTEM_FOLDERS = (
    "/etc", "/System", "/private", "/var", "/usr", "/bin", "/sbin", "/dev", "/proc", "/sys",
    "/boot", "/Library", "/Applications",
)  # fmt: skip
_NAME_CHARS = re.compile(r"[^A-Za-z0-9_]+")
_WILDCARD = re.compile(r"[*?\[]")
_NO_HEADER = re.compile(r"^column\d+$")

Kind = Literal["builtin", "files", "sqlite", "duckdb", "postgres", "mysql", "url"]
Scope = Literal["builtin", "user", "project"]
Status = Literal["ready", "reading", "untrusted", "error"]
Privacy = Literal["open", "local", "schema"]
_ENGINE_KINDS = ("files", "sqlite", "duckdb", "postgres", "mysql")
DEFAULT_TIMEOUT = 15.0
"""Seconds a query may run on a database server, unless ``timeout_s`` says otherwise."""


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
    files: int | None = None
    dates: tuple[str, str] | None = None
    """The first and last month of a date column, such as ``2024-01``, for a ``files`` source."""
    needs_extension: str | None = None
    in_keychain: bool = False
    """True when the source names a password in the Keychain. The password itself is never here."""
    timeout_s: float | None = None
    """For a database: seconds a query may run on the server."""
    warning: str | None = None
    """For a database: a sentence when its login can change data."""

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
    notes_cut: bool = False
    """True when the notes file is longer than the model reads, so ``notes`` is its start."""
    sample: dict[str, list[list[Any]]] = field(default_factory=dict[str, list[list[Any]]])


@dataclass(frozen=True, slots=True)
class Inspection:
    """What a location holds, before it is a source."""

    kind: Kind
    tables: tuple[TableInfo, ...]
    sample: dict[str, list[list[Any]]]
    suggested_name: str
    suggested_privacy: Privacy
    privacy_reason: str | None
    files: int | None = None
    notes: tuple[str, ...] = ()
    needs_extension: str | None = None
    url: str | None = None
    """For a database: its address, with no password, as ``data.add`` takes it."""
    server_version: str | None = None
    warning: str | None = None
    """For a database: a sentence when the login can change data, with a way to make a safer one."""


@dataclass(frozen=True, slots=True)
class QueryResult:
    result_id: str
    source: str
    columns: list[dict[str, str]]
    rows: list[list[Any]]
    truncated: bool
    elapsed_ms: int
    stored: bool = False
    """True when the rows are kept in a file that :meth:`DataSources.page` reads."""
    sql: str = ""


@dataclass(frozen=True, slots=True)
class ResultPage:
    """Rows ``offset`` on of a kept result."""

    result_id: str
    source: str
    columns: list[dict[str, str]]
    rows: list[list[Any]]
    total_rows: int
    sql: str = ""


@dataclass(frozen=True, slots=True)
class ExportPlan:
    """A kept result and the new file it would be written to. Nothing is written yet."""

    result_id: str
    source: str
    sql: str
    rows: int
    path: Path
    format: str


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
    entry: _Entry
    tables: tuple[TableInfo, ...] = ()
    error: str | None = None
    needs: str | None = None
    warning: str | None = None
    files: int | None = None
    dates: tuple[str, str] | None = None
    stamp: tuple[tuple[str, int, int], ...] = ()
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
        watch_seconds: float = WATCH_SECONDS,
    ) -> None:
        self._worker = worker
        self._paths = paths
        self.results = ResultStore(paths.data_results_dir)
        self._trusted = trusted
        self._clock = clock
        self._open: dict[str, _Open] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._loaded_at = 0.0
        self._warming: set[asyncio.Task[None]] = set()
        self._watch_seconds = watch_seconds
        self._watcher: asyncio.Task[None] | None = None
        self.secrets: SecretStore | None = None
        """Where a database source's password is read from. Set by the daemon."""
        self.changed: Callable[[str, str], None] = lambda _name, _reason: None
        """Called with a source's name and a reason (``files``) when its files changed."""

    @property
    def config_file(self) -> Path:
        """The user's ``config.toml``, where a user's source is written."""
        return self._paths.config_file

    @property
    def worker(self) -> DataWorker:
        return self._worker

    def access(self, root: Path | None) -> DataAccess:
        """The sources of ``root``, for a tool of that session."""
        return DataAccess(self, root)

    async def close(self) -> None:
        await self.results.aclose()
        for task in [*self._warming, *([self._watcher] if self._watcher else [])]:
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
            in_keychain=settings is not None and settings.password is not None,
            timeout_s=None
            if settings is None or entry.kind not in DATABASE_KINDS
            else settings.timeout_s or DEFAULT_TIMEOUT,
        )
        if opened is not None and opened.needs is not None:
            base = replace(base, needs_extension=opened.needs)
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
        return replace(
            base,
            tables=self._visible(entry, opened.tables),
            files=opened.files,
            dates=opened.dates if base.privacy == "open" else None,
            warning=opened.warning,
        )

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
                if opened.needs is not None:
                    raise NeedsExtension(opened.needs)
                if opened.error is not None:
                    raise DataError(opened.error)
                if entry.settings is None:
                    await self._load_builtin(entry, opened)
                return opened
            opened = _Open(signature, now, entry)
            try:
                opened.tables = await self._attach(entry, opened)
            except DataError as exc:
                opened.error = str(exc)
                if isinstance(exc, NeedsExtension):
                    opened.needs = exc.extension
                self._open[entry.key] = opened
                raise
            self._open[entry.key] = opened
            if entry.settings is not None and entry.settings.watch:
                self._start_watching()
            return opened

    async def _attach(self, entry: _Entry, opened: _Open) -> tuple[TableInfo, ...]:
        if entry.kind == "builtin":
            spec = SourceSpec(entry.key, "builtin", str(self._paths.database_file))
            await self._worker.attach(spec)
            self._loaded_at = 0.0
            await self._load_tables()
            return await self._count(entry.key, [table.name for table in builtin.TABLES])
        if entry.kind not in _ENGINE_KINDS:
            raise DataError(f"golem cannot open {entry.kind} sources yet.")
        if entry.kind in DATABASE_KINDS:
            return await self._attach_database(entry, opened)
        spec = SourceSpec(entry.key, entry.kind, entry.location)  # type: ignore[arg-type]
        await self._need_extension(spec)
        listed = await self._worker.attach(spec)
        tables = await self._count(entry.key, [item["name"] for item in listed])
        opened.stamp = await asyncio.to_thread(_stamp, spec)
        if entry.kind == "files":
            opened.files = len(opened.stamp)
            opened.dates = await self._dates(entry, opened, tables)
        return tables

    async def _password(self, entry: _Entry) -> str | None:
        """The password of a database source, read from the Keychain. It goes nowhere else."""
        ref = None if entry.settings is None else entry.settings.password
        if ref is None:
            return None
        if self.secrets is None:
            raise DataError(f"golem has no place to read the password of {entry.name} from.")
        try:
            return await asyncio.to_thread(resolve, ref, self.secrets)
        except SecretMissingError:
            raise DataError(
                f"The password of {entry.name} is not in the Keychain. "
                "Open the source's settings and enter it again."
            ) from None
        except SecretStoreError as exc:
            raise DataError(f"The Keychain could not be read for {entry.name}: {exc}") from None

    async def _attach_database(self, entry: _Entry, opened: _Open) -> tuple[TableInfo, ...]:
        """Connect to a server. Its tables are listed with the catalog's row estimates."""
        settings = entry.settings
        assert settings is not None
        spec = SourceSpec(
            entry.key,
            entry.kind,  # type: ignore[arg-type]
            entry.location,
            await self._password(entry),
            settings.timeout_s or DEFAULT_TIMEOUT,
        )
        await self._need_extension(spec)
        listed = await self._worker.attach(spec)
        info = self._worker.server_info(entry.key)
        if info.get("can_write"):
            opened.warning = _write_warning(parse_url(entry.location))
        return tuple(TableInfo(item["name"], item.get("rows")) for item in listed)

    async def _need_extension(self, spec: SourceSpec) -> None:
        """Raise :class:`NeedsExtension` when ``spec`` needs one that is not installed yet."""
        from golem.data.engine import extension_installed, needed_extension

        need = await asyncio.to_thread(needed_extension, spec)
        if need is not None and not extension_installed(self._paths.data_extensions_dir, need):
            raise NeedsExtension(need)

    async def _dates(
        self, entry: _Entry, opened: _Open, tables: tuple[TableInfo, ...]
    ) -> tuple[str, str] | None:
        """The first and last month of the first date column of the first few tables."""
        for table in tables[:3]:
            try:
                described = await self._table(entry, opened, table)
            except DataError:
                continue
            for column in described.columns:
                kind = column.type.upper()
                if (kind == "DATE" or kind.startswith("TIMESTAMP")) and column.min and column.max:
                    return column.min[:7], column.max[:7]
        return None

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

    # -- watching -----------------------------------------------------------------------------

    def _start_watching(self) -> None:
        if self._watcher is not None and not self._watcher.done():
            return
        try:
            self._watcher = asyncio.get_running_loop().create_task(self._watch())
        except RuntimeError:
            return

    async def _watch(self) -> None:
        """Look at the files of every open source that is watched, and reopen it on a change."""
        while True:
            await asyncio.sleep(self._watch_seconds)
            for key, opened in list(self._open.items()):
                try:
                    await self._check(key, opened)
                except Exception:
                    log.exception("could not look at the files of %s", opened.entry.name)

    async def _check(self, key: str, opened: _Open) -> None:
        entry = opened.entry
        current = next((e for e in self._entries(entry.project) if e.name == entry.name), None)
        if current is None or current.settings is None or not current.settings.watch:
            return
        if (
            opened.error is not None
            or self._untrusted(current)
            or self._open.get(key) is not opened
        ):
            return
        spec = SourceSpec(current.key, current.kind, current.location)  # type: ignore[arg-type]
        if await asyncio.to_thread(_stamp, spec) == opened.stamp:
            return
        self._open.pop(key, None)
        with contextlib.suppress(DataError):
            await self._ensure(current)
        self.changed(current.name, "files")

    async def forget(self, name: str) -> None:
        """Close the source called ``name`` everywhere, so the next use opens it again."""
        for key in [k for k in self._open if k == name or k.startswith(f"{name}@")]:
            self._open.pop(key, None)
            with contextlib.suppress(DataError):
                await self._worker.detach(key)

    async def install_extension(self, name: str) -> None:
        """Download extension ``name`` once. Only a person's request calls this, never a model."""
        await self._worker.ensure_extension(name)
        for key, opened in list(self._open.items()):
            if opened.needs == name:
                del self._open[key]

    # -- what a caller asks for ---------------------------------------------------------------

    def taken_names(self, root: Path | None) -> set[str]:
        """The names of the sources ``root`` sees."""
        return {entry.name for entry in self._entries(root)}

    async def inspect(self, location: str, root: Path | None = None) -> Inspection:
        """Open ``location`` read-only in a source of its own, look at it, and close it.

        Raises :class:`DataError` with a sentence for a path that is missing, empty or a system
        folder.
        """
        from golem.data.engine import (
            extension_installed,
            location_kind,
            matched_files,
            needed_extension,
        )

        place = Path(location).expanduser()
        _check_place(place, location)
        kind = await asyncio.to_thread(location_kind, str(place))
        name = self.suggest_name(place, root)
        spec = SourceSpec(f"inspect_{uuid.uuid4().hex[:8]}", kind, str(place))  # type: ignore[arg-type]
        files: int | None = None
        notes: list[str] = []
        if kind == "files":
            found = await asyncio.to_thread(matched_files, str(place))
            if not found:
                raise DataError(
                    f"No CSV, TSV, Parquet, JSON or Excel files in {location}. "
                    "golem reads .csv, .tsv, .parquet, .json, .jsonl, .ndjson and .xlsx."
                )
            files = len(found)
            if place.is_dir() or _WILDCARD.search(location):
                notes += await asyncio.to_thread(_skipped, place, {p for p, _ in found})
        need = await asyncio.to_thread(needed_extension, spec)
        if need is not None and not extension_installed(self._paths.data_extensions_dir, need):
            privacy, reason = guess_privacy(location, [])
            return Inspection(
                kind,  # type: ignore[arg-type]
                (),
                {},
                name,
                privacy,
                reason,
                files,
                (str(NeedsExtension(need)),),
                need,
            )
        described: list[TableInfo] = []
        sample: dict[str, list[list[Any]]] = {}
        try:
            listed = await self._worker.attach(spec)
            for item in listed[:MAX_DESCRIBED]:
                answer = await self._worker.describe(spec.name, item["name"])
                described.append(_table_info(item["name"], answer))
                shown = await self._worker.query(
                    spec.name, f"select * from {_quote(item['name'])}", INSPECT_ROWS
                )
                sample[item["name"]] = shown["rows"]
        finally:
            with contextlib.suppress(DataError):
                await self._worker.detach(spec.name)
        if kind == "files" and len(described) > 1:
            names = ", ".join(t.name for t in described)
            notes.append(
                f"The files have {len(described)} different sets of columns, so they are "
                f"{len(described)} tables: {names}."
            )
        for table in described:
            own = [c.name for c in table.columns if c.name != "file"]
            if own and all(_NO_HEADER.match(name) for name in own):
                notes.append(
                    f"{table.name} has no header row, so its columns are named "
                    f"{', '.join(own[:3])}, and so on."
                )
        columns = [c.name for table in described for c in table.columns]
        privacy, reason = guess_privacy(location, columns)
        return Inspection(
            kind,  # type: ignore[arg-type]
            tuple(described),
            sample,
            name,
            privacy,
            reason,
            files,
            tuple(notes),
        )

    async def inspect_database(
        self, target: DatabaseTarget, password: str | None, root: Path | None = None
    ) -> Inspection:
        """Connect to a database read-only, look at it, and disconnect. Nothing is stored.

        The password is used for this one connection. Raises :class:`DataError`.
        """
        url = build_url(target)
        name = self.suggest_database_name(target.database, root)
        privacy, reason = (
            ("local", "This database runs on your Mac, so a local model may read it.")
            if target.is_local
            else ("schema", "This database is on another computer, so no model reads its rows.")
        )
        spec = SourceSpec(
            f"inspect_{uuid.uuid4().hex[:8]}",
            target.kind,  # type: ignore[arg-type]
            url,
            password or None,
        )
        need = await asyncio.to_thread(_needed, spec)
        if need is not None and not self._extension_ready(need):
            return Inspection(
                target.kind,  # type: ignore[arg-type]
                (),
                {},
                name,
                privacy,  # type: ignore[arg-type]
                reason,
                None,
                (str(NeedsExtension(need)),),
                need,
                url,
            )
        described: list[TableInfo] = []
        sample: dict[str, list[list[Any]]] = {}
        try:
            listed = await self._worker.attach(spec)
            info = self._worker.server_info(spec.name)
            for item in listed[:MAX_DESCRIBED]:
                answer = await self._worker.describe(spec.name, item["name"])
                described.append(_table_info(item["name"], answer))
                shown = await self._worker.query(
                    spec.name,
                    f"select * from {_quote(item['name'], server=True)} limit {INSPECT_ROWS}",
                    INSPECT_ROWS,
                )
                sample[item["name"]] = shown["rows"]
        finally:
            with contextlib.suppress(DataError):
                await self._worker.detach(spec.name)
        notes: list[str] = []
        if len(listed) > MAX_DESCRIBED:
            notes.append(f"{len(listed)} tables: the first {MAX_DESCRIBED} are described here.")
        return Inspection(
            target.kind,  # type: ignore[arg-type]
            tuple(described),
            sample,
            name,
            privacy,  # type: ignore[arg-type]
            reason,
            None,
            tuple(notes),
            None,
            url,
            info.get("version"),
            _write_warning(target) if info.get("can_write") else None,
        )

    def suggest_database_name(self, database: str, root: Path | None) -> str:
        """A source name from a database name: valid, not ``golem``, not taken."""
        base = _NAME_CHARS.sub("_", database).strip("_")[:28]
        if not base or not base[0].isalpha():
            base = f"db_{base}".strip("_")
        taken = self.taken_names(root) | DATA_RESERVED
        candidate, number = base, 1
        while candidate in taken:
            number += 1
            candidate = f"{base}_{number}"
        return candidate

    def _extension_ready(self, need: str) -> bool:
        from golem.data.engine import extension_installed

        return extension_installed(self._paths.data_extensions_dir, need)

    def suggest_name(self, place: Path, root: Path | None) -> str:
        """A source name from a file or folder name: valid, not ``golem``, not taken."""
        stem = place.name if place.is_dir() else place.stem
        match = _WILDCARD.search(stem)
        fixed = stem[: match.start()] if match else stem
        base = _NAME_CHARS.sub("_", fixed).strip("_")
        if not base or not base[0].isalpha():
            base = f"data_{base}".strip("_")
        base = base[:28]
        taken = self.taken_names(root) | DATA_RESERVED
        candidate, number = base, 1
        while candidate in taken:
            number += 1
            candidate = f"{base}_{number}"
        return candidate

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
        found = await asyncio.to_thread(self._notes, entry)
        notes = None if found is None else found.text
        cut = found is not None and found.cut
        return Description(self._info(entry), (*described, *rest), notes, cut, rows)

    def notes_path(self, root: Path | None, name: str) -> Path:
        """Where the notes of source ``name`` are kept, whether or not the file exists."""
        return self._notes_path(self._entry(root, name))

    def _notes_path(self, entry: _Entry) -> Path:
        return notes_file(self._paths.data_dir, entry.project, entry.name)

    def _notes(self, entry: _Entry, limit: int | None = MAX_BYTES) -> Notes | None:
        """The notes file of ``entry``, read fresh. The built-in source falls back to its own."""
        found = read_notes(self._notes_path(entry), limit)
        if found is None and entry.settings is None:
            return Notes(builtin.NOTES)
        return found

    async def read_notes(self, root: Path | None, name: str) -> Notes | None:
        """The whole notes text of source ``name``, for a person to edit. Raises DataError."""
        entry = self._entry(root, name)
        return await asyncio.to_thread(self._notes, entry, None)

    async def _table(self, entry: _Entry, opened: _Open, table: TableInfo) -> TableInfo:
        cached = opened.described.get(table.name)
        if cached is not None and self._clock() - cached[0] < CACHE_SECONDS:
            return cached[1]
        answer = await self._worker.describe(entry.key, table.name)
        info = _table_info(table.name, answer)
        opened.described[table.name] = (self._clock(), info)
        return info

    async def _sample(self, entry: _Entry, table: str, count: int) -> list[list[Any]]:
        server = entry.kind in DATABASE_KINDS
        bound = f" limit {count}" if server else ""
        answer = await self._worker.query(
            entry.key, f"select * from {_quote(table, server=server)}{bound}", count
        )
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
        store = self.results.path(ident)
        answer = await self._worker.query(entry.key, sql, limit, result_id=ident, store=store)
        return QueryResult(
            result_id=ident,
            source=name,
            columns=answer["columns"],
            rows=answer["rows"],
            truncated=bool(answer["truncated"]),
            elapsed_ms=int(answer["elapsed_ms"]),
            stored=bool(answer.get("stored", False)),
            sql=sql,
        )

    async def page(
        self,
        result_id: str,
        offset: int,
        limit: int,
        sort_column: str | None = None,
        sort_desc: bool = False,
    ) -> ResultPage:
        """Rows of a kept result, sorted when asked. Raises :class:`DataError`."""
        path = self.results.path(result_id)
        answer = await self._worker.result_page(path, offset, limit, sort_column, sort_desc)
        return ResultPage(
            result_id=result_id,
            source=str(answer.get("meta", {}).get("source", "")),
            columns=answer["columns"],
            rows=answer["rows"],
            total_rows=int(answer["total_rows"]),
            sql=str(answer.get("meta", {}).get("sql", "")),
        )

    def _locations(self, root: Path | None) -> list[str]:
        """The places the sources of ``root`` read, so an export never lands in one."""
        return [e.location for e in self._entries(root) if e.kind in _ENGINE_KINDS]

    async def plan_export(
        self, root: Path | None, result_id: str, raw_path: str, fmt: str | None = None
    ) -> ExportPlan:
        """Check an export and say what it would write. Raises :class:`DataError`.

        Raises :class:`NeedsExtension` for Excel when its add-on is not installed.
        """
        from golem.data.engine import extension_installed
        from golem.data.export import infer_format, target_path

        found = await self.page(result_id, 0, 1)
        target = await asyncio.to_thread(target_path, raw_path, root, self._locations(root))
        kind = fmt or infer_format(raw_path)
        if kind == "xlsx" and not extension_installed(self._paths.data_extensions_dir, "excel"):
            raise NeedsExtension("excel")
        return ExportPlan(result_id, found.source, found.sql, found.total_rows, target, kind)

    async def export(self, plan: ExportPlan) -> int:
        """Write the whole of the result of ``plan`` to its new file. Returns the row count."""
        return await self._worker.export(self.results.path(plan.result_id), plan.path, plan.format)

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

    async def plan_export(
        self, result_id: str, raw_path: str, fmt: str | None = None
    ) -> ExportPlan:
        return await self._sources.plan_export(self._root, result_id, raw_path, fmt)

    async def export(self, plan: ExportPlan) -> int:
        return await self._sources.export(plan)

    async def columns(self, name: str) -> dict[str, list[str]]:
        """The tables of a source and their column names, for an error that names them."""
        description = await self._sources.describe(self._root, name)
        return {t.name: [c.name for c in t.columns] for t in description.tables if t.columns}


def _stamp(spec: SourceSpec) -> tuple[tuple[str, int, int], ...]:
    from golem.data.engine import stamp

    return stamp(spec)


def _needed(spec: SourceSpec) -> str | None:
    from golem.data.engine import needed_extension

    return needed_extension(spec)


def _write_warning(target: DatabaseTarget) -> str:
    return f"{WRITE_WARNING} {read_only_howto(target.kind, target.database)}"


def _check_place(place: Path, shown: str) -> None:
    """Refuse a location that is missing, or a system folder outside the home folder."""
    base = place
    while _WILDCARD.search(str(base)) and base != base.parent:
        base = base.parent
    if not base.exists():
        raise DataError(f"There is nothing at {shown}.")
    real = base.resolve()
    allowed = [
        Path.home().resolve(),
        Path(tempfile.gettempdir()).resolve(),
        Path("/tmp").resolve(),
        Path("/var/tmp").resolve(),
    ]
    if any(real == p or p in real.parents for p in allowed):
        return
    for folder in _SYSTEM_FOLDERS:
        if real == Path(folder) or Path(folder) in real.parents:
            raise DataError(
                f"{shown} is a system folder. Pick a file or folder of your own, "
                "such as one in your home folder."
            )


def _skipped(place: Path, used: set[Path]) -> list[str]:
    """A note about files next to the matched ones that golem does not read."""
    folder = place if place.is_dir() else place.parent
    while _WILDCARD.search(str(folder)) and folder != folder.parent:
        folder = folder.parent
    resolved = {p.resolve() for p in used}
    try:
        names = [
            p
            for p in folder.iterdir()
            if p.is_file() and not p.name.startswith(".") and p.resolve() not in resolved
        ]
    except OSError:
        return []
    if not names or (not place.is_dir() and not _WILDCARD.search(str(place))):
        return []
    kinds = sorted({p.suffix.lower() or "no suffix" for p in names})
    many = "files were" if len(names) > 1 else "file was"
    return [f"{len(names)} {many} skipped ({', '.join(kinds)}): golem does not read them."]


def _table_info(name: str, answer: dict[str, Any]) -> TableInfo:
    return TableInfo(
        name,
        None if answer["rows"] is None else int(answer["rows"]),
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


def _quote(name: str, *, server: bool = False) -> str:
    """A table's name as SQL. A server's table is ``schema.table``, so it is two names."""
    parts = name.split(".", 1) if server else [name]
    return ".".join('"' + part.replace('"', '""') + '"' for part in parts)


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
    "ExportPlan",
    "Inspection",
    "QueryResult",
    "ResultPage",
    "SourceInfo",
    "TableInfo",
]
