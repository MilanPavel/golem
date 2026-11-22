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

A permitted ``delegate`` starts its helpers in the first pass (the host finds them again when this
node starts over, so nothing starts twice). After the last approval the node parks the run with
one more ``interrupt()`` while any helper has not ended. The wake is a plain answer: pass 1 then
finds every helper ended and does not interrupt, and pass 2 builds the result from their logs.
Parks come last, so they never change which answer belongs to which approval.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Literal, Protocol, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.types import interrupt
from pydantic import ValidationError

from golem.config import PERMISSION_MODES, PermissionMode
from golem.graphs.adapter import (
    APPROVAL_KIND,
    FILE_CHANGED_KIND,
    HELPERS_KIND,
    PLAN_PROPOSED_KIND,
    SKILL_LOADED_KIND,
    STREAM_KEY,
)
from golem.graphs.child import ChildLimits
from golem.graphs.notes import is_note
from golem.graphs.result_budget import DEFAULT_BUDGET, ResultBudget
from golem.graphs.state import AgentState
from golem.memory.privacy import Target
from golem.memory.service import MemoryAccess
from golem.models.tiers import Tier
from golem.permissions.engine import Allowance, session_allows
from golem.permissions.policy import Policy, describe, explain
from golem.skills.registry import SkillRegistry
from golem.tools.delegate import (
    DelegateArgs,
    HelperOutcome,
    HelperSpec,
    results_summary,
    results_text,
)
from golem.tools.registry import (
    Artifacts,
    InvalidArguments,
    Preview,
    ToolContext,
    ToolError,
    ToolRegistry,
    ToolResult,
    ToolScope,
)

log = logging.getLogger("golem.graphs")

CWD_KEY = "golem_cwd"
PINNED_FOLDERS_KEY = "golem_pinned_folders"
"""The ``configurable`` key with the folders of the session's pinned skills, for the read tools."""
"""``configurable`` key for the session folder. It is not checkpointed."""

ALLOWED_KEY = "golem_allowed_tools"
MODE_KEY = "golem_permission_mode"
PLAN_KEY = "golem_plan_first"
"""``configurable`` key for whether the session is in plan first: its runs only read."""

PLAN_REFUSAL = "plan first is on: this run only reads. End with propose_plan."
"""``configurable`` key for the ``[tool, subject]`` pairs allowed for the rest of the session."""

ASKED_KEY = "golem_asked_calls"
"""``configurable`` key for the call ids this run has already asked about, in order."""

MCP_KEY = "golem_mcp_servers"
"""``configurable`` key for the on-demand MCP servers the session turned on."""

MCP_NOW_KEY = "golem_mcp_now"
"""``configurable`` key for a set the model's ``mcp_enable`` adds to during one run, so the
servers it turned on are in scope for the next model call before the session list is read again."""

CHILD_KEY = "golem_child"
"""``configurable`` key of a child run, with its :class:`ChildScope`. Absent in a session's run."""

LOCAL_ONLY_KEY = "golem_local_only"
"""``configurable`` key for whether the session stays on this Mac, for the helper's model."""

MEMORY_KEY = "golem_memory"
"""``configurable`` key for the run's :class:`MemoryAccess`. Absent when memory is off, and in
a run that resumed after a tool approval or a step-up."""

HELPERS_DONE = "helpers_done"
"""The ``decision`` of the answer that wakes a lead parked for its helpers."""

NO_ASK_REFUSAL = "a helper cannot ask for approval: this call needs it"


@dataclass(frozen=True, slots=True)
class ChildScope:
    """What marks a run as a child run: its tools, and the model calls before it must answer."""

    tools: frozenset[str]
    max_calls: int
    asks: bool = False
    """Whether the helper may ask you, as a helper session of an agent that has ``asks``."""
    prompt: str = ""
    """The helper's whole system prompt: the body of its agent file."""
    granted: Callable[[], Iterable[Allowance]] | None = field(default=None, compare=False)
    """What the helper's session allows now, read again at each tool step. A batch answer
    (``approval.respond`` with ``scope: "batch"``) reaches a helper that is still running
    through it, so the helper does not ask for what you allowed."""
    spent: Callable[[], Awaitable[bool]] | None = field(default=None, compare=False)
    """Whether the helper has reached its cost or token limit, read from its stored events
    before each model call. When it has, the call is the last one: it answers without tools."""


