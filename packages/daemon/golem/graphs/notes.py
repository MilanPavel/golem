"""A note from golem to the model.

A note is a human message the model reads, marked so that nothing shows it as
something the user said. The transcript and the title leave it out. The inspect
view and the trace show it, since they show what the model reads.
"""

from __future__ import annotations

from langchain_core.messages import BaseMessage, HumanMessage

from golem.sessions.ids import new_id

PREFIX = "[golem] "
_FLAG = "golem_note"


def note(text: str) -> HumanMessage:
    """A note with ``text``, starting with ``[golem] ``."""
    return HumanMessage(content=PREFIX + text, id=new_id("n"), additional_kwargs={_FLAG: True})


def is_note(message: BaseMessage) -> bool:
    """Whether ``message`` is a note from golem and not something the user said."""
    return isinstance(message, HumanMessage) and message.additional_kwargs.get(_FLAG) is True


__all__ = ["PREFIX", "is_note", "note"]
