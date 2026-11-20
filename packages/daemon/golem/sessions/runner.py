"""One chat turn: stream the graph and emit the run's events.

A turn may hold several model calls, with tool calls between them. Each
model call is its own assistant message. Each tool call is
``tool.requested``, ``tool.started``, then ``tool.completed`` or
``tool.failed``.

A tool call that needs approval pauses the run: ``approval.needed`` is the
last event, the task ends, and the run waits with no task at all, across a
TUI close or a daemon restart. :func:`resume_turn` starts a new task for the
same run with the answer: ``approval.resolved``, then the rest of the run.

A cancelled turn still ends in the log. The open reply completes with the
text streamed so far, marked interrupted, each tool call still open fails,
and ``run.cancelled`` follows.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping, Sequence
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from golem.coding.changes import ChangeStore, status_of
from golem.config import ModelPrice, PermissionMode
from golem.graphs.adapter import (
    ApprovalAsked,
    CheckCompleted,
    CheckOffered,
    CheckStarted,
    ChildFact,
    ConsentAsked,
    ContextChanged,
    FileChanged,
    HelpersParked,
    ModelRequested,
    ModelResponded,
    ModelRouted,
    ModelStarted,
    ModelWaiting,
    PinRead,
    PinSkipped,
    PlanProposed,
    SkillLoaded,
    TextCompleted,
    TextDelta,
    ThinkingDelta,
    TodosChanged,
    ToolErrored,
    ToolFinished,
    ToolOutput,
    ToolStarted,
    ToolWriting,
    Translator,
)
from golem.graphs.chat import ChatRuntime, Growth
from golem.graphs.step_up import Consent
from golem.graphs.tools_node import Answer, ChildScope
from golem.memory.service import MemoryAccess
from golem.models.cost import cost_usd
from golem.models.errors import ContextFull, ModelUnreachable
from golem.models.pick import Choice
from golem.models.privacy import LOCAL_ONLY_HINT
from golem.models.router import ModelConfigError, ModelIdentity
from golem.models.tiers import Tier
from golem.permissions.engine import Allowance
from golem.sessions.interrupted import close_reply
from golem.sessions.log import SessionLog
from golem.skills.invoke import Invocation
from golem.skills.pinned import PinMemory
from golem_protocol.events import (
    ApprovalDecision,
    ApprovalNeededData,
    ApprovalResolvedData,
    CallPrice,
    CheckCompletedData,
    CheckInfo,
    CheckOfferedData,
    CheckStartedData,
    ConsentAnswer,
    ContextChangedData,
    EmptyEventData,
    EventType,
    FileChangedData,
    HelperStartedEvent,
    HelperWaitData,
    MessageCompletedData,
    MessageDeltaData,
    MessageStartedData,
    MessageThinkingDeltaData,
    ModelCallCompletedData,
    ModelCallStartedData,
    ModelRejection,
    ModelRoutedData,
    ModelWaitingData,
    PlanProposedData,
    PromptSectionInfo,
    RouteConsentNeededData,
    RunCancelledData,
    RunFailedData,
    SkillActivatedData,
    SkillSkippedData,
    TodosUpdatedData,
    TokenUsage,
    ToolCompletedData,
    ToolFailedData,
    ToolOutputData,
    ToolRequestedData,
    ToolSource,
    ToolStartedData,
    ToolWritingData,
)

log = logging.getLogger("golem.sessions")

CancelReason = Literal["user", "shutdown"]

CANCELLED_TOOL = "cancelled before it finished"


@dataclass(frozen=True, slots=True)
class Turn:
    """What one ``message.send`` asked for, with the ids already chosen.

    ``text`` is what the model gets. For a skill invoked by name that is the
    skill's filled-in body, ``skill`` says which skill, and ``typed`` is what
    the user typed.
    """

    session_id: str
    run_id: str
    text: str
    model_profile: str
    schema_version: int
    user_message_id: str
    assistant_message_id: str
    cwd: str | None = None
    allowed_tools: tuple[Allowance, ...] = ()
    mcp_servers: tuple[str, ...] = ()
    pinned: tuple[str, ...] = ()
    pinned_folders: tuple[str, ...] = ()
    options: dict[str, float | str] = field(default_factory=dict[str, float | str], compare=False)
    permission_mode: PermissionMode | None = None
    checks: bool | None = None
    plan_first: bool = False
    local_only: bool = False
    pins: PinMemory = field(default_factory=PinMemory, compare=False)
    skill: Invocation | None = None
    typed: str | None = None
    routed: Choice | None = field(default=None, compare=False)
    """The pick for this turn, None on a ``pinned`` session. ``model_profile`` is its model."""
    begun: bool = False
    """The run has its user message and ``run.started`` already: it waited on a question."""
    growth: Growth | None = field(default=None, compare=False)
    """The window growth this turn's first call loads and reports, None when none."""
    step_up: bool = False
    """The run may move to a stronger model once (route ``auto``)."""
    replaces: str | None = None
    """The model whose answer the user asked to try again on a stronger one."""
    read_folders: tuple[str, ...] = ()
    """Folders the read tools may read from this turn on (a watch firing's folder)."""
    child: ChildScope | None = field(default=None, compare=False)
    """The scope of a helper session, from its record. None for any other session."""
    memory: MemoryAccess | None = field(default=None, compare=False)
    """What the run may use of long-term memory. None when memory is off, and for a helper."""


