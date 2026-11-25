"""The chat graph: ``START → call_model``, then ``tools → call_model`` while
the reply asks for tools, then ``checks`` and ``END``. On route ``auto`` a struggling
model or a prompt that cannot fit sends the run through ``step_up`` once: the rest of the run
goes on a stronger model. A provider that fails sends the run back to ``call_model`` on
another model, at most twice.

Checkpoint messages carry the protocol ``message_id`` as their LangChain
``id``, so the event log and the checkpoint name the same message. The first
model call of a turn uses the turn's assistant id. Each later call gets a new
one and announces it on the custom stream. A fork uses those ids to find
where to cut a thread's history.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, aclosing, asynccontextmanager, nullcontext
from dataclasses import dataclass, replace
from typing import Any, Literal, Protocol, cast

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.types import Command, interrupt

from golem.coding.changes import ChangeStore
from golem.config import ContextSettings, ModelPrice, PermissionMode
from golem.graphs.adapter import CONSENT_KIND, STREAM_KEY, message_text, stop_reason_of
from golem.graphs.checks_node import CHECKS_KEY, checks_node
from golem.graphs.child import (
    FINAL_REQUEST,
    ChildLimits,
)
from golem.graphs.compact import Compaction, clear_now, summarise_now
from golem.graphs.context_view import (
    SUMMARY_ID,
    ContextView,
    cleared_ids,
    freed_by,
    plan_clear,
    plan_summary,
    sent_chars,
    used_tokens,
    view,
)
from golem.graphs.delegate_policy import Prices
from golem.graphs.estimate import TokenRatios
from golem.graphs.fit import Fitted, fit_prompt, num_predict_of, prompt_estimate, reply_reserve
from golem.graphs.memory_stub import stub_local_notes
from golem.graphs.notes import is_note, note
from golem.graphs.prompt import PINNED_KEY, PromptContext, SystemPrompt
from golem.graphs.result_budget import ResultBudget, result_budget
from golem.graphs.state import AgentState
from golem.graphs.step_up import NextModel, StepAsk, StepRequest, StepUp
from golem.graphs.struggle import Struggle, detect
from golem.graphs.summarise import Summariser
from golem.graphs.text_calls import recover, recover_json_tail, unwrapped
from golem.graphs.tools_node import (
    ALLOWED_KEY,
    ASKED_KEY,
    CHILD_KEY,
    CWD_KEY,
    LOCAL_ONLY_KEY,
    MCP_KEY,
    MCP_NOW_KEY,
    MEMORY_KEY,
    MODE_KEY,
    PINNED_FOLDERS_KEY,
    PLAN_KEY,
    Answer,
    BudgetOf,
    ChildScope,
    EnableMcp,
    HelperHost,
    cancelled_results,
    child_of,
    memory_of,
    scope_of,
    tools_node,
    unanswered_calls,
)
from golem.memory.privacy import Target
from golem.memory.section import memory_block
from golem.memory.service import MemoryAccess
from golem.models.discovery import Loaded
from golem.models.dispatcher import Call, Dispatcher, Grant, LineKey, Wait
from golem.models.errors import (
    BUDGET_HINT,
    BudgetSpent,
    ContextFull,
    Failure,
    ModelUnreachable,
    failure_note,
    failure_of,
    provider_error,
    retry_after,
    retry_delay,
)
from golem.models.ollama import LocalServers
from golem.models.pick import size_text
from golem.models.roles import RoleModel, for_role
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow, WindowOf
from golem.models.window_plan import spilled
from golem.permissions.engine import Allowance
from golem.permissions.policy import Policy
from golem.sessions.helper_estimate import EstimateCard
from golem.sessions.ids import new_id
from golem.skills.registry import SkillRegistry
from golem.tools import default_registry
from golem.tools.delegate import HelperOutcome, HelperSpec
from golem.tools.registry import Artifacts, ToolError, ToolRegistry

log = logging.getLogger("golem.graphs")

OPTIONS_KEY = "golem_model_options"
"""The ``configurable`` key with the session's Ollama option overrides, for each model call."""

GROWTH_KEY = "golem_window_growth"
"""The ``configurable`` key with the turn's :class:`Growth`, when its window grew."""

INTERRUPTED_KEY = "golem_interrupted"
"""``response_metadata`` flag on a reply the run did not finish."""

_ASSISTANT_ID = "golem_assistant_message_id"


@dataclass(slots=True)
class Growth:
    """The planned window of a local model went up between turns, from ``window_from`` to
    ``window_to``. The first call of the turn loads it and says so, and ``reported`` is then true.
    """

    window_from: int
    window_to: int
    reported: bool = False


MAX_MODEL_CALLS = 25
MAX_FALLBACKS = 2
"""Model calls in one run before it stops. Each tool round is one more."""

_RECURSION_LIMIT = 2 * MAX_MODEL_CALLS


class TooManyStepsError(Exception):
    """The run kept calling tools past :data:`MAX_MODEL_CALLS`."""

    def __init__(self) -> None:
        super().__init__(f"the run stopped after {MAX_MODEL_CALLS} model calls")


class _Checkpoint(Protocol):
    @property
    def values(self) -> Mapping[str, object]: ...


_MAX_UNDONE = 20


class _RunningGraph(Protocol):
    def astream(
        self,
        graph_input: AgentState | Command[object] | None,
        config: RunnableConfig,
        *,
        stream_mode: list[str],
        version: str,
    ) -> AsyncGenerator[object]: ...

    async def aget_state(self, config: RunnableConfig) -> _Checkpoint: ...

    def aget_state_history(self, config: RunnableConfig) -> AsyncIterator[_Checkpoint]: ...

    async def aupdate_state(
        self,
        config: RunnableConfig,
        values: Mapping[str, object],
        as_node: str | None = None,
    ) -> RunnableConfig: ...


class _GraphBuilder(Protocol):
    def add_node(
        self,
        name: str,
        action: Callable[[AgentState, RunnableConfig], Awaitable[Mapping[str, object]]],
    ) -> None: ...

    def add_edge(self, start: object, end: object) -> None: ...

    def add_conditional_edges(
        self, source: str, path: Callable[[AgentState], str], path_map: Mapping[str, object]
    ) -> None: ...

    def compile(self, *, checkpointer: BaseCheckpointSaver[str]) -> _RunningGraph: ...


