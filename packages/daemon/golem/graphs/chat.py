"""The phase-2 chat graph: ``START → call_model → END``."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Protocol, cast

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from golem.graphs.state import AgentState
from golem.models.router import ModelRouter


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


class _GraphBuilder(Protocol):
    def add_node(
        self,
        name: str,
        action: Callable[[AgentState], Awaitable[dict[str, list[BaseMessage]]]],
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
    ) -> AsyncIterator[object]:
        """Stream one user turn. The first turn writes the state fields."""
        config = self._config(session_id)
        existing = await self.values(session_id)
        graph_input = _turn_input(
            text,
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

    def _config(self, session_id: str) -> RunnableConfig:
        return {"configurable": {"thread_id": session_id}}


def open_chat(router: ModelRouter, checkpointer: BaseCheckpointSaver[str]) -> ChatRuntime:
    """Compile the chat graph against ``checkpointer``."""

    async def call_model(state: AgentState) -> dict[str, list[BaseMessage]]:
        model = router.chat_model(state["model_profile"])
        response = await model.ainvoke(list(state["messages"]))
        return {"messages": [response]}

    builder = cast(_GraphBuilder, StateGraph(AgentState))
    builder.add_node("call_model", call_model)
    builder.add_edge(START, "call_model")
    builder.add_edge("call_model", END)
    return ChatRuntime(builder.compile(checkpointer=checkpointer), router)


def _turn_input(
    text: str,
    *,
    session_id: str,
    model_profile: str,
    schema_version: int,
    has_checkpoint: bool,
) -> AgentState:
    message = HumanMessage(content=text)
    if has_checkpoint:
        return cast(AgentState, {"messages": [message]})
    return {
        "messages": [message],
        "session_id": session_id,
        "model_profile": model_profile,
        "schema_version": schema_version,
    }


__all__ = ["ChatRuntime", "open_chat"]
