"""Daemon commands: ``hello``, ``daemon.status``, ``ping``, sessions, chat, and inspect."""

from __future__ import annotations

import logging
import os
import time

from pydantic import BaseModel, ConfigDict

from golem import __version__
from golem.models.router import ModelConfigError
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    MESSAGE_NOT_FOUND,
    MODEL_NOT_CONFIGURED,
    PROTOCOL_MISMATCH,
    RUN_NOT_FOUND,
    SESSION_BUSY,
    SESSION_NOT_FOUND,
    Method,
    RequestContext,
    RpcCallError,
)
from golem.sessions.manager import (
    BlankTitleError,
    MessageNotFoundError,
    RunNotFoundError,
    SchemaMismatchError,
    SessionBusyError,
    SessionManager,
    SessionNotFoundError,
)
from golem.sessions.summaries import summarize
from golem_protocol.commands import (
    DaemonStatus,
    HelloParams,
    HelloResult,
    InspectMessage,
    MessageSendParams,
    MessageSendResult,
    PingParams,
    RunCancelParams,
    RunCancelResult,
    SessionAttachParams,
    SessionAttachResult,
    SessionCloseParams,
    SessionCloseResult,
    SessionCreateParams,
    SessionCreateResult,
    SessionDetachParams,
    SessionDetachResult,
    SessionForkParams,
    SessionForkResult,
    SessionInspectParams,
    SessionInspectResult,
    SessionListParams,
    SessionListResult,
    SessionRenameParams,
    SessionRenameResult,
)
from golem_protocol.events import Ping
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
    profile, provider, name = _configured_model(ctx)
    return DaemonStatus(
        pid=os.getpid(),
        version=__version__,
        protocol_major=PROTOCOL_MAJOR,
        protocol_minor=PROTOCOL_MINOR,
        uptime_seconds=time.monotonic() - ctx.state.started_at,
        state=ctx.state.state,
        model_profile=profile,
        model_provider=provider,
        model_name=name,
    )


def _configured_model(ctx: RequestContext) -> tuple[str | None, str | None, str | None]:
    sessions = ctx.state.sessions
    if sessions is None:
        return None, None, None
    identity = sessions.configured_model()
    return identity.profile, identity.provider, identity.name


async def _ping(ctx: RequestContext, params: PingParams) -> Ping:
    del ctx
    return Ping(type="system.ping", nonce=params.nonce)


async def _session_create(ctx: RequestContext, params: SessionCreateParams) -> SessionCreateResult:
    sessions = _sessions(ctx)
    session_id = await sessions.create(params.model_profile)
    return SessionCreateResult(session_id=session_id)


async def _session_attach(ctx: RequestContext, params: SessionAttachParams) -> SessionAttachResult:
    sessions = _sessions(ctx)
    try:
        last_seq = await sessions.attach(params.session_id, params.after_seq, ctx.connection)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return SessionAttachResult(session_id=params.session_id, last_seq=last_seq)


async def _session_detach(ctx: RequestContext, params: SessionDetachParams) -> SessionDetachResult:
    _sessions(ctx).detach(params.session_id, ctx.connection)
    return SessionDetachResult()


async def _session_list(ctx: RequestContext, params: SessionListParams) -> SessionListResult:
    sessions = _sessions(ctx)
    if params.watch:
        found = await sessions.watch(params.limit, ctx.connection)
    else:
        found = await sessions.recent(params.limit)
    return SessionListResult(sessions=[summarize(item) for item in found])


async def _session_fork(ctx: RequestContext, params: SessionForkParams) -> SessionForkResult:
    try:
        session_id = await _sessions(ctx).fork(params.session_id, params.at_message_id)
    except MessageNotFoundError as exc:
        raise RpcCallError(MESSAGE_NOT_FOUND, "message not found") from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return SessionForkResult(session_id=session_id)


async def _session_close(ctx: RequestContext, params: SessionCloseParams) -> SessionCloseResult:
    try:
        session_id = await _sessions(ctx).close(params.session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    return SessionCloseResult(session_id=session_id)


async def _session_rename(ctx: RequestContext, params: SessionRenameParams) -> SessionRenameResult:
    try:
        title = await _sessions(ctx).rename(params.session_id, params.title)
    except BlankTitleError as exc:
        raise RpcCallError(INVALID_PARAMS, "title is blank") from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return SessionRenameResult(title=title)


async def _message_send(ctx: RequestContext, params: MessageSendParams) -> MessageSendResult:
    sessions = _sessions(ctx)
    try:
        run_id = await sessions.send(params.session_id, params.text)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    return MessageSendResult(run_id=run_id)


async def _run_cancel(ctx: RequestContext, params: RunCancelParams) -> RunCancelResult:
    try:
        cancelled = await _sessions(ctx).cancel(params.run_id)
    except RunNotFoundError as exc:
        raise RpcCallError(RUN_NOT_FOUND, "run not found") from exc
    return RunCancelResult(cancelled=cancelled)


async def _session_inspect(
    ctx: RequestContext, params: SessionInspectParams
) -> SessionInspectResult:
    sessions = _sessions(ctx)
    try:
        view = await sessions.inspect(params.session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return SessionInspectResult(
        session_id=view.session_id,
        model_profile=view.model_profile,
        model_provider=view.model_provider,
        model_name=view.model_name,
        message_count=len(view.messages),
        messages=[
            InspectMessage(role=message.role, text=message.text) for message in view.messages
        ],
    )


def _sessions(ctx: RequestContext) -> SessionManager:
    sessions = ctx.state.sessions
    if sessions is None:
        raise RpcCallError(INTERNAL_ERROR, "sessions are not ready")
    return sessions


def standard_methods() -> dict[str, Method]:
    """The commands the daemon answers."""
    return {
        "hello": Method("hello", HelloParams, False, _hello),
        "daemon.status": Method("daemon.status", _EmptyParams, True, _status),
        "ping": Method("ping", PingParams, True, _ping),
        "session.create": Method("session.create", SessionCreateParams, True, _session_create),
        "session.attach": Method("session.attach", SessionAttachParams, True, _session_attach),
        "session.detach": Method("session.detach", SessionDetachParams, True, _session_detach),
        "session.list": Method("session.list", SessionListParams, True, _session_list),
        "session.fork": Method("session.fork", SessionForkParams, True, _session_fork),
        "session.close": Method("session.close", SessionCloseParams, True, _session_close),
        "session.rename": Method("session.rename", SessionRenameParams, True, _session_rename),
        "message.send": Method("message.send", MessageSendParams, True, _message_send),
        "run.cancel": Method("run.cancel", RunCancelParams, True, _run_cancel),
        "session.inspect": Method("session.inspect", SessionInspectParams, True, _session_inspect),
    }