class ChatRuntime:
    """A compiled chat graph plus the router, tools, and policy its nodes use."""

    def __init__(
        self,
        graph: _RunningGraph,
        router: ModelRouter,
        tools: ToolRegistry | None = None,
        policy: Policy | None = None,
        prompt: SystemPrompt | None = None,
        window_of: WindowOf | None = None,
        price_of: Callable[[str], ModelPrice | None] | None = None,
        tier_of: Callable[[str], Tier | None] | None = None,
        helper_prices: Callable[[str], Prices] | None = None,
    ) -> None:
        self._graph = graph
        self.router = router
        self.tools = default_registry() if tools is None else tools
        self.policy = Policy(None) if policy is None else policy
        self.prompt = SystemPrompt() if prompt is None else prompt
        self.window_of = window_of
        self.price_of = price_of
        """The price of a profile's model, or None when unknown. No I/O."""
        self.tier_of = tier_of
        """The tier of a profile's model, or None when the profile does not resolve. No I/O."""
        self.helper_prices = helper_prices
        """What a profile's model and the helpers it could start cost, for the prompt. No I/O."""
        self.note_speed: Callable[..., object] | None = None
        """Told the profile and server timings of each finished call, for the speed book."""
        self.enable_mcp: EnableMcp | None = None
        """Turns on an on-demand MCP server for a session, for the model's ``mcp_enable``."""
        self.skills: SkillRegistry | None = None
        """The skills sessions see, for the model's ``load_skill``."""
        self.changes: ChangeStore | None = None
        """Where each file a tool writes is recorded. None: not recorded."""
        self.until_pulled: Callable[[str], Awaitable[None]] | None = None
        """Waits until a model's download ends, given its ref. Raises with the download's error."""
        self.context: ContextSettings | None = None
        """The ``[context]`` settings the graph was built with."""
        self.summariser: Summariser | None = None
        """Writes the summaries of the graph, and of a manual compaction."""
        self.budget_refs: Callable[[], list[str]] | None = None
        """Ready budget models that take tools, cheapest first, for the ``explore`` role."""
        self._child_limits: ChildLimits | None = None
        self.helpers: HelperHost | None = None
        """Starts and reads helper sessions, for ``delegate``. The session manager sets it. None: a
        ``delegate`` call is refused, since a helper cannot be started."""
        self.next_model: NextModel | None = None
        """Names the model a run steps up to. None: a run never steps up."""

    @property
    def child_limits(self) -> ChildLimits:
        """The caps of ``delegate`` that are not in a helper's snapshot: the answer length and how
        many helpers one message starts, from ``[agents]`` and ``[agents.explorer]``."""
        if self._child_limits is not None:
            return self._child_limits
        settings = self.router.agent_settings()
        defaults = ChildLimits()
        return ChildLimits(
            max_calls=settings.explorer.max_calls or defaults.max_calls,
            timeout_s=float(settings.explorer.timeout_seconds),
            answer_chars=settings.explorer.answer_chars or defaults.answer_chars,
            max_per_turn=settings.batch_limit,
            advisors_per_message=settings.advisor.max_per_message,
        )

    @child_limits.setter
    def child_limits(self, limits: ChildLimits) -> None:
        self._child_limits = limits

    async def values(self, session_id: str) -> Mapping[str, object]:
        """Checkpoint values for ``session_id``, or an empty mapping."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        raw = snapshot.values
        if not isinstance(raw, dict) or not raw:
            return {}
        return cast(Mapping[str, object], raw)

    async def branch_seen(self, session_id: str) -> str | None:
        """The branch the model last heard of, None before the first turn that knew one."""
        seen = (await self.values(session_id)).get("branch_seen")
        return seen if isinstance(seen, str) else None

    async def system_prompt(
        self,
        session_id: str,
        cwd: str | None,
        pinned: Sequence[str] = (),
        mcp_servers: Sequence[str] = (),
        *,
        profile: str | None = None,
        options: Mapping[str, float | str] | None = None,
        tools: Sequence[str] = (),
        memory: MemoryAccess | None = None,
    ) -> str:
        """The system prompt the next model call of ``session_id`` would get, or ``""``.

        With ``profile``, the sections that depend on the model's window see it, and ``tools``
        are the names of the tools the call would offer. ``memory`` is the access a run would
        carry, for the memory block.
        """
        parts = await self.prompt_parts(
            await self.values(session_id),
            cwd,
            pinned,
            mcp_servers,
            profile=profile,
            options=options,
            tools=tools,
            memory=memory,
        )
        return "\n\n".join(text for _, text in parts)

    async def prompt_parts(
        self,
        state: Mapping[str, object],
        cwd: str | None,
        pinned: Sequence[str] = (),
        mcp_servers: Sequence[str] = (),
        *,
        profile: str | None = None,
        options: Mapping[str, float | str] | None = None,
        tools: Sequence[str] = (),
        memory: MemoryAccess | None = None,
        plan_first: bool = False,
    ) -> list[tuple[str, str]]:
        """The named, non-empty parts of the system prompt for ``state``, in prompt order."""
        window = None
        if profile is not None and self.window_of is not None:
            window = self.window_of(profile, options).window
        context = PromptContext(
            state,
            cwd,
            tuple(pinned),
            mcp_servers=tuple(mcp_servers),
            plan_first=plan_first,
            tools=tuple(tools),
            window=window,
            memory=await _memory_block(memory, self.tier_of, profile),
            tier=None if profile is None or self.tier_of is None else self.tier_of(profile),
            prices=None
            if profile is None or self.helper_prices is None
            else self.helper_prices(profile),
        )
        return self.prompt.parts(context)

    async def stream(
        self,
        *,
        session_id: str,
        text: str,
        model_profile: str,
        schema_version: int,
        user_message_id: str,
        assistant_message_id: str,
        cwd: str | None = None,
        allowed_tools: Sequence[Allowance] = (),
        mcp_servers: Sequence[str] = (),
        skill_folder: str | None = None,
        read_folders: Sequence[str] = (),
        pinned: Sequence[str] = (),
        pinned_folders: Sequence[str] = (),
        options: Mapping[str, float | str] | None = None,
        permission_mode: PermissionMode | None = None,
        checks: bool | None = None,
        plan_first: bool = False,
        local_only: bool = False,
        growth: Growth | None = None,
        step_up: bool = False,
        child: ChildScope | None = None,
        memory: MemoryAccess | None = None,
        notes: Sequence[str] = (),
        branch: str | None = None,
    ) -> AsyncGenerator[object]:
        """Stream one user turn. The first turn writes the state fields.

        ``notes`` are texts from golem the model reads before the user's message, each as a
        note (see :mod:`golem.graphs.notes`), not as something the user said. ``branch`` is the
        folder's branch, which the checkpoint keeps as the one the model last heard of.

        Tool calls a stopped run left without results get a cancelled result
        first, so the provider accepts the history. ``cwd`` is the folder the
        file tools work in, and ``mcp_servers`` the on-demand MCP servers the
        session turned on. ``skill_folder`` is the folder of the skill this turn
        runs, which the read tools may read from then on, as may the ``read_folders`` a
        routine firing adds for its own session. ``pinned`` are the
        skills pinned in the session, for the system prompt, and
        ``pinned_folders`` their folders, which the read tools may read. Raises
        :class:`TooManyStepsError` when the model keeps calling tools.

        Close the generator (``contextlib.aclosing``) when you stop early, so
        the graph run ends before the checkpoint is touched again.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                _ASSISTANT_ID: assistant_message_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: [list(pair) for pair in allowed_tools],
                MCP_KEY: list(mcp_servers),
                MCP_NOW_KEY: set[str](),
                PINNED_KEY: list(pinned),
                PINNED_FOLDERS_KEY: list(pinned_folders),
                OPTIONS_KEY: dict(options or {}),
                MODE_KEY: permission_mode,
                CHECKS_KEY: checks,
                PLAN_KEY: plan_first,
                LOCAL_ONLY_KEY: local_only,
                GROWTH_KEY: growth,
                **({} if child is None else {CHILD_KEY: child}),
                **({} if memory is None else {MEMORY_KEY: memory}),
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        await self.answer_dangling(session_id)
        existing = await self.values(session_id)
        undone = await self._undone_note(session_id, existing)
        graph_input = _turn_input(
            [*undone[0], *map(note, notes), HumanMessage(content=text, id=user_message_id)],
            session_id=session_id,
            model_profile=model_profile,
            schema_version=schema_version,
            has_checkpoint=bool(existing),
            step_up=step_up,
        )
        if undone[1] is not None:
            graph_input["changes_seen"] = undone[1]
        if branch is not None:
            graph_input["branch_seen"] = branch
        folders = [*([] if skill_folder is None else [skill_folder]), *read_folders]
        if folders:
            graph_input["skill_folders"] = folders
        async with aclosing(self._parts(graph_input, config)) as parts:
            async for part in parts:
                yield part

    async def resume(
        self,
        *,
        session_id: str,
        answer: Answer,
        cwd: str | None = None,
        allowed_tools: Sequence[Allowance] = (),
        asked: Sequence[str] = (),
        mcp_servers: Sequence[str] = (),
        pinned: Sequence[str] = (),
        pinned_folders: Sequence[str] = (),
        options: Mapping[str, float | str] | None = None,
        permission_mode: PermissionMode | None = None,
        checks: bool | None = None,
        plan_first: bool = False,
        local_only: bool = False,
        child: ChildScope | None = None,
        memory: MemoryAccess | None = None,
    ) -> AsyncGenerator[object]:
        """Go on with a run paused on a tool approval, with the user's ``answer``.

        A lead parked for its helpers is woken with ``Answer.helpers_done()``.

        ``asked`` are the call ids the run already asked about, this one included.

        Close the generator when you stop early, as with :meth:`stream`.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: [list(pair) for pair in allowed_tools],
                ASKED_KEY: list(asked),
                MCP_KEY: list(mcp_servers),
                MCP_NOW_KEY: set[str](),
                PINNED_KEY: list(pinned),
                PINNED_FOLDERS_KEY: list(pinned_folders),
                OPTIONS_KEY: dict(options or {}),
                MODE_KEY: permission_mode,
                CHECKS_KEY: checks,
                PLAN_KEY: plan_first,
                LOCAL_ONLY_KEY: local_only,
                **({} if child is None else {CHILD_KEY: child}),
                **({} if memory is None else {MEMORY_KEY: memory}),
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        command: Command[object] = Command(resume=answer.to_resume())
        async with aclosing(self._parts(command, config)) as parts:
            async for part in parts:
                yield part

    async def continue_thread(
        self,
        *,
        session_id: str,
        cwd: str | None = None,
        allowed_tools: Sequence[Allowance] = (),
        mcp_servers: Sequence[str] = (),
        pinned: Sequence[str] = (),
        pinned_folders: Sequence[str] = (),
        options: Mapping[str, float | str] | None = None,
        permission_mode: PermissionMode | None = None,
        checks: bool | None = None,
        plan_first: bool = False,
        local_only: bool = False,
        child: ChildScope | None = None,
        memory: MemoryAccess | None = None,
    ) -> AsyncGenerator[object]:
        """Run the thread from its last checkpoint with no new input.

        For a run that stopped between two steps, such as a helper after a restart. Close the
        generator when you stop early, as with :meth:`stream`.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: [list(pair) for pair in allowed_tools],
                MCP_KEY: list(mcp_servers),
                MCP_NOW_KEY: set[str](),
                PINNED_KEY: list(pinned),
                PINNED_FOLDERS_KEY: list(pinned_folders),
                OPTIONS_KEY: dict(options or {}),
                MODE_KEY: permission_mode,
                CHECKS_KEY: checks,
                PLAN_KEY: plan_first,
                LOCAL_ONLY_KEY: local_only,
                **({} if child is None else {CHILD_KEY: child}),
                **({} if memory is None else {MEMORY_KEY: memory}),
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        async with aclosing(self._parts(None, config)) as parts:
            async for part in parts:
                yield part

    def explore_role(self, session_profile: str, *, local_only: bool = False) -> RoleModel:
        """The model of the ``explore`` role. A session that stays local keeps a local one."""
        role = for_role(
            "explore",
            session_profile=session_profile,
            settings=self.router.roles(),
            tier_of_profile=self.tier_of or (lambda _profile: None),
            budget_models=self.budget_refs() if self.budget_refs is not None else [],
        )
        tier = None if self.tier_of is None else self.tier_of(role.profile)
        if local_only and tier not in (None, "local"):
            return RoleModel(session_profile, True, "session is local")
        return role

    async def start_helpers(
        self,
        *,
        state: AgentState,
        config: RunnableConfig,
        call_id: str,
        helpers: Sequence[HelperSpec],
        cheaper: bool = False,
    ) -> None:
        await self._helper_host().start_helpers(
            state=state, config=config, call_id=call_id, helpers=helpers, cheaper=cheaper
        )

    async def estimate_helpers(
        self, *, state: AgentState, config: RunnableConfig, helpers: Sequence[HelperSpec]
    ) -> EstimateCard | None:
        if self.helpers is None:
            return None  # the refusal comes from start_helpers, with its message
        return await self._helper_host().estimate_helpers(
            state=state, config=config, helpers=helpers
        )

    async def helpers_ended(self, session_id: str, call_id: str) -> bool:
        return await self._helper_host().helpers_ended(session_id, call_id)

    async def helper_results(self, session_id: str, call_id: str) -> list[HelperOutcome]:
        return await self._helper_host().helper_results(session_id, call_id)

    def _helper_host(self) -> HelperHost:
        if self.helpers is None:
            raise ToolError("a helper cannot be started here")
        return self.helpers

    async def waiting(self, session_id: str) -> bool:
        """Whether the thread is paused on an interrupt."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        return bool(getattr(snapshot, "interrupts", ()))

    async def _parts(
        self, graph_input: AgentState | Command[object] | None, config: RunnableConfig
    ) -> AsyncGenerator[object]:
        parts = self._graph.astream(
            graph_input,
            config,
            stream_mode=["messages", "updates", "custom"],
            version="v2",
        )
        async with aclosing(parts):
            try:
                async for part in parts:
                    yield part
            except GraphRecursionError as exc:
                raise TooManyStepsError from exc

    async def _undone_note(
        self, session_id: str, existing: Mapping[str, object]
    ) -> tuple[list[HumanMessage], int | None]:
        """The note that tells the model of undone changes, and the new ``changes_seen``."""
        if self.changes is None:
            return [], None
        seen = existing.get("changes_seen")
        paths = await self.changes.reverted_since(session_id, seen if isinstance(seen, int) else 0)
        if not paths:
            return [], None
        shown = ", ".join(paths[:_MAX_UNDONE])
        if len(paths) > _MAX_UNDONE:
            shown += f" and {len(paths) - _MAX_UNDONE} more"
        text = (
            f"Since your last reply the user undid your changes to: {shown}. "
            "These files are back to their earlier text. Read a file again before you edit it."
        )
        return [note(text)], await self.changes.last_seq(session_id)

    async def answer_dangling(self, session_id: str) -> int:
        """Give each tool call without a result a cancelled one. Returns how many."""
        calls = unanswered_calls(_messages(await self.values(session_id)))
        if not calls:
            return 0
        await self._graph.aupdate_state(
            self._config(session_id),
            {"messages": cancelled_results(calls)},
            as_node="call_model",
        )
        return len(calls)

    async def compact(
        self,
        session_id: str,
        action: Literal["clear", "summarise"],
        *,
        profile: str,
        options: Mapping[str, float | str],
        focus: str | None,
        system_chars: int,
        tools_chars: int,
        local_only: bool = False,
    ) -> Compaction:
        """Clear or summarise the history of an idle session, and store the new context view.

        The checkpoint keeps every message. ``system_chars`` and ``tools_chars`` are the sizes
        of what a call sends besides the history. Raises when the summary call fails.
        """
        values = await self.values(session_id)
        messages = _without_thinking(_messages(values))
        ctx = cast(ContextView | None, values.get("context_view"))
        settings = self.context if self.context is not None else self.router.context_settings()
        window = self.window_of(profile, options) if self.window_of is not None else ContextWindow()
        room = _room(settings, window)
        used, ratio = used_tokens(view(messages, ctx), system_chars, tools_chars)
        if action == "clear":
            done = clear_now(
                messages, ctx, used=used, ratio=ratio, keep_results=settings.keep_results
            )
        elif self.summariser is None:
            raise ValueError("this daemon has no summariser")
        else:
            done = await summarise_now(
                self.summariser,
                # No run is live, so no access: every note a recall result holds is stubbed.
                await stub_local_notes(messages, None),
                ctx,
                keep_turns=settings.keep_turns,
                focus=focus,
                used=used,
                ratio=ratio,
                session_id=session_id,
                profile=profile,
                options=options,
                local_only=local_only,
            )
        done = replace(done, window=room)
        if done.view is not None:
            await self._graph.aupdate_state(
                self._config(session_id), {"context_view": done.view}, as_node="call_model"
            )
        return done

    async def message_text(self, session_id: str, message_id: str) -> str | None:
        """Text of the checkpoint message with ``message_id``, or None."""
        for message in _messages(await self.values(session_id)):
            if message.id == message_id:
                return message_text(message)
        return None

    async def record_interrupted(
        self,
        session_id: str,
        *,
        user_message_id: str,
        assistant_message_id: str,
        text: str,
    ) -> bool:
        """Append the partial reply of a turn that did not finish.

        Writes only when the checkpoint ends with that turn's user message or
        with a tool result, so a reply the model did finish is never
        replaced. Returns whether it wrote.
        """
        if text == "":
            return False
        messages = _messages(await self.values(session_id))
        if not messages:
            return False
        last = messages[-1]
        if last.id != user_message_id and not isinstance(last, ToolMessage):
            return False
        reply = AIMessage(
            content=text,
            id=assistant_message_id,
            response_metadata={INTERRUPTED_KEY: True},
        )
        await self._graph.aupdate_state(
            self._config(session_id),
            {"messages": [reply]},
            as_node="call_model",
        )
        return True

    async def fork(self, source_id: str, target_id: str, *, at_message_id: str) -> bool:
        """Start ``target_id`` with ``source_id``'s state as it was at ``at_message_id``.

        Reads the newest checkpoint whose last message has that id, so it
        works while ``source_id`` is running, and leaves the source untouched.
        Returns False when no checkpoint ends there.
        """
        async for snapshot in self._graph.aget_state_history(self._config(source_id)):
            messages = _messages(snapshot.values)
            if messages and messages[-1].id == at_message_id:
                values = {**snapshot.values, "messages": messages, "session_id": target_id}
                await self._graph.aupdate_state(
                    self._config(target_id), values, as_node="call_model"
                )
                return True
        return False

    def _config(self, session_id: str) -> RunnableConfig:
        return {"configurable": {"thread_id": session_id}}


def open_chat(
    router: ModelRouter,
    checkpointer: BaseCheckpointSaver[str],
    tools: ToolRegistry | None = None,
    policy: Policy | None = None,
    artifacts: Artifacts | None = None,
    local: LocalServers | None = None,
    prompt: SystemPrompt | None = None,
    blobs: Blobs | None = None,
    window_of: WindowOf | None = None,
    note_loaded: Callable[[str, int | None], Awaitable[Loaded]] | None = None,
    price_of: Callable[[str], ModelPrice | None] | None = None,
    dispatcher: Dispatcher | None = None,
    tier_of: Callable[[str], Tier | None] | None = None,
    learn_window: Callable[[str], Awaitable[None]] | None = None,
    context: ContextSettings | None = None,
    summariser: Summariser | None = None,
    ratios: TokenRatios | None = None,
    paid_ok: Callable[[str | None], Awaitable[bool]] | None = None,
    budget_refs: Callable[[], list[str]] | None = None,
    next_model: NextModel | None = None,
    label_of: Callable[[str | None, str], str] | None = None,
    helper_prices: Callable[[str], Prices] | None = None,
) -> ChatRuntime:
    """Compile the chat graph against ``checkpointer``.

    ``label_of`` is called with a session id and ``chat`` or ``helper`` and returns how a call
    holding a slot is named to the calls waiting behind it: the session title.

    ``tools`` defaults to the default registry. ``policy`` defaults to the
    built-in rules only, with no user or project file. Without ``artifacts``,
    big tool output is cut instead of stored. With ``local``, a model call to
    an Ollama on this machine starts it first, and holds it while it answers.
    ``prompt`` builds the system prompt for each model call. It defaults to
    none, so the model sees only the stored history. With ``blobs``, each model
    call stores its system prompt and tool schemas there, and reports their hashes.
    ``window_of`` gives the context window of a profile. Each model call reports it
    with the lengths of the system prompt's sections. Without it, the window is unknown.
    ``note_loaded`` is awaited with the profile and the ``num_ctx`` sent (or None) after each
    model call, so the server can read what the model loaded. When golem planned the window
    and the model did not fit on the GPU, the plan is lowered one step for the next call.
    ``learn_window`` is awaited before the window is worked out, so a local model's size
    and maximum are known on the first call. The window the call ran with goes out as
    ``model.response``, with ``text_tool_calls`` (``recovered`` or ``unread``) when the reply
    held a tool call written as text. A failure there never fails the call. With
    ``dispatcher``, a call to a local model waits for a slot of its line first. The slot is held
    for one call: a retry gives it back and takes one again.
    ``context`` holds the ``[context]`` settings. When the history fills the window past
    ``clear_at``, old tool results are sent as one line each. Without it, nothing is cleared.
    With ``summariser``, a history still past ``compact_at`` after that has its old turns
    replaced by a summary in what is sent. Before each call the prompt is estimated with the
    tokens per character ``ratios`` learned from finished calls, and a prompt that would not fit
    the window is cleared and summarised harder, or the call raises ``ContextFull``.
    ``paid_ok`` is awaited with the session id before each call to a paid model. When it says
    no, a cap in ``[budget]`` is spent: the run fails with ``budget_spent`` before the call,
    so every tool result of the run is stored by then. ``budget_refs`` lists the ready budget
    models, for the ``explore`` role of the helper that ``delegate`` starts.
    ``next_model`` is awaited when a run on route ``auto`` struggles or its prompt cannot fit:
    it names the model the rest of the run moves to, once, or None when none is allowed.
    """
    clearing = context
    learned = TokenRatios() if ratios is None else ratios
    registry = default_registry() if tools is None else tools
    rules = Policy(None) if policy is None else policy
    binder = _ToolBinder()
    system_prompt = SystemPrompt() if prompt is None else prompt

    async def call_model(state: AgentState, config: RunnableConfig) -> dict[str, object]:
        messages = list(state["messages"])
        profile = state["model_profile"]
        paid = tier_of is not None and tier_of(profile) not in (None, "local")
        if paid_ok is not None and paid and not await paid_ok(state.get("session_id")):
            raise BudgetSpent(
                "a budget cap is spent, so the run stopped before its next paid call",
                hint=BUDGET_HINT,
            )
        carried = _carried_id(state)
        # Text of a failed call was shown, so the call that follows is a new reply.
        message_id = carried or (new_id("m") if _fell_back(state) else _reply_id(messages, config))
        if carried is None:
            get_stream_writer()({STREAM_KEY: "model.started", "message_id": message_id})
        scope = scope_of(config)
        child = child_of(config)
        # A helper that used its calls, or reached its cost or token limit, makes one more,
        # without tools, to give its answer.
        final = child is not None and (
            sum(isinstance(m, AIMessage) for m in messages) >= child.max_calls
            or (child.spent is not None and await child.spent())
        )
        overrides = _options(config)
        local_only = _local_only(config)
        if local_only:
            router.ensure_local(profile)
        await registry.prepare(scope)
        tools = registry.scoped(scope)
        plan_first = _plan(config)
        schemas = [] if final else tools.schemas(plan_first=plan_first)
        plain = _portable(_without_thinking(messages), router.kind(profile))
        if tier_of is None or tier_of(profile) != "local":
            # A hosted model never reads a local note. Only the copy sent changes.
            plain = await stub_local_notes(plain, memory_of(config))
        history = view(plain, state.get("context_view"))
        async with _held(router, local, profile):
            if learn_window is not None:
                try:
                    await learn_window(profile)
                except Exception:
                    log.debug("learning the model %s failed", profile, exc_info=True)
            window = window_of(profile, overrides) if window_of is not None else ContextWindow()
            offered = (
                tuple(_schema_name(item) for item in schemas) if binder.offers(profile) else ()
            )
            context = PromptContext(
                state,
                _cwd(config),
                _pinned(config),
                get_stream_writer(),
                tuple(sorted(scope.enabled)),
                plan_first=plan_first,
                tools=offered,
                window=window.window,
                memory=await _memory_block(memory_of(config), tier_of, profile),
                tier=None if tier_of is None else tier_of(profile),
                prices=None if helper_prices is None else helper_prices(profile),
            )
            parts = (
                [("helper", child.prompt)] if child is not None else system_prompt.parts(context)
            )
            text = "\n\n".join(t for _, t in parts)
            system = SystemMessage(content=text) if text else None
            # The system message is sent, never returned, so it stays out of the checkpoint.
            sent = _outgoing(system, history, final)
            current = state.get("context_view")
            original = current
            system_chars = 0 if system is None else len(message_text(system))
            tools_chars = (
                len(json.dumps(schemas, sort_keys=True, separators=(",", ":")))
                if schemas and binder.offers(profile)
                else 0
            )
            room = _room(clearing, window)
            used, ratio = used_tokens(history, system_chars, tools_chars, learned.learned(profile))
            if clearing is not None and room is not None:
                cleared = _clear_old(plain, current, clearing, room, used, ratio)
                if cleared is not None:
                    current = cleared.view
                    used = cast(int, cleared.item["after_tokens"])
                    get_stream_writer()({**cleared.item, "room": room})
                if used >= clearing.compact_at * room:
                    summed = await _summarise_old(
                        summariser,
                        plain,
                        current,
                        clearing,
                        used,
                        ratio,
                        session_id=state.get("session_id"),
                        profile=profile,
                        options=overrides,
                        local_only=local_only,
                        access=memory_of(config),
                    )
                    if summed is not None:
                        current = summed.view
                        used = cast(int, summed.item["after_tokens"])
                        get_stream_writer()({**summed.item, "room": room})
                    else:
                        # Nothing to summarise, or it failed: clear all but the newest two.
                        harder = clearing.model_copy(
                            update={"clear_at": 0.0, "clear_to": 0.0, "keep_results": 2}
                        )
                        again = _clear_old(plain, current, harder, room, used, ratio)
                        if again is not None:
                            current = again.view
                            used = cast(int, again.item["after_tokens"])
                            get_stream_writer()({**again.item, "room": room})
                        if used >= clearing.compact_at * room:
                            log.info("the prompt is still at %d of %d tokens", used, room)
            if clearing is not None and window.window is not None:
                try:
                    fitted = await _fit(
                        learned, router, profile, plain, current, system_chars + tools_chars,
                        window.window, clearing, summariser, state.get("session_id"), overrides,
                        local_only, memory_of(config),
                    )  # fmt: skip
                except ContextFull as full:
                    if not _may_step_up(state):
                        raise
                    # No call is made: the router sends the run to the step-up.
                    return {
                        "last_call": {
                            "context_full": {
                                "need": full.need,
                                "window": full.window,
                                "model": profile,
                                "message_id": message_id,
                            }
                        }
                    }
                current = fitted.view
                for change in fitted.items:
                    get_stream_writer()(change)
            if current is not original:
                history = view(plain, current)
                sent = _outgoing(system, history, final)
            request: dict[str, object] = {STREAM_KEY: "model.request", "message_id": message_id}
            request["profile"] = profile
            request["message_ids"] = [m.id for m in history if m.id]
            request["cleared_ids"] = cleared_ids(messages, current)
            if history and history[0].id == SUMMARY_ID:
                request["summary_chars"] = len(message_text(history[0]))
            if parts:
                request["system_sections"] = [{"name": n, "chars": len(t)} for n, t in parts]
            request["context_window"] = window.window
            request["estimated_tokens"] = prompt_estimate(
                learned, profile, history, system_chars + tools_chars
            )
            request["num_ctx"] = window.num_ctx
            request["window_estimated"] = window.estimated
            request["window_planned"] = window.planned
            if blobs is not None:
                if system is not None and isinstance(system.content, str):
                    request["system_prompt_sha"] = await blobs.put("system_prompt", system.content)
                if schemas and binder.offers(profile):
                    text = json.dumps(schemas, sort_keys=True, separators=(",", ":"))
                    request["tools_sha"] = await blobs.put("tools", text)
            request.update(_sizes(system, history, schemas if binder.offers(profile) else []))
            get_stream_writer()(request)
            growth = _growth(config)
            failed: tuple[Exception, ModelUnreachable | None, Failure, bool] | None = None
            response: AIMessage | None = None
            streamed = _Streamed()
            chat = router.chat_model(profile, overrides, local_only=local_only)
            before = chat.callbacks
            chat.callbacks = [streamed]
            arrived: float | None = None
            grew_told = False

            async def attempt() -> AIMessage:
                nonlocal arrived, grew_told
                async with _gated(
                    router,
                    dispatcher,
                    profile,
                    message_id,
                    state.get("session_id"),
                    "chat" if child is None else "helper",
                    arrived,
                    label_of,
                ) as grant:
                    if grant is not None:
                        arrived = grant.arrived
                    if growth is not None and not grew_told:
                        grew_told = True
                        get_stream_writer()(
                            {
                                STREAM_KEY: "model.waiting",
                                "message_id": message_id,
                                "waiting": True,
                                "model": router.resolve(profile).model_id,
                                "window": growth.window_to,
                                "reason": "load",
                                "line": router.resolve(profile).model_id,
                            }
                        )
                    return await binder.invoke(profile, chat, sent, schemas)

            try:
                provided = router.provider_line(profile)
                response = await _retrying(
                    attempt,
                    streamed,
                    router.sleep,
                    dispatcher,
                    None if provided is None else provided[0],
                )
            except Exception as exc:
                down = router.unreachable(profile, exc) or await router.refused(profile, exc)
                failure = "unreachable" if down is not None else failure_of(exc)
                if failure == "other":
                    raise
                failed = (exc, down, failure, streamed.seen)
            finally:
                chat.callbacks = before
        if failed is not None:
            return await fall_back(state, profile, message_id, *failed)
        if response is None:
            raise AssertionError("a call that did not fail has a reply")
        _learn(learned, profile, history, system_chars + tools_chars, response, window.window)
        loaded: int | None = None
        if note_loaded is not None:
            try:
                state_loaded = await note_loaded(profile, window.num_ctx)
                loaded = state_loaded.context_length
                if window.planned and router.plans is not None:
                    _lower_when_spilled(router, profile, state_loaded)
            except Exception:
                log.debug("noting the loaded model %s failed", profile, exc_info=True)
        ran = loaded
        if window.num_ctx is not None:
            if loaded is not None and loaded != window.num_ctx:
                log.warning(
                    "%s was sent num_ctx %d but ran with %d", profile, window.num_ctx, loaded
                )
            else:
                ran = window.num_ctx
        update: dict[str, object] = {"id": message_id}
        text_tool_calls: str | None = None
        if final:
            update["tool_calls"] = []
        elif response.tool_calls:
            calls = _with_ids(response.tool_calls)
            for call in calls:
                inner = unwrapped(call["name"], call["args"], schemas)
                if inner is not None:
                    call["args"] = inner
                    log.info(
                        "%s wrapped the arguments of %s in a call; unwrapped", profile, call["name"]
                    )
            update["tool_calls"] = calls
        elif schemas and binder.offers(profile):
            reply = message_text(response)
            if "<function=" in reply:
                recovered = recover(reply, schemas)
                if recovered is not None:
                    update["content"], update["tool_calls"] = recovered
                    text_tool_calls = "recovered"
                    log.info(
                        "%s wrote %d tool call(s) as text; recovered", profile, len(recovered[1])
                    )
                else:
                    text_tool_calls = "unread"
                    log.info("%s wrote a tool call as text that could not be read", profile)
            else:
                found = recover_json_tail(reply, schemas)
                if isinstance(found, tuple):
                    update["content"], update["tool_calls"] = found
                    text_tool_calls = "recovered"
                    log.info("%s wrote %d tool call(s) as JSON; recovered", profile, len(found[1]))
                elif found == "unread":
                    text_tool_calls = "unread"
                    log.info("%s wrote a tool call as JSON that could not be read", profile)
        response_item: dict[str, object] = {
            STREAM_KEY: "model.response",
            "message_id": message_id,
            "context_window": ran,
        }
        if text_tool_calls is not None:
            response_item["text_tool_calls"] = text_tool_calls
        # Only Ollama sends these numbers, so a hosted reply has none.
        timings = _timings(response)
        if timings:
            response_item["timings"] = timings
        get_stream_writer()(response_item)
        if growth is not None:
            growth.reported = True
            get_stream_writer()(
                {STREAM_KEY: "model.waiting", "message_id": message_id, "waiting": False}
            )
            get_stream_writer()(
                {
                    STREAM_KEY: "context.changed",
                    "action": "grew",
                    "window_from": growth.window_from,
                    "window_to": growth.window_to,
                    "reload_ms": timings.get("load_ms"),
                }
            )
        result: dict[str, object] = {"messages": [response.model_copy(update=update)]}
        result["last_call"] = {
            "stop_reason": stop_reason_of(response),
            "text_tool_calls": text_tool_calls,
        }
        if current is not original:
            result["context_view"] = current
        return result

    async def fall_back(
        state: AgentState,
        profile: str,
        message_id: str,
        exc: Exception,
        down: ModelUnreachable | None,
        failure: Failure,
        streamed: bool,
    ) -> dict[str, object]:
        """Move the run to another model after ``profile`` failed, or raise the error.

        Only a run on route ``auto`` moves, at most :data:`MAX_FALLBACKS` times. The provider
        is marked, so the next pick skips it too. The failed call stored no reply.
        """
        try:
            provider = router.resolve(profile).provider_name
        except ModelConfigError:
            provider = router.identity(profile).provider or "the provider"
        router.health.mark(provider, failure)
        error = down if down is not None else provider_error(provider, failure)
        made = state.get("fallbacks", 0)
        ask = runtime[0].next_model if runtime else None
        if state.get("can_step_up") is not True or made >= MAX_FALLBACKS or ask is None:
            raise error from exc
        found = await ask(state.get("session_id", ""), profile, StepRequest("fallback"))
        if not isinstance(found, StepUp):
            raise error from exc
        log.warning("%s failed (%s); falling back to %s", profile, failure, found.profile)
        get_stream_writer()(
            {
                STREAM_KEY: "model.routed",
                "profile": found.profile,
                "tier": found.tier,
                "reason": "fallback",
                "detail": failure_note(provider, failure),
                "rejected": [(r.ref, r.tier, r.why) for r in found.choice.rejected],
            }
        )
        return {
            "model_profile": found.profile,
            "fallbacks": made + 1,
            "last_call": {"fell_back": {"message_id": message_id, "streamed": streamed}},
        }

    def route(state: AgentState) -> Literal["call_model", "tools", "step_up", "end"]:
        if _fell_back(state) is not None:
            return "call_model"
        if _may_step_up(state) and (state.get("last_call") or {}).get("context_full"):
            return "step_up"
        last = state["messages"][-1] if state["messages"] else None
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        # A reply with tool calls goes to the tools first: its calls need their results.
        return "step_up" if _struggles(state) is not None else "end"

    def route_after_tools(state: AgentState) -> Literal["call_model", "step_up"]:
        return "step_up" if _struggles(state) is not None else "call_model"

    def route_after_step_up(state: AgentState) -> Literal["call_model", "end"]:
        # No stronger model on a plain reply: the run ends as it would have.
        last = state["messages"][-1] if state["messages"] else None
        stepped = (state.get("last_call") or {}).get("stepped") is True
        plain = isinstance(last, AIMessage) and not last.tool_calls
        return "end" if plain and not stepped else "call_model"

    async def step_up(state: AgentState, config: RunnableConfig) -> dict[str, object]:
        profile = state["model_profile"]
        call = dict(state.get("last_call") or {})
        old = router.identity(profile).name or profile
        full = cast("dict[str, object] | None", call.get("context_full"))
        need: int | None = None
        if full:
            need, window = _count(full.get("need")), _count(full.get("window"))
            signal = "context_full"
            detail = f"did not fit in {size_text(window or 0)} on {old}"
        else:
            found = _struggles(state)
            if found is None:
                return {}
            signal, detail = found.signal, f"{found.detail} on {old}"
        ask = runtime[0].next_model if runtime else None
        stepped: StepUp | StepAsk | None = None
        session_id = state.get("session_id", "")
        if ask is not None:
            tokens = sum(len(message_text(m)) for m in state["messages"]) // 4
            request = StepRequest(signal, need, tokens, detail)
            stepped = await ask(session_id, profile, request)
            if isinstance(stepped, StepAsk):
                # The paid model needs a yes. The run waits here, as it does for a tool approval,
                # and this node runs again from its top with the answer.
                answer = interrupt(
                    {
                        STREAM_KEY: CONSENT_KIND,
                        "question": {
                            "model_profile": stepped.profile,
                            "tier": stepped.tier,
                            "why": stepped.question.why,
                            "estimated_usd": stepped.question.estimated_usd,
                            "alternatives": list(stepped.question.alternatives),
                            "caps": None
                            if stepped.question.caps is None
                            else stepped.question.caps.model_dump(),
                            "signal": signal,
                        },
                    }
                )
                stepped = None
                said = Answer.parse(answer).decision
                if said == "session" or said == "once":
                    again = replace(request, answer=said)
                    stepped = await ask(session_id, profile, again)
        writer = get_stream_writer()
        if not isinstance(stepped, StepUp):
            if full:
                raise ContextFull(need or 0, _count(full.get("window")) or 0, profile)
            writer(
                {
                    STREAM_KEY: "model.routed",
                    "profile": profile,
                    "tier": (tier_of(profile) if tier_of is not None else None) or "frontier",
                    "reason": "fallback",
                    "detail": f"no stronger model is available ({detail})",
                }
            )
            return {"stepped_up": True, "last_call": {**call, "stepped": False}}
        writer(
            {
                STREAM_KEY: "model.routed",
                "profile": stepped.profile,
                "tier": stepped.tier,
                "reason": "escalated",
                "detail": detail,
                "rejected": [(r.ref, r.tier, r.why) for r in stepped.choice.rejected],
            }
        )
        result: dict[str, object] = {
            "model_profile": stepped.profile,
            "stepped_up": True,
            "last_call": {**call, "stepped": True},
        }
        last = state["messages"][-1] if state["messages"] else None
        if signal == "empty_reply" and last is not None and last.id:
            # The stronger model answers the request itself, so the empty reply goes.
            result["messages"] = [RemoveMessage(id=last.id)]
        return result

    def route_after_checks(state: AgentState) -> Literal["call_model", "end"]:
        # The checks node adds a note only when a check failed and a round is left.
        last = state["messages"][-1] if state["messages"] else None
        return "call_model" if last is not None and is_note(last) else "end"

    builder = cast(_GraphBuilder, StateGraph(AgentState))
    builder.add_node("call_model", call_model)
    runtime: list[ChatRuntime] = []
    builder.add_node(
        "tools",
        tools_node(
            registry,
            rules,
            artifacts,
            lambda: runtime[0].enable_mcp if runtime else None,
            lambda: runtime[0].skills if runtime else None,
            _budget_by_window(window_of),
            lambda: runtime[0] if runtime else None,
            tier_of,
            lambda: router.agent_settings().use_helpers,
        ),
    )
    builder.add_edge(START, "call_model")
    builder.add_node("checks", checks_node(rules, artifacts))
    builder.add_node("step_up", step_up)
    builder.add_conditional_edges(
        "call_model",
        route,
        {"call_model": "call_model", "tools": "tools", "step_up": "step_up", "end": "checks"},
    )
    builder.add_conditional_edges(
        "tools", route_after_tools, {"call_model": "call_model", "step_up": "step_up"}
    )
    builder.add_conditional_edges(
        "step_up", route_after_step_up, {"call_model": "call_model", "end": "checks"}
    )
    builder.add_conditional_edges(
        "checks", route_after_checks, {"call_model": "call_model", "end": END}
    )
    runtime.append(
        ChatRuntime(
            builder.compile(checkpointer=checkpointer),
            router,
            registry,
            rules,
            system_prompt,
            window_of,
            price_of,
            tier_of,
        )
    )
    runtime[0].context = context
    runtime[0].summariser = summariser
    runtime[0].budget_refs = budget_refs
    runtime[0].next_model = next_model
    runtime[0].helper_prices = helper_prices
    return runtime[0]


def _may_step_up(state: AgentState) -> bool:
    """Whether the run is on route ``auto`` and has not stepped up yet."""
    return state.get("can_step_up") is True and state.get("stepped_up") is not True


def _struggles(state: AgentState) -> Struggle | None:
    """The struggle that sends the run to the step-up, or None."""
    if not _may_step_up(state):
        return None
    call = state.get("last_call") or {}
    reason, text_calls = call.get("stop_reason"), call.get("text_tool_calls")
    return detect(
        state["messages"],
        stop_reason=reason if isinstance(reason, str) else None,
        text_tool_calls=text_calls if isinstance(text_calls, str) else None,
    )


def _carried_id(state: AgentState) -> str | None:
    """The reply id the next call goes on with: one that did not fit, or failed before any text."""
    call = state.get("last_call") or {}
    full = call.get("context_full")
    found = cast(dict[str, object], full).get("message_id") if isinstance(full, dict) else None
    fell = _fell_back(state)
    if fell is not None and fell.get("streamed") is not True:
        found = fell.get("message_id")
    return found if isinstance(found, str) else None


def _fell_back(state: AgentState) -> dict[str, object] | None:
    """``last_call["fell_back"]``: the call that failed and sent the run to another model."""
    found = (state.get("last_call") or {}).get("fell_back")
    return cast("dict[str, object]", found) if isinstance(found, dict) else None


class _Streamed(BaseCallbackHandler):
    """Notes that a model call has streamed a token, so its text may have reached the user."""

    run_inline = True

    def __init__(self) -> None:
        self.seen = False

    def on_llm_new_token(self, token: str | list[str | dict[str, Any]], **kwargs: Any) -> None:
        del kwargs
        if token:
            self.seen = True


async def _retrying(
    call: Callable[[], Awaitable[AIMessage]],
    streamed: _Streamed,
    sleep: Callable[[float], Awaitable[None]],
    dispatcher: Dispatcher | None = None,
    line: LineKey | None = None,
) -> AIMessage:
    """Run ``call``; when it is rate-limited or fails on the server's side, once more.

    The retry waits 2 seconds, or what ``retry-after`` asks for up to 10. A call that already
    streamed text is not retried: the user saw it.

    On a provider ``line`` a refusal (429) calls ``refused`` and the call tries again through
    the line, which holds it back, up to three times. A server error still gets the one retry.
    """
    refusals = 0
    served = False
    while True:
        try:
            reply = await call()
        except Exception as exc:
            failure = failure_of(exc)
            if streamed.seen:
                raise
            if dispatcher is not None and line is not None and failure == "rate_limited":
                if refusals == 3:
                    raise
                refusals += 1
                dispatcher.refused(line, retry_after(exc))
                continue
            if failure not in ("rate_limited", "server_error") or served:
                raise
            served = True
            await sleep(retry_delay(exc))
            continue
        if dispatcher is not None and line is not None:
            dispatcher.succeeded(line)
        return reply


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _timings(message: AIMessage) -> dict[str, int]:
    """The server's own numbers of a call, from Ollama's last chunk. Durations become ms."""
    meta = message.response_metadata
    found: dict[str, int] = {}
    for key, name in (
        ("load_duration", "load_ms"),
        ("prompt_eval_duration", "prompt_ms"),
        ("eval_duration", "reply_ms"),
    ):
        value = meta.get(key)
        if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0:
            found[name] = round(value / 1_000_000)
    for key, name in (("prompt_eval_count", "prompt_tokens"), ("eval_count", "reply_tokens")):
        value = meta.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            found[name] = value
    return found


def _budget_by_window(window_of: WindowOf | None) -> BudgetOf | None:
    """The tools node's result budget from the window of the session's model."""
    if window_of is None:
        return None

    def budget(state: AgentState, config: RunnableConfig) -> ResultBudget:
        return result_budget(window_of(state["model_profile"], _options(config)).window)

    return budget


@dataclass(frozen=True, slots=True)
class _Cleared:
    view: ContextView
    item: dict[str, object]


def _room(settings: ContextSettings | None, window: ContextWindow) -> int | None:
    """The tokens the history may fill, or None when nothing may be cleared or summarised.

    An unknown window, or one no bigger than the reply reserve, has no room.
    """
    if settings is None or window.window is None:
        return None
    room = window.window - settings.reply_reserve
    return room if room > 0 else None


def _clear_old(
    messages: Sequence[BaseMessage],
    current: ContextView | None,
    settings: ContextSettings,
    room: int,
    used: int,
    ratio: float,
) -> _Cleared | None:
    """The view that clears old tool results and the ``context.changed`` item, or None.

    ``messages`` is the stored history, ``used`` the tokens the call would send and ``ratio``
    the tokens per character that estimate used.
    """
    planned = plan_clear(
        messages,
        current,
        used=used,
        ratio=ratio,
        room=room,
        clear_at=settings.clear_at,
        clear_to=settings.clear_to,
        keep_results=settings.keep_results,
    )
    if planned is None:
        return None
    freed, count = freed_by(messages, current, planned, ratio)
    if count == 0:
        return None
    item: dict[str, object] = {
        STREAM_KEY: "context.changed",
        "action": "cleared",
        "before_tokens": used,
        "after_tokens": max(0, used - freed),
        "count": count,
    }
    return _Cleared(planned, item)


async def _summarise_old(
    summariser: Summariser | None,
    messages: Sequence[BaseMessage],
    current: ContextView | None,
    settings: ContextSettings,
    used: int,
    ratio: float,
    *,
    session_id: str | None,
    profile: str,
    options: Mapping[str, float | str],
    local_only: bool = False,
    access: MemoryAccess | None = None,
) -> _Cleared | None:
    """The view that sends a summary of the old turns and its ``context.changed`` item.

    The summary outlives the call and goes to any model later, so it is made from the history
    as a hosted model may read it: a local note is stubbed, whatever model summarises.

    None when there is nothing to summarise by turns (too few, or one long turn), when
    there is no summariser, or when the summary failed: a failed summary never fails the run.
    """
    if summariser is None:
        return None
    messages = await stub_local_notes(messages, access)
    found = plan_summary(messages, current, keep_turns=settings.keep_turns)
    if found is None:
        return None
    start, end = found
    earlier = (current or {}).get("summary") if start > 0 else None
    try:
        text = await summariser.make(
            session_id=session_id,
            session_profile=profile,
            options=options,
            messages=messages[start:end],
            earlier=earlier,
            local_only=local_only,
        )
    except Exception:
        log.warning("summarising old turns failed", exc_info=True)
        return None
    planned: ContextView = {
        **(current or {}),
        "summary": text,
        "summarised_before": cast(str, messages[end].id),
    }
    now = view(messages, planned)
    before = sum(len(_sent_text(m)) for m in view(messages, current))
    after = sum(len(_sent_text(m)) for m in now)
    item: dict[str, object] = {
        STREAM_KEY: "context.changed",
        "action": "summarised",
        "before_tokens": used,
        "after_tokens": max(0, used - round((before - after) * ratio)),
        "count": end - start,
    }
    return _Cleared(planned, item)


async def _fit(
    learned: TokenRatios,
    router: ModelRouter,
    profile: str,
    plain: Sequence[BaseMessage],
    current: ContextView | None,
    fixed_chars: int,
    window: int,
    settings: ContextSettings,
    summariser: Summariser | None,
    session_id: str | None,
    options: Mapping[str, float | str],
    local_only: bool = False,
    access: MemoryAccess | None = None,
) -> Fitted:
    """The view that fits ``window`` with the reply reserve, or raises ``ContextFull``."""

    async def summarise(ctx: ContextView | None) -> tuple[ContextView, int] | None:
        last_turn = settings.model_copy(update={"keep_turns": 1})
        found = await _summarise_old(
            summariser, plain, ctx, last_turn, 0, 1.0,
            session_id=session_id, profile=profile, options=options, local_only=local_only,
            access=access,
        )  # fmt: skip
        return None if found is None else (found.view, cast(int, found.item["count"]))

    def changed(action: str, before: int, after: int, count: int) -> dict[str, object]:
        return {
            STREAM_KEY: "context.changed",
            "action": action,
            "before_tokens": before,
            "after_tokens": after,
            "count": count,
            "room": window - reserve,
        }

    reserve = reply_reserve(settings.reply_reserve, _num_predict(router, profile, options), window)
    return await fit_prompt(
        plain,
        current,
        model=profile,
        ratios=learned,
        fixed_chars=fixed_chars,
        window=window,
        reserve=reserve,
        summarise=summarise,
        item=changed,
    )


def _num_predict(
    router: ModelRouter, profile: str, overrides: Mapping[str, float | str]
) -> float | str | None:
    """The ``num_predict`` the call is sent with: the session's, else the saved one."""
    if "num_predict" in overrides:
        return num_predict_of(overrides)
    try:
        saved = router.ollama_options(router.resolve(profile).model_id, overrides)
    except Exception:
        return None
    return num_predict_of(saved)


