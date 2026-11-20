"""What a hosted model gets of a ``recall`` result that holds a local note (ADR-061, decision 17).

The checkpoint keeps the whole result, so a later local call still reads it. Only the copy
sent to a hosted model is changed. Each memory is checked with ``may_use`` and the model of
the call. A result that cannot be attributed is sent as one stub line.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from langchain_core.messages import BaseMessage, ToolMessage

from golem.graphs.adapter import message_text
from golem.graphs.tools_node import ERROR_KEY, MEMORY_IDS_KEY
from golem.memory.privacy import Target
from golem.memory.service import MemoryAccess

STUB = "a local note was read here and is not sent to this model"
"""One line in place of a memory a hosted model may not read."""

_HOSTED = Target(local=False)


async def stub_local_notes(
    messages: Sequence[BaseMessage], access: MemoryAccess | None
) -> list[BaseMessage]:
    """``messages`` as a hosted model may read them.

    Nothing changes when no ``recall`` result holds a note.

    A result's lines follow its ``memory_ids`` in order. A line of a memory the model may not
    read becomes :data:`STUB`. When the lines do not match the ids, or the result has no
    ids, or there is no access to check them with, the whole result is one stub line.
    """
    kept: list[BaseMessage] = []
    for message in messages:
        if (
            isinstance(message, ToolMessage)
            and message.name == "recall"
            and ERROR_KEY not in message.additional_kwargs
        ):
            message = await _stubbed(message, access)
        kept.append(message)
    return kept


async def _stubbed(message: ToolMessage, access: MemoryAccess | None) -> ToolMessage:
    ids: object = message.additional_kwargs.get(MEMORY_IDS_KEY)
    if not isinstance(ids, list):
        return _whole(message)
    listed = cast(list[object], ids)
    names = [i for i in listed if isinstance(i, str)]
    if len(names) != len(listed):
        return _whole(message)
    if not names:
        return message
    allowed = set[str]() if access is None else await access.allowed(names, _HOSTED)
    if len(allowed) == len(names) and all(i in allowed for i in names):
        return message
    if not isinstance(message.content, str):
        return _whole(message)
    lines = message_text(message).split("\n")
    # The first line is the note about memory, then one line for each id.
    if len(lines) < len(names) + 1:
        return _whole(message)
    for at, name in enumerate(names, start=1):
        if lines[at] == STUB:
            continue
        if not lines[at].startswith(f"{name} | "):
            return _whole(message)
        if name not in allowed:
            lines[at] = STUB
    return message.model_copy(update={"content": "\n".join(lines)})


def _whole(message: ToolMessage) -> ToolMessage:
    return message.model_copy(update={"content": STUB})


__all__ = ["STUB", "stub_local_notes"]
