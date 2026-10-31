"""Checkpointed state for the chat graph.

``messages`` comes from :class:`langgraph.graph.MessagesState` and uses the
``add_messages`` reducer. ``session_id`` and ``schema_version`` are set on the
first turn and then ride along in the checkpoint. ``model_profile`` is set on
every turn, from the session's current model. ``todos`` is replaced whole by
each ``todo_write``, and small by design. ``skill_folders`` gains the folder
of each skill the session runs, and the read tools may read those folders.
"""

from __future__ import annotations

from typing import Annotated, NotRequired

from langgraph.graph import MessagesState  # pyright: ignore[reportMissingTypeStubs]

SCHEMA_VERSION = 1


def add_folders(current: list[str] | None, new: list[str] | None) -> list[str]:
    """``current`` and then each folder of ``new`` that it does not have yet."""
    folders = list(current or [])
    for folder in new or []:
        if folder not in folders:
            folders.append(folder)
    return folders


class AgentState(MessagesState):
    """One chat thread. ``session_id`` is the checkpointer ``thread_id``."""

    session_id: str
    model_profile: str
    schema_version: int
    todos: NotRequired[list[dict[str, str]]]
    """The agent's plan, from ``todo_write``. Missing in checkpoints from before it."""
    skill_folders: NotRequired[Annotated[list[str], add_folders]]
    """Folders of the skills this session ran, oldest first. Empty in older checkpoints."""
