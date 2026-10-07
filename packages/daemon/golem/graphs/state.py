"""Checkpointed state for the chat graph.

``messages`` comes from :class:`langgraph.graph.MessagesState` and uses the
``add_messages`` reducer. The other fields are set on the first turn and then
ride along in the checkpoint.
"""

from __future__ import annotations

from langgraph.graph import MessagesState  # pyright: ignore[reportMissingTypeStubs]

SCHEMA_VERSION = 1


class AgentState(MessagesState):
    """One chat thread. ``session_id`` is the checkpointer ``thread_id``."""

    session_id: str
    model_profile: str
    schema_version: int