def _learn(
    learned: TokenRatios,
    profile: str,
    history: Sequence[BaseMessage],
    fixed_chars: int,
    response: AIMessage,
    window: int | None,
) -> None:
    """Teach ``learned`` from a finished call, and log the estimate against the real count."""
    usage = response.usage_metadata
    tokens = usage.get("input_tokens") if usage else None
    if not tokens:
        return
    chars = fixed_chars + sum(sent_chars(m) for m in history)
    log.debug(
        "%s: estimated %d tokens, the server counted %d",
        profile,
        prompt_estimate(learned, profile, history, fixed_chars),
        tokens,
    )
    learned.note(profile, chars=chars, tokens=tokens, window=window)


def _without_thinking(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """``messages`` with the thinking of every earlier reply removed.

    The library turns a stored ``reasoning_content`` into the request's ``thinking``
    on the next call. golem never sends thinking back, so the copies sent have none.
    The messages in the checkpoint keep theirs.
    """
    kept: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, AIMessage) and "reasoning_content" in message.additional_kwargs:
            extra = {k: v for k, v in message.additional_kwargs.items() if k != "reasoning_content"}
            message = message.model_copy(update={"additional_kwargs": extra})
        kept.append(message)
    return kept


_MAKERS = {"google_genai": "google"}
"""The library's name for a provider, where it differs from golem's kind."""


