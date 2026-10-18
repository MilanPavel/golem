"""Server → client events.

``Ping`` is the result body of the ``ping`` command. Chat events are the
``params`` of an ``event`` notification. ``type`` discriminates that union.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

_CONFIG = ConfigDict(extra="forbid", frozen=True)


class Ping(BaseModel):
    """Dummy heartbeat event. Proves Pydantic → JSON Schema → TypeScript."""

    model_config = _CONFIG

    type: Literal["system.ping"]
    nonce: str


class ForkedFrom(BaseModel):
    """The session and message a fork was copied from."""

    model_config = _CONFIG

    session_id: str = Field(min_length=1)
    message_id: str = Field(min_length=1)


class SessionCreatedData(BaseModel):
    """Profile stored for a new session.

    ``model_profile`` is a profile name or a ``provider/model`` ref.
    ``model_provider`` and ``model_name`` are set when the daemon can resolve
    it, and null otherwise. ``forked_from`` is set on a session made by
    ``session.fork``.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    forked_from: ForkedFrom | None = None


class MessageStartedData(BaseModel):
    """An assistant message is open and tokens may follow."""

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    role: Literal["assistant"]


class MessageDeltaData(BaseModel):
    """One incremental fragment of an assistant message."""

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    text: str


class MessageCompletedData(BaseModel):
    """Full text of a user or assistant message.

    ``interrupted`` is true when the run stopped before the model finished.
    ``text`` is then what had streamed so far.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    role: Literal["user", "assistant"]
    text: str
    interrupted: bool = False


class EmptyEventData(BaseModel):
    """No payload. Used by ``run.started``, ``run.completed``, and ``session.closed``."""

    model_config = _CONFIG


class RunFailedData(BaseModel):
    """Why a run stopped. No traceback."""

    model_config = _CONFIG

    message: str = Field(min_length=1)


class RunCancelledData(BaseModel):
    """Who stopped the run. ``user`` is ``run.cancel``, ``shutdown`` the daemon stopping."""

    model_config = _CONFIG

    reason: Literal["user", "shutdown"]


class SessionUpdatedData(BaseModel):
    """A session attribute changed. Today that is only its title."""

    model_config = _CONFIG

    title: str = Field(min_length=1)


class ModelSelectedData(BaseModel):
    """The model the session's next run uses.

    ``model_profile`` is the name asked for, a profile or a ``provider/model``
    ref. ``model_provider`` and ``model_name`` are what it resolved to when it
    was chosen. ``reason`` ``user`` is ``session.set_model``.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    reason: Literal["user"]


class SessionCreatedEvent(BaseModel):
    """A session exists. ``run_id`` is null because no run has started."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.created"]
    data: SessionCreatedData


class SessionUpdatedEvent(BaseModel):
    """The session got a title. ``run_id`` is null: no run owns the change."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.updated"]
    data: SessionUpdatedData


class SessionClosedEvent(BaseModel):
    """The session left the list. ``run_id`` is null: no run owns the change.

    The earlier events stay in the log. ``session.list`` hides the session.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.closed"]
    data: EmptyEventData


class ModelSelectedEvent(BaseModel):
    """The session switched models.

    It applies from the next run. A run in progress keeps its model.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["model.selected"]
    data: ModelSelectedData


class MessageStartedEvent(BaseModel):
    """The assistant bubble is open."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.started"]
    data: MessageStartedData


class MessageDeltaEvent(BaseModel):
    """Tokens to append to the open assistant message."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.delta"]
    data: MessageDeltaData


class MessageCompletedEvent(BaseModel):
    """The full text of one message. Replaces any deltas for that id."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.completed"]
    data: MessageCompletedData


class RunStartedEvent(BaseModel):
    """A graph run is in progress for this session."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.started"]
    data: EmptyEventData


class RunCompletedEvent(BaseModel):
    """The graph run finished and the checkpoint is current."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.completed"]
    data: EmptyEventData


class RunFailedEvent(BaseModel):
    """The graph run stopped with an error."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.failed"]
    data: RunFailedData


class RunCancelledEvent(BaseModel):
    """The run was stopped before the model finished. The partial reply is kept."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.cancelled"]
    data: RunCancelledData


EventType = Literal[
    "session.created",
    "session.updated",
    "session.closed",
    "model.selected",
    "message.started",
    "message.delta",
    "message.completed",
    "run.started",
    "run.completed",
    "run.failed",
    "run.cancelled",
]
"""The ``type`` of each :data:`ChatEvent` member."""


ChatEvent = Annotated[
    SessionCreatedEvent
    | SessionUpdatedEvent
    | SessionClosedEvent
    | ModelSelectedEvent
    | MessageStartedEvent
    | MessageDeltaEvent
    | MessageCompletedEvent
    | RunStartedEvent
    | RunCompletedEvent
    | RunFailedEvent
    | RunCancelledEvent,
    Field(discriminator="type"),
]

CHAT_EVENT: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)
"""Validates a plain mapping or JSON into one :data:`ChatEvent`."""


__all__ = [
    "CHAT_EVENT",
    "ChatEvent",
    "EmptyEventData",
    "EventType",
    "ForkedFrom",
    "MessageCompletedData",
    "MessageCompletedEvent",
    "MessageDeltaData",
    "MessageDeltaEvent",
    "MessageStartedData",
    "MessageStartedEvent",
    "ModelSelectedData",
    "ModelSelectedEvent",
    "Ping",
    "RunCancelledData",
    "RunCancelledEvent",
    "RunCompletedEvent",
    "RunFailedData",
    "RunFailedEvent",
    "RunStartedEvent",
    "SessionClosedEvent",
    "SessionCreatedData",
    "SessionCreatedEvent",
    "SessionUpdatedData",
    "SessionUpdatedEvent",
]
