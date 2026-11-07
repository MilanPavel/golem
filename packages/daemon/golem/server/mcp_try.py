"""``mcp.test``, ``mcp.logs``, and ``mcp.call``: find out why a server fails, and try a tool.

The browser may call all three (ADR-037). ``mcp.test`` starts what the page
described, which ``mcp.add`` could already do, and stores nothing. ``mcp.call``
runs when a person presses Run, so the press is the approval.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from golem.mcp import McpServerError
from golem.mcp.catalog import find_entry
from golem.mcp.client import McpError, McpTool
from golem.mcp.probe import Step
from golem.mcp.tools import result_text
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.mcp_edit import (
    catalog_table,
    check_sent,
    get_mcp,
    get_scope,
    own_secrets,
    to_settings,
    to_table,
)
from golem_protocol.commands import (
    McpCallParams,
    McpCallResult,
    McpImplementation,
    McpLogsParams,
    McpLogsResult,
    McpTestParams,
    McpTestProgress,
    McpTestResult,
    McpTestStep,
    McpToolInfo,
)
from golem_protocol.rpc import McpTestProgressNotification

CHARS_PER_TOKEN = 4


async def mcp_test(ctx: RequestContext, params: McpTestParams) -> McpTestResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    values = {ref: value.get_secret_value() for ref, value in params.secrets.items()}
    draft = False
    project: Path | None = None
    hidden: Callable[[str], bool] = lambda _name: False  # noqa: E731
    if params.catalog_id is not None:
        # An entry that is not saved: its secrets come by input id, and only this request's.
        draft = True
        table, values = catalog_table(
            params.catalog_id, params.inputs, values, name=params.name, scope=scope
        )
        settings = to_settings(table)
        entry = find_entry(params.catalog_id)
        assert entry is not None
        own_secrets(params.name or entry.name, settings)
        check_sent(values, settings)
    elif params.name is not None:
        try:
            settings = mcp.settings(scope, params.name)
            root = mcp.status(scope, params.name).project
        except McpServerError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
        project = None if root is None else Path(root)
        hidden = lambda name: not settings.tools.allows(name)  # noqa: E731
    else:
        assert params.config is not None
        settings = to_settings(to_table(params.config))
        check_sent(values, settings)

    def progress(step: Step) -> None:
        note = McpTestProgress(
            test_id=params.test_id,
            step=step.step,  # pyright: ignore[reportArgumentType]
            state=step.state,
            elapsed_ms=step.elapsed_ms,
            detail=step.detail,
        )
        mcp.broadcast(McpTestProgressNotification(params=note))

    # A saved server may read its stored secrets. A config that is not saved may use
    # only what this request sends, so it cannot point a stored secret at a new address.
    found = await mcp.test(
        settings,
        sent=values,
        keychain=not draft and params.name is not None,
        project=project,
        progress=progress,
    )
    return McpTestResult(
        test_id=params.test_id,
        ok=found.ok,
        steps=[
            McpTestStep(
                step=step.step,  # pyright: ignore[reportArgumentType]
                state=step.state,
                elapsed_ms=step.elapsed_ms,
                detail=step.detail,
            )
            for step in found.steps
        ],
        server_info=(
            None
            if found.server_name is None
            else McpImplementation(name=found.server_name, version=found.server_version)
        ),
        protocol_version=found.protocol_version,
        tools=[_info(tool, hidden(tool.name)) for tool in found.tools],
        stderr_tail=found.stderr_tail,
        hint=None if found.hint is None else found.hint.text,
        runtime=None if found.hint is None else found.hint.runtime,
    )


async def mcp_logs(ctx: RequestContext, params: McpLogsParams) -> McpLogsResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        lines = mcp.logs(scope, params.name, params.limit)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return McpLogsResult(name=params.name, lines=lines)


async def mcp_call(ctx: RequestContext, params: McpCallParams) -> McpCallResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        result = await mcp.call(scope, params.name, params.tool, params.arguments)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except McpError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    structured = result.structured
    return McpCallResult(
        text=result_text(result),
        is_error=result.is_error,
        structured=structured,
    )


def _info(tool: McpTool, hidden: bool) -> McpToolInfo:
    schema = json.dumps({"name": tool.name, "description": tool.description, **tool.input_schema})
    return McpToolInfo(
        name=tool.name,
        description=tool.description,
        hidden=hidden,
        schema_tokens=len(schema) // CHARS_PER_TOKEN,
        input_schema=dict(tool.input_schema),
    )
