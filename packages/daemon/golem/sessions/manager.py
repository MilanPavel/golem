"""Sessions: their rows and events live in ``golem.db``, their model context
in the checkpointer.

A session found only in the checkpointer predates the event log. Resolving it
writes the ``session.created`` it never had, with an empty history before it.

A session without a title gets one after its first completed run, from a
task that does not keep the session busy.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator, Callable, Coroutine, Iterable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal, cast

from langchain_core.messages import BaseMessage

from golem.config import ModelPrice, PermissionMode, RouteMode
from golem.evals.whatif import build_report, session_model
from golem.graphs.adapter import PlainMessage, plain_messages, trace_messages
from golem.graphs.chat import ChatRuntime, Growth
from golem.graphs.child import child_thread
from golem.graphs.context_view import ContextView, view
from golem.graphs.state import SCHEMA_VERSION
from golem.graphs.step_up import Consent, StepAsk, StepRequest, StepUp
from golem.models import options as model_options
from golem.models.budget import Budget, Room, spent_text
from golem.models.cost import cost_usd
from golem.models.errors import BUDGET_HINT
from golem.models.facts import FactsSource, ModelFacts
from golem.models.pick import Choice, Rejected, Traits, ladder, pick
from golem.models.privacy import LOCAL_ONLY_REFUSAL, is_local_only
from golem.models.project_privacy import project_local_only
from golem.models.router import ModelConfigError, ModelIdentity, ModelRouter
from golem.models.tiers import TIERS, Tier
from golem.models.window_plan import should_grow
from golem.permissions.engine import MCP_ENABLE, Allowance, server_grant
from golem.permissions.policy import explain
from golem.sessions.approvals import pending_approval, pending_consent
from golem.sessions.bus import EventTarget, SummaryTarget
from golem.sessions.context import context_breakdown
from golem.sessions.ids import new_id
from golem.sessions.log import SessionLog
from golem.sessions.runner import (
    CancelReason,
    Resume,
    RunControl,
    Turn,
    ask_consent,
    fail_calls,
    resume_turn,
    run_turn,
)
from golem.sessions.summaries import cut_summary
from golem.sessions.titles import TitleGenerator, choose_title, clean_title, fork_title
from golem.sessions.trace import (
    build_trace,
    context_events,
    filled_window,
    helper_of,
    read_span,
    with_windows,
)
from golem.skills.invoke import Invocation, SkillInvokeError, invoke
from golem.skills.pinned import PinMemory, SkillPinError, pinnable, pinned_folders
from golem.skills.registry import SkillRegistry
from golem.store.blobs import BlobStore
from golem.store.records import RunRecords, SessionActivity, SessionRecords
from golem.tools.registry import ToolError, ToolScope
from golem_protocol.commands import (
    EvalRoutingResult,
    PendingItem,
    SessionCompactResult,
    TraceContextEvent,
    TraceRunSpan,
    TraceSpanResult,
)
from golem_protocol.events import (
    ApprovalDecision,
    ChatEvent,
    ConsentAnswer,
    ConsentCaps,
    ContextChangedData,
    EmptyEventData,
    FileChangedData,
    ForkedFrom,
    MessageCompletedEvent,
    ModelOptionsChangedData,
    ModelRoutedEvent,
    ModelSelectedData,
    RouteConsentAnsweredData,
    RunCancelledData,
    RunFailedData,
    SessionAllowance,
    SessionChecksChangedData,
    SessionCompletedData,
    SessionCreatedData,
    SessionModeChangedData,
    SessionPlanChangedData,
    SessionUpdatedData,
    SkillActivatedData,
    SkillActivatedEvent,
    SkillCall,
    SkillDeactivatedData,
    SkillSkippedEvent,
    TodosUpdatedData,
)

NOT_APPROVED = "cancelled before it was approved"

NO_STRONGER = "No stronger model is ready. Add a key in Settings."

GROW_EVERY = 600.0
"""Seconds between two growths of the window in one session."""

log = logging.getLogger("golem.sessions")


class SessionNotFoundError(Exception):
    """No session row and no checkpoint for this id."""


class SpanNotFoundError(Exception):
    """No span of this session has the id."""


class SessionBusyError(Exception):
    """A run is already in progress for this session, or waits for an approval."""


class ApprovalNotFoundError(Exception):
    """No run of this session waits on this tool call."""


class ConsentAnswerError(Exception):
    """The answer to the paid step-up question is not one the question offered."""


class RuleWriteError(Exception):
    """An "always allow" answer could not write its rule."""


class InvalidToolArgsError(Exception):
    """Edited arguments that the tool does not accept, or that a rule denies."""


class BlankTitleError(Exception):
    """Nothing is left of the title once it is cleaned."""


class MessageNotFoundError(Exception):
    """The session has no completed message with this id to fork at."""


class RunNotFoundError(Exception):
    """No run with this id, in progress or finished."""


@dataclass(frozen=True, slots=True)
class SessionView:
    """Checkpoint text for one session. Provider types stay in the graph."""

    session_id: str
    model_profile: str
    model_provider: str | None
    model_name: str | None
    messages: list[PlainMessage]
    """The system prompt first, when there is one, then the stored messages."""

    @property
    def stored(self) -> int:
        """How many of ``messages`` are in the checkpoint: all but the system prompt."""
        return sum(1 for message in self.messages if message.role != "system")


class BudgetSpentError(Exception):
    """A turn on a paid model was refused because a cap in ``[budget]`` is spent."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class GrowRefusedError(Exception):
    """The window cannot grow. The message says why, in words for the user."""


@dataclass(frozen=True, slots=True)
class _Step:
    model_id: str
    current: int
    size: int


class SchemaMismatchError(Exception):
    """The checkpoint's ``schema_version`` is not the one this process writes."""

    def __init__(self, found: object) -> None:
        super().__init__(f"unsupported schema_version {found}")
        self.found = found


@dataclass
class _LiveSession:
    session_id: str
    model_profile: str
    schema_version: int
    cwd: str | None = None
    origin: str = "user"
    """Who started the session. It never changes."""
    allowed_tools: set[Allowance] = field(default_factory=set[Allowance])
    mcp_servers: set[str] = field(default_factory=set[str])
    skills: list[str] = field(default_factory=list[str])
    """The pinned skills, in the order they were pinned."""
    options: dict[str, float | str] = field(default_factory=dict[str, float | str])
    """The Ollama option overrides of this session."""
    permission_mode: PermissionMode | None = None
    """The session's permission mode override, None to follow ``config.toml``."""
    checks: bool | None = None
    """Whether the session lets golem run checks. None until it answers the offer."""
    route: RouteMode = "pinned"
    """How the session picks the model of each turn."""
    paid_ok: bool = False
    """The user agreed to paid models for this session. A fork does not copy it."""
    plan_first: bool = False
    """Whether the session is in plan first: its runs only read and end in a plan."""
    pins: PinMemory = field(default_factory=PinMemory)
    """What the log last said about each pin, so a run logs only a change."""
    title: str | None = None
    titling: bool = False
    closed: bool = False
    task: asyncio.Task[None] | None = None
    compacting: bool = False
    """A compaction is writing the session's context view. No run may start."""
    clears: int = 0
    """How many times this session's context was cleared, counted from ``context.changed``."""
    summaries: int = 0
    """How many times it was summarised."""
    counted_seq: int = 0
    """The newest event ``clears`` and ``summaries`` have read."""
    grew_at: float | None = None
    """When the session last grew the window, on the manager's clock."""
    growth: Growth | None = None
    """A growth the user asked for, which the next turn's first call reports."""
    step_ups: dict[str, int] = field(default_factory=dict[str, int])
    """How many runs of this session stepped up on each signal. In memory only."""
    step_floor: Tier | None = None
    """The tier the picks of this session start at, after one signal stepped up in two runs."""


def _schemas(text: str | None) -> list[dict[str, object]] | None:
    """The tool schemas stored as JSON, or None when absent or not a list of objects."""
    if text is None:
        return None
    try:
        found = json.loads(text)
    except ValueError:
        return None
    if not isinstance(found, list):
        return None
    items = cast(list[object], found)
    if not all(isinstance(item, dict) for item in items):
        return None
    return cast(list[dict[str, object]], items)


@dataclass(frozen=True, slots=True)
class _Routed:
    """The pick of a turn: the profile that runs, why, and the question to ask first, if any."""

    profile: str
    choice: Choice | None
    ask: Consent | None = None
    replaces: str | None = None


class _NoLocalFit(Exception):
    """The user chose to stay local and no local model passes. ``choice`` says why."""

    def __init__(self, choice: Choice) -> None:
        super().__init__(choice.detail)
        self.choice = choice


@dataclass(frozen=True, slots=True)
class _LiveRun:
    task: asyncio.Task[None]
    control: RunControl


