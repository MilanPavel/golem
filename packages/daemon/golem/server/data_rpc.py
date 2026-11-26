"""The ``data.*`` methods: list the data sources, look one up, query it, cancel a query.

These are you looking at your own data from a page, so a query may run on any source: a
source's privacy limits only what goes to a model. You see sample rows of every source except
a ``schema`` one. ``session_id`` picks the folder whose project sources count.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from golem.config import (
    DATA_RESERVED,
    DATA_SOURCE_NAME,
    DataSourceSettings,
    load_data_sources,
)
from golem.config_edit import (
    DataExistsError,
    DataTableError,
    add_data_source,
    remove_data_source,
    update_data_source,
)
from golem.data.draft import INSTRUCTION, UNUSABLE, build_prompt, clean
from golem.data.draft import SAMPLE_ROWS as DRAFT_ROWS
from golem.data.notes import MAX_BYTES, TOO_LONG, write_notes
from golem.data.results import KIND, table_record, wire_rows
from golem.data.sources import DataSources, SourceInfo, TableInfo
from golem.data.types import DataError
from golem.models.errors import BudgetSpent, ModelUnreachable
from golem.models.router import ModelConfigError
from golem.server.dispatcher import (
    BUDGET_SPENT,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    MODEL_NOT_CONFIGURED,
    RequestContext,
    RpcCallError,
)
from golem.server.mcp_edit import config_target, get_scope
from golem.sessions.manager import SchemaMismatchError, SessionNotFoundError
from golem_protocol.commands import (
    DataAddParams,
    DataAddResult,
    DataCancelParams,
    DataCancelResult,
    DataChanged,
    DataColumn,
    DataDescribeParams,
    DataDescribeResult,
    DataExtensionInstallParams,
    DataExtensionInstallResult,
    DataInspectParams,
    DataInspectResult,
    DataListParams,
    DataListResult,
    DataNotesDraftParams,
    DataNotesDraftResult,
    DataNotesGetParams,
    DataNotesGetResult,
    DataNotesSetParams,
    DataNotesSetResult,
    DataQueryParams,
    DataRemoveParams,
    DataRemoveResult,
    DataResult,
    DataResultPageParams,
    DataSource,
    DataTable,
    DataUpdateParams,
    DataUpdateResult,
)
from golem_protocol.rpc import DataChangedNotification

SAMPLE_ROWS = 10
"""How many rows of each table ``data.describe`` shows."""


def _sources(ctx: RequestContext) -> DataSources:
    sources = ctx.state.data
    if sources is None:
        raise RpcCallError(INVALID_PARAMS, "data sources are not available")
    return sources


async def _root(ctx: RequestContext, session_id: str | None) -> Path | None:
    """The folder of the session, or None for no session or a session without a folder."""
    if session_id is None or ctx.state.sessions is None:
        return None
    try:
        cwd = await ctx.state.sessions.cwd_of(session_id)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(INVALID_PARAMS, f"there is no session {session_id}") from exc
    return None if cwd is None else Path(cwd)


def wire_source(info: SourceInfo) -> DataSource:
    """A source for the wire. It never holds a password."""
    return DataSource(
        name=info.name,
        kind=info.kind,
        scope=info.scope,
        project=info.project,
        location=info.location,
        privacy=info.privacy,
        status=info.status,
        error=info.error,
        tables=None if info.tables is None else len(info.tables),
        rows=info.rows,
        watch=info.watch,
        needs_extension=info.needs_extension,  # type: ignore[arg-type]
    )


def wire_table(table: TableInfo) -> DataTable:
    return DataTable(
        name=table.name,
        rows=table.rows,
        columns=[
            DataColumn(
                name=c.name,
                type=c.type,
                min=c.min,
                max=c.max,
                distinct=c.distinct,
                null_fraction=c.null_fraction,
            )
            for c in table.columns
        ],
    )


_rows = wire_rows


async def data_list(ctx: RequestContext, params: DataListParams) -> DataListResult:
    root = await _root(ctx, params.session_id)
    found = await _sources(ctx).list(root)
    return DataListResult(sources=[wire_source(info) for info in found])


async def data_describe(ctx: RequestContext, params: DataDescribeParams) -> DataDescribeResult:
    root = await _root(ctx, params.session_id)
    sources = _sources(ctx)
    try:
        info = next((i for i in sources.snapshot(root) if i.name == params.source), None)
        shows_rows = info is not None and info.privacy != "schema"
        found = await sources.describe(
            root, params.source, params.table, sample=SAMPLE_ROWS if shows_rows else 0
        )
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return DataDescribeResult(
        source=wire_source(found.source),
        tables=[wire_table(table) for table in found.tables],
        sample={name: _rows(rows) for name, rows in found.sample.items()},
        notes=found.notes,
    )


async def data_query(ctx: RequestContext, params: DataQueryParams) -> DataResult:
    root = await _root(ctx, params.session_id)
    try:
        result = await _sources(ctx).query(
            root, params.source, params.sql, params.limit, params.result_id
        )
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    if result.stored and params.session_id is not None and ctx.state.artifacts is not None:
        # The result belongs to the session, so closing the session removes its file.
        await ctx.state.artifacts.put(
            params.session_id,
            None,
            KIND,
            table_record(
                result_id=result.result_id,
                source=result.source,
                sql=result.sql,
                columns=result.columns,
                rows=len(result.rows),
                truncated=result.truncated,
            ),
        )
    return DataResult(
        result_id=result.result_id,
        source=result.source,
        columns=[DataColumn(name=c["name"], type=c["type"]) for c in result.columns],
        rows=_rows(result.rows),
        total_rows=len(result.rows),
        truncated=result.truncated,
        elapsed_ms=result.elapsed_ms,
    )


async def data_result_page(ctx: RequestContext, params: DataResultPageParams) -> DataResult:
    """One page of a kept result. It is you reading your own data, so any source's rows."""
    try:
        found = await _sources(ctx).page(
            params.result_id, params.offset, params.limit, params.sort_column, params.sort_desc
        )
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return DataResult(
        result_id=found.result_id,
        source=found.source,
        columns=[DataColumn(name=c["name"], type=c["type"]) for c in found.columns],
        rows=_rows(found.rows),
        total_rows=found.total_rows,
        truncated=False,
        elapsed_ms=0,
    )


