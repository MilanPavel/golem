"""The chat graph: ``START → call_model``, then ``tools → call_model`` while
the reply asks for tools, then ``END``.

Checkpoint messages carry the protocol ``message_id`` as their LangChain
``id``, so the event log and the checkpoint name the same message. The first
model call of a turn uses the turn's assistant id. Each later call gets a new
one and announces it on the custom stream. A fork uses those ids to find
where to cut a thread's history.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import aclosing
from typing import Literal, Protocol, cast

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]
from langgraph.types import Command

from golem.graphs.adapter import STREAM_KEY, message_text
from golem.graphs.state import AgentState
from golem.graphs.tools_node import (
    ALLOWED_KEY,
    CWD_KEY,
    cancelled_results,
    tools_node,
    unanswered_calls,
)
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.ids import new_id
from golem.tools import default_registry
from golem.tools.registry import ToolRegistry

log = logging.getLogger("golem.graphs")

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
        action: Callable[[AgentState, RunnableConfig], Awaitable[dict[str, list[BaseMessage]]]],
    ) -> None: ...

    def add_edge(self, start: object, end: object) -> None: ...

    def add_conditional_edges(
        self, source: str, path: Callable[[AgentState], str], path_map: Mapping[str, object]
    ) -> None: ...

    def compile(self, *, checkpointer: BaseCheckpointSaver[str]) -> _RunningGraph: ...


class ChatRuntime:
    """A compiled chat graph plus the router its node calls."""

    def __init__(self, graph: _RunningGraph, router: ModelRouter) -> None:
        self._graph = graph
        self.router = router

    async def values(self, session_id: str) -> Mapping[str, object]:
        """Checkpoint values for ``session_id``, or an empty mapping."""
        snapshot = await self._graph.aget_state(self._config(session_id))
        raw = snapshot.values
        if not isinstance(raw, dict) or not raw:
            return {}
        return cast(Mapping[str, object], raw)

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
        allowed_tools: Sequence[str] = (),
    ) -> AsyncGenerator[object]:
        """Stream one user turn. The first turn writes the state fields.

        Tool calls a stopped run left without results get a cancelled result
        first, so the provider accepts the history. ``cwd`` is the folder the
        file tools work in. Raises :class:`TooManyStepsError` when the model
        keeps calling tools.

        Close the generator (``contextlib.aclosing``) when you stop early, so
        the graph run ends before the checkpoint is touched again.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                _ASSISTANT_ID: assistant_message_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: list(allowed_tools),
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        await self.answer_dangling(session_id)
        existing = await self.values(session_id)
        graph_input = _turn_input(
            HumanMessage(content=text, id=user_message_id),
            session_id=session_id,
            model_profile=model_profile,
            schema_version=schema_version,
            has_checkpoint=bool(existing),
        )
        async with aclosing(self._parts(graph_input, config)) as parts:
            async for part in parts:
                yield part

    async def resume(
        self,
        *,
        session_id: str,
        decision: str,
        cwd: str | None = None,
        allowed_tools: Sequence[str] = (),
    ) -> AsyncGenerator[object]:
        """Go on with a run paused on a tool approval, with the user's ``decision``.

        Close the generator when you stop early, as with :meth:`stream`.
        """
        config: RunnableConfig = {
            "configurable": {
                "thread_id": session_id,
                CWD_KEY: cwd or "",
                ALLOWED_KEY: list(allowed_tools),
            },
            "recursion_limit": _RECURSION_LIMIT,
        }
        answer: Command[object] = Command(resume={"decision": decision})
        async with aclosing(self._parts(answer, config)) as parts:
            async for part in parts:
                yield part

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
) -> ChatRuntime:
    """Compile the chat graph against ``checkpointer``.

    ``tools`` defaults to the default registry. ``policy`` defaults to the
    built-in rules only, with no user or project file.
    """
    registry = default_registry() if tools is None else tools
    binder = _ToolBinder(registry)

    async def call_model(state: AgentState, config: RunnableConfig) -> dict[str, list[BaseMessage]]:
        messages = list(state["messages"])
        message_id = _reply_id(messages, config)
        get_stream_writer()({STREAM_KEY: "model.started", "message_id": message_id})
        profile = state["model_profile"]
        response = await binder.invoke(profile, router.chat_model(profile), messages)
        update: dict[str, object] = {"id": message_id}
        if response.tool_calls:
            update["tool_calls"] = _with_ids(response.tool_calls)
        return {"messages": [response.model_copy(update=update)]}

    def route(state: AgentState) -> Literal["tools", "end"]:
        last = state["messages"][-1] if state["messages"] else None
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return "end"

    builder = cast(_GraphBuilder, StateGraph(AgentState))
    builder.add_node("call_model", call_model)
    builder.add_node("tools", tools_node(registry, Policy(None) if policy is None else policy))
    builder.add_edge(START, "call_model")
    builder.add_conditional_edges("call_model", route, {"tools": "tools", "end": END})
    builder.add_edge("tools", "call_model")
    return ChatRuntime(builder.compile(checkpointer=checkpointer), router)


class _ToolBinder:
    """Offers the registry's tools to each model that takes them.

    A chat model class without ``bind_tools`` gets none. A model whose server
    refuses tools (Ollama: "does not support tools") is asked again without
    them, and that profile is not offered tools again in this process.
    """

    def __init__(self, registry: ToolRegistry) -> None:
        self._schemas = registry.schemas()
        self._refused: set[str] = set()

    async def invoke(
        self, profile: str, model: BaseChatModel, messages: Sequence[BaseMessage]
    ) -> AIMessage:
        if self._schemas and profile not in self._refused:
            try:
                bound = model.bind_tools(self._schemas)
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


def _ai(message: BaseMessage) -> AIMessage:
    if isinstance(message, AIMessage):
        return message
    return AIMessage(content=message.content)


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
    message: HumanMessage,
    *,
    session_id: str,
    model_profile: str,
    schema_version: int,
    has_checkpoint: bool,
) -> AgentState:
    if has_checkpoint:
        # model_profile rides along so that session.set_model applies from this turn.
        return cast(AgentState, {"messages": [message], "model_profile": model_profile})
    return {
        "messages": [message],
        "session_id": session_id,
        "model_profile": model_profile,
        "schema_version": schema_version,
    }


__all__ = ["INTERRUPTED_KEY", "MAX_MODEL_CALLS", "ChatRuntime", "TooManyStepsError", "open_chat"]
