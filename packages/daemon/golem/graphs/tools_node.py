"""The ``tools`` node: decide about each of the last reply's tool calls, then run them.

The prebuilt ``ToolNode`` would run LangChain tools directly. This node keeps
the tools plain Python, asks the permission policy about every call before
it runs, reports each call on the custom stream, and turns every failure or
refusal into a result the model can read, so a bad call never ends the run.

A call the policy says ``ask`` about pauses the run with ``interrupt()``. A
resumed run starts this node again from the top, so it works in two passes:
first every decision, with one interrupt per call that asks, and only then
the calls themselves and their stream items. Nothing has run or been
reported before the last answer, so starting over repeats nothing.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from golem.graphs.adapter import APPROVAL_KIND, STREAM_KEY
from golem.graphs.state import AgentState
from golem.permissions.policy import Policy, explain
from golem.tools.registry import ToolContext, ToolError, ToolRegistry

log = logging.getLogger("golem.graphs")

CWD_KEY = "golem_cwd"
"""``configurable`` key for the session folder. It is not checkpointed."""

ALLOWED_KEY = "golem_allowed_tools"
"""``configurable`` key for the tools allowed for the rest of the session."""

PREVIEW_CHARS = 4_000

CANCELLED_RESULT = "cancelled: the run stopped before this tool call finished"
DENIED_RESULT = "the user denied this tool call"


@dataclass(frozen=True, slots=True)
class _Verdict:
    run: bool
    message: str = ""


def tools_node(
    registry: ToolRegistry,
    policy: Policy,
) -> Callable[[AgentState, RunnableConfig], Awaitable[dict[str, list[BaseMessage]]]]:
    async def tools(state: AgentState, config: RunnableConfig) -> dict[str, list[BaseMessage]]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage):
            return {"messages": []}
        ctx = ToolContext(root=_root(config))
        allowed = _allowed(config)
        verdicts = [
            _decide(registry, policy, call, ctx, allowed, last.id) for call in last.tool_calls
        ]
        write = get_stream_writer()
        results: list[BaseMessage] = []
        for call, verdict in zip(last.tool_calls, verdicts, strict=True):
            call_id = call_id_of(call)
            if not verdict.run:
                write({STREAM_KEY: "tool.failed", "call_id": call_id, "message": verdict.message})
                results.append(
                    _result(call_id, call["name"], f"error: {verdict.message}", error=True)
                )
                continue
            write({STREAM_KEY: "tool.started", "call_id": call_id})
            try:
                result = await registry.call(call["name"], call["args"], ctx)
            except ToolError as exc:
                message = str(exc) or type(exc).__name__
                write({STREAM_KEY: "tool.failed", "call_id": call_id, "message": message})
                results.append(_result(call_id, call["name"], f"error: {message}", error=True))
                continue
            except Exception as exc:
                log.exception("tool %s failed", call["name"])
                message = f"{type(exc).__name__}: {exc}"
                write({STREAM_KEY: "tool.failed", "call_id": call_id, "message": message})
                results.append(_result(call_id, call["name"], f"error: {message}", error=True))
                continue
            preview = result.output[:PREVIEW_CHARS]
            write(
                {
                    STREAM_KEY: "tool.completed",
                    "call_id": call_id,
                    "summary": result.summary,
                    "preview": preview,
                    "truncated": len(preview) < len(result.output),
                }
            )
            results.append(_result(call_id, call["name"], result.output))
        return {"messages": results}

    return tools


def _decide(
    registry: ToolRegistry,
    policy: Policy,
    call: ToolCall,
    ctx: ToolContext,
    allowed: set[str],
    message_id: str | None,
) -> _Verdict:
    name = call["name"]
    decision = policy.check(registry, name, call["args"], ctx.root)
    if decision.allowed:
        return _Verdict(run=True)
    if decision.action == "deny":
        log.info("tool %s denied by %s", name, decision.source)
        return _Verdict(run=False, message=explain(decision, name))
    if name in allowed:
        return _Verdict(run=True)
    answer = interrupt(
        {
            STREAM_KEY: APPROVAL_KIND,
            "call_id": call_id_of(call),
            "message_id": message_id,
            "name": name,
            "args": dict(call["args"]),
            "source": decision.source,
        }
    )
    choice = cast(dict[str, object], answer).get("decision") if isinstance(answer, dict) else None
    if choice == "allow_session":
        allowed.add(name)
        return _Verdict(run=True)
    if choice == "allow":
        return _Verdict(run=True)
    return _Verdict(run=False, message=DENIED_RESULT)


def call_id_of(call: ToolCall) -> str:
    call_id = call.get("id")
    return call_id if isinstance(call_id, str) and call_id != "" else ""


def unanswered_calls(messages: Sequence[BaseMessage]) -> list[ToolCall]:
    """Tool calls of the newest reply that have no result after it.

    Providers refuse a history where a tool call has no result. A run that
    stopped between the reply and its results leaves exactly that.
    """
    answered: set[str] = set()
    for message in reversed(messages):
        if isinstance(message, ToolMessage):
            answered.add(message.tool_call_id)
            continue
        if isinstance(message, AIMessage):
            return [call for call in message.tool_calls if call_id_of(call) not in answered]
        return []
    return []


def cancelled_results(calls: Sequence[ToolCall]) -> list[ToolMessage]:
    return [_result(call_id_of(call), call["name"], CANCELLED_RESULT, error=True) for call in calls]


def _result(call_id: str, name: str, content: str, *, error: bool = False) -> ToolMessage:
    return ToolMessage(
        content=content,
        tool_call_id=call_id,
        name=name,
        id=f"t_{call_id}",
        status="error" if error else "success",
    )


def _allowed(config: RunnableConfig) -> set[str]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(ALLOWED_KEY)
    if not isinstance(raw, list | tuple):
        return set()
    return {item for item in cast(Sequence[object], raw) if isinstance(item, str)}


def _root(config: RunnableConfig) -> Path | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return Path(raw) if isinstance(raw, str) and raw != "" else None


__all__ = [
    "ALLOWED_KEY",
    "CANCELLED_RESULT",
    "CWD_KEY",
    "DENIED_RESULT",
    "PREVIEW_CHARS",
    "call_id_of",
    "cancelled_results",
    "tools_node",
    "unanswered_calls",
]
