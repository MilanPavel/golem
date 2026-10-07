"""Daemon commands: ``hello``, ``daemon.status``, ``ping``, and chat."""

from __future__ import annotations

import logging
import os
import time

from pydantic import BaseModel, ConfigDict

from golem import __version__
from golem.models.router import ModelConfigError
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    MODEL_NOT_CONFIGURED,
    PROTOCOL_MISMATCH,
    SESSION_BUSY,
    SESSION_NOT_FOUND,
    Method,
    RequestContext,
    RpcCallError,
)
from golem.sessions.manager import (
    EventSink,
    SchemaMismatchError,
    SessionBusyError,
    SessionManager,
    SessionNotFoundError,
)
from golem_protocol.commands import (
    DaemonStatus,
    HelloParams,
    HelloResult,
    MessageSendParams,
    MessageSendResult,
    PingParams,
    SessionCreateParams,
    SessionCreateResult,
)
from golem_protocol.events import ChatEvent, Ping
from golem_protocol.rpc import RpcNotification
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

log = logging.getLogger("golem.server")


class _EmptyParams(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


async def _hello(ctx: RequestContext, params: HelloParams) -> HelloResult:
    if params.protocol_major != PROTOCOL_MAJOR:
        raise RpcCallError(
            PROTOCOL_MISMATCH,
            (f"protocol major mismatch: client {params.protocol_major}, daemon {PROTOCOL_MAJOR}"),
            {"client_major": params.protocol_major, "daemon_major": PROTOCOL_MAJOR},
        )
    ctx.connection.welcomed = True
    log.info("hello client=%s minor=%s", params.client, params.protocol_minor)
    return HelloResult(
        protocol_major=PROTOCOL_MAJOR,
        protocol_minor=PROTOCOL_MINOR,
        daemon_version=__version__,
    )


async def _status(ctx: RequestContext, params: _EmptyParams) -> DaemonStatus:
    del params
    return DaemonStatus(
        pid=os.getpid(),
        version=__version__,
        protocol_major=PROTOCOL_MAJOR,
        protocol_minor=PROTOCOL_MINOR,
        uptime_seconds=time.monotonic() - ctx.state.started_at,
        state=ctx.state.state,
    )


async def _ping(ctx: RequestContext, params: PingParams) -> Ping:
    del ctx
    return Ping(type="system.ping", nonce=params.nonce)


async def _session_create(ctx: RequestContext, params: SessionCreateParams) -> SessionCreateResult:
    sessions = _sessions(ctx)
    session_id = await sessions.create(params.model_profile, _sink(ctx))
    return SessionCreateResult(session_id=session_id)


async def _message_send(ctx: RequestContext, params: MessageSendParams) -> MessageSendResult:
    sessions = _sessions(ctx)
    try:
        run_id = await sessions.send(params.session_id, params.text, _sink(ctx))
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    return MessageSendResult(run_id=run_id)


def _sessions(ctx: RequestContext) -> SessionManager:
    sessions = ctx.state.sessions
    if sessions is None:
        raise RpcCallError(INTERNAL_ERROR, "sessions are not ready")
    return sessions


def _sink(ctx: RequestContext) -> EventSink:
    async def emit(event: ChatEvent) -> None:
        try:
            await ctx.connection.send(RpcNotification(params=event))
        except (ConnectionError, OSError):
            log.debug("client went away during %s", event.type)

    return emit


def standard_methods() -> dict[str, Method]:
    """The commands the daemon answers."""
    return {
        "hello": Method("hello", HelloParams, False, _hello),
        "daemon.status": Method("daemon.status", _EmptyParams, True, _status),
        "ping": Method("ping", PingParams, True, _ping),
        "session.create": Method("session.create", SessionCreateParams, True, _session_create),
        "message.send": Method("message.send", MessageSendParams, True, _message_send),
    }