async def data_cancel(ctx: RequestContext, params: DataCancelParams) -> DataCancelResult:
    await _sources(ctx).cancel(params.result_id)
    return DataCancelResult()


# -- inspecting and changing sources -----------------------------------------------------------


def _announce(ctx: RequestContext, source: str | None, reason: str) -> None:
    ctx.state.broadcast(
        DataChangedNotification(params=DataChanged(source=source, reason=reason))  # type: ignore[arg-type]
    )


async def data_inspect(ctx: RequestContext, params: DataInspectParams) -> DataInspectResult:
    root = await _root(ctx, params.session_id)
    try:
        found = await _sources(ctx).inspect(params.location, root)
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return DataInspectResult(
        kind=found.kind,
        files=found.files,
        tables=[wire_table(table) for table in found.tables],
        sample={name: _rows(rows) for name, rows in found.sample.items()},
        suggested_name=found.suggested_name,
        suggested_privacy=found.suggested_privacy,
        privacy_reason=found.privacy_reason,
        notes=list(found.notes),
        needs_extension=found.needs_extension,  # type: ignore[arg-type]
    )


async def _listed(ctx: RequestContext, root: Path | None, name: str) -> DataSource:
    for info in await _sources(ctx).list(root):
        if info.name == name:
            return wire_source(info)
    raise RpcCallError(INVALID_PARAMS, f"There is no source called {name}.")


async def data_add(ctx: RequestContext, params: DataAddParams) -> DataAddResult:
    from golem.data.engine import location_kind

    sources = _sources(ctx)
    scope = await get_scope(ctx, params.session_id)
    path = await config_target(ctx, params.scope, scope)
    root = None if scope.root is None else Path(scope.root)
    name = params.name
    if not re.match(DATA_SOURCE_NAME, name):
        raise RpcCallError(
            INVALID_PARAMS,
            f"{name!r} is not a source name: use letters, digits and _, starting with a letter, "
            "up to 32 characters.",
        )
    if name in DATA_RESERVED:
        raise RpcCallError(INVALID_PARAMS, f"{name} is the built-in source: pick another name.")
    if name in sources.taken_names(root):
        raise RpcCallError(INVALID_PARAMS, f"There is already a source called {name}.")
    if params.password is not None:
        raise RpcCallError(INVALID_PARAMS, "A file or a folder has no password.")
    place = Path(params.location).expanduser()
    kind = params.kind or await asyncio.to_thread(location_kind, str(place))
    if kind not in ("files", "sqlite", "duckdb"):
        raise RpcCallError(INVALID_PARAMS, f"golem cannot open {kind} sources yet.")
    watch = params.watch
    if "watch" not in params.model_fields_set:
        watch = kind == "files" and (
            place.is_dir() or re.search(r"[*?\[]", params.location) is not None
        )
    try:
        settings = DataSourceSettings(
            path=params.location,
            kind=kind,  # type: ignore[arg-type]
            privacy=params.privacy,
            watch=watch,
        )
    except ValidationError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc.errors()[0]["msg"])) from exc
    table: dict[str, Any] = {"path": params.location}
    if DataSourceSettings(path=params.location).resolved_kind != settings.resolved_kind:
        table["kind"] = settings.resolved_kind
    table["privacy"] = params.privacy
    if watch:
        table["watch"] = True
    try:
        await asyncio.to_thread(add_data_source, path, name, table)
    except DataExistsError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    await sources.forget(name)
    _announce(ctx, name, "added")
    return DataAddResult(source=await _listed(ctx, root, name))


