"""An MCP server's tools as golem tools, so they run through the ``tools`` node.

Each one is named ``mcp__<server>__<tool>``. Providers allow only letters,
digits, ``_``, and ``-`` in a tool name, at most 64 of them, so the server's
own name is cleaned to fit, and the call goes out under its original name.

A server's tool is never ``read_only``: what it does is the server's word,
so the default rules ask before every call. Its output is outside content,
so the model reads it marked as data.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict

from golem.mcp.client import CallResult, McpTool
from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult
from golem.tools.untrusted import MCP_NOTE, wrap

PREFIX = "mcp__"
MAX_NAME = 64
SUMMARY_CHARS = 80

CallTool = Callable[[str, Mapping[str, object]], Awaitable[CallResult]]
"""Runs the server's tool, by its own name, with these arguments."""


class McpArguments(BaseModel):
    """Any JSON object. The server checks it against the tool's schema."""

    model_config = ConfigDict(extra="allow")


def tool_name(server: str, tool: str) -> str:
    """``mcp__<server>__<tool>``, with the tool's name cleaned and cut to fit."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", tool)
    return f"{PREFIX}{server}__{cleaned}"[:MAX_NAME]


def mcp_tools(server: str, listed: list[McpTool], call: CallTool) -> list[Tool[Any]]:
    """golem tools for ``listed``. A tool whose cleaned name is taken is left out."""
    tools: dict[str, Tool[Any]] = {}
    for item in listed:
        name = tool_name(server, item.name)
        if name not in tools:
            tools[name] = _tool(server, name, item, call)
    return list(tools.values())


def result_text(result: CallResult) -> str:
    """The content items as text. Binary items are named, not inlined."""
    parts = [_item_text(item) for item in result.content]
    text = "\n".join(part for part in parts if part)
    if not text and result.structured is not None:
        text = json.dumps(result.structured, ensure_ascii=False, indent=2)
    return text


def subject(args: Mapping[str, object], root: Path | None) -> str:
    """The arguments as one line of JSON, so "always allow" covers this exact call."""
    del root
    return json.dumps(dict(args), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _tool(server: str, name: str, item: McpTool, call: CallTool) -> Tool[Any]:
    async def run(args: McpArguments, ctx: ToolContext) -> ToolResult:
        del ctx
        result = await call(item.name, args.model_dump(mode="json"))
        text = result_text(result)
        if result.is_error:
            raise ToolError(text or f"{item.name} failed")
        first = text.strip().splitlines()[0] if text.strip() else "done"
        summary = first if len(first) <= SUMMARY_CHARS else f"{first[: SUMMARY_CHARS - 1]}…"
        output = wrap(text, tag="mcp_output", note=MCP_NOTE, server=server, tool=item.name)
        return ToolResult(output=output, summary=summary)

    description = item.description.strip() or f"The {item.name} tool of the {server} MCP server."
    return Tool(
        name=name,
        description=description,
        args=McpArguments,
        run=run,
        untrusted=True,
        subject=subject,
        parameters=_parameters(item.input_schema),
    )


def _parameters(schema: Mapping[str, object]) -> dict[str, object]:
    """The tool's input schema as providers take it: an object, with no ``$schema``."""
    parameters = {key: value for key, value in schema.items() if key != "$schema"}
    parameters["type"] = "object"
    parameters.setdefault("properties", {})
    return parameters


def _item_text(item: Mapping[str, object]) -> str:
    kind = item.get("type")
    if kind == "text":
        text = item.get("text")
        return text if isinstance(text, str) else ""
    if kind in ("image", "audio"):
        data = item.get("data")
        size = len(data) * 3 // 4 if isinstance(data, str) else 0
        return f"[{kind} {item.get('mimeType', '')}, {size} bytes, not shown]"
    if kind == "resource":
        resource = item.get("resource")
        if isinstance(resource, dict):
            text = resource.get("text")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            if isinstance(text, str):
                return text
            return f"[resource {resource.get('uri', '')}, not shown]"  # pyright: ignore[reportUnknownMemberType]
        return ""
    if kind == "resource_link":
        return f"[resource link {item.get('name', '')}: {item.get('uri', '')}]"
    return ""


__all__ = ["PREFIX", "McpArguments", "mcp_tools", "result_text", "subject", "tool_name"]
