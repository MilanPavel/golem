"""MCP servers as tool providers: a stdio client, their tools as golem tools, and a supervisor."""

from golem.mcp.supervisor import McpSupervisor

__all__ = ["McpSupervisor"]
