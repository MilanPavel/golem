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
from golem.tools.registry import (
    Artifacts,
    Preview,
    ToolContext,
    ToolError,
    ToolRegistry,
    ToolScope,
)

log = logging.getLogger("golem.graphs")

CWD_KEY = "golem_cwd"
"""``configurable`` key for the session folder. It is not checkpointed."""

ALLOWED_KEY = "golem_allowed_tools"
"""``configurable`` key for the ``[tool, subject]`` pairs allowed for the rest of the session."""

ASKED_KEY = "golem_asked_calls"
"""``configurable`` key for the call ids this run has already asked about, in order."""

MCP_KEY = "golem_mcp_servers"
"""``configurable`` key for the on-demand MCP servers the session turned on."""

PREVIEW_CHARS = 4_000

ARTIFACT_CHARS = 20_000
"""Output longer than this goes to an artifact, and the model gets its head and tail."""
HEAD_CHARS = 12_000
TAIL_CHARS = 4_000
CUT_CHARS = 100_000
"""Without an artifact store, what the model gets of one call at most."""

STATE_KEYS = frozenset({"todos"})
"""Graph state a tool may change through ``ToolResult.update``. Anything else is dropped."""

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
    artifacts: Artifacts | None = None,
) -> Callable[[AgentState, RunnableConfig], Awaitable[dict[str, object]]]:
    async def tools(state: AgentState, config: RunnableConfig) -> dict[str, object]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage):
            return {"messages": []}
        session_tools = registry.scoped(scope_of(config))
        session_id = state.get("session_id")
        base = ToolContext(
            root=_root(config),
            shell=policy.shell(),
            web=policy.web(),
            session_id=session_id,
            artifacts=artifacts,
            read_roots=tuple(Path(folder) for folder in state.get("skill_folders") or []),
        )
        allowed = _allowed(config)
        asked = _asked(config)
        ids = [call_id_of(call) for call in last.tool_calls]
        last_asked = max(
            (index for index, call_id in enumerate(ids) if call_id in asked), default=-1
        )
        planned: dict[Path, str] = {}
        verdicts: list[_Verdict] = []
        for index, call in enumerate(last.tool_calls):
            if session_tools.get(call["name"]) is None:
                verdicts.append(_Verdict(run=False, message=unavailable(call["name"])))
                continue
            preview = await _preview(session_tools, call, replace(base, planned=dict(planned)))
            verdict = _decide(
                session_tools,
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
                preview = await _preview(
                    session_tools, edited, replace(base, planned=dict(planned))
                )
            if verdict.run and isinstance(preview, Preview):
                planned[preview.path] = preview.after
            verdicts.append(verdict)
        write = get_stream_writer()
        results: list[BaseMessage] = []
        updates: dict[str, object] = {}
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
                result = await session_tools.call(call["name"], args, ctx)
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
            tool = session_tools.get(call["name"])
            kind = "untrusted" if tool is not None and tool.untrusted else "tool_output"
            output, artifact_id = await _for_model(
                artifacts, session_id, call_id, result.output, kind
            )
            preview = result.output[:PREVIEW_CHARS]
            write(
                {
                    STREAM_KEY: "tool.completed",
                    "call_id": call_id,
                    "summary": result.summary,
                    "preview": preview,
                    "truncated": len(preview) < len(result.output),
                    "artifact_id": artifact_id,
                }
            )
            if verdict.args is not None:
                output = _edited(verdict.args, output)
            results.append(_result(call_id, call["name"], output))
            changed = {k: v for k, v in (result.update or {}).items() if k in STATE_KEYS}
            if "todos" in changed:
                write({STREAM_KEY: "todos.updated", "call_id": call_id, "todos": changed["todos"]})
            updates.update(changed)
        return {"messages": results, **updates}

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
    if decision.action == "deny" and answer.decision != "deny":
        log.info("tool %s denied by %s after it was approved", name, decision.source)
        return _Verdict(run=False, message=explain(decision, name))
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


async def _for_model(
    artifacts: Artifacts | None,
    session_id: str | None,
    call_id: str,
    output: str,
    kind: str = "tool_output",
) -> tuple[str, str | None]:
    """What the model reads of ``output``, and the artifact that holds all of it.

    Long output is stored whole, and the model gets its head and its tail,
    where a failing command prints the part that matters.
    """
    if len(output) <= ARTIFACT_CHARS:
        return output, None
    if artifacts is None or session_id is None:
        if len(output) <= CUT_CHARS:
            return output, None
        return f"{output[:CUT_CHARS]}\n[output cut at {CUT_CHARS} characters]", None
    artifact_id = await artifacts.put(session_id, call_id, kind, output)
    skipped = len(output) - HEAD_CHARS - TAIL_CHARS
    note = (
        f"[{skipped} characters cut; the whole output is {len(output)} characters in artifact "
        f"{artifact_id}. Read it with read_artifact(artifact_id, offset, limit).]"
    )
    return f"{output[:HEAD_CHARS]}\n{note}\n{output[-TAIL_CHARS:]}", artifact_id


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


def unavailable(name: str) -> str:
    """Why a call to a tool the session does not have did not run."""
    if name.startswith("mcp__"):
        server = name.removeprefix("mcp__").split("__", 1)[0]
        return (
            f"{name} is not available in this session: the MCP server {server} is not "
            f"running, or not enabled here (/mcp enable {server})"
        )
    return f"unknown tool {name!r}"


def scope_of(config: RunnableConfig) -> ToolScope:
    """The outside tools this run's session sees: its folder and its enabled servers."""
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(MCP_KEY)
    names = cast(Sequence[object], raw) if isinstance(raw, list | tuple) else ()
    return ToolScope(
        root=_root(config), enabled=frozenset(name for name in names if isinstance(name, str))
    )


def _root(config: RunnableConfig) -> Path | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return Path(raw) if isinstance(raw, str) and raw != "" else None


__all__ = [
    "ALLOWED_KEY",
    "ARTIFACT_CHARS",
    "ASKED_KEY",
    "CANCELLED_RESULT",
    "CHANGED_RESULT",
    "CWD_KEY",
    "DENIED_RESULT",
    "MCP_KEY",
    "PREVIEW_CHARS",
    "STATE_KEYS",
    "Answer",
    "call_id_of",
    "cancelled_results",
    "scope_of",
    "tools_node",
    "unanswered_calls",
    "unavailable",
]