def _portable(messages: Sequence[BaseMessage], kind: str | None) -> list[BaseMessage]:
    """``messages`` as a model of provider ``kind`` can read them.

    A hosted model may answer with parts only its own provider reads, such as the
    ``reasoning`` and ``function_call`` parts of OpenAI. Another provider refuses them,
    so on route ``auto`` the next turn on a local model would fail. A reply written by
    another provider is sent as its text; its tool calls are kept on the message. A reply
    with no known writer, and a call with no known ``kind``, stay as they are. The
    messages in the checkpoint keep their parts.
    """
    if kind is None:
        return list(messages)
    kept: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, AIMessage) and not isinstance(message.content, str):
            maker = message.response_metadata.get("model_provider")
            if isinstance(maker, str) and _MAKERS.get(maker, maker) != kind:
                message = message.model_copy(update={"content": message_text(message)})
        kept.append(message)
    return kept


def _sizes(
    system: SystemMessage | None, messages: Sequence[BaseMessage], schemas: list[dict[str, object]]
) -> dict[str, object]:
    """The characters and UTF-8 bytes of what a model call sends, for ``model.request``.

    A message counts its text and, for a reply, its tool calls as JSON. The tool
    schemas count as the compact JSON the call stores.
    """
    system_text = "" if system is None else message_text(system)
    tools_text = json.dumps(schemas, sort_keys=True, separators=(",", ":")) if schemas else ""
    texts = [_sent_text(m) for m in messages]
    return {
        "system_chars": len(system_text),
        "system_bytes": len(system_text.encode()),
        "tools_chars": len(tools_text),
        "tools_bytes": len(tools_text.encode()),
        "message_chars": [len(t) for t in texts],
        "message_bytes": [len(t.encode()) for t in texts],
    }


