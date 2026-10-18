"""Daemon commands: ``hello``, ``daemon.status``, ``ping``, sessions, chat, inspect, and keys."""

from __future__ import annotations

import asyncio
import logging
import os
import time

from pydantic import BaseModel, ConfigDict

from golem import __version__
from golem.config_edit import set_default_model
from golem.models.keys import KeyStore, KeyStoreError
from golem.models.pulls import PullError, PullManager
from golem.models.router import ModelConfigError, ModelRouter
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    KEYCHAIN_UNAVAILABLE,
    MESSAGE_NOT_FOUND,
    MODEL_NOT_CONFIGURED,
    MODEL_PULL_FAILED,
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
    AuthKeyStatus,
    AuthListParams,
    AuthListResult,
    AuthRemoveParams,
    AuthRemoveResult,
    AuthSetParams,
    AuthSetResult,
    DaemonStatus,
    HelloParams,
    HelloResult,
    InspectMessage,
    ListedModel,
    ListedProvider,
    MessageSendParams,
    MessageSendResult,
    ModelDeleteParams,
    ModelDeleteResult,
    ModelListParams,
    ModelListResult,
    ModelPriceInfo,
    ModelProbeParams,
    ModelProbeResult,
    ModelPullCancelParams,
    ModelPullCancelResult,
    ModelPullParams,
    ModelPullResult,
    ModelSetDefaultParams,
    ModelSetDefaultResult,
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
    SessionSetModelParams,
    SessionSetModelResult,
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


async def _auth_set(ctx: RequestContext, params: AuthSetParams) -> AuthSetResult:
    router = _sessions(ctx).router
    store = _key_store(router, params.provider)
    key = params.key.get_secret_value().strip()
    if key == "" or any(char.isspace() for char in key):
        raise RpcCallError(INVALID_PARAMS, "the key is empty or has spaces in it")
    try:
        await asyncio.to_thread(store.set, params.provider, key)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    log.info("stored key provider=%s", params.provider)
    return AuthSetResult(provider=params.provider)


async def _auth_remove(ctx: RequestContext, params: AuthRemoveParams) -> AuthRemoveResult:
    router = _sessions(ctx).router
    store = _key_store(router, params.provider)
    try:
        removed = await asyncio.to_thread(store.delete, params.provider)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    log.info("removed key provider=%s removed=%s", params.provider, removed)
    return AuthRemoveResult(provider=params.provider, removed=removed)


async def _auth_list(ctx: RequestContext, params: AuthListParams) -> AuthListResult:
    del params
    router = _sessions(ctx).router
    try:
        statuses = await asyncio.to_thread(router.key_statuses)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    return AuthListResult(
        providers=[
            AuthKeyStatus(
                provider=status.provider,
                takes_key=status.takes_key,
                needs_key=status.needs_key,
                env_var=status.env_var,
                source=status.source,
            )
            for status in statuses
        ]
    )


async def _model_list(ctx: RequestContext, params: ModelListParams) -> ModelListResult:
    models = ctx.state.models
    if models is None:
        raise RpcCallError(INTERNAL_ERROR, "models are not ready")
    listing = await models.list(refresh=params.refresh)
    return ModelListResult(
        default=listing.default,
        ram_gb=listing.ram_gb,
        models=[
            ListedModel(
                ref=model.ref,
                label=model.label,
                provider=model.provider,
                source=model.source,
                status=model.status,
                progress=model.progress,
                profiles=list(model.profiles),
                ctx=model.ctx,
                tools=model.tools,
                price=None if model.price is None else ModelPriceInfo(**model.price.model_dump()),
                size_gb=model.size_gb,
                fit=model.fit,
                stale=model.stale,
            )
            for model in listing.models
        ],
        providers=[
            ListedProvider(provider=item.provider, status=item.status, stale=item.stale)
            for item in listing.providers
        ],
    )


async def _session_set_model(
    ctx: RequestContext, params: SessionSetModelParams
) -> SessionSetModelResult:
    try:
        identity = await _sessions(ctx).set_model(params.session_id, params.model)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    log.info("session model session=%s model=%s", params.session_id, params.model)
    return SessionSetModelResult(
        session_id=params.session_id,
        model_profile=identity.profile,
        model_provider=identity.provider,
        model_name=identity.name,
    )


async def _model_set_default(
    ctx: RequestContext, params: ModelSetDefaultParams
) -> ModelSetDefaultResult:
    router = _sessions(ctx).router
    try:
        router.resolve(params.model)
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    config_file = ctx.state.paths.config_file
    try:
        await asyncio.to_thread(set_default_model, config_file, params.model)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("default model=%s", params.model)
    return ModelSetDefaultResult(default=params.model)


def _pulls(ctx: RequestContext) -> PullManager:
    pulls = ctx.state.pulls
    if pulls is None:
        raise RpcCallError(INTERNAL_ERROR, "downloads are not ready")
    return pulls


async def _model_probe(ctx: RequestContext, params: ModelProbeParams) -> ModelProbeResult:
    try:
        probe = await _pulls(ctx).probe(params.name)
    except PullError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return ModelProbeResult(
        ref=probe.ref,
        installed=probe.installed,
        exists=probe.exists,
        size_gb=probe.size_gb,
        fit=probe.fit,
        disk_free_gb=probe.disk_free_gb,
    )


async def _model_pull(ctx: RequestContext, params: ModelPullParams) -> ModelPullResult:
    try:
        ref, started = await _pulls(ctx).start(params.name)
    except PullError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return ModelPullResult(ref=ref, started=started)


async def _model_pull_cancel(
    ctx: RequestContext, params: ModelPullCancelParams
) -> ModelPullCancelResult:
    try:
        ref, cancelled = await _pulls(ctx).cancel(params.name)
    except PullError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return ModelPullCancelResult(ref=ref, cancelled=cancelled)


async def _model_delete(ctx: RequestContext, params: ModelDeleteParams) -> ModelDeleteResult:
    try:
        ref, deleted = await _pulls(ctx).delete(params.name)
    except PullError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return ModelDeleteResult(ref=ref, deleted=deleted)


def _key_store(router: ModelRouter, provider_name: str) -> KeyStore:
    provider = router.provider(provider_name)
    if provider is None:
        raise RpcCallError(INVALID_PARAMS, f"unknown model provider: {provider_name}")
    if provider.kind == "ollama":
        raise RpcCallError(INVALID_PARAMS, f"{provider_name} takes no key")
    if router.keys is None:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, "this daemon has no key store")
    return router.keys


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
        "auth.set": Method("auth.set", AuthSetParams, True, _auth_set),
        "auth.remove": Method("auth.remove", AuthRemoveParams, True, _auth_remove),
        "auth.list": Method("auth.list", AuthListParams, True, _auth_list),
        "model.list": Method("model.list", ModelListParams, True, _model_list),
        "model.probe": Method("model.probe", ModelProbeParams, True, _model_probe),
        "model.pull": Method("model.pull", ModelPullParams, True, _model_pull),
        "model.pull_cancel": Method(
            "model.pull_cancel", ModelPullCancelParams, True, _model_pull_cancel
        ),
        "model.delete": Method("model.delete", ModelDeleteParams, True, _model_delete),
        "model.set_default": Method(
            "model.set_default", ModelSetDefaultParams, True, _model_set_default
        ),
        "session.set_model": Method(
            "session.set_model", SessionSetModelParams, True, _session_set_model
        ),
    }
