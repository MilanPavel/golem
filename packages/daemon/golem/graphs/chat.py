"""The chat graph: ``START → call_model → END``.

Checkpoint messages carry the protocol ``message_id`` as their LangChain
``id``, so the event log and the checkpoint name the same message.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Protocol, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from golem.graphs.adapter import message_text
from golem.graphs.state import AgentState
from golem.models.router import ModelRouter

INTERRUPTED_KEY = "golem_interrupted"
"""``response_metadata`` flag on a reply the run did not finish."""

_ASSISTANT_ID = "golem_assistant_message_id"


class _Checkpoint(Protocol):
    @property
    def values(self) -> Mapping[str, object]: ...


class _RunningGraph(Protocol):
    def astream(
        self,
        graph_input: AgentState,
        config: RunnableConfig,
        *,
        stream_mode: list[str],
        version: str,
    ) -> AsyncIterator[object]: ...

    async def aget_state(self, config: RunnableConfig) -> _Checkpoint: ...

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
    ) -> AsyncIterator[object]:
        """Stream one user turn. The first turn writes the state fields."""
        config: RunnableConfig = {
            "configurable": {"thread_id": session_id, _ASSISTANT_ID: assistant_message_id},
        }
        existing = await self.values(session_id)
        graph_input = _turn_input(
            HumanMessage(content=text, id=user_message_id),
            session_id=session_id,
            model_profile=model_profile,
            schema_version=schema_version,
            has_checkpoint=bool(existing),
        )
        async for part in self._graph.astream(
            graph_input,
            config,
            stream_mode=["messages", "updates"],
            version="v2",
        ):
            yield part

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

        Writes only when the checkpoint ends with that turn's user message,
        so a reply the model did finish is never replaced. Returns whether
        it wrote.
        """
        if text == "":
            return False
        messages = _messages(await self.values(session_id))
        if not messages or messages[-1].id != user_message_id:
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

    def _config(self, session_id: str) -> RunnableConfig:
        return {"configurable": {"thread_id": session_id}}


def open_chat(router: ModelRouter, checkpointer: BaseCheckpointSaver[str]) -> ChatRuntime:
    """Compile the chat graph against ``checkpointer``."""

    async def call_model(state: AgentState, config: RunnableConfig) -> dict[str, list[BaseMessage]]:
        model = router.chat_model(state["model_profile"])
        response = await model.ainvoke(list(state["messages"]))
        message_id = config.get("configurable", {}).get(_ASSISTANT_ID)
        if isinstance(message_id, str):
            response = response.model_copy(update={"id": message_id})
        return {"messages": [response]}

    builder = cast(_GraphBuilder, StateGraph(AgentState))
    builder.add_node("call_model", call_model)
    builder.add_edge(START, "call_model")
    builder.add_edge("call_model", END)
    return ChatRuntime(builder.compile(checkpointer=checkpointer), router)


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
        return cast(AgentState, {"messages": [message]})
    return {
        "messages": [message],
        "session_id": session_id,
        "model_profile": model_profile,
        "schema_version": schema_version,
    }


__all__ = ["INTERRUPTED_KEY", "ChatRuntime", "open_chat"]