class HelperHost(Protocol):
    """What starts helper sessions and reads how they ended. The session manager has it."""

    async def start_helpers(
        self,
        *,
        state: AgentState,
        config: RunnableConfig,
        call_id: str,
        helpers: Sequence[HelperSpec],
    ) -> None:
        """Start the helpers of the ``delegate`` call ``call_id``, or find them again.

        Idempotent for one call. Refuses what the manager refuses, such as a helper of a helper,
        by raising :class:`ToolError` with a message the model can read.
        """
        ...

    async def helpers_ended(self, session_id: str, call_id: str) -> bool:
        """Whether every helper of the call has ended."""
        ...

    async def helper_results(self, session_id: str, call_id: str) -> list[HelperOutcome]:
        """How each helper of the call ended, in the order of the call."""
        ...


class ChildHost(HelperHost, Protocol):
    """What the tools node needs to start a helper. The chat runtime has it."""

    @property
    def child_limits(self) -> ChildLimits: ...


EnableMcp = Callable[[str, ToolScope, str], Awaitable[list[str]]]
"""``(session_id, scope, name)``: turns the on-demand server on for the session, waits until it
runs, and returns its tool names. Raises :class:`ToolError` when it cannot."""

PREVIEW_CHARS = 4_000

ARTIFACT_CHARS = DEFAULT_BUDGET.artifact_chars
"""Output longer than this goes to an artifact, for a 32K window or an unknown one."""
CUT_CHARS = 100_000
"""Without an artifact store, what the model gets of one call at most, for the default budget."""

BudgetOf = Callable[[AgentState, RunnableConfig], ResultBudget]
"""The budget for one tool result, from the window of the model that will read it."""

STATE_KEYS = frozenset({"todos", "skill_folders"})
"""Graph state a tool may change through ``ToolResult.update``. Anything else is dropped."""

ERROR_KEY = "golem_error"
"""``additional_kwargs`` key on a failed ``ToolMessage``: why the call did not give a result."""

MEMORY_IDS_KEY = "golem_memory_ids"
"""``additional_kwargs`` key on a ``recall`` result: the ids of the memories it shows, in order."""

