"""``mcp.import.scan`` and ``mcp.import.apply``: bring in the servers other apps have.

The browser may call both (ADR-037). A scan holds the other apps' secret values
in memory for ten minutes and never sends them back. An apply goes through the
same checks as ``mcp.add``: a server names only its own secrets, a secret is
stored before the file names it, and the servers reload once at the end.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from golem.config_edit import McpExistsError, add_mcp_server, has_mcp_server
from golem.mcp import McpServerError
from golem.mcp.importer import ConvertError, Found, Raw, convert, discover, fit_name, from_text
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.mcp_edit import (
    check_sent,
    config_target,
    get_mcp,
    get_scope,
    own_secrets,
    store_secrets,
)
from golem_protocol.commands import (
    McpImportApplyParams,
    McpImportApplyResult,
    McpImportCandidate,
    McpImportFailure,
    McpImportScanParams,
    McpImportScanResult,
    McpImportSource,
    McpServer,
    McpServerConfig,
)

log = logging.getLogger("golem.server")


async def mcp_import_scan(ctx: RequestContext, params: McpImportScanParams) -> McpImportScanResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    existing: dict[str, str] = {}
    for status in mcp.statuses(scope if params.session_id else None):
        try:
            existing[status.name] = mcp.settings(scope, status.name).target
        except McpServerError:
            existing[status.name] = ""
    if params.text is not None:
        found = [from_text(params.text)]
    else:
        found = await asyncio.to_thread(discover, ctx.state.user_home or Path.home(), scope.root)
    taken = set(existing)
    targets = {target for target in existing.values() if target}
    kept: dict[str, Raw] = {}
    sources: list[McpImportSource] = []
    for index, item in enumerate(found):
        sources.append(_source(index, item, taken, targets, kept))
    return McpImportScanResult(scan_id=ctx.state.mcp_imports.put(kept), sources=sources)


def _source(
    index: int, item: Found, taken: set[str], targets: set[str], kept: dict[str, Raw]
) -> McpImportSource:
    candidates: list[McpImportCandidate] = []
    skipped = list(item.skipped)
    for raw in item.raws:
        name, clash = fit_name(raw.name, taken)
        try:
            converted = convert(name, raw.body, raw.inputs)
        except ConvertError as exc:
            skipped.append(f"{raw.name}: {exc}")
            continue
        taken.add(name)
        key = f"{item.source}.{index}:{raw.name}"
        kept[key] = raw
        candidates.append(
            McpImportCandidate(
                key=key,
                name=name,
                original_name=raw.name,
                scope=raw.scope,
                config=McpServerConfig.model_validate(converted.settings.model_dump(mode="json")),
                secret_refs=converted.settings.secrets,
                missing_refs=converted.needed,
                warnings=converted.warnings,
                clash=clash,
                already_same=converted.settings.target in targets,
            )
        )
    return McpImportSource(
        id=item.source,
        label=item.label,
        path=None if item.path is None else str(item.path),
        candidates=candidates,
        skipped=skipped,
        error=item.error,
    )


async def mcp_import_apply(
    ctx: RequestContext, params: McpImportApplyParams
) -> McpImportApplyResult:
    mcp = get_mcp(ctx)
    raws = ctx.state.mcp_imports.take(params.scan_id)
    if raws is None:
        raise RpcCallError(
            INVALID_PARAMS, "that scan expired or was already used: scan again before importing"
        )
    scope = await get_scope(ctx, params.session_id)
    supplied = {ref: value.get_secret_value() for ref, value in params.secrets.items()}
    added: list[str] = []
    failed: list[McpImportFailure] = []
    paths: dict[Path, None] = {}
    for pick in params.picks:
        raw = raws.get(pick.key)
        if raw is None:
            failed.append(McpImportFailure(key=pick.key, error="that server is not in the scan"))
            continue
        try:
            path = await config_target(ctx, pick.scope, scope)
            converted = convert(pick.name, raw.body, raw.inputs)
            values = {
                **converted.secrets,
                **{ref: supplied[ref] for ref in converted.needed if ref in supplied},
            }
            own_secrets(pick.name, converted.settings)
            check_sent(values, converted.settings)
            if pick.scope == "user" and mcp.config_files(pick.name):
                raise RpcCallError(INVALID_PARAMS, f"{pick.name} already exists")
            try:
                if await asyncio.to_thread(has_mcp_server, path, pick.name):
                    raise RpcCallError(INVALID_PARAMS, f"{path} already has [mcp.{pick.name}]")
            except (OSError, ValueError) as exc:
                raise RpcCallError(INTERNAL_ERROR, f"could not read {path}: {exc}") from exc
            await store_secrets(ctx, values)
            try:
                await asyncio.to_thread(add_mcp_server, path, pick.name, converted.table)
            except McpExistsError as exc:
                raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
            except OSError as exc:
                raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
        except (RpcCallError, ConvertError) as exc:
            failed.append(McpImportFailure(key=pick.key, error=str(exc)))
            continue
        paths[path] = None
        added.append(pick.name)
    for path in paths:
        mcp.reload(path)
    servers: list[McpServer] = []
    for name in added:
        try:
            servers.append(mcp.status(scope, name))
        except McpServerError as exc:
            failed.append(McpImportFailure(key=name, error=str(exc)))
    log.info("imported %d MCP servers, %d failed", len(servers), len(failed))
    return McpImportApplyResult(added=servers, failed=failed)
