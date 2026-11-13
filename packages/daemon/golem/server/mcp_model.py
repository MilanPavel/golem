"""Turning on an on-demand MCP server, for a session: the same path for the user and the model."""

from __future__ import annotations

from dataclasses import replace

from golem.mcp import McpServerError, McpSupervisor
from golem.sessions.manager import SessionManager
from golem.tools.registry import ToolError, ToolScope


async def turn_on(
    sessions: SessionManager, mcp: McpSupervisor, session_id: str, scope: ToolScope, name: str
) -> list[str]:
    """Turn on ``name`` for ``session_id`` and start it. Returns the session's enabled servers.

    Raises :class:`McpServerError` unless ``name`` is an on-demand server the session sees.
    """
    mcp.check_toggle(scope, name)
    names = await sessions.set_mcp(session_id, name, True)
    mcp.start_for(replace(scope, enabled=frozenset(names)))
    return names


async def turn_on_for_model(
    sessions: SessionManager, mcp: McpSupervisor, session_id: str, scope: ToolScope, name: str
) -> list[str]:
    """What ``mcp_enable`` does, once the user approved it: :func:`turn_on`, then wait for
    ``running``. Returns the tool names the model gets. Raises :class:`ToolError`.

    Only a server the model was offered may be turned on, so ``auto_enable = false`` holds.
    """
    offered = [offer for offer, _ in mcp.offers(scope)]
    if name not in offered:
        listing = ", ".join(offered) or "none"
        raise ToolError(f"{name} is not a server you can turn on; the ones you can are: {listing}")
    try:
        names = await turn_on(sessions, mcp, session_id, scope, name)
    except McpServerError as exc:
        raise ToolError(str(exc)) from exc
    here = replace(scope, enabled=frozenset(names))
    await mcp.prepare(here)
    status = mcp.state_of(here, name)
    if status.state != "running":
        detail = status.error or f"it is {status.state}"
        raise ToolError(f"{name} is on, but did not start: {detail}")
    return mcp.tool_names(here, name)


__all__ = ["turn_on", "turn_on_for_model"]