ErrorKind = Literal["invalid_args", "unknown_tool", "tool_error", "denied", "cancelled"]

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
    kind: ErrorKind = "tool_error"
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
    def helpers_done() -> Answer:
        """The wake of a lead parked for its helpers. The node ignores what it says."""
        return Answer(decision=HELPERS_DONE)

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
    enable_mcp: Callable[[], EnableMcp | None] = lambda: None,
    skills: Callable[[], SkillRegistry | None] = lambda: None,
    budget_of: BudgetOf | None = None,
    children: Callable[[], ChildHost | None] = lambda: None,
    tier_of: Callable[[str], Tier | None] | None = None,
) -> Callable[[AgentState, RunnableConfig], Awaitable[dict[str, object]]]:
    async def tools(state: AgentState, config: RunnableConfig) -> dict[str, object]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage):
            return {"messages": []}
        budget = DEFAULT_BUDGET if budget_of is None else budget_of(state, config)
        session_tools = registry.scoped(scope_of(config))
        session_id = state.get("session_id")
        enabler = enable_mcp()

        async def enable_here(name: str) -> list[str]:
            assert enabler is not None and session_id is not None
            names = await enabler(session_id, scope_of(config), name)
            now = cast(Mapping[str, object], config.get("configurable", {})).get(MCP_NOW_KEY)
            if isinstance(now, set):
                cast(set[str], now).add(name)
            return names

        skill_registry = skills()
        root = _root(config)
        base = ToolContext(
            root=root,
            shell=policy.shell(),
            web=policy.web(),
            session_id=session_id,
            artifacts=artifacts,
            read_roots=_read_roots(state, config),
            enable_mcp=enable_here if enabler is not None and session_id else None,
            skills=None if skill_registry is None else skill_registry.view(root),
            page_chars=budget.page_chars,
            memory=None if child_of(config) is not None else _memory_for(state, config, tier_of),
            memory_target=_target(state, tier_of),
        )
        allowed = _allowed(config)
        mode = _mode(config)
        plan_first = _plan_first(config)
        child = child_of(config)
        if child is not None and child.granted is not None:
            allowed |= set(child.granted())
        helper = child is not None
        never_ask = child is not None and not child.asks
        host = children()
        parking = host is not None and not helper and bool(session_id)
        parked: list[str] = []
        delegated = _delegated_this_turn(state["messages"])
        asked = _asked(config)
        ids = [call_id_of(call) for call in last.tool_calls]
        last_asked = max(
            (index for index, call_id in enumerate(ids) if call_id in asked), default=-1
        )
        planned: dict[Path, str] = {}
        verdicts: list[_Verdict] = []
        for index, call in enumerate(last.tool_calls):
            if session_tools.get(call["name"]) is None:
                verdicts.append(
                    _Verdict(run=False, message=unavailable(call["name"]), kind="unknown_tool")
                )
                continue
            if plan_first and not session_tools.plan_allows(call["name"]):
                verdicts.append(_Verdict(run=False, message=PLAN_REFUSAL, kind="denied"))
                continue
            if not plan_first and (called := session_tools.get(call["name"])) and called.plan_only:
                message = f"{call['name']} is only for a plan first run"
                verdicts.append(_Verdict(run=False, message=message, kind="denied"))
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
                mode,
                asked=ids[index] in asked,
                before_last_asked=index < last_asked,
                never_ask=never_ask,
            )
            if verdict.run and verdict.args is not None:
                edited = cast(ToolCall, {**call, "args": verdict.args})
                preview = await _preview(
                    session_tools, edited, replace(base, planned=dict(planned))
                )
            if verdict.run and isinstance(preview, Preview):
                planned[preview.path] = preview.after
            if verdict.run and parking and call["name"] == "delegate":
                # Only a call the policy lets through starts helpers.
                assert host is not None
                try:
                    specs = _specs(call if verdict.args is None else {**call, "args": verdict.args})
                    if delegated >= host.child_limits.max_per_turn:
                        raise ToolError(NO_MORE_HELPERS)
                    await host.start_helpers(
                        state=state, config=config, call_id=ids[index], helpers=specs
                    )
                except InvalidArguments as exc:
                    verdict = _Verdict(run=False, message=str(exc), kind="invalid_args")
                except ToolError as exc:
                    message = str(exc) or type(exc).__name__
                    verdict = _Verdict(run=False, message=message, kind="denied")
                else:
                    delegated += 1
                    parked.append(ids[index])
            verdicts.append(verdict)
        if parked:
            assert host is not None and session_id is not None
            while not all([await host.helpers_ended(session_id, c) for c in parked]):
                interrupt({STREAM_KEY: HELPERS_KIND, "call_ids": list(parked)})
        write = get_stream_writer()
        results: list[BaseMessage] = []
        updates: dict[str, object] = {}
        for call, verdict in zip(last.tool_calls, verdicts, strict=True):
            call_id = call_id_of(call)
            if not verdict.run:
                write({STREAM_KEY: "tool.failed", "call_id": call_id, "message": verdict.message})
                results.append(
                    _result(call_id, call["name"], f"error: {verdict.message}", error=verdict.kind)
                )
                continue
            started = time.monotonic()
            if call_id in parked:
                # The manager stored tool.started when it started the helpers.
                assert host is not None and session_id is not None
                ended = await host.helper_results(session_id, call_id)
                result = ToolResult(output=results_text(ended), summary=results_summary(ended))
            else:
                write({STREAM_KEY: "tool.started", "call_id": call_id})
                output = _streamer(write, call_id)
                ctx = replace(base, output=output, approved_diff=verdict.approved_diff)
                args = call["args"] if verdict.args is None else verdict.args
                try:
                    result = await session_tools.call(call["name"], args, ctx)
                except ToolError as exc:
                    message = str(exc) or type(exc).__name__
                    write(_failure(call_id, message, started))
                    failure: ErrorKind = (
                        "invalid_args"
                        if isinstance(exc, InvalidArguments)
                        else (
                            "unknown_tool" if message.startswith("unknown tool") else "tool_error"
                        )
                    )
                    results.append(
                        _result(call_id, call["name"], f"error: {message}", error=failure)
                    )
                    continue
                except Exception as exc:
                    log.exception("tool %s failed", call["name"])
                    message = f"{type(exc).__name__}: {exc}"
                    write(_failure(call_id, message, started))
                    results.append(
                        _result(call_id, call["name"], f"error: {message}", error="tool_error")
                    )
                    continue
            duration_ms = _ms(started)
            tool = session_tools.get(call["name"])
            kind = "untrusted" if tool is not None and tool.untrusted else "tool_output"
            output, artifact_id = await _for_model(
                artifacts, session_id, call_id, result.output, kind, budget
            )
            for edit in result.edits:
                write(
                    {
                        STREAM_KEY: FILE_CHANGED_KIND,
                        "call_id": call_id,
                        "path": edit.path,
                        "before": edit.before,
                        "after": edit.after,
                        "source": edit.source,
                    }
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
                    "failed": result.failed,
                    "duration_ms": duration_ms,
                    "diff": result.diff,
                    "sources": [
                        {"url": s.url, "title": s.title, "snippet": s.snippet, "kind": s.kind}
                        for s in result.sources
                    ],
                }
            )
            if verdict.args is not None:
                output = _edited(verdict.args, output)
            results.append(_result(call_id, call["name"], output, memory_ids=result.memory_ids))
            changed = {k: v for k, v in (result.update or {}).items() if k in STATE_KEYS}
            if "todos" in changed:
                write({STREAM_KEY: "todos.updated", "call_id": call_id, "todos": changed["todos"]})
            plan = (result.update or {}).get("plan")
            if isinstance(plan, dict):
                write({STREAM_KEY: PLAN_PROPOSED_KIND, "call_id": call_id, **plan})
            activated = (result.update or {}).get("skill_activated")
            if isinstance(activated, dict):
                write({STREAM_KEY: SKILL_LOADED_KIND, "call_id": call_id, **activated})
            if "skill_folders" in changed:
                folders = cast(list[str], changed["skill_folders"])
                base = replace(base, read_roots=(*base.read_roots, *map(Path, folders)))
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
    mode: PermissionMode | None,
    *,
    asked: bool,
    before_last_asked: bool,
    never_ask: bool = False,
) -> _Verdict:
    """``preview`` is what the call would change, or why it cannot, or None."""
    name = call["name"]
    subject = describe(registry, name, call["args"], ctx.root).subject
    decision = policy.check(registry, name, call["args"], ctx.root, mode)
    if not asked:
        if decision.allowed:
            return _Verdict(run=True)
        if decision.action == "deny":
            log.info("tool %s denied by %s", name, decision.source)
            return _Verdict(run=False, message=explain(decision, name), kind="denied")
        if never_ask:
            return _Verdict(run=False, message=NO_ASK_REFUSAL, kind="denied")
        if session_allows(allowed, name, subject):
            return _Verdict(run=True)
        if before_last_asked:
            return _Verdict(run=False, message=CHANGED_RESULT, kind="denied")
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
        return _Verdict(run=False, message=explain(decision, name), kind="denied")
    if answer.decision == "allow_session":
        allowed.add((name, subject))
        return _Verdict(run=True, approved_diff=answer.diff)
    if answer.decision == "allow" and answer.args is not None:
        return _Verdict(run=True, args=answer.args)
    if answer.decision in ("allow", "allow_always"):
        return _Verdict(run=True, approved_diff=answer.diff)
    return _Verdict(run=False, message=DENIED_RESULT, kind="denied")


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
    budget: ResultBudget = DEFAULT_BUDGET,
) -> tuple[str, str | None]:
    """What the model reads of ``output``, and the artifact that holds all of it.

    Long output is stored whole, and the model gets its head and its tail,
    where a failing command prints the part that matters. ``budget`` follows the window.
    """
    if len(output) <= budget.artifact_chars:
        return output, None
    if artifacts is None or session_id is None:
        cut = min(CUT_CHARS, budget.artifact_chars * 5)
        if len(output) <= cut:
            return output, None
        return f"{output[:cut]}\n[output cut at {cut} characters]", None
    artifact_id = await artifacts.put(session_id, call_id, kind, output)
    skipped = len(output) - budget.head_chars - budget.tail_chars
    note = (
        f"[{skipped} characters cut; the whole output is {len(output)} characters in artifact "
        f"{artifact_id}. Read it with read_artifact(artifact_id, offset, limit).]"
    )
    return f"{output[: budget.head_chars]}\n{note}\n{output[-budget.tail_chars :]}", artifact_id