@dataclass(frozen=True, slots=True)
class Resume:
    """The answer to the tool call a run waits on, and what the run's events say about it.

    ``open_calls`` are the run's tool calls requested and not finished, and
    ``asked`` the ones it asked about, in order, this one included. ``rule``
    is the rule an ``allow_always`` wrote. ``diff`` is the change the user
    was shown, which is the only one the call may make. ``args`` are the
    arguments the user edited the call to.
    """

    session_id: str
    run_id: str
    call_id: str
    name: str
    decision: ApprovalDecision
    user_message_id: str | None
    open_calls: tuple[str, ...]
    consent: ConsentAnswer | None = None
    """Set when the run waits on the paid question of a struggling model, not on a tool call."""
    cwd: str | None = None
    allowed_tools: tuple[Allowance, ...] = ()
    asked: tuple[str, ...] = ()
    subject: str | None = None
    rule: str | None = None
    diff: str | None = None
    args: dict[str, object] | None = None
    mcp_servers: tuple[str, ...] = ()
    pinned: tuple[str, ...] = ()
    pinned_folders: tuple[str, ...] = ()
    options: dict[str, float | str] = field(default_factory=dict[str, float | str], compare=False)
    permission_mode: PermissionMode | None = None
    checks: bool | None = None
    plan_first: bool = False
    local_only: bool = False
    pins: PinMemory = field(default_factory=PinMemory, compare=False)
    child: ChildScope | None = field(default=None, compare=False)
    """The scope of a helper session, from its record. None for any other session."""
    go: Literal["answer", "wake", "continue"] = "answer"
    """What the run goes on with. ``answer``: the approval or consent above. ``wake``: a lead
    whose helpers have ended, which has no answer to give. ``continue``: the checkpoint with no
    input, for a helper run a restart cut off. The two last ignore ``call_id``, ``name`` and
    ``decision``."""
    memory: MemoryAccess | None = field(default=None, compare=False)
    """What the run may use of long-term memory. None when memory is off, and for a helper."""


@dataclass
class RunControl:
    """Shared by a run task and whoever may stop it.

    ``started`` is set once the task is inside its cancel handler. Cancel only
    after that, or the turn ends without ``run.cancelled``.
    """

    started: asyncio.Event = field(default_factory=asyncio.Event)
    reason: CancelReason | None = None


@dataclass
class _Progress:
    """``open`` is the assistant message streaming now, ``parts`` its text so far.

    ``reply`` is the text of the newest finished one. ``calls`` are tool
    calls requested and not yet finished.

    ``model`` names the model that answers when a call does not name its own.
    ``call`` is the message id of the model call sent and not yet ended, ``sent_at``
    when it was sent (``time.monotonic()``), and ``first_at`` when its first text came.
    ``index`` counts the calls sent so far. ``ran_window`` is the window the call
    ran with, read after it. ``text_tool_calls`` is what became of a tool call it wrote as text.
    """

    run_started: bool = False
    open: str | None = None
    reply: str | None = None
    parts: list[str] = field(default_factory=list[str])
    calls: list[str] = field(default_factory=list[str])
    waiting: bool = False
    pins: PinMemory = field(default_factory=PinMemory)
    model: ModelIdentity | None = None
    identify: Callable[[str | None], ModelIdentity] | None = None
    """Names the model of a profile. The model of a call is read from it as the call is sent."""
    price_of: Callable[[str], ModelPrice | None] | None = None
    tier_of: Callable[[str], Tier | None] | None = None
    call_model: ModelIdentity | None = None
    """The model of the call sent and not yet ended."""
    index: int = 0
    call: str | None = None
    sent_at: float = 0.0
    first_at: float | None = None
    ran_window: int | None = None
    text_tool_calls: Literal["recovered", "unread"] | None = None
    timings: Mapping[str, int] = field(default_factory=dict[str, int])
    """The model server's own numbers for the call, from ``model.response``."""
    note_speed: Callable[..., object] | None = None
    translate: Translator = field(default_factory=Translator)
    """Turns stream parts into facts. It holds text that may be half of a ``<think>`` tag."""
    thinking: list[str] = field(default_factory=list[str])
    think_at: float | None = None
    """When the first thinking fragment of the open reply came."""
    think_ms: int | None = None
    """Thinking time of the open reply, set when its first answer fragment comes."""
    changes: ChangeStore | None = None
    """Records the files a tool wrote. None: they are not recorded and send no event."""
    session_id: str = ""
    run_id: str = ""
    helper_ids: Callable[[str], Awaitable[list[str]]] | None = None
    """The helper sessions of a ``delegate`` call, by the call's id, for ``helper.wait``."""
    children: dict[str, _Progress] = field(default_factory=dict[str, "_Progress"])
    """The state of each child run, by the id of the ``delegate`` call that started it. A child's
    calls are counted and kept here, apart from the run's own."""


