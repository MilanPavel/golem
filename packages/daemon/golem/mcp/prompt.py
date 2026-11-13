"""The system prompt block that lists the on-demand MCP servers the model may ask to turn on."""

from __future__ import annotations

from pathlib import Path

from golem.graphs.prompt import PromptContext, Section
from golem.mcp.supervisor import McpSupervisor
from golem.tools.registry import ToolScope

MCP_SECTION = "mcp_servers"


def mcp_section(supervisor: McpSupervisor) -> Section:
    """``MCP servers you can turn on: name (what it is for), …``, or nothing when none is off.

    Servers with ``auto_enable = false`` are left out, and so are the ones the session has on.
    """

    def section(context: PromptContext) -> str | None:
        root = None if context.cwd is None else Path(context.cwd)
        offers = supervisor.offers(ToolScope(root=root, enabled=frozenset(context.mcp_servers)))
        if not offers:
            return None
        names = ", ".join(f"{name} ({text})" if text else name for name, text in offers)
        return (
            f"MCP servers you can turn on: {names}. "
            "Call mcp_enable(name, reason) when a task needs one."
        )

    return Section(MCP_SECTION, section)


__all__ = ["MCP_SECTION", "mcp_section"]
