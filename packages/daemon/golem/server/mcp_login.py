"""``mcp.login`` and ``mcp.logout``: sign in to a hosted MCP server with OAuth, or sign out.

The browser may call both (ADR-037, ADR-049). Neither takes or returns a secret: the
daemon runs the whole sign-in, and the page only gets the address to open.
"""

from __future__ import annotations

from golem.mcp import McpServerError
from golem.server.dispatcher import INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.mcp_edit import get_mcp, get_scope
from golem_protocol.commands import McpLoginResult, McpServer, McpServerParams


async def mcp_login(ctx: RequestContext, params: McpServerParams) -> McpLoginResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        url = await mcp.login(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return McpLoginResult(name=params.name, authorize_url=url)


async def mcp_logout(ctx: RequestContext, params: McpServerParams) -> McpServer:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        return await mcp.logout(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
