"""The chat graph: ``START → call_model``, then ``tools → call_model`` while
the reply asks for tools, then ``checks`` and ``END``.

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
from contextlib import AbstractAsyncContextManager, aclosing, nullcontext
from dataclasses import dataclass, replace
from typing import Literal, Protocol, cast

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.types import Command

from golem.coding.changes import ChangeStore
from golem.config import ContextSettings, ModelPrice, PermissionMode
from golem.graphs.adapter import STREAM_KEY, message_text
from golem.graphs.checks_node import CHECKS_KEY, checks_node
from golem.graphs.child import (
    CHILD_PROMPT,
    EXPLORER_TOOLS,
    FINAL_REQUEST,
    ChildLimits,
    ChildResult,
    run_child,
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
from golem.graphs.estimate import TokenRatios
from golem.graphs.fit import Fitted, fit_prompt, num_predict_of, prompt_estimate, reply_reserve
from golem.graphs.notes import is_note, note
from golem.graphs.prompt import PINNED_KEY, PromptContext, SystemPrompt
from golem.graphs.result_budget import ResultBudget, result_budget
from golem.graphs.state import SCHEMA_VERSION, AgentState
from golem.graphs.summarise import Summariser
from golem.graphs.text_calls import recover
from golem.graphs.tools_node import (
    ALLOWED_KEY,
    ASKED_KEY,
    CHILD_KEY,
    CWD_KEY,
    LOCAL_ONLY_KEY,
    MCP_KEY,
    MCP_NOW_KEY,
    MODE_KEY,
    PINNED_FOLDERS_KEY,
    PLAN_KEY,
    Answer,
    BudgetOf,
    ChildScope,
    EnableMcp,
    cancelled_results,
    child_of,
    scope_of,
    tools_node,
    unanswered_calls,
)
from golem.models.discovery import Loaded
from golem.models.errors import BUDGET_HINT, BudgetSpent
from golem.models.gate import ServerGate
from golem.models.ollama import LocalServers
from golem.models.roles import RoleModel, for_role
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow, WindowOf
from golem.models.window_plan import spilled
from golem.permissions.engine import Allowance
from golem.permissions.policy import Policy
from golem.sessions.ids import new_id
from golem.skills.registry import SkillRegistry
from golem.tools import default_registry
from golem.tools.registry import Artifacts, ToolRegistry

log = logging.getLogger("golem.graphs")

OPTIONS_KEY = "golem_model_options"
"""The ``configurable`` key with the session's Ollama option overrides, for each model call."""

INTERRUPTED_KEY = "golem_interrupted"
"""``response_metadata`` flag on a reply the run did not finish."""

_ASSISTANT_ID = "golem_assistant_message_id"

