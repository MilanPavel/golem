"""What a hosted model gets of a ``data_query`` or ``data_describe`` result of a private source.

The checkpoint keeps the whole result, so a later local call still reads it, and the screen
shows it. Only the copy sent to a hosted model is changed. Each result is checked with
``may_use_rows`` against the level of the source it read. A result that cannot be attributed
is sent as one stub line.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import cast

from langchain_core.messages import BaseMessage, ToolMessage

from golem.config import DataPrivacyLevel
from golem.data.privacy import may_use_rows
from golem.graphs.tools_node import DATA_KEY, ERROR_KEY
from golem.memory.privacy import ChatPrivacy, Target

STUB = "rows of a data source were read here and are not sent to this model"
"""One line in place of a result the model may not read, when its source is not known."""

_TOOLS = ("data_query", "data_describe")
_LEVELS: tuple[DataPrivacyLevel, ...] = ("open", "local", "schema")
_HOSTED = Target(local=False)


def stub_local_rows(
    messages: Sequence[BaseMessage], chat: ChatPrivacy | None = None
) -> list[BaseMessage]:
    """``messages`` as a hosted model may read them.

    A result of a source whose rows the model may not read becomes the line the tool made for
    that case: the row count, the columns and their types, no value. A result with no known
    source becomes :data:`STUB`. Nothing else changes.
    """
    where = chat or ChatPrivacy()
    return [_stubbed(message, where) for message in messages]


def _stubbed(message: BaseMessage, chat: ChatPrivacy) -> BaseMessage:
    if (
        not isinstance(message, ToolMessage)
        or message.name not in _TOOLS
        or ERROR_KEY in message.additional_kwargs
    ):
        return message
    found: object = message.additional_kwargs.get(DATA_KEY)
    if not isinstance(found, Mapping):
        return message.model_copy(update={"content": STUB})
    read = cast(Mapping[str, object], found)
    privacy, hosted = read.get("privacy"), read.get("hosted")
    if privacy not in _LEVELS:
        return message.model_copy(update={"content": STUB})
    if may_use_rows(privacy, chat, _HOSTED).allowed:
        return message
    if isinstance(hosted, str):
        return message.model_copy(update={"content": hosted})
    # A schema source's result holds no value already. Any other result with no text is stubbed.
    return message if privacy == "schema" else message.model_copy(update={"content": STUB})


__all__ = ["STUB", "stub_local_rows"]