async def run_turn(
    runtime: ChatRuntime, events: SessionLog, turn: Turn, control: RunControl
) -> str | None:
    """Run ``turn`` until it ends or waits. A failure becomes ``run.failed``, not an exception.

    Returns the reply when the run completed, and None when it failed or
    waits for an approval. Cancellation is re-raised after ``run.cancelled``
    is in the log.
    """
    progress = _Progress(
        pins=turn.pins,
        model=runtime.router.identity(turn.model_profile),
        identify=runtime.router.identity,
        price_of=runtime.price_of,
        tier_of=runtime.tier_of,
        changes=runtime.changes,
        session_id=turn.session_id,
        run_id=turn.run_id,
        note_speed=runtime.note_speed,
        helper_ids=_helper_ids(events, turn.run_id),
    )

    async def emit(kind: EventType, data: BaseModel) -> None:
        await events.emit(turn.session_id, turn.run_id, kind, data)

    try:
        control.started.set()
        skill = turn.skill
        if turn.begun:
            progress.run_started = True
        else:
            await _begin(turn, emit, progress)
        if turn.routed is not None:
            routed = _routed(runtime, turn.model_profile, turn.routed, turn.replaces)
            await emit("model.routed", routed)
        progress.open = turn.assistant_message_id
        await emit(
            "message.started",
            MessageStartedData(message_id=turn.assistant_message_id, role="assistant"),
        )
        await _until_pulled(runtime, turn.model_profile)
        stream = runtime.stream(
            session_id=turn.session_id,
            text=turn.text,
            model_profile=turn.model_profile,
            schema_version=turn.schema_version,
            user_message_id=turn.user_message_id,
            assistant_message_id=turn.assistant_message_id,
            cwd=turn.cwd,
            allowed_tools=turn.allowed_tools,
            mcp_servers=turn.mcp_servers,
            pinned=turn.pinned,
            pinned_folders=turn.pinned_folders,
            options=turn.options,
            permission_mode=turn.permission_mode,
            checks=turn.checks,
            plan_first=turn.plan_first,
            local_only=turn.local_only,
            growth=turn.growth,
            step_up=turn.step_up,
            skill_folder=None if skill is None else str(skill.path),
            read_folders=turn.read_folders,
            child=turn.child,
            memory=turn.memory,
        )
        return await _finish(stream, progress, emit)
    except asyncio.CancelledError:
        await _stopped(
            runtime,
            events,
            turn.session_id,
            turn.run_id,
            turn.user_message_id,
            progress,
            control.reason or "shutdown",
        )
        raise
    except Exception as exc:
        return await _failed(turn.run_id, exc, progress, emit)


async def _begin(
    turn: Turn,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
    progress: _Progress | None = None,
) -> None:
    """The first events of a run: the skill it invoked, the user's message, ``run.started``."""
    skill = turn.skill
    if skill is not None:
        await emit(
            "skill.activated",
            SkillActivatedData(
                name=skill.call.name,
                source=skill.source,
                how="invoked",
                path=str(skill.path),
                hash=skill.hash,
            ),
        )
    await emit(
        "message.completed",
        MessageCompletedData(
            message_id=turn.user_message_id,
            role="user",
            text=turn.text,
            skill=None if skill is None else skill.call,
        ),
    )
    # Emits are shielded: once one is awaited, it lands even if this task is cancelled.
    if progress is not None:
        progress.run_started = True
    await emit("run.started", EmptyEventData())


async def ask_consent(
    runtime: ChatRuntime, events: SessionLog, turn: Turn, consent: Consent
) -> None:
    """Start the run of ``turn`` and make it wait on the paid step-up question.

    The run has no task while it waits, so it survives a daemon restart. The answer starts
    a new task for the same run, with the turn's ``begun`` set.
    """

    async def emit(kind: EventType, data: BaseModel) -> None:
        await events.emit(turn.session_id, turn.run_id, kind, data)

    await _begin(turn, emit)
    identity = runtime.router.identity(consent.profile)
    await emit(
        "route.consent.needed",
        RouteConsentNeededData(
            model_profile=consent.profile,
            provider=identity.provider,
            model=identity.name,
            tier=consent.tier,
            why=consent.why,
            estimated_usd=consent.estimated_usd,
            alternatives=list(consent.alternatives),
            caps=consent.caps,
            signal=consent.signal,
            replaces_model=consent.replaces,
        ),
    )


