"""The ``data.*`` methods: list the data sources, look one up, query it, cancel a query.

These are you looking at your own data from a page, so a query may run on any source: a
source's privacy limits only what goes to a model. You see sample rows of every source except
a ``schema`` one. ``session_id`` picks the folder whose project sources count.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from golem.data.sources import DataSources, SourceInfo, TableInfo
from golem.data.types import DataError
from golem.server.dispatcher import INVALID_PARAMS, RequestContext, RpcCallError
from golem.sessions.manager import SchemaMismatchError, SessionNotFoundError
from golem_protocol.commands import (
    DataCancelParams,
    DataCancelResult,
    DataColumn,
    DataDescribeParams,
    DataDescribeResult,
    DataListParams,
    DataListResult,
    DataQueryParams,
    DataResult,
    DataSource,
    DataTable,
)

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


def _rows(rows: list[list[Any]]) -> list[list[Any]]:
    """Rows with a list or a struct as JSON text: a cell on the wire is a scalar."""
    return [
        [json.dumps(v, ensure_ascii=False) if isinstance(v, list | dict) else v for v in row]
        for row in rows
    ]


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
    return DataResult(
        result_id=result.result_id,
        source=result.source,
        columns=[DataColumn(name=c["name"], type=c["type"]) for c in result.columns],
        rows=_rows(result.rows),
        truncated=result.truncated,
        elapsed_ms=result.elapsed_ms,
    )


async def data_cancel(ctx: RequestContext, params: DataCancelParams) -> DataCancelResult:
    await _sources(ctx).cancel(params.result_id)
    return DataCancelResult()