def _find(sources: DataSources, root: Path | None, name: str) -> tuple[SourceInfo, Path]:
    """The source called ``name`` and the config file that holds it."""
    found = next((i for i in sources.snapshot(root) if i.name == name), None)
    if found is None:
        raise RpcCallError(INVALID_PARAMS, f"There is no source called {name}.")
    if found.scope == "builtin":
        raise RpcCallError(INVALID_PARAMS, "The built-in source cannot be changed or removed.")
    return found, found_path(sources, found)


def found_path(sources: DataSources, info: SourceInfo) -> Path:
    if info.scope == "project" and info.project is not None:
        return Path(info.project) / ".golem" / "config.toml"
    return sources.config_file


async def data_update(ctx: RequestContext, params: DataUpdateParams) -> DataUpdateResult:
    sources = _sources(ctx)
    root = await _root(ctx, params.session_id)
    info, path = _find(sources, root, params.name)
    changes: dict[str, Any] = {}
    if params.privacy is not None:
        changes["privacy"] = params.privacy
    if params.watch is not None:
        changes["watch"] = True if params.watch else None
    if params.include is not None or params.exclude is not None:
        try:
            current = load_data_sources(path)[params.name].tables
        except (OSError, ValueError, KeyError) as exc:
            raise RpcCallError(INTERNAL_ERROR, f"could not read {path}: {exc}") from exc
        include = current.include if params.include is None else params.include
        exclude = current.exclude if params.exclude is None else params.exclude
        tables = {k: list(v) for k, v in (("include", include), ("exclude", exclude)) if v}
        changes["tables"] = tables or None
    try:
        await asyncio.to_thread(update_data_source, path, params.name, changes)
    except DataTableError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    await sources.forget(params.name)
    _announce(ctx, params.name, "updated")
    return DataUpdateResult(source=await _listed(ctx, root, info.name))


async def data_remove(ctx: RequestContext, params: DataRemoveParams) -> DataRemoveResult:
    sources = _sources(ctx)
    root = await _root(ctx, params.session_id)
    _, path = _find(sources, root, params.name)
    try:
        await asyncio.to_thread(remove_data_source, path, params.name)
    except DataTableError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    await sources.forget(params.name)
    _announce(ctx, params.name, "removed")
    return DataRemoveResult()


async def data_extension_install(
    ctx: RequestContext, params: DataExtensionInstallParams
) -> DataExtensionInstallResult:
    try:
        await _sources(ctx).install_extension(params.name)
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    _announce(ctx, None, "updated")
    return DataExtensionInstallResult()


# -- notes -------------------------------------------------------------------------------------


async def data_notes_get(ctx: RequestContext, params: DataNotesGetParams) -> DataNotesGetResult:
    """The notes of a source, null when there are none, and where they are kept."""
    root = await _root(ctx, params.session_id)
    sources = _sources(ctx)
    try:
        found = await sources.read_notes(root, params.source)
        path = sources.notes_path(root, params.source)
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return DataNotesGetResult(text=None if found is None else found.text, path=str(path))


async def data_notes_set(ctx: RequestContext, params: DataNotesSetParams) -> DataNotesSetResult:
    """Save the notes. Empty text deletes the file, so the built-in source gets its own back."""
    root = await _root(ctx, params.session_id)
    sources = _sources(ctx)
    info = next((i for i in sources.snapshot(root) if i.name == params.source), None)
    if info is None:
        raise RpcCallError(INVALID_PARAMS, f"There is no source called {params.source}.")
    if info.scope == "project":
        await config_target(ctx, "project", await get_scope(ctx, params.session_id))
    if len(params.text.encode("utf-8")) > MAX_BYTES:
        raise RpcCallError(INVALID_PARAMS, TOO_LONG)
    path = sources.notes_path(root, params.source)
    try:
        await asyncio.to_thread(write_notes, path, params.text)
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
    _announce(ctx, params.source, "notes")
    return DataNotesSetResult(path=str(path))


async def data_notes_draft(
    ctx: RequestContext, params: DataNotesDraftParams
) -> DataNotesDraftResult:
    """A proposal for the notes, from the schema and, where allowed, sample rows. Not saved."""
    drafts = ctx.state.drafts
    if drafts is None:
        raise RpcCallError(INTERNAL_ERROR, "the daemon is not ready to draft notes yet")
    root = await _root(ctx, params.session_id)
    sources = _sources(ctx)
    try:
        info = next((i for i in sources.snapshot(root) if i.name == params.source), None)
        shows_rows = info is not None and info.privacy != "schema"
        found = await sources.describe(root, params.source, sample=DRAFT_ROWS if shows_rows else 0)
        reply, _model = await drafts.ask(
            INSTRUCTION, lambda local: build_prompt(found, local=local), "a notes draft"
        )
    except DataError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except BudgetSpent as exc:
        raise RpcCallError(BUDGET_SPENT, f"{exc}; {exc.hint}") from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    except ModelUnreachable as exc:
        raise RpcCallError(INTERNAL_ERROR, f"{exc}; {exc.hint}") from exc
    text = clean(reply)
    if not text:
        raise RpcCallError(INVALID_PARAMS, UNUSABLE)
    return DataNotesDraftResult(text=text + "\n")