def _routed(
    runtime: ChatRuntime, profile: str, choice: Choice, replaces: str | None = None
) -> ModelRoutedData:
    identity = runtime.router.identity(profile)
    tier = None
    if choice.model is not None:
        tier = choice.model.tier
    elif runtime.tier_of is not None:
        tier = runtime.tier_of(profile)
    return ModelRoutedData(
        model_profile=profile,
        provider=identity.provider,
        model=identity.name,
        tier=tier or "frontier",
        reason=choice.reason,
        detail=choice.detail,
        rejected=[ModelRejection(ref=r.ref, tier=r.tier, why=r.why) for r in choice.rejected],
        replaces_model=replaces,
    )


async def _until_pulled(runtime: ChatRuntime, profile: str) -> None:
    """Hold the turn while its model downloads. A failed download raises and fails the run."""
    if runtime.until_pulled is None:
        return
    try:
        ref = runtime.router.resolve(profile).ref
    except ModelConfigError:
        return
    await runtime.until_pulled(ref)


async def resume_turn(
    runtime: ChatRuntime, events: SessionLog, resume: Resume, control: RunControl
) -> str | None:
    """Answer the waiting tool call, then run on until the run ends or waits again.

    Returns what :func:`run_turn` returns.
    """
    progress = _Progress(
        run_started=True,
        calls=list(resume.open_calls),
        pins=resume.pins,
        model=runtime.router.identity(),
        identify=runtime.router.identity,
        price_of=runtime.price_of,
        tier_of=runtime.tier_of,
        changes=runtime.changes,
        session_id=resume.session_id,
        run_id=resume.run_id,
        note_speed=runtime.note_speed,
        helper_ids=_helper_ids(events, resume.run_id),
    )

    async def emit(kind: EventType, data: BaseModel) -> None:
        await events.emit(resume.session_id, resume.run_id, kind, data)

    try:
        control.started.set()
        if resume.go == "wake":
            stream = runtime.resume(
                session_id=resume.session_id,
                answer=Answer.helpers_done(),
                cwd=resume.cwd,
                allowed_tools=resume.allowed_tools,
                asked=resume.asked,
                mcp_servers=resume.mcp_servers,
                pinned=resume.pinned,
                pinned_folders=resume.pinned_folders,
                options=resume.options,
                permission_mode=resume.permission_mode,
                checks=resume.checks,
                plan_first=resume.plan_first,
                local_only=resume.local_only,
                child=resume.child,
                memory=resume.memory,
            )
            return await _finish(stream, progress, emit)
        if resume.go == "continue":
            stream = runtime.continue_thread(
                session_id=resume.session_id,
                cwd=resume.cwd,
                allowed_tools=resume.allowed_tools,
                mcp_servers=resume.mcp_servers,
                pinned=resume.pinned,
                pinned_folders=resume.pinned_folders,
                options=resume.options,
                permission_mode=resume.permission_mode,
                checks=resume.checks,
                plan_first=resume.plan_first,
                local_only=resume.local_only,
                child=resume.child,
            )
            return await _finish(stream, progress, emit)
        if resume.consent is None:
            await emit(
                "approval.resolved",
                ApprovalResolvedData(
                    call_id=resume.call_id,
                    name=resume.name,
                    decision=resume.decision,
                    subject=resume.subject,
                    rule=resume.rule,
                    args=resume.args,
                ),
            )
            answer = Answer(decision=resume.decision, diff=resume.diff, args=resume.args)
        else:
            answer = Answer(decision=resume.consent)
        stream = runtime.resume(
            session_id=resume.session_id,
            answer=answer,
            cwd=resume.cwd,
            allowed_tools=resume.allowed_tools,
            asked=resume.asked,
            mcp_servers=resume.mcp_servers,
            pinned=resume.pinned,
            pinned_folders=resume.pinned_folders,
            options=resume.options,
            permission_mode=resume.permission_mode,
            checks=resume.checks,
            plan_first=resume.plan_first,
            local_only=resume.local_only,
            child=resume.child,
            memory=resume.memory,
        )
        return await _finish(stream, progress, emit)
    except asyncio.CancelledError:
        await _stopped(
            runtime,
            events,
            resume.session_id,
            resume.run_id,
            resume.user_message_id,
            progress,
            control.reason or "shutdown",
        )
        raise
    except Exception as exc:
        return await _failed(resume.run_id, exc, progress, emit)