def _sent_text(message: BaseMessage) -> str:
    text = message_text(message)
    if isinstance(message, AIMessage) and message.tool_calls:
        text += json.dumps(message.tool_calls, ensure_ascii=False, default=str)
    return text


class Blobs(Protocol):
    """Keeps text by its hash. ``put`` returns the sha256 hex of ``text``."""

    async def put(self, kind: str, text: str) -> str: ...


def _schema_name(schema: Mapping[str, object]) -> str:
    """The tool name in an OpenAI format schema."""
    function = schema.get("function")
    if not isinstance(function, dict):
        return ""
    name = cast(Mapping[str, object], function).get("name")
    return name if isinstance(name, str) else ""


class _ToolBinder:
    """Offers the session's tools to each model that takes them, on every call.

    A chat model class without ``bind_tools`` gets none. A model whose server
    refuses tools (Ollama: "does not support tools") is asked again without
    them, and that profile is not offered tools again in this process.
    """

    def __init__(self) -> None:
        self._refused: set[str] = set()

    def offers(self, profile: str) -> bool:
        """Whether ``profile`` is still offered tools, as far as is known."""
        return profile not in self._refused

    async def invoke(
        self,
        profile: str,
        model: BaseChatModel,
        messages: Sequence[BaseMessage],
        schemas: list[dict[str, object]],
    ) -> AIMessage:
        if schemas and profile not in self._refused:
            try:
                bound = model.bind_tools(schemas)
            except NotImplementedError:
                bound = None
            if bound is not None:
                try:
                    return _ai(await bound.ainvoke(list(messages)))
                except Exception as exc:
                    if "does not support tools" not in str(exc).lower():
                        raise
                    log.info("profile %s does not take tools; asking without them", profile)
                    self._refused.add(profile)
        return _ai(await model.ainvoke(list(messages)))


