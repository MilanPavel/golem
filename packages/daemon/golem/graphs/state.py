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

from golem.graphs.context_view import ContextView

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
    context_view: NotRequired[ContextView]
    """What a model call sends of ``messages``. Replaced whole on update. Empty or missing: all."""
    checks_offered: NotRequired[bool]
    """Whether the session was offered its checks. Set once, so the offer is made once."""
    check_round: NotRequired[int]
    """Fix rounds the checks sent back to the model in this turn. Reset to 0 each turn."""
    check_results: NotRequired[list[dict[str, object]]]
    """What the checks of the latest turn reported. Replaced each turn, empty when none ran."""
    changes_seen: NotRequired[int]
    """The highest ``file_changes.seq`` the model was told about. Missing or 0: none yet."""
    branch_seen: NotRequired[str]
    """The branch of the session's folder as of the last turn that had one. Missing: none yet."""
    can_step_up: NotRequired[bool]
    """Whether this run may move to a stronger model once. Set each turn, true on route ``auto``."""
    stepped_up: NotRequired[bool]
    """A step-up was tried in this run, so no second one is. Reset each turn."""
    fallbacks: NotRequired[int]
    """Times this run left a failing provider for another model. At most two. Reset each turn."""
    last_call: NotRequired[dict[str, object]]
    """What the router needs of the last model call: ``stop_reason``, ``text_tool_calls``,
    ``context_full`` (``need``, ``window``, ``model``, ``message_id``), ``stepped``,
    ``fell_back`` (``message_id``, ``streamed``)."""
