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

LangGraph hands the answers back in the order the interrupts were made. A
rule written while the run waited ("always allow") must not change that
order, so a call that was already asked about (``ASKED_KEY``, from the run's
events) asks again and gets its stored answer, whatever the rules say now.
A call before the last asked one that would ask only because the rules
changed is refused, rather than asked out of turn.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import cast

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.types import interrupt

from golem.graphs.adapter import APPROVAL_KIND, STREAM_KEY
from golem.graphs.state import AgentState
from golem.permissions.engine import Allowance, session_allows
from golem.permissions.policy import Policy, describe, explain
from golem.tools.registry import Preview, ToolContext, ToolError, ToolRegistry

log = logging.getLogger("golem.graphs")

CWD_KEY = "golem_cwd"
"""``configurable`` key for the session folder. It is not checkpointed."""

ALLOWED_KEY = "golem_allowed_tools"
"""``configurable`` key for the ``[tool, subject]`` pairs allowed for the rest of the session."""

ASKED_KEY = "golem_asked_calls"
"""``configurable`` key for the call ids this run has already asked about, in order."""

PREVIEW_CHARS = 4_000

CANCELLED_RESULT = "cancelled: the run stopped before this tool call finished"
DENIED_RESULT = "the user denied this tool call"
CHANGED_RESULT = "the rules changed while the run waited, so this call did not run"


@dataclass(frozen=True, slots=True)
class _Verdict:
    """Whether a call runs. ``approved_diff`` is the change the user approved for it.

    ``args`` are the arguments the user edited the call to, which it runs with.
    """

    run: bool
    message: str = ""
    approved_diff: str | None = None
    args: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class Answer:
    """The user's answer to one approval, as the interrupt gets it back.

    ``diff`` is the change the user was shown, read from ``approval.needed``.
    ``args`` are the arguments the user edited the call to, when they did.
    """

    decision: str
    diff: str | None = None
    args: dict[str, object] | None = None

    def to_resume(self) -> dict[str, object]:
        return {"decision": self.decision, "diff": self.diff, "args": self.args}

    @staticmethod
    def parse(raw: object) -> Answer:
        if not isinstance(raw, dict):
            return Answer(decision="deny")
        value = cast(dict[str, object], raw)
        decision, diff, args = value.get("decision"), value.get("diff"), value.get("args")
        return Answer(
            decision=decision if isinstance(decision, str) else "deny",
            diff=diff if isinstance(diff, str) else None,
            args=dict(cast(dict[str, object], args)) if isinstance(args, dict) else None,
        )


def tools_node(
    registry: ToolRegistry,
    policy: Policy,
) -> Callable[[AgentState, RunnableConfig], Awaitable[dict[str, list[BaseMessage]]]]:
    async def tools(state: AgentState, config: RunnableConfig) -> dict[str, list[BaseMessage]]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage):
            return {"messages": []}
        base = ToolContext(root=_root(config), shell=policy.shell())
        allowed = _allowed(config)
        asked = _asked(config)
        ids = [call_id_of(call) for call in last.tool_calls]
        last_asked = max(
            (index for index, call_id in enumerate(ids) if call_id in asked), default=-1
        )
        planned: dict[Path, str] = {}
        verdicts: list[_Verdict] = []
        for index, call in enumerate(last.tool_calls):
            preview = await _preview(registry, call, replace(base, planned=dict(planned)))
            verdict = _decide(
                registry,
                policy,
                call,
                base,
                allowed,
                last.id,
                preview,
                asked=ids[index] in asked,
                before_last_asked=index < last_asked,
            )
            if verdict.run and verdict.args is not None:
                edited = cast(ToolCall, {**call, "args": verdict.args})
                preview = await _preview(registry, edited, replace(base, planned=dict(planned)))
            if verdict.run and isinstance(preview, Preview):
                planned[preview.path] = preview.after
            verdicts.append(verdict)
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
            ctx = replace(
                base, output=_streamer(write, call_id), approved_diff=verdict.approved_diff
            )
            args = call["args"] if verdict.args is None else verdict.args
            try:
                result = await registry.call(call["name"], args, ctx)
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
            output = result.output if verdict.args is None else _edited(verdict.args, result.output)
            results.append(_result(call_id, call["name"], output))
        return {"messages": results}

    return tools


