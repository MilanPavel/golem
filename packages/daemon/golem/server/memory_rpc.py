"""The ``memory.*`` methods: list, read, write, edit and delete memories, export them, set privacy.

These are you looking at your own memory from the browser, so a write is author ``you`` and no
model is involved. ``[memory] enabled = false`` leaves no service, and every method but
``memory.settings`` answers with the reason. ``memory.settings`` writes the privacy of a scope to
the user's file; ``auto_keep`` is not a parameter, because it widens trust (ADR-037).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from stat import S_ISREG

from golem.config import load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.memory.export import render
from golem.memory.records import MemoryRecord, Scope, SourceRow, State
from golem.memory.service import MemoryService
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem_protocol.commands import (
    MemoryCounts,
    MemoryDeleteParams,
    MemoryDeleteResult,
    MemoryExportParams,
    MemoryExportResult,
    MemoryGetParams,
    MemoryGetResult,
    MemoryItem,
    MemoryListParams,
    MemoryListResult,
    MemorySettings,
    MemorySettingsParams,
    MemorySettingsResult,
    MemorySource,
    MemoryUpdateParams,
    MemoryUpdateResult,
    MemoryWriteParams,
    MemoryWriteResult,
)

log = logging.getLogger("golem.server")

_SEARCH_CAP = 1000
"""How many hits a word search reads, so a page can say ``total`` and be cut by ``after``."""
_PAGE = 200
_MAX_SOURCE_BYTES = 20_000_000
"""The largest file a note may name as a source. A larger one is refused, not read."""
_STATES: tuple[State, ...] = ("proposed", "kept", "stale")
_SETTING_KEY: dict[Scope, str] = {"you": "you", "project": "projects", "history": "history"}
"""The key of ``[memory]`` for each scope."""


def _service(ctx: RequestContext) -> MemoryService:
    service = ctx.state.memory
    if service is None:
        raise RpcCallError(INVALID_PARAMS, "memory is off: [memory] enabled = false")
    return service


def _invalid(reason: str) -> RpcCallError:
    return RpcCallError(INVALID_PARAMS, reason)


async def _local_model_ready(ctx: RequestContext) -> bool:
    """Whether a local model is set up: the one thing that lets a ``local`` memory be used."""
    models = ctx.state.models
    if models is None:
        return False
    listed = models.cached() or (await models.list()).models
    return any(model.tier == "local" and model.status == "ready" for model in listed)


async def _items(ctx: RequestContext, records: list[MemoryRecord]) -> list[MemoryItem]:
    """Each record as an item. A ``local`` memory is ``usable`` when a local model exists."""
    local = await _local_model_ready(ctx) if any(r.privacy == "local" for r in records) else False
    return [_item(record, local if record.privacy == "local" else None) for record in records]


def _item(record: MemoryRecord, usable: bool | None) -> MemoryItem:
    fields = asdict(record)
    fields["sources"] = [MemorySource(**asdict(source)) for source in record.sources]
    return MemoryItem(**fields, usable=usable)


async def _settings(ctx: RequestContext) -> MemorySettings:
    paths = ctx.state.paths
    loaded = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    memory = loaded.memory
    if ctx.state.memory is not None:
        ctx.state.memory.use_settings(memory)
    return MemorySettings(
        you=memory.you,
        projects=memory.projects,
        history=memory.history,
        auto_keep=list(memory.auto_keep),
        share=memory.share,
        min_tokens=memory.min_tokens,
        max_tokens=memory.max_tokens,
    )


async def memory_list(ctx: RequestContext, params: MemoryListParams) -> MemoryListResult:
    store = _service(ctx).store
    if params.query is not None:
        hits = await store.search(params.query, params.scope, params.folder, _SEARCH_CAP)
        if params.state is not None:
            hits = [hit for hit in hits if hit.state == params.state]
        start = 0
        if params.after is not None:
            ids = [hit.id for hit in hits]
            start = ids.index(params.after) + 1 if params.after in ids else len(ids)
        page = hits[start : start + params.limit]
        total = len(hits)
    else:
        page = await store.list(
            params.scope, params.folder, params.state, params.limit, params.after
        )
        matching = await store.counts(params.folder, params.state)
        total = matching[params.scope] if params.scope is not None else sum(matching.values())
    by_scope = await store.counts()
    by_state = {state: sum((await store.counts(state=state)).values()) for state in _STATES}
    return MemoryListResult(
        items=await _items(ctx, page),
        total=total,
        counts=MemoryCounts(**by_scope, **by_state),
        settings=await _settings(ctx),
    )


async def memory_get(ctx: RequestContext, params: MemoryGetParams) -> MemoryGetResult:
    record = await _service(ctx).store.get(params.id)
    if record is None:
        raise _invalid(f"there is no memory {params.id}")
    return MemoryGetResult(item=(await _items(ctx, [record]))[0])


async def memory_write(ctx: RequestContext, params: MemoryWriteParams) -> MemoryWriteResult:
    service = _service(ctx)
    sources = await _hashed(params.sources, params.folder)
    try:
        record = await service.write_by_you(
            params.text,
            params.scope,
            folder=params.folder,
            title=params.title,
            privacy=params.privacy,
            always=params.always,
            sources=sources,
        )
    except ValueError as exc:
        raise _invalid(str(exc)) from exc
    if record is None:
        raise _invalid("memory is off: [memory] enabled = false")
    return MemoryWriteResult(item=(await _items(ctx, [record]))[0])


async def memory_update(ctx: RequestContext, params: MemoryUpdateParams) -> MemoryUpdateResult:
    service = _service(ctx)
    sources = None
    if params.accept_sources:
        found = await service.store.get(params.id)
        if found is None:
            raise _invalid(f"there is no memory {params.id}")
        sources = await _hashed([source.path for source in found.sources], found.folder)
    try:
        record = await service.update(
            params.id,
            text=params.text,
            title=params.title,
            privacy=params.privacy,
            always=params.always,
            folder=params.folder,
            sources=sources,
        )
    except ValueError as exc:
        raise _invalid(str(exc)) from exc
    if record is None:
        raise _invalid(f"there is no memory {params.id}")
    return MemoryUpdateResult(item=(await _items(ctx, [record]))[0])


async def memory_delete(ctx: RequestContext, params: MemoryDeleteParams) -> MemoryDeleteResult:
    service = _service(ctx)
    deleted: list[str] = []
    missing: list[str] = []
    for memory_id in dict.fromkeys(params.ids):
        (deleted if await service.delete(memory_id) else missing).append(memory_id)
    return MemoryDeleteResult(deleted=deleted, missing=missing)


async def memory_export(ctx: RequestContext, params: MemoryExportParams) -> MemoryExportResult:
    store = _service(ctx).store
    records: list[MemoryRecord] = []
    after: str | None = None
    while page := await store.list(params.scope, params.folder, None, _PAGE, after):
        records.extend(page)
        after = page[-1].id
    return MemoryExportResult(
        format=params.format, text=render(records, params.format), count=len(records)
    )


async def memory_settings(
    ctx: RequestContext, params: MemorySettingsParams
) -> MemorySettingsResult:
    if params.scope is not None and params.privacy is not None:
        config_file = ctx.state.paths.config_file
        key = _SETTING_KEY[params.scope]
        try:
            await asyncio.to_thread(set_keys, config_file, {"memory": {key: params.privacy}})
        except (RawConflictError, ValueError) as exc:
            raise _invalid(str(exc)) from exc
        except OSError as exc:
            raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
        log.info("memory setting saved %s=%s", key, params.privacy)
    return MemorySettingsResult(settings=await _settings(ctx))


async def _hashed(paths: list[str], folder: str | None) -> tuple[SourceRow, ...]:
    """The files of a note as they are now. A path inside ``folder`` is kept relative to it."""
    now = datetime.now(UTC).isoformat()
    return tuple(
        await asyncio.gather(*(asyncio.to_thread(_source, path, folder, now) for path in paths))
    )


def _source(path: str, folder: str | None, now: str) -> SourceRow:
    base = Path(folder).resolve() if folder is not None else None
    file = Path(path).expanduser()
    if not file.is_absolute():
        if base is None:
            raise _invalid(f"{path} is relative and the memory has no project folder")
        file = base / file
    file = file.resolve()
    digest = hashlib.sha256()
    size = 0
    try:
        stat = file.stat()
        # Only a plain file: a device or a pipe would never end.
        if not S_ISREG(stat.st_mode):
            raise _invalid(f"the source {path} is not a file")
        if stat.st_size > _MAX_SOURCE_BYTES:
            raise _invalid(f"the source {path} is over {_MAX_SOURCE_BYTES // 1_000_000} MB")
        with file.open("rb") as opened:
            while chunk := opened.read(1 << 20):
                size += len(chunk)
                if size > _MAX_SOURCE_BYTES:
                    raise _invalid(f"the source {path} is over {_MAX_SOURCE_BYTES // 1_000_000} MB")
                digest.update(chunk)
    except OSError as exc:
        raise _invalid(f"cannot read the source {path}: {exc.strerror or exc}") from exc
    inside = base is not None and file.is_relative_to(base)
    return SourceRow(
        path=str(file.relative_to(base)) if inside and base is not None else str(file),
        sha256=digest.hexdigest(),
        size=size,
        mtime_ns=stat.st_mtime_ns,
        checked_at=now,
    )


__all__ = [
    "memory_delete",
    "memory_export",
    "memory_get",
    "memory_list",
    "memory_settings",
    "memory_update",
    "memory_write",
]