class SessionManager:
    """Create, attach, list, inspect, send, cancel, and close, for one daemon process."""

    def __init__(
        self,
        runtime: ChatRuntime,
        events: SessionLog,
        records: SessionRecords,
        runs: RunRecords,
        *,
        titles: TitleGenerator | None = None,
        skills: SkillRegistry | None = None,
        blobs: BlobStore | None = None,
    ) -> None:
        self._runtime = runtime
        self._blobs = blobs
        self._skills = skills
        self._events = events
        self._records = records
        self._run_records = runs
        self._titles = titles
        events.local_only = self.local_only
        runtime.next_model = self._next_model
        self.facts: FactsSource | None = None
        """Where a routed turn reads the facts of the models. None: it has none."""
        self.budget: Budget | None = None
        """The caps of ``[budget]``. None: a turn is never held back for its cost."""
        self.listed_refs: Callable[[], Sequence[str]] = lambda: ()
        """The refs of the models the daemon knows of, for the candidates of a pick."""
        self._sessions: dict[str, _LiveSession] = {}
        self._runs: dict[str, _LiveRun] = {}
        self._naming: set[asyncio.Task[None]] = set()
        self._lock = asyncio.Lock()
        self.clock: Callable[[], float] = time.monotonic
        """Seconds for the limit on growing, replaceable in tests."""

    async def create(
        self, model_profile: str | None, *, cwd: str | None = None, origin: str | None = None
    ) -> str:
        """Store a new session and its ``session.created``. Nobody is attached yet.

        ``cwd`` is the folder its file tools work in. None gives it no file tools.
        ``origin`` is ``cli``, ``routine:<name>`` and so on, None for ``user``. Only
        daemon code calls this with ``routine:*``: the ``session.create`` command
        accepts ``user`` and ``cli`` only.
        ``model_profile`` is a profile name or a ``provider/model`` ref, or None
        for the default.

        Raises :class:`~golem.models.router.ModelConfigError` when
        ``model_profile`` does not resolve or its provider has no key, as
        :meth:`set_model` does.
        """
        if model_profile is None:
            profile = self._runtime.router.profile_name
        else:
            self._runtime.router.chat_model(model_profile)
            profile = model_profile
        async with self._lock:
            session = _LiveSession(
                session_id=new_id("s"),
                model_profile=profile,
                schema_version=SCHEMA_VERSION,
                cwd=cwd,
                origin="user" if origin is None else origin,
                route=self._runtime.router.routing_settings().mode,
            )
            await self._announce(session)
            self._sessions[session.session_id] = session
            return session.session_id

    async def fork(self, session_id: str, at_message_id: str) -> str:
        """A new session with ``session_id``'s history up to ``at_message_id``.

        The new thread starts from the checkpoint that ends at that message.
        Its log gets the parent's ``message.completed`` events up to it, with
        their original ``run_id`` and new ``seq``. It also starts with the
        source's pinned skills and on-demand MCP servers as they are now. The
        tools allowed for the session are not copied, so the fork asks again.
        Nobody is attached yet.

        Raises :class:`MessageNotFoundError`, :class:`SessionNotFoundError`,
        or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            source = await self._resolve(session_id)
            stored = await self._events.stored(session_id)
            history = _completed_through(stored, at_message_id)
            if history is None:
                raise MessageNotFoundError(at_message_id)
            fork = _LiveSession(
                session_id=new_id("s"),
                model_profile=source.model_profile,
                schema_version=SCHEMA_VERSION,
                cwd=source.cwd,
                mcp_servers=set(source.mcp_servers),
                skills=list(source.skills),
                route=source.route,
            )
            if not await self._runtime.fork(
                session_id, fork.session_id, at_message_id=at_message_id
            ):
                raise MessageNotFoundError(at_message_id)
            await self._announce(fork, ForkedFrom(session_id=session_id, message_id=at_message_id))
            for event in history:
                await self._events.emit(
                    fork.session_id, event.run_id, "message.completed", event.data
                )
            todos = (await self._runtime.values(fork.session_id)).get("todos")
            if isinstance(todos, list) and todos:
                await self._events.emit(
                    fork.session_id,
                    None,
                    "todos.updated",
                    TodosUpdatedData.model_validate({"todos": todos}),
                )
            if fork.mcp_servers:
                await self._events.emit(
                    fork.session_id,
                    None,
                    "session.updated",
                    SessionUpdatedData(mcp_servers=sorted(fork.mcp_servers)),
                )
            pins = _pin_events(stored, fork.skills)
            for event in pins:
                await self._events.emit(fork.session_id, None, event.type, event.data)
            fork.pins = PinMemory.from_events(pins)
            if source.title is not None:
                await self._set_title(fork, fork_title(source.title))
            self._sessions[fork.session_id] = fork
            return fork.session_id

    async def attach(self, session_id: str, after_seq: int, target: EventTarget) -> int:
        """Replay events after ``after_seq`` to ``target``, then stream live ones.

        Returns the newest ``seq``. Raises :class:`SessionNotFoundError` or
        :class:`SchemaMismatchError`.
        """
        async with self._lock:
            await self._resolve(session_id)
        return await self._events.attach(session_id, after_seq, target)

    def detach(self, session_id: str, target: EventTarget) -> None:
        """Stop live events for ``session_id`` on ``target``."""
        self._events.detach(session_id, target)

    def detach_all(self, target: object) -> None:
        """Forget ``target`` everywhere, as a watcher too. Called when its connection closes."""
        self._events.detach_all(target)

    async def recent(self, limit: int, cwd: str | None = None) -> list[SessionActivity]:
        """Sessions with the newest activity first; with ``cwd``, only those in that folder."""
        return await self._records.recent(limit, cwd)

    async def watch(self, limit: int, target: SummaryTarget) -> list[SessionActivity]:
        """Like :meth:`recent`, and ``target`` gets each later change as a summary."""
        return await self._events.watch(limit, target)

    async def eval_routing(
        self, days: int, session_id: str | None, now: datetime
    ) -> EvalRoutingResult:
        """What the recorded sessions would have cost on each route. Calls no model.

        Reads the stored events of the sessions with activity in the last ``days`` days, or of
        ``session_id`` alone. Raises :class:`SessionNotFoundError` for an unknown id.
        """
        if session_id is not None:
            if await self._records.get(session_id) is None:
                raise SessionNotFoundError(session_id)
            ids = [session_id]
        else:
            ids = await self._records.updated_since(now - timedelta(days=days))
        sessions = {found: await self._events.stored(found) for found in ids}
        router = self._runtime.router
        routing = router.routing_settings()
        names = [n for n in routing.ladder.model_dump().values() if isinstance(n, str)]
        names += [p for p in (session_model(e) for e in sessions.values()) if p is not None]
        refs: list[str] = []
        for name in names:
            try:
                refs.append(router.resolve(name).ref)
            except ModelConfigError:
                continue
        refs.extend(self.listed_refs())
        facts: list[ModelFacts] = []
        if self.facts is not None:
            facts = await self.facts.facts(list(dict.fromkeys(refs)))
        return build_report(
            sessions, routing=routing, context=router.context_settings(), facts=facts, days=days
        )

    async def pending(self, activity: SessionActivity) -> PendingItem | None:
        """What a waiting session waits for, read from its stored events."""
        return await self._events.pending(activity)

    def _offered(self, session: _LiveSession) -> list[str]:
        """The names of the tools the session's next model call would offer."""
        found = self._runtime.tools.scoped(_scope(session)).schemas()
        return [str(cast(Mapping[str, object], item["function"])["name"]) for item in found]

    async def inspect(self, session_id: str) -> SessionView:
        """The messages the next model call would see, system prompt first. Does not start a run."""
        async with self._lock:
            session = await self._resolve(session_id)
            values = await self._runtime.values(session_id)
            identity = self._runtime.router.identity(session.model_profile)
            system = await self._runtime.system_prompt(
                session_id,
                session.cwd,
                session.skills,
                sorted(session.mcp_servers),
                profile=session.model_profile,
                options=dict(session.options),
                tools=self._offered(session),
            )
            messages = plain_messages(_as_sent(values))
            return SessionView(
                session_id=session.session_id,
                model_profile=session.model_profile,
                model_provider=identity.provider,
                model_name=identity.name,
                messages=[PlainMessage("system", system), *messages] if system else messages,
            )

    async def compact(
        self, session_id: str, action: Literal["clear", "summarise", "grow"], focus: str | None
    ) -> SessionCompactResult:
        """Clear old tool results, summarise old turns, or grow the window of an idle session.

        ``grow`` moves the planned window up one step for the next turn, with no test of how
        full the context is. Raises :class:`GrowRefusedError` when it cannot.

        Only the context view changes: the checkpoint keeps every message, and the next
        model call sends the smaller view. Stores ``context.changed`` (no run) unless there was
        nothing to do. The summary call can take a minute, and the session stays busy meanwhile.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`,
        :class:`SessionBusyError` when a run is open, waits for an approval, or a compaction
        is running, and whatever the summary call raises.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if (session.task is not None and not session.task.done()) or session.compacting:
                raise SessionBusyError(session_id)
            if await self._run_records.waiting(session_id) is not None:
                raise SessionBusyError(session_id)
            if action == "grow":
                return await self._grow_now(session)
            session.compacting = True
        try:
            system = await self._runtime.system_prompt(
                session_id,
                session.cwd,
                session.skills,
                sorted(session.mcp_servers),
                profile=session.model_profile,
                options=dict(session.options),
                tools=self._offered(session),
            )
            schemas = self._runtime.tools.scoped(_scope(session)).schemas()
            done = await self._runtime.compact(
                session_id,
                action,
                profile=session.model_profile,
                options=dict(session.options),
                focus=focus,
                system_chars=len(system),
                tools_chars=len(json.dumps(schemas, sort_keys=True, separators=(",", ":"))),
                local_only=self.local_only(session.cwd),
            )
            if done.view is not None:
                await self._events.emit(
                    session_id,
                    None,
                    "context.changed",
                    ContextChangedData(
                        action=done.action,
                        before_tokens=done.before_tokens,
                        after_tokens=done.after_tokens,
                        count=done.messages,
                        room=done.window,
                    ),
                )
        finally:
            session.compacting = False
        return SessionCompactResult(
            before_tokens=done.before_tokens,
            after_tokens=done.after_tokens,
            count=done.count,
            window=done.window,
            model=done.model,
        )

    async def trace(self, session_id: str) -> tuple[str | None, list[TraceRunSpan]]:
        """The session's title and its runs as a tree of spans. Does not start a run.

        A model span has its context window. One the event did not record gets
        today's window, marked estimated.

        Raises :class:`SessionNotFoundError` and :class:`SchemaMismatchError`, as
        :meth:`inspect` does.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            runs = build_trace(await self._events.stored(session_id))
            window_of = self._runtime.window_of
            if window_of is not None:
                runs = with_windows(
                    runs, lambda name: window_of(name, None).window, session.model_profile
                )
            return session.title, runs

    async def trace_context_events(self, session_id: str) -> list[TraceContextEvent]:
        """The session's ``context.changed`` events, for the trace.

        Raises :class:`SessionNotFoundError` and :class:`SchemaMismatchError`.
        """
        async with self._lock:
            await self._resolve(session_id)
            return context_events(await self._events.stored(session_id))

    async def trace_span(self, session_id: str, span_id: str) -> TraceSpanResult:
        """The input and output of one span, with the stored system prompt and tools.

        A model span also has ``context``: what filled the call, by part, each
        estimated and scaled to the tokens the provider counted.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`, and
        :class:`SpanNotFoundError` when no span of the session has ``span_id``.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            events = await self._events.stored(session_id)
            runs = build_trace(events)
            # A helper's calls are read from its own thread, not the session's.
            parent = helper_of(runs, span_id)
            thread = session_id if parent is None else child_thread(session_id, parent)
            messages = trace_messages(await self._runtime.values(thread))
        found = read_span(runs, events, messages, span_id)
        if found is None:
            raise SpanNotFoundError(span_id)
        updates: dict[str, object] = {}
        prompt: str | None = None
        tools: list[dict[str, object]] | None = None
        if self._blobs is not None:
            prompt = await self._blob(found.system_prompt_sha)
            tools = _schemas(await self._blob(found.tools_sha))
            updates["system_prompt"] = prompt
            updates["tools"] = tools
        span = found.result.span
        if span.kind == "model":
            window, estimated = found.context_window, found.window_estimated
            num_ctx = found.num_ctx
            window_of = self._runtime.window_of
            if window is None and window_of is not None:
                window, estimated = filled_window(
                    span, None, session.model_profile, lambda name: window_of(name, None).window
                )
                used = None if span.tokens is None else span.tokens.input
                if window is not None and used is not None and used > window:
                    window, estimated = None, False
            context, sized = context_breakdown(
                used=None if span.tokens is None else span.tokens.input,
                window=window,
                window_estimated=estimated,
                num_ctx=num_ctx,
                system_prompt=prompt,
                sections=found.result.system_sections,
                tools=tools,
                messages=found.result.messages,
                cleared_ids=found.cleared_ids,
                summary_chars=found.summary_chars,
                window_planned=found.window_planned,
                reserve=self._reply_reserve(),
            )
            updates["context"] = context.model_copy(
                update={
                    "prompt_cut": found.cut.cut,
                    "prompt_cut_kind": found.cut.kind,
                    "dropped_message_ids": list(found.cut.dropped_message_ids),
                    "dropped_tokens": found.cut.dropped_tokens,
                }
            )
            updates["messages"] = sized
        return found.result.model_copy(update=updates)

    def _reply_reserve(self) -> int:
        runtime = self._runtime
        settings = runtime.context
        if settings is None:
            settings = runtime.router.context_settings()
        return settings.reply_reserve

    async def _blob(self, sha256: str | None) -> str | None:
        if sha256 is None or self._blobs is None:
            return None
        found = await self._blobs.get(sha256)
        return None if found is None else found[1]

    async def close(self, session_id: str) -> str:
        """Hide ``session_id`` from the list. Its events stay in the log.

        A run still in progress is cancelled first. Closing a session that is
        already hidden returns its id.

        Raises :class:`SessionNotFoundError`.
        """
        while True:
            async with self._lock:
                record = await self._records.get(session_id)
                if record is None:
                    raise SessionNotFoundError(session_id)
                if record.closed_at is not None:
                    self._sessions.pop(session_id, None)
                    return session_id
                session = self._sessions.get(session_id)
                if session is not None:
                    session.closed = True
                live = self._run_for(session)
                naming = [
                    task
                    for task in self._naming
                    if task.get_name() == f"golem-title-{session_id}" and not task.done()
                ]
                if live is None and not naming:
                    waiting = await self._run_records.waiting(session_id)
                    if waiting is not None:
                        await self._cancel_waiting(session_id, waiting.run_id)
                    await self._events.emit(session_id, None, "session.closed", EmptyEventData())
                    self._sessions.pop(session_id, None)
                    return session_id
            if live is not None:
                await self._stop([live], "user")
            for task in naming:
                task.cancel()
            if naming:
                await asyncio.wait(naming)

    async def rename(self, session_id: str, title: str) -> str:
        """Set the title by hand. Returns it cleaned.

        Raises :class:`BlankTitleError`, :class:`SessionNotFoundError`, or
        :class:`SchemaMismatchError`.
        """
        cleaned = clean_title(title)
        if cleaned == "":
            raise BlankTitleError(session_id)
        async with self._lock:
            session = await self._resolve(session_id)
            await self._set_title(session, cleaned)
        return cleaned

    @property
    def router(self) -> ModelRouter:
        return self._runtime.router

    async def set_model(self, session_id: str, model: str) -> ModelIdentity:
        """Use ``model`` from the session's next run, and store ``model.selected``.

        A run in progress keeps the model it started with. Choosing the
        model the session already uses stores nothing.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`, or
        :class:`~golem.models.router.ModelConfigError` when ``model`` does not
        resolve or its provider has no key.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            router = self._runtime.router
            router.chat_model(model)
            identity = router.identity(model)
            if session.model_profile == model:
                return identity
            await self._events.emit(
                session_id,
                None,
                "model.selected",
                ModelSelectedData(
                    model_profile=model,
                    model_provider=identity.provider,
                    model_name=identity.name,
                    reason="user",
                ),
            )
            session.model_profile = model
            return identity

    async def session_options(self, session_id: str) -> dict[str, float | str]:
        """The session's option overrides.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            return dict((await self._resolve(session_id)).options)

    async def cwd_of(self, session_id: str) -> str | None:
        """The folder the session works in, None for a session without one.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            return (await self._resolve(session_id)).cwd

    @asynccontextmanager
    async def idle(self, session_id: str) -> AsyncGenerator[str | None]:
        """Keep the session without a run while the block runs. Yields its folder.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`, or
        :class:`SessionBusyError` when a run is active or waits on an approval.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                raise SessionBusyError(session_id)
            if await self._run_records.waiting(session_id) is not None:
                raise SessionBusyError(session_id)
            yield session.cwd

    async def announce_change(self, session_id: str, data: FileChangedData) -> None:
        """Tell the session's screens about a change made between runs."""
        await self._events.emit(session_id, None, "file.changed", data)

    async def is_busy(self, session_id: str) -> bool:
        """Whether a run is active or waits for an approval.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                return True
            return await self._run_records.waiting(session_id) is not None

    async def model_profile(self, session_id: str) -> str:
        """The profile or ref the session runs on.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            return (await self._resolve(session_id)).model_profile

    async def set_options(
        self,
        session_id: str,
        change: dict[str, float | str | None],
        think_values: Sequence[str] | None = None,
    ) -> dict[str, float | str]:
        """Override options for this session, and store ``model.options.changed``.

        A value of None removes an override. The overrides apply from the next run.
        Nothing is stored when they do not change.

        Raises :class:`SessionNotFoundError`, :class:`SchemaMismatchError`, or
        ``ValueError`` for an unknown option or a value out of range. ``think_values`` is
        what ``think`` takes for the session's model, or None to accept every value.
        """
        for name, value in change.items():
            if value is not None:
                model_options.validate(name, value, think_values if name == "think" else None)
        async with self._lock:
            session = await self._resolve(session_id)
            merged = dict(session.options)
            for name, value in change.items():
                if value is None:
                    merged.pop(name, None)
                else:
                    merged[name] = value
            if merged == session.options:
                return merged
            await self._events.emit(
                session_id, None, "model.options.changed", ModelOptionsChangedData(options=merged)
            )
            session.options = merged
            return dict(merged)

    async def set_mode(
        self, session_id: str, mode: PermissionMode | None
    ) -> tuple[PermissionMode, bool]:
        """Set the session's permission mode, or with None remove its override.

        Stores ``session.mode.changed`` and returns the effective mode and whether the
        session set it. Nothing is stored when the override does not change. The mode
        applies from the next tool call.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if mode != session.permission_mode:
                await self._events.emit(
                    session_id, None, "session.mode.changed", SessionModeChangedData(mode=mode)
                )
                session.permission_mode = mode
            return self._effective_mode(session), session.permission_mode is not None

    async def set_checks(self, session_id: str, on: bool) -> bool:
        """Say whether golem may run the project's checks in this session.

        Stores ``session.checks.changed`` unless the answer is the one it already has.
        It applies from the next turn.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if on != session.checks:
                await self._events.emit(
                    session_id, None, "session.checks.changed", SessionChecksChangedData(on=on)
                )
                session.checks = on
            return on

    async def set_route(self, session_id: str, mode: RouteMode) -> RouteMode:
        """Set how the session picks the model of each turn.

        Stores ``session.updated`` with the route unless the session already has it.
        It applies from the next turn.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if mode != session.route:
                await self._events.emit(
                    session_id, None, "session.updated", SessionUpdatedData(route=mode)
                )
                session.route = mode
            return mode

    async def set_plan(self, session_id: str, on: bool) -> bool:
        """Put the session in plan first, or take it out.

        Stores ``session.plan.changed`` unless the session is already so. It applies
        from the next turn.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if on != session.plan_first:
                await self._events.emit(
                    session_id, None, "session.plan.changed", SessionPlanChangedData(on=on)
                )
                session.plan_first = on
            return on

    async def permission_mode(self, session_id: str) -> PermissionMode:
        """The mode the session runs in: its override, else the one in ``config.toml``.

        Raises :class:`SessionNotFoundError` or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            return self._effective_mode(await self._resolve(session_id))

    def _effective_mode(self, session: _LiveSession) -> PermissionMode:
        return session.permission_mode or self._runtime.policy.default_mode()

    def configured_model(self) -> ModelIdentity:
        """The model ``daemon.status`` reports for this process."""
        return self._runtime.router.identity()

    async def send(
        self,
        session_id: str,
        text: str,
        *,
        cwd: str | None = None,
        skill: SkillCall | None = None,
        stronger: bool = False,
    ) -> str:
        """Start one graph run. Returns ``run_id`` before the model finishes.

        The run's events go to the targets attached to ``session_id``. A
        session without a folder takes ``cwd`` first, with ``session.updated``.
        With ``skill``, the model gets that skill's filled-in body instead of
        ``text``, and ``text`` is kept as what the user typed.

        With ``stronger``, this one turn runs on the tier above the model that wrote the
        last answer: only on route ``auto``, and the session's model and route stay.

        Raises :class:`SessionNotFoundError`, :class:`SessionBusyError`,
        :class:`SchemaMismatchError`, :class:`~golem.skills.invoke.SkillInvokeError`,
        or :class:`~golem.models.router.ModelConfigError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if session.task is not None and not session.task.done():
                raise SessionBusyError(session_id)
            if session.compacting:
                raise SessionBusyError(session_id)
            if await self._run_records.waiting(session_id) is not None:
                raise SessionBusyError(session_id)
            room = None if self.budget is None else await self.budget.room(session_id)
            # The folder may come with this message, so it is known before the model is chosen.
            folder = session.cwd if session.cwd is not None else cwd
            local_only = self.local_only(folder)
            routed = _Routed(session.model_profile, None)
            replaces = None
            if stronger:
                if local_only:
                    raise ModelConfigError(LOCAL_ONLY_REFUSAL, code="local_only")
                if session.route != "auto":
                    raise ModelConfigError(NO_STRONGER)
                replaces = await self._last_model(session_id)
                if replaces is None:
                    raise ModelConfigError(NO_STRONGER)
            if session.route != "pinned":
                routed = await self._route(
                    session, text, room, local_only=local_only, replaces=replaces
                )
            elif local_only:
                self._refuse_hosted(routed.profile)
            if routed.ask is None:
                self._check_budget(routed.profile, room)
            self._runtime.router.chat_model(routed.profile, local_only=local_only)
            growth = None
            if routed.ask is None:
                growth = await self._growth_for(session, routed.profile)
            invocation = None if skill is None else self._invoke(session_id, folder, skill)
            if session.cwd is None and cwd is not None:
                await self._events.emit(
                    session_id, None, "session.updated", SessionUpdatedData(cwd=cwd)
                )
                session.cwd = cwd
            turn = self._turn_of(
                session,
                routed,
                run_id=new_id("r"),
                user_message_id=new_id("m"),
                text=text if invocation is None else invocation.text,
                skill=invocation,
                typed=None if invocation is None else text,
                growth=growth,
                local_only=local_only,
            )
            if routed.ask is not None:
                await ask_consent(self._runtime, self._events, turn, routed.ask)
                return turn.run_id
            control = RunControl()
            await self._start(session, turn.run_id, control, self._turn(session, turn, control))
            return turn.run_id

    def _turn_of(
        self,
        session: _LiveSession,
        routed: _Routed,
        *,
        run_id: str,
        user_message_id: str,
        text: str,
        skill: Invocation | None,
        typed: str | None,
        begun: bool = False,
        growth: Growth | None = None,
        local_only: bool = False,
    ) -> Turn:
        return Turn(
            session_id=session.session_id,
            run_id=run_id,
            text=text,
            skill=skill,
            typed=typed,
            model_profile=routed.profile,
            schema_version=session.schema_version,
            user_message_id=user_message_id,
            assistant_message_id=new_id("m"),
            cwd=session.cwd,
            allowed_tools=_ordered(session.allowed_tools),
            mcp_servers=tuple(sorted(session.mcp_servers)),
            pinned=tuple(session.skills),
            pinned_folders=self._pinned_folders(session),
            options=dict(session.options),
            permission_mode=session.permission_mode,
            checks=session.checks,
            plan_first=session.plan_first,
            local_only=local_only or session.route == "local",
            pins=session.pins,
            routed=routed.choice,
            begun=begun,
            growth=growth,
            step_up=session.route == "auto",
            replaces=routed.replaces,
        )

    async def answer_consent(self, session_id: str, run_id: str, answer: ConsentAnswer) -> str:
        """Answer the paid step-up question ``run_id`` waits on, and go on with that run.

        ``session`` allows paid models for the rest of the session (unless ``[routing] paid``
        is ``always_ask``) and runs the turn on the paid model. ``once`` runs this turn on it.
        ``local`` picks again among the local models. Returns the run's id.

        Raises :class:`ApprovalNotFoundError`, :class:`ConsentAnswerError`,
        :class:`SessionNotFoundError`, or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            waiting = await self._run_records.waiting(session_id)
            pending = None
            if waiting is not None and waiting.run_id == run_id:
                pending = pending_consent(await self._events.for_run(run_id))
            if pending is None:
                raise ApprovalNotFoundError(run_id)
            if answer not in pending.alternatives:
                raise ConsentAnswerError(f"this question does not offer {answer}")
            await self._events.emit(
                session_id,
                run_id,
                "route.consent.answered",
                RouteConsentAnsweredData(answer=answer),
            )
            if answer == "session" and self._runtime.router.routing_settings().paid != "always_ask":
                await self._events.emit(
                    session_id, None, "session.updated", SessionUpdatedData(paid_ok=True)
                )
                session.paid_ok = True
            if pending.signal is not None:
                # The run is paused in its middle: it goes on with the answer, not a new turn.
                resume = Resume(
                    session_id=session_id,
                    run_id=run_id,
                    call_id="",
                    name="",
                    decision="deny",
                    user_message_id=pending.user_message_id,
                    open_calls=(),
                    consent=answer,
                    cwd=session.cwd,
                    allowed_tools=_ordered(session.allowed_tools),
                    mcp_servers=tuple(sorted(session.mcp_servers)),
                    pinned=tuple(session.skills),
                    pinned_folders=self._pinned_folders(session),
                    options=dict(session.options),
                    permission_mode=session.permission_mode,
                    checks=session.checks,
                    plan_first=session.plan_first,
                    local_only=self.local_only(session.cwd) or session.route == "local",
                    pins=session.pins,
                )
                control = RunControl()
                work = self._resumed(session, resume, control, None)
                await self._start(session, run_id, control, work)
                return run_id
            room = None if self.budget is None else await self.budget.room(session_id)
            try:
                local_only = self.local_only(session.cwd)
                routed = await self._route(
                    session, pending.text, room, answer, local_only, replaces=pending.replaces
                )
                self._runtime.router.chat_model(routed.profile, local_only=local_only)
            except _NoLocalFit as exc:
                fit = exc.choice.reason == "fit"
                failed = RunFailedData(
                    message=f"No local model can take this turn: {exc.choice.detail}.",
                    code="context_full" if fit else None,
                    hint="Use a model with a larger window, or start a new session."
                    if fit
                    else None,
                )
                await self._fail_waiting(session_id, run_id, failed)
                return run_id
            except ModelConfigError as exc:
                await self._fail_waiting(session_id, run_id, RunFailedData(message=str(exc)))
                return run_id
            invocation = None
            if pending.skill is not None:
                try:
                    invocation = self._invoke(session_id, session.cwd, pending.skill)
                except SkillInvokeError:
                    invocation = None
            turn = self._turn_of(
                session,
                routed,
                run_id=run_id,
                user_message_id=pending.user_message_id,
                text=pending.text,
                skill=invocation,
                typed=None,
                begun=True,
                growth=await self._growth_for(session, routed.profile),
                local_only=local_only,
            )
            if answer == "once" and room is not None and room.spent and self.budget is not None:
                self.budget.exempt(session_id)
            control = RunControl()
            await self._start(session, run_id, control, self._turn(session, turn, control))
            return run_id

    async def _fail_waiting(self, session_id: str, run_id: str, failed: RunFailedData) -> None:
        await self._events.emit(session_id, run_id, "run.failed", failed)
        await self._ended(session_id, run_id, None)

    def _growth_step(self, session: _LiveSession, profile: str) -> _Step:
        """The next window of ``profile``'s model, or raise why it cannot grow."""
        router = self._runtime.router
        plans = router.plans
        resolved = router.resolve(profile)
        name = resolved.model_id
        if plans is None or resolved.provider.kind != "ollama":
            raise GrowRefusedError(f"{name} is not a local model with a window golem plans")
        set_by_user = (
            router.context_settings().window != "auto"
            or resolved.ctx is not None
            or "num_ctx" in router.ollama_options(name, session.options)
        )
        if set_by_user:
            raise GrowRefusedError("the window is set by you")
        current = plans.planned(name)
        if current is None:
            raise GrowRefusedError(f"golem has not planned a window for {name}")
        size = plans.next_up(name)
        if size is None:
            raise GrowRefusedError(f"this Mac cannot hold a larger window for {name}")
        return _Step(name, current, size)

    def _apply_growth(self, session: _LiveSession, step: _Step) -> Growth:
        plans = self._runtime.router.plans
        assert plans is not None
        plans.raised(step.model_id, step.size)
        session.grew_at = self.clock()
        log.info(
            "window grows session=%s model=%s %d -> %d",
            session.session_id,
            step.model_id,
            step.current,
            step.size,
        )
        return Growth(step.current, step.size)

    async def _grow_now(self, session: _LiveSession) -> SessionCompactResult:
        """The manual ``grow``: the next turn's first call loads the larger window."""
        step = self._growth_step(session, session.model_profile)
        session.growth = self._apply_growth(session, step)
        reserve = self._runtime.router.context_settings().reply_reserve
        used = await self._records.last_input(session.session_id) or 0
        return SessionCompactResult(
            before_tokens=used,
            after_tokens=used,
            count=0,
            window=max(1, step.size - reserve),
            model=step.model_id,
            window_from=step.current,
            window_to=step.size,
        )

    async def _growth_for(self, session: _LiveSession, profile: str) -> Growth | None:
        """The growth this turn's first call reports: the one asked for, or one the session earned.

        A local session on a planned window that is full again after clearing or summarising
        moves up one step, at most once in ``GROW_EVERY`` seconds. Never during a run.
        """
        asked, session.growth = session.growth, None
        if asked is not None:
            return asked
        try:
            step = self._growth_step(session, profile)
        except (GrowRefusedError, ModelConfigError):
            return None
        if session.grew_at is not None and self.clock() - session.grew_at < GROW_EVERY:
            return None
        used = await self._records.last_input(session.session_id)
        if used is None:
            return None
        reserve = self._runtime.router.context_settings().reply_reserve
        await self._count_context(session)
        if not should_grow(
            used=used,
            window=step.current,
            reserve=reserve,
            clears_this_session=session.clears,
            summaries_this_session=session.summaries,
        ):
            return None
        return self._apply_growth(session, step)

    async def _count_context(self, session: _LiveSession) -> None:
        """Count the clears and summaries in the events the session stored since last time."""
        for event in await self._events.since(session.session_id, session.counted_seq):
            session.counted_seq = max(session.counted_seq, event.seq)
            if event.type != "context.changed":
                continue
            if event.data.action == "cleared":
                session.clears += 1
            elif event.data.action == "summarised":
                session.summaries += 1

    def _check_budget(self, profile: str, room: Room | None) -> None:
        """Refuse a turn on a paid model while a cap is spent. A local model is never refused.

        A turn that waits on the paid question is not refused: its answer decides.
        """
        if room is None or not room.spent or self.budget is None:
            return
        tier = None if self._runtime.tier_of is None else self._runtime.tier_of(profile)
        if tier in (None, "local"):
            return
        raise BudgetSpentError(self._spent_message(room))

    def _spent_message(self, room: Room) -> str:
        spent = room.spent_today if room.cap == "day" else room.spent_session
        cap = self._runtime.router.budget_settings()
        limit = cap.daily_usd if room.cap == "day" else cap.session_usd
        return f"{spent_text(room)}: ${spent:.2f} of ${limit or 0:.2f}; {BUDGET_HINT}"

    def local_only(self, cwd: str | None) -> bool:
        """Whether chats in ``cwd`` stay on this Mac.

        True when ``[routing] local_only`` lists the folder or one above it, or a project
        file at or above it sets the flag. Read from the current files, so a change applies
        to the next turn.
        """
        listed = self._runtime.router.routing_settings().local_only
        return is_local_only(cwd, listed, project_local_only(cwd))

    def _refuse_hosted(self, profile: str) -> None:
        """Raise a ``local_only`` error when ``profile`` is a hosted model."""
        try:
            self._runtime.router.ensure_local(profile)
        except ModelConfigError as exc:
            raise ModelConfigError(LOCAL_ONLY_REFUSAL, code="local_only") from exc

    async def _route(
        self,
        session: _LiveSession,
        text: str,
        room: Room | None = None,
        answer: ConsentAnswer | None = None,
        local_only: bool = False,
        replaces: str | None = None,
    ) -> _Routed:
        """The profile this turn runs on, and why. Reads cached facts, never the network.

        ``replaces`` is the model whose answer the user asked to redo: the pick takes the
        tier above it, for this turn only, and raises ``NO_STRONGER`` when nothing may run.

        A paid model needs the user's yes first, so a pick that lands on one comes back with
        the question to ask (``ask``). ``answer`` is the user's answer to that question: a yes
        takes the paid model and passes the caps, ``local`` leaves the paid models out. A
        session of a routine never asks: its paid models are left out.

        Raises :class:`~golem.models.router.ModelConfigError` on route ``local`` when the
        session's model is hosted and no local model passes, and on ``auto`` when only a paid
        model is left and paid models are off. Raises :class:`_NoLocalFit` for ``local``.
        In a local-only folder it raises with the code ``local_only`` when only a hosted
        model is left.
        """
        router = self._runtime.router
        settings = router.routing_settings()
        over_ask = router.budget_settings().over == "ask"
        interactive = not session.origin.startswith("routine:")
        yes = answer in ("session", "once")
        everything = await self._facts_of(session, settings.ladder.model_dump().values())
        candidates = ladder(settings.ladder, session.model_profile, everything)
        own = next((m for m in candidates if session.model_profile in (m.profile, m.ref)), None)
        floor = None if local_only else session.step_floor
        if replaces is not None:
            floor = self._above(replaces, everything)
            if floor is None:
                raise ModelConfigError(NO_STRONGER)
        used = await self._records.last_input(session.session_id)
        prompt = None if used is None else used + len(text) // 4
        reserve = router.context_settings().reply_reserve
        traits = Traits(
            prompt_tokens=prompt,
            reply_reserve=reserve,
            needs_tools=True,
            local_only=local_only or session.route == "local",
            paid_allowed=yes or (session.paid_ok and settings.paid != "always_ask"),
            paid_room_usd=None if room is None or yes or (over_ask and interactive) else room.usd,
            min_tier=floor,
        )
        why_left = None
        if local_only:
            why_left = "this folder is local only"
        elif answer == "local":
            why_left = "you chose to stay local"
        elif settings.paid == "never" or not interactive:
            why_left = "paid models are turned off"
        pool = candidates
        held: list[Rejected] = []
        if why_left is not None:
            pool = [m for m in candidates if m.tier == "local"]
            held = [Rejected(m.ref, m.tier, why_left) for m in candidates if m.tier != "local"]
        choice = Choice(None, "fallback", "no model facts", ())
        if own is not None:
            choice = pick(session.route, own, pool, traits)
        if held:
            choice = replace(choice, rejected=(*choice.rejected, *held))
        picked = choice.model
        if replaces is not None:
            if picked is None:
                if answer == "local":
                    raise ModelConfigError("You chose to stay local, so no stronger model runs.")
                raise ModelConfigError(NO_STRONGER)
            choice = replace(choice, reason="user", detail="you asked for a stronger model")
            ask = None
            if not yes:
                ask = self._question(
                    session,
                    picked.profile,
                    picked.tier,
                    picked.price,
                    room,
                    choice,
                    text,
                    prompt,
                    why="You asked for a stronger model.",
                    replaces=replaces,
                )
            return _Routed(picked.profile, choice, ask, replaces)
        if picked is not None:
            if answer == "local":
                choice = replace(choice, detail="you chose to stay local")
            elif choice.reason == "budget" and room is not None:
                choice = replace(choice, detail=spent_text(room))
            ask = None
            if not yes:
                ask = self._question(
                    session, picked.profile, picked.tier, picked.price, room, choice, text, prompt
                )
            return _Routed(picked.profile, choice, ask)
        tier = own.tier if own is not None else None
        if tier is None and self._runtime.tier_of is not None:
            tier = self._runtime.tier_of(session.model_profile)
        if local_only:
            self._refuse_hosted(session.model_profile)
        if session.route == "local" and tier != "local":
            raise ModelConfigError(
                "this session is local only and has no local model; pick one with /model"
            )
        if answer == "local":
            raise _NoLocalFit(choice)
        detail = f"no other model passed ({choice.detail}), so the session's model runs"
        fallback = Choice(own, "fallback", detail, choice.rejected)
        if tier not in (None, "local") and not yes:
            if why_left is not None:
                raise ModelConfigError(
                    f"no local model can take this turn ({choice.detail}), and {why_left}"
                )
            price = None if own is None else own.price
            ask = self._question(
                session,
                session.model_profile,
                tier,
                price,
                room,
                choice,
                text,
                prompt,
                fallback=True,
            )
            return _Routed(session.model_profile, fallback, ask)
        return _Routed(session.model_profile, fallback)

    async def _next_model(
        self, session_id: str, profile: str, ask: StepRequest
    ) -> StepUp | StepAsk | None:
        """The model the rest of a run moves to, or None when it stays on ``profile``.

        A struggle asks for the tier above the current one, a prompt that does not fit for a
        model with a larger window. A failing provider (``fallback``) asks for another model:
        the same tier first, then the tier above, then, from a hosted model, a local one. The
        failed model and the providers marked in ``router.health`` are left out. The privacy,
        the caps and the paid question are the pick's own. A paid model needs a yes the session
        already gave (or ``ask.answer``). A struggle in an interactive session that may ask
        gets a :class:`StepAsk` instead: the run waits for the answer. A failing provider and
        a prompt that does not fit never ask: the run stays.
        """
        session = await self._resolve(session_id)
        router = self._runtime.router
        settings = router.routing_settings()
        local_only = self.local_only(session.cwd) or session.route == "local"
        tier = None if self._runtime.tier_of is None else self._runtime.tier_of(profile)
        fallback = ask.signal == "fallback"
        floor: Tier | None = None  # for a fallback, the failed model's tier, below
        if not fallback and ask.signal != "context_full":
            if tier is None or tier == TIERS[-1]:
                return None
            floor = TIERS[TIERS.index(tier) + 1]
        interactive = not session.origin.startswith("routine:")
        room = None if self.budget is None else await self.budget.room(session_id)
        everything = await self._facts_of(session, settings.ladder.model_dump().values())
        candidates = everything if fallback else ladder(settings.ladder, profile, everything)
        own = next((m for m in candidates if profile in (m.profile, m.ref)), None)
        if fallback:
            tier = tier if own is None else own.tier
            floor = tier
            candidates = [m for m in candidates if self._usable(profile, m)]
            own = own or next(iter(candidates), None)
        if own is None or (fallback and tier is None):
            return None
        if local_only or settings.paid == "never" or not interactive:
            candidates = [m for m in candidates if m.tier == "local"]
        traits = Traits(
            prompt_tokens=ask.need,
            reply_reserve=router.context_settings().reply_reserve,
            local_only=local_only,
            paid_allowed=ask.answer in ("session", "once")
            or (session.paid_ok and settings.paid == "ask"),
            paid_room_usd=None if room is None else room.usd,
            min_tier=floor,
        )
        choice = pick("auto", own, candidates, traits)
        found = choice.model
        if fallback and (found is None or choice.needs_consent) and tier != "local":
            # No other hosted model is allowed: a local one does not need a yes.
            local = [m for m in candidates if m.tier == "local"]
            choice = pick("auto", own, local, replace(traits, min_tier=None))
            found = choice.model
        if found is None or found.ref == own.ref:
            return None
        if choice.needs_consent:
            if fallback or ask.signal == "context_full" or ask.answer is not None:
                return None
            if local_only or not interactive or settings.paid == "never":
                return None
            if ask.detail is None:
                return None
            question = self._question(
                session,
                found.profile,
                found.tier,
                found.price,
                room,
                choice,
                "",
                ask.prompt,
                why=ask.detail,
                signal=ask.signal,
            )
            if question is None:
                return None
            return StepAsk(found.profile, found.tier, choice, question)
        if local_only and found.tier != "local":
            return None
        if fallback:
            return StepUp(found.profile, found.tier, choice)
        count = session.step_ups.get(ask.signal, 0) + 1
        session.step_ups[ask.signal] = count
        if count >= 2 and not local_only and found.tier != "local":
            session.step_floor = found.tier
        return StepUp(found.profile, found.tier, choice)

    def _usable(self, failed: str, model: ModelFacts) -> bool:
        """Whether ``model`` may replace ``failed``: another, ready, with a healthy provider."""
        router = self._runtime.router
        try:
            if router.resolve(failed).ref == model.ref:
                return False
        except ModelConfigError:
            pass
        return model.ready and router.health.why(model.ref.partition("/")[0]) is None

    def _question(
        self,
        session: _LiveSession,
        profile: str,
        tier: Tier | None,
        price: ModelPrice | None,
        room: Room | None,
        choice: Choice,
        text: str,
        prompt: int | None,
        *,
        fallback: bool = False,
        why: str | None = None,
        signal: str | None = None,
        replaces: str | None = None,
    ) -> Consent | None:
        """The question to ask before a turn runs on ``profile``, None when none is needed.

        A local model is never asked about. A spent cap with ``over = "ask"`` asks with only
        ``once`` and ``local``. Otherwise the first paid model of a session asks, and every
        one does with ``paid = "always_ask"``. A spent cap with ``over = "local"`` is
        refused by :meth:`_check_budget`, not asked.
        """
        if tier in (None, "local"):
            return None
        router = self._runtime.router
        settings = router.routing_settings()
        budget = router.budget_settings()
        caps = None
        if room is not None and (budget.daily_usd is not None or budget.session_usd is not None):
            caps = ConsentCaps(
                session_usd=budget.session_usd,
                daily_usd=budget.daily_usd,
                spent_session=room.spent_session,
                spent_today=room.spent_today,
            )
        answers: tuple[ConsentAnswer, ...] = ("session", "once", "local")
        if room is not None and room.spent:
            if budget.over != "ask":
                return None
            limit = budget.daily_usd if room.cap == "day" else budget.session_usd
            word = "daily" if room.cap == "day" else "session"
            why = f"The {word} budget (${limit or 0:.2f}) is spent."
            answers = ("once", "local")
        elif session.paid_ok and settings.paid != "always_ask":
            return None
        elif why is not None:
            pass
        elif fallback:
            why = (
                f"No other model can take this turn ({choice.detail}),"
                " so your own model, which is paid, would run."
            )
        else:
            why = f"No local model can take this turn: {choice.detail}."
        if price is None and self._runtime.price_of is not None:
            price = self._runtime.price_of(profile)
        tokens = len(text) // 4 if prompt is None else prompt
        reserve = router.context_settings().reply_reserve
        estimate = cost_usd({"input": tokens, "output": reserve}, price)
        return Consent(profile, tier, why, estimate, answers, caps, signal, replaces)

    async def _last_model(self, session_id: str) -> str | None:
        """The ``provider/model`` that wrote the last answer, from the newest ``model.routed``."""
        for event in reversed(await self._events.stored(session_id)):
            if isinstance(event, ModelRoutedEvent):
                data = event.data
                if data.provider is not None and data.model is not None:
                    return f"{data.provider}/{data.model}"
                return data.model_profile
        return None

    def _above(self, ref: str, facts: Sequence[ModelFacts]) -> Tier | None:
        """The tier above ``ref``'s, None when it is the top one or its tier is not known."""
        known = next((m.tier for m in facts if ref in (m.ref, m.profile)), None)
        if known is None and self._runtime.tier_of is not None:
            known = self._runtime.tier_of(ref)
        if known is None or known == TIERS[-1]:
            return None
        return TIERS[TIERS.index(known) + 1]

    async def _facts_of(self, session: _LiveSession, named: Iterable[object]) -> list[ModelFacts]:
        """The facts of the session's model, the ladder's names and every listed model."""
        if self.facts is None:
            return []
        router = self._runtime.router
        refs: list[str] = []
        for name in (session.model_profile, *(n for n in named if isinstance(n, str))):
            try:
                refs.append(router.resolve(name).ref)
            except ModelConfigError:
                continue
        refs.extend(self.listed_refs())
        return await self.facts.facts(list(dict.fromkeys(refs)), overrides=dict(session.options))

    async def respond(
        self,
        session_id: str,
        call_id: str,
        decision: ApprovalDecision,
        args: dict[str, object] | None = None,
    ) -> str:
        """Answer the tool call ``session_id``'s run waits on, and go on with that run.

        Returns the run's id once ``approval.resolved`` is in the log.

        ``allow_always`` writes an allow rule for exactly this call first in
        the user's ``config.toml`` before the run goes on. ``args`` are the
        call's arguments as the user edited them, with ``allow``: the tool must
        accept them, and no rule may deny the edited call.

        Raises :class:`ApprovalNotFoundError`, :class:`SessionNotFoundError`,
        :class:`SessionBusyError`, :class:`RuleWriteError`,
        :class:`InvalidToolArgsError`, or :class:`SchemaMismatchError`.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            run = await self._run_records.waiting(session_id)
            live = session.task is not None and not session.task.done()
            if run is None:
                if live:
                    raise SessionBusyError(session_id)
                raise ApprovalNotFoundError(call_id)
            if live and session.task is not None:
                # approval.needed is stored before the paused task has finished closing its stream.
                await asyncio.wait({session.task})
            pending = pending_approval(await self._events.for_run(run.run_id))
            if pending is None or pending.call_id != call_id:
                raise ApprovalNotFoundError(call_id)
            if args is not None and args == pending.args:
                args = None
            if args is not None:
                args = self._check_edited(session, pending.name, decision, args)
            rule: str | None = None
            if decision == "allow_always":
                rule = await self._remember(session, pending.name, pending.args)
            if decision == "allow_session":
                session.allowed_tools.add((pending.name, pending.subject))
            if pending.name == MCP_ENABLE and decision != "deny":
                # Approving "turn on X" also approves X's tools for the rest of the session.
                server = (args if args is not None else pending.args).get("name")
                if isinstance(server, str) and server != "":
                    session.allowed_tools.add(server_grant(server))
            resume = Resume(
                session_id=session_id,
                run_id=run.run_id,
                call_id=call_id,
                name=pending.name,
                decision=decision,
                user_message_id=pending.user_message_id,
                open_calls=pending.open_calls,
                cwd=session.cwd,
                allowed_tools=_ordered(session.allowed_tools),
                asked=pending.asked,
                subject=pending.subject,
                rule=rule,
                diff=pending.diff,
                args=args,
                mcp_servers=tuple(sorted(session.mcp_servers)),
                pinned=tuple(session.skills),
                pinned_folders=self._pinned_folders(session),
                options=dict(session.options),
                permission_mode=session.permission_mode,
                checks=session.checks,
                plan_first=session.plan_first,
                local_only=self.local_only(session.cwd) or session.route == "local",
                pins=session.pins,
            )
            control = RunControl()
            work = self._resumed(session, resume, control, pending.prompt)
            await self._start(session, run.run_id, control, work)
            return run.run_id

    async def allowances(self, session_id: str) -> list[Allowance]:
        """What ``session_id`` allows for the rest of the session."""
        async with self._lock:
            session = await self._resolve(session_id)
            return list(_ordered(session.allowed_tools))

    async def revoke(self, session_id: str, tool: str, subject: str | None) -> bool:
        """Stop allowing ``tool`` with ``subject`` for the rest of the session.

        Stores ``session.updated`` with the list that is left. Returns False
        when it was not allowed.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if (tool, subject) not in session.allowed_tools:
                return False
            session.allowed_tools.discard((tool, subject))
            left = [
                SessionAllowance(tool=name, subject=item)
                for name, item in _ordered(session.allowed_tools)
            ]
            await self._events.emit(
                session_id, None, "session.updated", SessionUpdatedData(allowed_tools=left)
            )
            return True

    async def tool_scope(self, session_id: str) -> ToolScope:
        """The outside tools ``session_id`` sees: its folder and its enabled MCP servers."""
        async with self._lock:
            return _scope(await self._resolve(session_id))

    async def set_mcp(self, session_id: str, name: str, enabled: bool) -> list[str]:
        """Turn the on-demand MCP server ``name`` on or off for the session.

        Stores ``session.updated`` with the whole list when it changed, so it
        survives a restart. Returns the list. Whether ``name`` is an
        on-demand server is the caller's check.
        """
        async with self._lock:
            session = await self._resolve(session_id)
            if (name in session.mcp_servers) != enabled:
                if enabled:
                    session.mcp_servers.add(name)
                else:
                    session.mcp_servers.discard(name)
                await self._events.emit(
                    session_id,
                    None,
                    "session.updated",
                    SessionUpdatedData(mcp_servers=sorted(session.mcp_servers)),
                )
            return sorted(session.mcp_servers)

    async def set_skills(
        self, session_id: str, pin: Sequence[str] = (), unpin: Sequence[str] = ()
    ) -> list[str]:
        """Pin skills for the whole session, or unpin them. Returns the pins, in order.

        Each new pin is ``skill.activated`` with ``how: "pinned"``, and each
        unpin is ``skill.deactivated``. Both are stored, so the pins survive a
        restart. From the next turn on, every model call has the pinned bodies
        in its system prompt.
        Pinning a pinned skill, or unpinning one that is not, changes nothing.

        Raises :class:`SessionNotFoundError`, or :class:`SkillPinError` when a
        name is in both lists or the session cannot pin it. Nothing changes then.
        """
        both = sorted(set(pin) & set(unpin))
        if both:
            raise SkillPinError(f"{both[0]} is in both pin and unpin")
        async with self._lock:
            session = await self._resolve(session_id)
            new = [name for name in dict.fromkeys(pin) if name not in session.skills]
            gone = [name for name in dict.fromkeys(unpin) if name in session.skills]
            found = []
            if new:
                if self._skills is None:
                    raise SkillPinError("skills are not loaded in this daemon")
                view = self._skills.view(None if session.cwd is None else Path(session.cwd))
                found = [pinnable(view, name) for name in new]
            for entry in found:
                skill = entry.skill
                await self._events.emit(
                    session_id,
                    None,
                    "skill.activated",
                    SkillActivatedData(
                        name=skill.name,
                        source=entry.origin,
                        how="pinned",
                        path=str(skill.path),
                        hash=skill.hash,
                    ),
                )
                session.skills.append(skill.name)
                session.pins.read(skill.name, skill.hash)
            for name in gone:
                await self._events.emit(
                    session_id,
                    None,
                    "skill.deactivated",
                    SkillDeactivatedData(name=name, reason="unpinned"),
                )
                session.skills.remove(name)
                session.pins.forget(name)
            return list(session.skills)

    def _pinned_folders(self, session: _LiveSession) -> tuple[str, ...]:
        """The folders of the session's pins that it can use now."""
        if self._skills is None or not session.skills:
            return ()
        return tuple(pinned_folders(self._skills, session.cwd, session.skills))

    def _check_edited(
        self, session: _LiveSession, name: str, decision: ApprovalDecision, args: dict[str, object]
    ) -> dict[str, object]:
        """The edited arguments as the tool reads them, once the tool and the rules accept them.

        The folder checks run when the call does: an earlier call of the same
        reply may create the file this one edits.
        """
        if decision != "allow":
            raise InvalidToolArgsError("edited arguments run once, so the answer must be allow")
        root = None if session.cwd is None else Path(session.cwd)
        tools, policy = self._runtime.tools.scoped(_scope(session)), self._runtime.policy
        try:
            checked = tools.validate(name, args)
        except ToolError as exc:
            raise InvalidToolArgsError(str(exc)) from exc
        verdict = policy.check(tools, name, checked, root, session.permission_mode)
        if verdict.action == "deny":
            raise InvalidToolArgsError(explain(verdict, name))
        return checked

    async def _remember(self, session: _LiveSession, name: str, args: dict[str, object]) -> str:
        root = None if session.cwd is None else Path(session.cwd)
        policy, tools = self._runtime.policy, self._runtime.tools.scoped(_scope(session))
        try:
            return await asyncio.to_thread(policy.remember, tools, name, args, root)
        except (OSError, ValueError) as exc:
            raise RuleWriteError(str(exc)) from exc

    async def _start(
        self,
        session: _LiveSession,
        run_id: str,
        control: RunControl,
        work: Coroutine[None, None, None],
    ) -> None:
        task = asyncio.create_task(work, name=f"golem-run-{run_id}")
        session.task = task
        self._runs[run_id] = _LiveRun(task=task, control=control)
        task.add_done_callback(lambda done: self._finished(run_id, done))
        await control.started.wait()

    async def cancel(self, run_id: str) -> bool:
        """Stop a run in progress. Returns once ``run.cancelled`` is in the log.

        Returns False for a run that already ended. Raises
        :class:`RunNotFoundError` for an id the daemon never ran.
        """
        live = self._runs.get(run_id)
        if live is not None and not live.task.done():
            await self._stop([live], "user")
            return True
        record = await self._run_records.get(run_id)
        if record is None:
            raise RunNotFoundError(run_id)
        if record.status == "waiting":
            async with self._lock:
                return await self._cancel_waiting(record.session_id, run_id)
        return False

    async def _cancel_waiting(self, session_id: str, run_id: str) -> bool:
        """End a run that waits for an approval. Its next turn repairs the checkpoint."""
        current = await self._run_records.get(run_id)
        if current is None or current.status != "waiting":
            return False
        pending = pending_approval(await self._events.for_run(run_id))
        calls = () if pending is None else pending.open_calls
        await fail_calls(self._events, session_id, run_id, calls, NOT_APPROVED)
        await self._events.emit(
            session_id, run_id, "run.cancelled", RunCancelledData(reason="user")
        )
        await self._ended(session_id, run_id, None)
        return True

    async def cancel_all(self) -> None:
        """Stop every run in progress, with the reason ``shutdown``, and any title being chosen.

        A session whose title was cancelled gets one after its next completed run.
        """
        await self._stop(list(self._runs.values()), "shutdown")
        naming = set(self._naming)
        for task in naming:
            task.cancel()
        if naming:
            await asyncio.wait(naming)

    async def _stop(self, runs: list[_LiveRun], reason: CancelReason) -> None:
        for run in runs:
            if run.control.reason is None:
                run.control.reason = reason
                run.task.cancel()
        tasks = {run.task for run in runs}
        if tasks:
            await asyncio.wait(tasks)

    def _invoke(self, session_id: str, folder: str | None, call: SkillCall) -> Invocation:
        if self._skills is None:
            raise SkillInvokeError("skills are not loaded in this daemon")
        view = self._skills.view(None if folder is None else Path(folder))
        return invoke(view, call, session_id=session_id)

    async def _turn(self, session: _LiveSession, turn: Turn, control: RunControl) -> None:
        try:
            reply = await run_turn(self._runtime, self._events, turn, control)
        except asyncio.CancelledError:
            await self._ended(session.session_id, turn.run_id, None)
            raise
        finally:
            if self.budget is not None:
                self.budget.restore(session.session_id)
        await self._ended(session.session_id, turn.run_id, reply)
        self._title_after(
            session,
            turn.typed or turn.text,
            reply,
            local_only=turn.local_only,
            # A routed turn may run on another model than the session's own.
            profile=turn.model_profile if turn.local_only else None,
        )

    async def _resumed(
        self, session: _LiveSession, resume: Resume, control: RunControl, prompt: str | None
    ) -> None:
        try:
            reply = await resume_turn(self._runtime, self._events, resume, control)
        except asyncio.CancelledError:
            await self._ended(resume.session_id, resume.run_id, None)
            raise
        await self._ended(resume.session_id, resume.run_id, reply)
        if prompt is not None:
            self._title_after(session, prompt, reply, local_only=resume.local_only)

    async def _ended(self, session_id: str, run_id: str, reply: str | None) -> None:
        """Store ``session.completed`` when a run of a headless session ended.

        A run that stopped on an approval, or that is still open, says nothing:
        ``approval.needed`` is its event. ``reply`` is the model's answer of a
        run that completed.
        """
        live = self._sessions.get(session_id)
        if live is not None:
            origin = live.origin
        else:
            record = await self._records.get(session_id)
            origin = "user" if record is None else record.origin
        if origin == "user":
            return
        run = await self._run_records.get(run_id)
        if run is None or run.status in ("running", "waiting"):
            return
        await self._events.emit(
            session_id,
            run_id,
            "session.completed",
            SessionCompletedData(
                run_id=run_id,
                status=run.status,
                summary=None if run.status != "completed" else cut_summary(reply),
            ),
        )

    def _title_after(
        self,
        session: _LiveSession,
        prompt: str,
        reply: str | None,
        *,
        local_only: bool = False,
        profile: str | None = None,
    ) -> None:
        if reply is None or self._titles is None or session.title is not None or session.titling:
            return
        session.titling = True
        task = asyncio.create_task(
            self._name(session, self._titles, prompt, reply, local_only, profile),
            name=f"golem-title-{session.session_id}",
        )
        self._naming.add(task)
        task.add_done_callback(self._named)

    async def _name(
        self,
        session: _LiveSession,
        titles: TitleGenerator,
        prompt: str,
        reply: str,
        local_only: bool,
        profile: str | None,
    ) -> None:
        try:
            title = await choose_title(
                titles,
                model_profile=profile or session.model_profile,
                prompt=prompt,
                reply=reply,
                options=dict(session.options),
                session_id=session.session_id,
                local_only=local_only,
            )
            async with self._lock:
                if session.title is None and not session.closed:
                    await self._set_title(session, title)
        finally:
            session.titling = False

    async def _set_title(self, session: _LiveSession, title: str) -> None:
        await self._events.emit(
            session.session_id, None, "session.updated", SessionUpdatedData(title=title)
        )
        session.title = title

    def _run_for(self, session: _LiveSession | None) -> _LiveRun | None:
        if session is None or session.task is None or session.task.done():
            return None
        for run in self._runs.values():
            if run.task is session.task:
                return run
        return None

    async def _resolve(self, session_id: str) -> _LiveSession:
        existing = self._sessions.get(session_id)
        if existing is not None:
            if existing.closed:
                raise SessionNotFoundError(session_id)
            return existing
        record = await self._records.get(session_id)
        if record is not None and record.closed_at is not None:
            raise SessionNotFoundError(session_id)
        values = await self._runtime.values(session_id)
        if values and values.get("schema_version") != SCHEMA_VERSION:
            raise SchemaMismatchError(values.get("schema_version"))
        if record is not None:
            profile = record.model_profile
        else:
            found = values.get("model_profile")
            if not isinstance(found, str) or found == "":
                raise SessionNotFoundError(session_id)
            profile = found
        session = _LiveSession(
            session_id=session_id,
            model_profile=profile,
            schema_version=SCHEMA_VERSION,
            title=None if record is None else record.title,
            cwd=None if record is None else record.cwd,
            origin="user" if record is None else record.origin,
            allowed_tools=set() if record is None else set(record.allowed_tools),
            mcp_servers=set() if record is None else set(record.mcp_servers),
            skills=[] if record is None else list(record.skills),
            options={} if record is None else dict(record.options),
            permission_mode=None if record is None else record.permission_mode,
            checks=None if record is None else record.checks,
            route="pinned" if record is None else record.route,
            paid_ok=False if record is None else record.paid_ok,
            plan_first=False if record is None else record.plan_first,
        )
        if session.skills:
            session.pins = PinMemory.from_events(await self._events.stored(session_id))
        if record is None:
            await self._announce(session)
        self._sessions[session_id] = session
        return session

    async def _announce(self, session: _LiveSession, forked_from: ForkedFrom | None = None) -> None:
        chosen = self._runtime.router.identity(session.model_profile)
        await self._events.emit(
            session.session_id,
            None,
            "session.created",
            SessionCreatedData(
                model_profile=session.model_profile,
                model_provider=chosen.provider,
                model_name=chosen.name,
                forked_from=forked_from,
                cwd=session.cwd,
                origin=None if session.origin == "user" else session.origin,
                route=session.route,
            ),
        )

    def _finished(self, run_id: str, task: asyncio.Task[None]) -> None:
        self._runs.pop(run_id, None)
        _report(task, "run task failed")

    def _named(self, task: asyncio.Task[None]) -> None:
        self._naming.discard(task)
        _report(task, "title task failed")


def _scope(session: _LiveSession) -> ToolScope:
    root = None if session.cwd is None else Path(session.cwd)
    return ToolScope(root=root, enabled=frozenset(session.mcp_servers))


def _ordered(allowed: set[Allowance]) -> tuple[Allowance, ...]:
    return tuple(sorted(allowed, key=lambda pair: (pair[0], pair[1] or "")))


def _pin_events(
    stored: Sequence[ChatEvent], names: Sequence[str]
) -> list[SkillActivatedEvent | SkillSkippedEvent]:
    """For each pin in ``names``, what the log last said about it, to copy into a fork.

    That is its newest pinned ``skill.activated``, and the ``skill.skipped``
    after it, if one came later.
    """
    copied: list[SkillActivatedEvent | SkillSkippedEvent] = []
    for name in names:
        activated: SkillActivatedEvent | None = None
        skipped: SkillSkippedEvent | None = None
        for event in stored:
            if isinstance(event, SkillActivatedEvent) and event.data.how == "pinned":
                if event.data.name == name:
                    activated, skipped = event, None
            elif isinstance(event, SkillSkippedEvent) and event.data.name == name:
                skipped = event
        copied.extend(event for event in (activated, skipped) if event is not None)
    return copied


def _completed_through(
    events: list[ChatEvent], message_id: str
) -> list[MessageCompletedEvent] | None:
    """The completed messages up to and including ``message_id``, or None if it never completed."""
    completed: list[MessageCompletedEvent] = []
    for event in events:
        if isinstance(event, MessageCompletedEvent):
            completed.append(event)
            if event.data.message_id == message_id:
                return completed
    return None


def _report(task: asyncio.Task[None], message: str) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error(message, exc_info=exc)


__all__ = [
    "ApprovalNotFoundError",
    "BlankTitleError",
    "InvalidToolArgsError",
    "MessageNotFoundError",
    "RuleWriteError",
    "RunNotFoundError",
    "SchemaMismatchError",
    "SessionBusyError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionView",
]


def _as_sent(values: Mapping[str, object]) -> dict[str, object]:
    """``values`` with its messages as the next model call would send them."""
    raw = values.get("messages")
    if not isinstance(raw, list):
        return dict(values)
    stored = [m for m in cast(list[object], raw) if isinstance(m, BaseMessage)]
    ctx = cast(ContextView | None, values.get("context_view"))
    return {**values, "messages": view(stored, ctx)}