def _decide(
    registry: ToolRegistry,
    policy: Policy,
    call: ToolCall,
    ctx: ToolContext,
    allowed: set[Allowance],
    message_id: str | None,
    preview: Preview | str | None,
    *,
    asked: bool,
    before_last_asked: bool,
) -> _Verdict:
    """``preview`` is what the call would change, or why it cannot, or None."""
    name = call["name"]
    subject = describe(registry, name, call["args"], ctx.root).subject
    decision = policy.check(registry, name, call["args"], ctx.root)
    if not asked:
        if decision.allowed:
            return _Verdict(run=True)
        if decision.action == "deny":
            log.info("tool %s denied by %s", name, decision.source)
            return _Verdict(run=False, message=explain(decision, name))
        if session_allows(allowed, name, subject):
            return _Verdict(run=True)
        if before_last_asked:
            return _Verdict(run=False, message=CHANGED_RESULT)
        if isinstance(preview, str):
            return _Verdict(run=False, message=preview)
    answer = Answer.parse(
        interrupt(
            {
                STREAM_KEY: APPROVAL_KIND,
                "call_id": call_id_of(call),
                "message_id": message_id,
                "name": name,
                "args": dict(call["args"]),
                "source": decision.source,
                "subject": subject,
                "diff": preview.diff if isinstance(preview, Preview) else None,
            }
        )
    )
    if answer.decision == "allow_session":
        allowed.add((name, subject))
        return _Verdict(run=True, approved_diff=answer.diff)
    if answer.decision == "allow" and answer.args is not None:
        return _Verdict(run=True, args=answer.args)
    if answer.decision in ("allow", "allow_always"):
        return _Verdict(run=True, approved_diff=answer.diff)
    return _Verdict(run=False, message=DENIED_RESULT)


async def _preview(
    registry: ToolRegistry, call: ToolCall, ctx: ToolContext
) -> Preview | str | None:
    """What ``call`` would change, the reason it cannot run, or None for a tool without one."""
    try:
        return await registry.preview(call["name"], call["args"], ctx)
    except ToolError as exc:
        return str(exc) or type(exc).__name__


def _edited(args: Mapping[str, object], output: str) -> str:
    edited = json.dumps(args, ensure_ascii=False)
    return f"note: the user edited the arguments before it ran: {edited}\n\n{output}"


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


def _streamer(write: Callable[[object], None], call_id: str) -> Callable[[str], None]:
    def output(text: str) -> None:
        if text:
            write({STREAM_KEY: "tool.output", "call_id": call_id, "text": text})

    return output


def _allowed(config: RunnableConfig) -> set[Allowance]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(ALLOWED_KEY)
    if not isinstance(raw, list | tuple):
        return set()
    found: set[Allowance] = set()
    for item in cast(Sequence[object], raw):
        if isinstance(item, list | tuple) and len(cast(Sequence[object], item)) == 2:
            tool, subject = cast(Sequence[object], item)
            if isinstance(tool, str) and (subject is None or isinstance(subject, str)):
                found.add((tool, subject))
    return found


def _asked(config: RunnableConfig) -> set[str]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(ASKED_KEY)
    if not isinstance(raw, list | tuple):
        return set()
    return {item for item in cast(Sequence[object], raw) if isinstance(item, str)}


def _root(config: RunnableConfig) -> Path | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return Path(raw) if isinstance(raw, str) and raw != "" else None


__all__ = [
    "ALLOWED_KEY",
    "ASKED_KEY",
    "CANCELLED_RESULT",
    "CHANGED_RESULT",
    "CWD_KEY",
    "DENIED_RESULT",
    "PREVIEW_CHARS",
    "Answer",
    "call_id_of",
    "cancelled_results",
    "tools_node",
    "unanswered_calls",
]