def _lower_when_spilled(router: ModelRouter, profile: str, loaded: Loaded) -> None:
    """Step a planned window down when part of the model runs on the CPU."""
    plans = router.plans
    if plans is None or not spilled(loaded.size, loaded.size_vram):
        return
    name = router.resolve(profile).model_id
    before = plans.planned(name)
    lower = plans.lower(name)
    if lower is not None:
        log.warning(
            "%s at %s tokens did not fit on the GPU; next call uses %d", name, before, lower
        )


def _held(
    router: ModelRouter, local: LocalServers | None, profile: str
) -> AbstractAsyncContextManager[None]:
    """Hold the local Ollama that ``profile`` runs on, or nothing for any other model."""
    target = None if local is None else router.ollama_server(profile)
    server = None if local is None or target is None else local.get(*target)
    return nullcontext() if server is None else server.hold()


@asynccontextmanager
async def _gated(
    router: ModelRouter,
    dispatcher: Dispatcher | None,
    profile: str,
    message_id: str,
    session_id: object,
    role: Literal["chat", "helper"],
    arrived: float | None,
    label_of: Callable[[str | None, str], str] | None = None,
) -> AsyncGenerator[Grant | None]:
    """Hold a slot of the line ``profile`` runs on: a local model's, or a hosted provider's.

    Each wait, short ones too, writes ``model.waited`` with its length when the call has its turn.
    A wait of over a second writes ``model.waiting`` with its reason (``slot`` on a local line,
    ``provider`` on a hosted one), the line's plain name, the position and the holder, and it
    ends when the call has its turn. ``arrived`` is the first arrival of a call that is tried
    again, so it keeps its place. ``label_of`` names the call for the waiters behind it, by
    the session title.
    """
    line = None if dispatcher is None else router.local_line(profile)
    if dispatcher is not None and line is None:
        provided = router.provider_line(profile)
        if provided is not None:
            line = provided[0]
            dispatcher.set_slots(line, provided[1])  # follows a change of config.toml
    if dispatcher is None or line is None:
        yield None
        return
    write = get_stream_writer()
    told = False

    def notice(wait: Wait | None) -> None:
        # The dispatcher decides when to call: after 1 s, on a new reason or position, and
        # at most once a second. Each call is written as it comes.
        nonlocal told
        if wait is not None:
            told = True
            item: dict[str, object] = {
                STREAM_KEY: "model.waiting",
                "message_id": message_id,
                "waiting": True,
                "reason": wait.reason,
                "line": wait.line,
                "position": wait.position,
            }
            if wait.holder:
                item["holder"] = wait.holder
            if wait.reason == "provider" and wait.retry_in is not None:
                item["retry_in_ms"] = round(wait.retry_in * 1000)
            write(item)
        elif told:
            told = False
            write({STREAM_KEY: "model.waiting", "message_id": message_id, "waiting": False})

    sid = session_id if isinstance(session_id, str) else None
    label = label_of(sid, role) if label_of is not None else None
    if not label:
        label = "a chat" if role == "chat" else "a helper"
    async with dispatcher.hold(Call(line, sid, role, label, arrived), notice) as grant:
        if grant.waited > 0:
            write(
                {
                    STREAM_KEY: "model.waited",
                    "message_id": message_id,
                    "ms": round(grant.waited * 1000),
                }
            )
        yield grant


