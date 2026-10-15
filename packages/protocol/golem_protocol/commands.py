"""Client → daemon commands.

``Ping`` in :mod:`golem_protocol.events` is the result of ``ping``.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HelloParams(BaseModel):
    """First command on a connection. Negotiates the protocol version."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_major: int
    protocol_minor: int
    client: str = Field(min_length=1, max_length=32)


class HelloResult(BaseModel):
    """Daemon's protocol version and build."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_major: int
    protocol_minor: int
    daemon_version: str


class DaemonStatus(BaseModel):
    """Result of ``daemon.status``.

    ``model_profile``, ``model_provider``, and ``model_name`` describe the
    model the daemon is configured to use. Provider and name are null when
    they are not set.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    pid: int
    version: str
    protocol_major: int
    protocol_minor: int
    uptime_seconds: float
    state: Literal["running", "draining"]
    model_profile: str | None = Field(default=None, min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)


class PingParams(BaseModel):
    """Client heartbeat. The daemon echoes ``nonce`` on a ``Ping`` event."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    nonce: str


class SessionCreateParams(BaseModel):
    """``session.create``. An empty profile uses the daemon's configured one.

    The caller is not attached. ``session.attach`` replays ``session.created``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model_profile: str | None = Field(default=None, min_length=1)


class SessionCreateResult(BaseModel):
    """The id of the session the daemon just created."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionAttachParams(BaseModel):
    """``session.attach``. Replay events after ``after_seq``, then stream live ones.

    Events reach a connection only for sessions it attached. Replayed events
    are written before any live event, with no gap and no repeat.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    after_seq: int = Field(default=0, ge=0)


class SessionAttachResult(BaseModel):
    """``last_seq`` is the newest event when the replay was read."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    last_seq: int = Field(ge=0)


class SessionDetachParams(BaseModel):
    """``session.detach``. Stop live events for this session on this connection."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionDetachResult(BaseModel):
    """No payload. Detaching a session that was not attached is not an error."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SessionListParams(BaseModel):
    """``session.list``. Newest activity first.

    With ``watch``, the connection also gets a ``session.summary``
    notification whenever a session's summary changes, until it closes.
    Watching again is not an error.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    limit: int = Field(default=50, ge=1, le=500)
    watch: bool = False


class SessionSummary(BaseModel):
    """One session as ``session.list`` reports it.

    ``status`` is ``running`` while a run is open. ``last_seq`` is the newest
    stored event, so a client can tell what it has not seen, and which of
    two summaries of one session is newer.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    title: str | None = Field(default=None, min_length=1)
    status: Literal["idle", "running"]
    created_at: str = Field(min_length=1)
    updated_at: str = Field(min_length=1)
    last_seq: int = Field(ge=0)


class SessionListResult(BaseModel):
    """Sessions, newest activity first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sessions: list[SessionSummary]


class MessageSendParams(BaseModel):
    """``message.send``. Starts one graph run for this session.

    The run's events go to the connections attached to the session.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=100_000)


class MessageSendResult(BaseModel):
    """The run that is now streaming events for this send."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class RunCancelParams(BaseModel):
    """``run.cancel``. Stop a run that is still in progress."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class RunCancelResult(BaseModel):
    """Whether the run was stopped.

    ``cancelled`` is false when the run had already ended. When it is true,
    ``run.cancelled`` is already in the log.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cancelled: bool


class SessionInspectParams(BaseModel):
    """``session.inspect``. Read the checkpoint for one session. Does not call the model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class InspectMessage(BaseModel):
    """One checkpoint message as plain text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["user", "assistant", "system", "tool"]
    text: str


class SessionInspectResult(BaseModel):
    """The conversation stored for this session.

    ``message_count`` is the length of ``messages``. Provider and name are
    null when this profile is not the one the daemon is configured to run.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    message_count: int = Field(ge=0)
    messages: list[InspectMessage]


__all__ = [
    "DaemonStatus",
    "HelloParams",
    "HelloResult",
    "InspectMessage",
    "MessageSendParams",
    "MessageSendResult",
    "PingParams",
    "RunCancelParams",
    "RunCancelResult",
    "SessionAttachParams",
    "SessionAttachResult",
    "SessionCreateParams",
    "SessionCreateResult",
    "SessionDetachParams",
    "SessionDetachResult",
    "SessionInspectParams",
    "SessionInspectResult",
    "SessionListParams",
    "SessionListResult",
    "SessionSummary",
]
