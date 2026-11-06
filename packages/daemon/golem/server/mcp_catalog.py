"""``mcp.catalog`` and ``runtime.install``: the servers on offer, and the programs they need.

Both may be called by the browser (ADR-037). Installing is limited to the two
names in :data:`golem.models.install.RUNTIMES`, so a page cannot ask brew for
anything else (ADR-035).
"""

from __future__ import annotations

from golem.mcp.catalog import load_catalog, unavailable
from golem.models.install import InstallError
from golem.server.dispatcher import INTERNAL_ERROR, OLLAMA_FAILED, RequestContext, RpcCallError
from golem.server.mcp_edit import get_mcp, get_scope
from golem_protocol.commands import (
    McpCatalogEntry,
    McpCatalogInput,
    McpCatalogParams,
    McpCatalogResult,
    RuntimeInstallCancelParams,
    RuntimeInstallCancelResult,
    RuntimeInstallParams,
    RuntimeInstallResult,
)

PROGRAMS = {"npx": "node", "uvx": "uv", "docker": "docker"}
"""What a missing ``npx``, ``uvx``, or ``docker`` is called to a person."""


async def mcp_catalog(ctx: RequestContext, params: McpCatalogParams) -> McpCatalogResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    present = {server.name for server in mcp.statuses(scope if params.session_id else None)}
    entries: list[McpCatalogEntry] = []
    for entry in load_catalog():
        reason = unavailable(entry)
        missing = PROGRAMS.get(entry.runtime)
        entries.append(
            McpCatalogEntry(
                id=entry.id,
                name=entry.name,
                title=entry.title,
                description=entry.description,
                category=entry.category,
                homepage=entry.homepage,
                runtime=entry.runtime,
                auth=entry.auth,
                inputs=[McpCatalogInput.model_validate(item.model_dump()) for item in entry.inputs],
                starter=entry.starter,
                on_demand=entry.defaults.enabled == "on_demand",
                available=reason is None,
                reason=reason,
                missing=(
                    missing  # pyright: ignore[reportArgumentType]
                    if missing is not None and not mcp.has_command(entry.runtime)
                    else None
                ),
                added=entry.name in present,
            )
        )
    return McpCatalogResult(entries=entries)


async def runtime_install(
    ctx: RequestContext, params: RuntimeInstallParams
) -> RuntimeInstallResult:
    installer = ctx.state.runtimes.get(params.name)
    if installer is None:
        raise RpcCallError(INTERNAL_ERROR, "the installer is not ready")
    try:
        started = await installer.start()
    except InstallError as exc:
        raise RpcCallError(OLLAMA_FAILED, str(exc), {"no_brew": exc.no_brew}) from exc
    return RuntimeInstallResult(name=params.name, started=started)


async def runtime_install_cancel(
    ctx: RequestContext, params: RuntimeInstallCancelParams
) -> RuntimeInstallCancelResult:
    installer = ctx.state.runtimes.get(params.name)
    cancelled = False if installer is None else await installer.cancel()
    return RuntimeInstallCancelResult(name=params.name, cancelled=cancelled)