MAX_MODEL_CALLS = 25
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
        graph_input: AgentState | Command[object],
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
        self.child_limits = ChildLimits()
        """What stops a helper started by ``delegate``."""

    async def values(self, session_id: str) -> Mapping[str, object]:
        """Checkpoint values for ``session_id``, or an empty mapping."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        raw = snapshot.values
        if not isinstance(raw, dict) or not raw:
            return {}
        return cast(Mapping[str, object], raw)

    async def system_prompt(
        self,
        session_id: str,
        cwd: str | None,
        pinned: Sequence[str] = (),
        mcp_servers: Sequence[str] = (),
    ) -> str:
        """The system prompt the next model call of ``session_id`` would get, or ``""``."""
        values = await self.values(session_id)
        context = PromptContext(values, cwd, tuple(pinned), mcp_servers=tuple(mcp_servers))
        return self.prompt.text(context)

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
        pinned: Sequence[str] = (),
        pinned_folders: Sequence[str] = (),
        options: Mapping[str, float | str] | None = None,
        permission_mode: PermissionMode | None = None,
        checks: bool | None = None,
        plan_first: bool = False,
        local_only: bool = False,
    ) -> AsyncGenerator[object]:
        """Stream one user turn. The first turn writes the state fields.

        Tool calls a stopped run left without results get a cancelled result
        first, so the provider accepts the history. ``cwd`` is the folder the
        file tools work in, and ``mcp_servers`` the on-demand MCP servers the
        session turned on. ``skill_folder`` is the folder of the skill this turn
        runs, which the read tools may read from then on. ``pinned`` are the
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
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        await self.answer_dangling(session_id)
        existing = await self.values(session_id)
        undone = await self._undone_note(session_id, existing)
        graph_input = _turn_input(
            [*undone[0], HumanMessage(content=text, id=user_message_id)],
            session_id=session_id,
            model_profile=model_profile,
            schema_version=schema_version,
            has_checkpoint=bool(existing),
        )
        if undone[1] is not None:
            graph_input["changes_seen"] = undone[1]
        if skill_folder is not None:
            graph_input["skill_folders"] = [skill_folder]
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
    ) -> AsyncGenerator[object]:
        """Go on with a run paused on a tool approval, with the user's ``answer``.

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
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        command: Command[object] = Command(resume=answer.to_resume())
        async with aclosing(self._parts(command, config)) as parts:
            async for part in parts:
                yield part

    async def stream_child(
        self,
        *,
        thread_id: str,
        session_id: str,
        brief: str,
        model_profile: str,
        cwd: str | None,
        options: Mapping[str, float | str] | None,
        max_calls: int,
    ) -> AsyncGenerator[object]:
        """Stream a child run: the same graph on ``thread_id``, with ``brief`` as its first message.

        The run has the helper's tools only, the strictest permission mode, none of the
        session's allowances, and no checks. Its state names ``session_id`` so that its
        artifacts and its budget check are the session's. Close the generator when you stop early.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": thread_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: [],
                MCP_KEY: [],
                MCP_NOW_KEY: set[str](),
                PINNED_KEY: [],
                PINNED_FOLDERS_KEY: [],
                OPTIONS_KEY: dict(options or {}),
                MODE_KEY: "careful",
                CHECKS_KEY: False,
                PLAN_KEY: False,
                CHILD_KEY: ChildScope(tools=EXPLORER_TOOLS, max_calls=max_calls),
            },
            "recursion_limit": 2 * (max_calls + 2) + 6,
        }
        await self.answer_dangling(thread_id)
        existing = await self.values(thread_id)
        graph_input = _turn_input(
            [HumanMessage(content=brief, id=new_id("m"))],
            session_id=session_id,
            model_profile=model_profile,
            schema_version=SCHEMA_VERSION,
            has_checkpoint=bool(existing),
        )
        async with aclosing(self._parts(graph_input, config)) as parts:
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

    async def delegate(
        self,
        *,
        state: AgentState,
        config: RunnableConfig,
        call_id: str,
        brief: str,
        emit_fact: Callable[[object], None],
    ) -> ChildResult:
        """Run a helper for the ``delegate`` call ``call_id`` of the run that has ``state``."""
        role = self.explore_role(state["model_profile"], local_only=_local_only(config))
        return await run_child(
            self,
            session_id=state["session_id"],
            call_id=call_id,
            brief=brief,
            model_profile=role.profile,
            cwd=_cwd(config),
            emit_fact=emit_fact,
            limits=self.child_limits,
            options=_options(config) if role.same_as_session else {},
        )

    async def waiting(self, session_id: str) -> bool:
        """Whether the thread is paused on an interrupt."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        return bool(getattr(snapshot, "interrupts", ()))

    async def _parts(
        self, graph_input: AgentState | Command[object], config: RunnableConfig
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
                messages,
                ctx,
                keep_turns=settings.keep_turns,
                focus=focus,
                used=used,
                ratio=ratio,
                session_id=session_id,
                profile=profile,
                options=options,
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
    gate: ServerGate | None = None,
    tier_of: Callable[[str], Tier | None] | None = None,
    learn_window: Callable[[str], Awaitable[None]] | None = None,
    context: ContextSettings | None = None,
    summariser: Summariser | None = None,
    ratios: TokenRatios | None = None,
    paid_ok: Callable[[str | None], Awaitable[bool]] | None = None,
    budget_refs: Callable[[], list[str]] | None = None,
) -> ChatRuntime:
    """Compile the chat graph against ``checkpointer``.

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
    held a tool call written as text. A failure there never fails the call. With ``gate``,
    a call to a local server waits for its turn first, so one generation runs at a time on it.
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
        message_id = _reply_id(messages, config)
        get_stream_writer()({STREAM_KEY: "model.started", "message_id": message_id})
        scope = scope_of(config)
        child = child_of(config)
        # A helper that used its calls makes one more, without tools, to give its answer.
        final = child is not None and sum(isinstance(m, AIMessage) for m in messages) >= (
            child.max_calls
        )
        overrides = _options(config)
        await registry.prepare(scope)
        tools = registry.scoped(scope)
        plan_first = _plan(config)
        schemas = [] if final else tools.schemas(plan_first=plan_first)
        context = PromptContext(
            state,
            _cwd(config),
            _pinned(config),
            get_stream_writer(),
            tuple(sorted(scope.enabled)),
            plan_first=plan_first,
        )
        parts = [("helper", CHILD_PROMPT)] if child is not None else system_prompt.parts(context)
        text = "\n\n".join(t for _, t in parts)
        system = SystemMessage(content=text) if text else None
        # The system message is sent, never returned, so it stays out of the checkpoint.
        history = view(_without_thinking(messages), state.get("context_view"))
        sent = _outgoing(system, history, final)
        async with _held(router, local, profile):
            if learn_window is not None:
                try:
                    await learn_window(profile)
                except Exception:
                    log.debug("learning the model %s failed", profile, exc_info=True)
            window = window_of(profile, overrides) if window_of is not None else ContextWindow()
            current = state.get("context_view")
            original = current
            plain = _without_thinking(messages)
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
                fitted = await _fit(
                    learned, router, profile, plain, current, system_chars + tools_chars,
                    window.window, clearing, summariser, state.get("session_id"), overrides,
                )  # fmt: skip
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
            try:
                async with _gated(router, gate, profile, message_id):
                    response = await binder.invoke(
                        profile, router.chat_model(profile, overrides), sent, schemas
                    )
            except Exception as exc:
                down = router.unreachable(profile, exc) or await router.refused(profile, exc)
                if down is None:
                    raise
                raise down from exc
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
            update["tool_calls"] = _with_ids(response.tool_calls)
        elif schemas and binder.offers(profile) and "<function=" in message_text(response):
            recovered = recover(message_text(response), schemas)
            if recovered is not None:
                update["content"], update["tool_calls"] = recovered
                text_tool_calls = "recovered"
                log.info("%s wrote %d tool call(s) as text; recovered", profile, len(recovered[1]))
            else:
                text_tool_calls = "unread"
                log.info("%s wrote a tool call as text that could not be read", profile)
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
        result: dict[str, object] = {"messages": [response.model_copy(update=update)]}
        if current is not original:
            result["context_view"] = current
        return result

    def route(state: AgentState) -> Literal["tools", "end"]:
        last = state["messages"][-1] if state["messages"] else None
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return "end"

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
        ),
    )
    builder.add_edge(START, "call_model")
    builder.add_node("checks", checks_node(rules, artifacts))
    builder.add_conditional_edges("call_model", route, {"tools": "tools", "end": "checks"})
    builder.add_edge("tools", "call_model")
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
    return runtime[0]


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
) -> _Cleared | None:
    """The view that sends a summary of the old turns and its ``context.changed`` item.

    None when there is nothing to summarise by turns (too few, or one long turn), when
    there is no summariser, or when the summary failed: a failed summary never fails the run.
    """
    if summariser is None:
        return None
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
) -> Fitted:
    """The view that fits ``window`` with the reply reserve, or raises ``ContextFull``."""

    async def summarise(ctx: ContextView | None) -> tuple[ContextView, int] | None:
        last_turn = settings.model_copy(update={"keep_turns": 1})
        found = await _summarise_old(
            summariser, plain, ctx, last_turn, 0, 1.0,
            session_id=session_id, profile=profile, options=options,
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


def _gated(
    router: ModelRouter, gate: ServerGate | None, profile: str, message_id: str
) -> AbstractAsyncContextManager[None]:
    """Wait for a turn on the local server ``profile`` runs on, or not for any other model."""
    target = None if gate is None else router.ollama_server(profile)
    if gate is None or target is None:
        return nullcontext()
    write = get_stream_writer()

    def notice(waiting: bool) -> None:
        write({STREAM_KEY: "model.waiting", "message_id": message_id, "waiting": waiting})

    return gate.hold(target[1], "chat", notice)


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


def _local_only(config: RunnableConfig) -> bool:
    """Whether the session stays on this Mac."""
    return cast(Mapping[str, object], config.get("configurable", {})).get(LOCAL_ONLY_KEY) is True


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
) -> AgentState:
    if has_checkpoint:
        # model_profile rides along so that session.set_model applies from this turn.
        return cast(
            AgentState,
            {"messages": messages, "model_profile": model_profile, "check_round": 0},
        )
    return cast(
        AgentState,
        {
            "messages": messages,
            "check_round": 0,
            "session_id": session_id,
            "model_profile": model_profile,
            "schema_version": schema_version,
        },
    )


__all__ = ["INTERRUPTED_KEY", "MAX_MODEL_CALLS", "ChatRuntime", "TooManyStepsError", "open_chat"]