def _ms(started: float) -> int:
    """Milliseconds since ``started``, a ``time.monotonic()`` reading."""
    return round((time.monotonic() - started) * 1000)


def _failure(call_id: str, message: str, started: float) -> dict[str, object]:
    return {
        STREAM_KEY: "tool.failed",
        "call_id": call_id,
        "message": message,
        "duration_ms": _ms(started),
    }


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
    return [
        _result(call_id_of(call), call["name"], CANCELLED_RESULT, error="cancelled")
        for call in calls
    ]


def _result(
    call_id: str,
    name: str,
    content: str,
    *,
    error: ErrorKind | None = None,
    memory_ids: tuple[str, ...] | None = None,
) -> ToolMessage:
    extra: dict[str, object] = {} if error is None else {ERROR_KEY: error}
    if memory_ids is not None:
        extra[MEMORY_IDS_KEY] = list(memory_ids)
    return ToolMessage(
        content=content,
        tool_call_id=call_id,
        name=name,
        id=f"t_{call_id}",
        status="success" if error is None else "error",
        additional_kwargs=extra,
    )


NO_MORE_HELPERS = "no more helpers in this turn; continue with what you have"


def _delegated_this_turn(messages: Sequence[BaseMessage]) -> int:
    """How many ``delegate`` calls got a result since the last message of the user.

    A note golem adds in a run is not the user speaking, so it does not start a new count.
    """
    found = 0
    for message in reversed(messages):
        if isinstance(message, HumanMessage) and not is_note(message):
            break
        if isinstance(message, ToolMessage) and message.name == "delegate":
            found += 1
    return found