def _ai(message: BaseMessage) -> AIMessage:
    if isinstance(message, AIMessage):
        return message
    return AIMessage(content=message.content)


def _cwd(config: RunnableConfig) -> str | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return raw if isinstance(raw, str) and raw != "" else None


def _options(config: RunnableConfig) -> dict[str, float | str]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(OPTIONS_KEY)
    if not isinstance(raw, dict):
        return {}
    return {
        key: value
        for key, value in cast(dict[object, object], raw).items()
        if isinstance(key, str) and isinstance(value, (int, float, str))
    }


def _outgoing(
    system: SystemMessage | None, history: Sequence[BaseMessage], final: bool
) -> list[BaseMessage]:
    """What a call sends: the system message, the history, and for a last call a request to answer.

    The request is sent and never stored, like the system message.
    """
    sent: list[BaseMessage] = [] if system is None else [system]
    sent.extend(history)
    if final:
        sent.append(HumanMessage(content=FINAL_REQUEST))
    return sent


async def _memory_block(
    access: MemoryAccess | None,
    tier_of: Callable[[str], Tier | None] | None,
    profile: str | None,
) -> str | None:
    """The fixed memory block for the model of this call. A model of unknown tier is hosted."""
    if access is None:
        return None
    tier = None if tier_of is None or not profile else tier_of(profile)
    return await memory_block(access, Target(local=tier == "local"))


