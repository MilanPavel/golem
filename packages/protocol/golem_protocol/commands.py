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
    """Result of ``daemon.status``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pid: int
    version: str
    protocol_major: int
    protocol_minor: int
    uptime_seconds: float
    state: Literal["running", "draining"]


class PingParams(BaseModel):
    """Client heartbeat. The daemon echoes ``nonce`` on a ``Ping`` event."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    nonce: str


class SessionCreateParams(BaseModel):
    """``session.create``. An empty profile uses the daemon's configured one."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model_profile: str | None = Field(default=None, min_length=1)


class SessionCreateResult(BaseModel):
    """The id of the session the daemon just created."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class MessageSendParams(BaseModel):
    """``message.send``. Starts one graph run for this session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=100_000)


class MessageSendResult(BaseModel):
    """The run that is now streaming events for this send."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


__all__ = [
    "DaemonStatus",
    "HelloParams",
    "HelloResult",
    "MessageSendParams",
    "MessageSendResult",
    "PingParams",
    "SessionCreateParams",
    "SessionCreateResult",
]