def _specs(call: ToolCall) -> list[HelperSpec]:
    """The helpers a ``delegate`` call asks for. Bad arguments raise :class:`InvalidArguments`."""
    raw = dict(call["args"])
    if raw.get("agent") in (None, ""):
        # No type named: the host answers with the types the session may use.
        brief = raw.get("brief")
        return [HelperSpec(agent="", brief=brief if isinstance(brief, str) else "")]
    try:
        args = DelegateArgs.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"])
        said = first["msg"].removeprefix("Value error, ")
        message = f"invalid arguments for delegate: {exc.error_count()} problem(s); {field}: {said}"
        raise InvalidArguments(message) from exc
    return [HelperSpec(agent=args.agent, brief=args.brief, model=args.model)]


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


def _mode(config: RunnableConfig) -> PermissionMode | None:
    """The session's permission mode override, or None to follow ``config.toml``."""
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(MODE_KEY)
    return next((mode for mode in PERMISSION_MODES if mode == raw), None)


def _plan_first(config: RunnableConfig) -> bool:
    """Whether the session is in plan first."""
    return cast(Mapping[str, object], config.get("configurable", {})).get(PLAN_KEY) is True


def _asked(config: RunnableConfig) -> set[str]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(ASKED_KEY)
    if not isinstance(raw, list | tuple):
        return set()
    return {item for item in cast(Sequence[object], raw) if isinstance(item, str)}