def _local_only(config: RunnableConfig) -> bool:
    """Whether the session stays on this Mac."""
    return cast(Mapping[str, object], config.get("configurable", {})).get(LOCAL_ONLY_KEY) is True


def _growth(config: RunnableConfig) -> Growth | None:
    """The turn's window growth that no call has reported yet."""
    raw = cast(Mapping[str, object], config.get("configurable", {})).get(GROWTH_KEY)
    return raw if isinstance(raw, Growth) and not raw.reported else None


def _plan(config: RunnableConfig) -> bool:
    """Whether the session is in plan first."""
    return cast(Mapping[str, object], config.get("configurable", {})).get(PLAN_KEY) is True


def _pinned(config: RunnableConfig) -> tuple[str, ...]:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(PINNED_KEY)
    if not isinstance(raw, list):
        return ()
    return tuple(name for name in cast(list[object], raw) if isinstance(name, str))


def _reply_id(messages: Sequence[BaseMessage], config: RunnableConfig) -> str:
    configured = config.get("configurable", {}).get(_ASSISTANT_ID)
    if not isinstance(configured, str) or any(message.id == configured for message in messages):
        return new_id("m")
    return configured


def _with_ids(calls: Sequence[ToolCall]) -> list[ToolCall]:
    fixed: list[ToolCall] = []
    for call in calls:
        call_id = call.get("id")
        if not isinstance(call_id, str) or call_id == "":
            call = ToolCall(name=call["name"], args=call["args"], id=new_id("c"))
        fixed.append(call)
    return fixed


def _messages(values: Mapping[str, object]) -> list[BaseMessage]:
    raw = values.get("messages")
    if not isinstance(raw, list):
        return []
    return [item for item in cast(list[object], raw) if isinstance(item, BaseMessage)]


def _turn_input(
    messages: list[HumanMessage],
    *,
    session_id: str,
    model_profile: str,
    schema_version: int,
    has_checkpoint: bool,
    step_up: bool = False,
) -> AgentState:
    fresh: dict[str, object] = {
        "can_step_up": step_up,
        "stepped_up": False,
        "fallbacks": 0,
        "last_call": {},
    }
    if has_checkpoint:
        # model_profile rides along so that session.set_model applies from this turn.
        return cast(
            AgentState,
            {"messages": messages, "model_profile": model_profile, "check_round": 0, **fresh},
        )
    return cast(
        AgentState,
        {
            **fresh,
            "messages": messages,
            "check_round": 0,
            "session_id": session_id,
            "model_profile": model_profile,
            "schema_version": schema_version,
        },
    )


__all__ = ["INTERRUPTED_KEY", "MAX_MODEL_CALLS", "ChatRuntime", "TooManyStepsError", "open_chat"]
