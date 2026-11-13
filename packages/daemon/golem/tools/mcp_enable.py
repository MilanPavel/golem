"""``mcp_enable``: the model asks to turn on an on-demand MCP server for this session.

It is offered only while the session has such a server that is off. It asks for
approval like any tool, with the reason shown, and does what ``/mcp enable`` does.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult


class McpEnableArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(
        min_length=1, description="A server named in the list of servers you can turn on."
    )
    reason: str = Field(
        min_length=1, max_length=300, description="Why you need it, shown to the user."
    )


async def _mcp_enable(args: McpEnableArgs, ctx: ToolContext) -> ToolResult:
    if ctx.enable_mcp is None:
        raise ToolError("MCP servers cannot be turned on here")
    tools = await ctx.enable_mcp(args.name)
    listing = ", ".join(tools) if tools else "(it offers no tools)"
    return ToolResult(
        output=f"{args.name} is on. Its tools, available from your next step: {listing}",
        summary=f"turned on {args.name}",
    )


MCP_ENABLE = Tool(
    name="mcp_enable",
    description=(
        "Turn on one of the MCP servers listed in your instructions as ones you can turn on. "
        "The user is asked first. Its tools can be called from your next step."
    ),
    args=McpEnableArgs,
    run=_mcp_enable,
    match_arg="name",
)

__all__ = ["MCP_ENABLE", "McpEnableArgs"]