def unavailable(name: str) -> str:
    """Why a call to a tool the session does not have did not run."""
    if name in ("recall", "remember"):
        return f"{name} is not available in this run: memory is off"
    if name.startswith("mcp__"):
        server = name.removeprefix("mcp__").split("__", 1)[0]
        return (
            f"{name} is not available in this session: the MCP server {server} is not "
            f"running, or not enabled here (/mcp enable {server})"
        )
    return f"unknown tool {name!r}"


def child_of(config: RunnableConfig) -> ChildScope | None:
    """The scope of a child run, or None for a session's own run."""
    raw = cast(Mapping[str, object], config.get("configurable", {})).get(CHILD_KEY)
    return raw if isinstance(raw, ChildScope) else None


def memory_of(config: RunnableConfig) -> MemoryAccess | None:
    raw = cast(Mapping[str, object], config.get("configurable", {})).get(MEMORY_KEY)
    return raw if isinstance(raw, MemoryAccess) else None


def _memory_for(
    state: AgentState, config: RunnableConfig, tier_of: Callable[[str], Tier | None] | None
) -> MemoryAccess | None:
    """The run's access, with the chat's ``model_local`` set to the model of this call.

    The run may have started on a local model and moved to a hosted one, so the value the
    manager built it with is not the call's.
    """
    access = memory_of(config)
    if access is None:
        return None
    local = _target(state, tier_of).local
    return replace(access, chat=replace(access.chat, model_local=local))


def _target(state: AgentState, tier_of: Callable[[str], Tier | None] | None) -> Target:
    """The model of this call. One whose tier is unknown counts as hosted."""
    profile = state.get("model_profile")
    tier = None if tier_of is None or not profile else tier_of(profile)
    return Target(local=tier == "local")


def scope_of(config: RunnableConfig) -> ToolScope:
    """The outside tools this run's session sees: its folder and its enabled servers.

    A child run sees only its own fixed tools.
    """
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    child = child_of(config)
    if child is not None:
        return ToolScope(root=_root(config), only=child.tools)
    raw = configurable.get(MCP_KEY)
    names = list(cast(Sequence[object], raw)) if isinstance(raw, list | tuple) else []
    now = configurable.get(MCP_NOW_KEY)
    if isinstance(now, set):
        names.extend(cast(set[object], now))
    return ToolScope(
        root=_root(config),
        enabled=frozenset(name for name in names if isinstance(name, str)),
        memory=memory_of(config) is not None,
    )


def _root(config: RunnableConfig) -> Path | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return Path(raw) if isinstance(raw, str) and raw != "" else None


def _read_roots(state: AgentState, config: RunnableConfig) -> tuple[Path, ...]:
    """The folders of the skills this session ran, then those of its pins, once each."""
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(PINNED_FOLDERS_KEY)
    pinned = (
        [f for f in cast(list[object], raw) if isinstance(f, str)] if isinstance(raw, list) else []
    )
    folders = [*(state.get("skill_folders") or []), *pinned]
    return tuple(Path(folder) for folder in dict.fromkeys(folders))


__all__ = [
    "ALLOWED_KEY",
    "ARTIFACT_CHARS",
    "ASKED_KEY",
    "CANCELLED_RESULT",
    "CHANGED_RESULT",
    "CHILD_KEY",
    "CWD_KEY",
    "DENIED_RESULT",
    "ERROR_KEY",
    "HELPERS_DONE",
    "LOCAL_ONLY_KEY",
    "MCP_KEY",
    "MCP_NOW_KEY",
    "MEMORY_IDS_KEY",
    "MEMORY_KEY",
    "MODE_KEY",
    "NO_ASK_REFUSAL",
    "PINNED_FOLDERS_KEY",
    "PLAN_KEY",
    "PLAN_REFUSAL",
    "PREVIEW_CHARS",
    "STATE_KEYS",
    "Answer",
    "BudgetOf",
    "ChildHost",
    "ChildScope",
    "EnableMcp",
    "ErrorKind",
    "HelperHost",
    "call_id_of",
    "cancelled_results",
    "child_of",
    "memory_of",
    "scope_of",
    "tools_node",
    "unanswered_calls",
    "unavailable",
]