async def _finish(
    stream: AsyncGenerator[object],
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> str | None:
    async with aclosing(stream):
        async for part in stream:
            for fact in progress.translate(part):
                await _apply(fact, progress, emit)
    if progress.waiting:
        return None
    await emit("run.completed", EmptyEventData())
    return "".join(progress.parts) if progress.reply is None else progress.reply


async def _failed(
    run_id: str,
    exc: Exception,
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> None:
    await _end_call(progress, emit, failed=True)
    await _end_children(progress, emit, CANCELLED_TOOL)
    if isinstance(exc, ModelUnreachable):
        log.warning("run %s failed: %s (%s)", run_id, exc.message, exc.__cause__)
        data = RunFailedData(
            message=exc.message, code=exc.code, provider=exc.provider, hint=exc.hint
        )
        await emit("run.failed", data)
        return
    if isinstance(exc, ContextFull):
        log.warning("run %s failed: needs about %d of %d tokens", run_id, exc.need, exc.window)
        await emit("run.failed", RunFailedData(message=exc.message, code=exc.code, hint=exc.hint))
        return
    if isinstance(exc, ModelConfigError) and exc.code == "local_only":
        log.warning("run %s failed: %s", run_id, exc)
        await emit(
            "run.failed",
            RunFailedData(message=str(exc), code="local_only", hint=LOCAL_ONLY_HINT),
        )
        return
    log.exception("run %s failed", run_id, exc_info=exc)
    message = str(exc).strip() or type(exc).__name__
    await emit("run.failed", RunFailedData(message=message))


async def _apply(
    fact: object,
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> None:
    if isinstance(fact, ModelStarted):
        if fact.message_id == progress.open:
            return
        progress.open = fact.message_id
        progress.parts = []
        _reset_thinking(progress)
        await emit(
            "message.started", MessageStartedData(message_id=fact.message_id, role="assistant")
        )
    elif isinstance(fact, ModelRouted):
        if fact.reason == "fallback" and progress.call is not None:
            # The call that was open failed. Text it showed is closed, and never stored.
            await _end_call(progress, emit, failed=True)
            if progress.open is not None and progress.parts:
                await emit(
                    "message.completed",
                    MessageCompletedData(
                        message_id=progress.open,
                        role="assistant",
                        text="".join(progress.parts),
                        interrupted=True,
                    ),
                )
                progress.open = None
                progress.parts = []
        identity = progress.identify(fact.profile) if progress.identify is not None else None
        await emit(
            "model.routed",
            ModelRoutedData(
                model_profile=fact.profile,
                provider=None if identity is None else identity.provider,
                model=None if identity is None else identity.name,
                tier=fact.tier,
                reason=fact.reason,
                detail=fact.detail,
                rejected=[ModelRejection(ref=r, tier=t, why=w) for r, t, w in fact.rejected],
            ),
        )
    elif isinstance(fact, ModelWaiting):
        await emit(
            "model.waiting",
            ModelWaitingData(
                message_id=fact.message_id,
                waiting=fact.waiting,
                model=fact.model,
                window=fact.window,
            ),
        )
    elif isinstance(fact, ModelRequested):
        progress.index += 1
        progress.call = fact.message_id
        progress.sent_at = time.monotonic()
        progress.first_at = None
        progress.ran_window = None
        progress.text_tool_calls = None
        progress.timings = {}
        model = progress.model
        if fact.profile is not None and progress.identify is not None:
            model = progress.identify(fact.profile)
        progress.call_model = model
        await emit(
            "model.call.started",
            ModelCallStartedData(
                message_id=fact.message_id,
                index=progress.index,
                profile=model.profile if model else "",
                provider=model.provider if model else None,
                model=model.name if model else None,
                tier=_tier(progress, model),
                system_prompt_sha=fact.system_prompt_sha,
                tools_sha=fact.tools_sha,
                message_ids=list(fact.message_ids),
                context_window=fact.context_window,
                num_ctx=fact.num_ctx,
                window_estimated=fact.window_estimated,
                window_planned=fact.window_planned,
                system_sections=None
                if fact.system_sections is None
                else [PromptSectionInfo(name=n, chars=c) for n, c in fact.system_sections],
                system_chars=fact.system_chars,
                system_bytes=fact.system_bytes,
                tools_chars=fact.tools_chars,
                tools_bytes=fact.tools_bytes,
                message_chars=None if fact.message_chars is None else list(fact.message_chars),
                message_bytes=None if fact.message_bytes is None else list(fact.message_bytes),
                cleared_ids=list(fact.cleared_ids),
                summary_chars=fact.summary_chars,
                estimated_tokens=fact.estimated_tokens,
            ),
        )
    elif isinstance(fact, ContextChanged):
        await emit(
            "context.changed",
            ContextChangedData(
                action=fact.action,
                before_tokens=fact.before_tokens,
                after_tokens=fact.after_tokens,
                count=fact.count,
                room=fact.room,
                window_from=fact.window_from,
                window_to=fact.window_to,
                reload_ms=fact.reload_ms,
            ),
        )
    elif isinstance(fact, ModelResponded):
        progress.ran_window = fact.context_window
        progress.text_tool_calls = fact.text_tool_calls
        progress.timings = fact.timings
    elif isinstance(fact, ThinkingDelta) and progress.open is not None:
        if progress.think_at is None:
            progress.think_at = time.monotonic()
        progress.thinking.append(fact.text)
        await emit(
            "message.thinking.delta",
            MessageThinkingDeltaData(message_id=progress.open, text=fact.text),
        )
    elif isinstance(fact, TextDelta) and progress.open is not None:
        now = time.monotonic()
        if progress.call is not None and progress.first_at is None:
            progress.first_at = now
        if progress.think_at is not None and progress.think_ms is None:
            progress.think_ms = _ms(now - progress.think_at)
        progress.parts.append(fact.text)
        await emit("message.delta", MessageDeltaData(message_id=progress.open, text=fact.text))
    elif isinstance(fact, ToolWriting) and progress.open is not None:
        await emit(
            "tool.writing",
            ToolWritingData(
                message_id=progress.open,
                index=fact.index,
                name=fact.name,
                path=fact.path,
                lines=fact.lines,
                chars=fact.chars,
            ),
        )
    elif isinstance(fact, TextCompleted):
        message_id = fact.message_id or progress.open
        if message_id is None:
            return
        progress.reply = fact.text
        progress.open = None
        thinking = fact.thinking or "".join(progress.thinking) or None
        spent = None
        if thinking is not None and progress.think_at is not None:
            spent = progress.think_ms
            if spent is None:
                spent = _ms(time.monotonic() - progress.think_at)
        _reset_thinking(progress)
        await emit(
            "message.completed",
            MessageCompletedData(
                message_id=message_id,
                role="assistant",
                text=fact.text,
                thinking=thinking,
                thinking_ms=spent,
            ),
        )
        await _end_call(progress, emit, fact)
        for call in fact.calls:
            progress.calls.append(call.call_id)
            await emit(
                "tool.requested",
                ToolRequestedData(
                    call_id=call.call_id, message_id=message_id, name=call.name, args=call.args
                ),
            )
    elif isinstance(fact, ChildFact):
        await _apply_child(fact, progress, emit)
    elif isinstance(fact, ToolStarted):
        await emit("tool.started", ToolStartedData(call_id=fact.call_id))
    elif isinstance(fact, ToolOutput):
        await emit("tool.output", ToolOutputData(call_id=fact.call_id, text=fact.text))
    elif isinstance(fact, ToolFinished):
        _done(progress, fact.call_id)
        await _end_child(progress, emit, fact.call_id, "the helper's tool call has no result")
        await emit(
            "tool.completed",
            ToolCompletedData(
                call_id=fact.call_id,
                summary=fact.summary,
                preview=fact.preview,
                truncated=fact.truncated,
                artifact_id=fact.artifact_id,
                failed=fact.failed,
                duration_ms=fact.duration_ms,
                diff=fact.diff,
                sources=[ToolSource.model_validate(row) for row in fact.sources] or None,
            ),
        )
    elif isinstance(fact, ToolErrored):
        _done(progress, fact.call_id)
        await _end_child(progress, emit, fact.call_id, "the helper stopped")
        await emit(
            "tool.failed",
            ToolFailedData(
                call_id=fact.call_id, message=fact.message, duration_ms=fact.duration_ms
            ),
        )
    elif isinstance(fact, TodosChanged):
        await emit(
            "todos.updated",
            TodosUpdatedData.model_validate({"call_id": fact.call_id, "todos": list(fact.todos)}),
        )
    elif isinstance(fact, PlanProposed):
        await emit(
            "plan.proposed",
            PlanProposedData.model_validate(
                {
                    "plan_id": fact.plan_id,
                    "call_id": fact.call_id,
                    "title": fact.title,
                    "steps": list(fact.steps),
                }
            ),
        )
    elif isinstance(fact, FileChanged):
        await _record_change(fact, progress, emit)
    elif isinstance(fact, PinRead):
        if progress.pins.read(fact.name, fact.hash):
            data = {"name": fact.name, "source": fact.source, "how": "pinned"}
            data |= {"path": fact.path, "hash": fact.hash}
            await emit("skill.activated", SkillActivatedData.model_validate(data))
    elif isinstance(fact, SkillLoaded):
        data = {"name": fact.name, "source": fact.source, "how": "model"}
        data |= {"path": fact.path, "hash": fact.hash}
        await emit("skill.activated", SkillActivatedData.model_validate(data))
    elif isinstance(fact, PinSkipped):
        data = {"name": fact.name, "reason": fact.reason, "message": fact.message}
        skipped = SkillSkippedData.model_validate(data)
        if progress.pins.skipped(skipped.name, skipped.reason):
            await emit("skill.skipped", skipped)
    elif isinstance(fact, CheckOffered):
        infos = [CheckInfo(name=name, command=command) for name, command in fact.checks]
        await emit("check.offered", CheckOfferedData(checks=infos))
    elif isinstance(fact, CheckStarted):
        await emit(
            "check.started",
            CheckStartedData(
                check_id=fact.check_id, name=fact.name, command=fact.command, round=fact.round
            ),
        )
    elif isinstance(fact, CheckCompleted):
        await emit(
            "check.completed",
            CheckCompletedData.model_validate(
                {
                    "check_id": fact.check_id,
                    "name": fact.name,
                    "status": fact.status,
                    "exit_code": fact.exit_code,
                    "duration_ms": fact.duration_ms,
                    "output": fact.output,
                    "artifact_id": fact.artifact_id,
                    "round": fact.round,
                }
            ),
        )
    elif isinstance(fact, ConsentAsked):
        progress.waiting = True
        identity = progress.identify(fact.profile) if progress.identify is not None else None
        await emit(
            "route.consent.needed",
            RouteConsentNeededData(
                model_profile=fact.profile,
                provider=None if identity is None else identity.provider,
                model=None if identity is None else identity.name,
                tier=fact.tier,
                why=fact.why,
                estimated_usd=fact.estimated_usd,
                alternatives=list(fact.alternatives),
                caps=fact.caps,
                signal=fact.signal,
            ),
        )
    elif isinstance(fact, HelpersParked):
        progress.waiting = True
        for call_id in fact.call_ids:
            ids = [] if progress.helper_ids is None else await progress.helper_ids(call_id)
            await emit(
                "helper.wait",
                HelperWaitData(call_id=call_id, state="parked", helper_ids=ids),
            )
    elif isinstance(fact, ApprovalAsked):
        progress.waiting = True
        await emit(
            "approval.needed",
            ApprovalNeededData(
                call_id=fact.call_id,
                message_id=fact.message_id,
                name=fact.name,
                args=fact.args,
                source=fact.source,
                subject=fact.subject,
                diff=fact.diff,
            ),
        )


def _helper_ids(events: SessionLog, run_id: str) -> Callable[[str], Awaitable[list[str]]]:
    """Reads the helper sessions of a ``delegate`` call from ``helper.started`` in ``run_id``."""

    async def ids(call_id: str) -> list[str]:
        return [
            e.data.helper_id
            for e in await events.for_run(run_id)
            if isinstance(e, HelperStartedEvent) and e.data.call_id == call_id
        ]

    return ids


def _tagged(
    emit: Callable[[EventType, BaseModel], Awaitable[None]], parent_call_id: str
) -> Callable[[EventType, BaseModel], Awaitable[None]]:
    """``emit`` that names the ``delegate`` call on each event, which only a child's have."""

    async def tagged(kind: EventType, data: BaseModel) -> None:
        await emit(kind, data.model_copy(update={"parent_call_id": parent_call_id}))

    return tagged


async def _apply_child(
    child: ChildFact,
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> None:
    """Emit a fact of a child run, with its parent call id, in the parent's run.

    The child has its own state, so its calls never move the run's own counters. It has no
    messages: its reply text, thinking and waiting are not emitted.
    """
    mine = progress.children.get(child.parent_call_id)
    if mine is None:
        mine = _Progress(
            model=progress.model,
            identify=progress.identify,
            price_of=progress.price_of,
            tier_of=progress.tier_of,
            note_speed=progress.note_speed,
            run_started=True,
            session_id=progress.session_id,
            run_id=progress.run_id,
        )
        progress.children[child.parent_call_id] = mine
    fact = child.fact
    tagged = _tagged(emit, child.parent_call_id)
    if isinstance(fact, TextCompleted):
        await _end_call(mine, tagged, fact)
        for call in fact.calls:
            mine.calls.append(call.call_id)
            await tagged(
                "tool.requested",
                ToolRequestedData(
                    call_id=call.call_id,
                    message_id=fact.message_id or "child",
                    name=call.name,
                    args=call.args,
                ),
            )
    elif isinstance(
        fact, ModelRequested | ModelResponded | ToolStarted | ToolFinished | ToolErrored
    ):
        await _apply(fact, mine, tagged)


async def _end_child(
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
    parent_call_id: str,
    message: str,
) -> None:
    """Close what a child run left open: its model call, and each tool call of it."""
    mine = progress.children.pop(parent_call_id, None)
    if mine is None:
        return
    tagged = _tagged(emit, parent_call_id)
    await _end_call(mine, tagged, failed=True)
    for call_id in mine.calls:
        await tagged("tool.failed", ToolFailedData(call_id=call_id, message=message))


async def _end_children(
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
    message: str,
) -> None:
    for parent_call_id in list(progress.children):
        await _end_child(progress, emit, parent_call_id, message)


async def _record_change(
    fact: FileChanged,
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
) -> None:
    """Store the change, then tell the screens. The texts stay here and never go out."""
    if progress.changes is None or fact.before == fact.after:
        return
    try:
        change = await progress.changes.record(
            session_id=progress.session_id,
            run_id=progress.run_id,
            call_id=fact.call_id,
            path=fact.path,
            before=fact.before,
            after=fact.after,
            source=fact.source,
        )
    except Exception:
        log.exception("could not record the change to %s", fact.path)
        return
    await emit(
        "file.changed",
        FileChangedData(
            change_id=change.change_id,
            call_id=change.call_id,
            path=change.path,
            status=status_of(change.before_sha, change.after_sha),
            added=change.added,
            removed=change.removed,
            source=change.source,
            reverts=change.reverts,
        ),
    )


def _tier(progress: _Progress, model: ModelIdentity | None) -> Tier | None:
    """The tier of the model of a call, or None when it does not resolve."""
    if model is None or model.provider is None or progress.tier_of is None:
        return None
    return progress.tier_of(model.profile)


async def _end_call(
    progress: _Progress,
    emit: Callable[[EventType, BaseModel], Awaitable[None]],
    done: TextCompleted | None = None,
    *,
    failed: bool = False,
) -> None:
    """``model.call.completed`` for the call sent and not ended, if there is one."""
    message_id = progress.call
    if message_id is None:
        return
    progress.call = None
    now = time.monotonic()
    first = progress.first_at
    usage = None if done is None or done.usage is None else TokenUsage(**done.usage)
    cost, price = None, None
    model = progress.call_model
    if not failed and usage is not None and model is not None and progress.price_of is not None:
        found = progress.price_of(model.profile)
        cost = cost_usd(usage.model_dump(), found)
        if cost is not None and found is not None:
            price = CallPrice(
                input=found.input, output=found.output, cached_input=found.cached_input
            )
    timings: Mapping[str, int] = {} if failed else progress.timings
    if timings and model is not None and progress.note_speed is not None:
        try:
            progress.note_speed(model.profile, timings)
        except Exception:
            log.debug("noting the speed of %s failed", model.profile, exc_info=True)
    await emit(
        "model.call.completed",
        ModelCallCompletedData(
            message_id=message_id,
            usage=usage,
            stop_reason=None if done is None else done.stop_reason,
            first_token_ms=None if first is None else _ms(first - progress.sent_at),
            latency_ms=_ms(now - progress.sent_at),
            failed=failed,
            context_window=None if failed else progress.ran_window,
            text_tool_calls=None if failed else progress.text_tool_calls,
            cost_usd=cost,
            price=price,
            load_ms=timings.get("load_ms"),
            prompt_ms=timings.get("prompt_ms"),
            reply_ms=timings.get("reply_ms"),
        ),
    )


def _reset_thinking(progress: _Progress) -> None:
    progress.thinking = []
    progress.think_at = None
    progress.think_ms = None


def _ms(seconds: float) -> int:
    return max(0, round(seconds * 1000))


def _done(progress: _Progress, call_id: str) -> None:
    if call_id in progress.calls:
        progress.calls.remove(call_id)


async def _stopped(
    runtime: ChatRuntime,
    events: SessionLog,
    session_id: str,
    run_id: str,
    user_message_id: str | None,
    progress: _Progress,
    reason: CancelReason,
) -> None:
    log.info("run %s cancelled (%s)", run_id, reason)
    try:
        if not progress.run_started:
            await events.emit(session_id, run_id, "run.started", EmptyEventData())

        async def emit(kind: EventType, data: BaseModel) -> None:
            await events.emit(session_id, run_id, kind, data)

        await _end_call(progress, emit, failed=True)
        await _end_children(progress, emit, CANCELLED_TOOL)
        await fail_calls(events, session_id, run_id, progress.calls, CANCELLED_TOOL)
        if progress.open is not None:
            await close_reply(
                runtime,
                events,
                session_id=session_id,
                run_id=run_id,
                user_message_id=user_message_id,
                assistant_message_id=progress.open,
                partial="".join(progress.parts),
            )
        await events.emit(session_id, run_id, "run.cancelled", RunCancelledData(reason=reason))
    except Exception:
        log.exception("could not record the end of cancelled run %s", run_id)


async def fail_calls(
    events: SessionLog, session_id: str, run_id: str, calls: Sequence[str], message: str
) -> None:
    """``tool.failed`` for each of ``calls``."""
    for call_id in calls:
        await events.emit(
            session_id, run_id, "tool.failed", ToolFailedData(call_id=call_id, message=message)
        )


__all__ = [
    "CANCELLED_TOOL",
    "CancelReason",
    "Resume",
    "RunControl",
    "Turn",
    "fail_calls",
    "resume_turn",
    "run_turn",
]
