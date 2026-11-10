"""Daemon commands: hello, status, ping, sessions, chat, keys, models, MCP, and skills."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import replace
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict

from golem import __version__
from golem.config import load_settings
from golem.config_edit import (
    McpTableError,
    RuleIndexError,
    read_model_options,
    set_default_model,
    set_mcp_enabled,
    set_model_options,
)
from golem.doctor import MacPlatform, run_checks
from golem.folders import FolderError, list_dirs
from golem.mcp import McpServerError, McpSupervisor
from golem.models import hardware, ollama
from golem.models import options as model_options
from golem.models.discovery import KeyRejected, KeyUnchecked
from golem.models.errors import ModelUnreachable
from golem.models.install import InstallError, OllamaInstaller
from golem.models.keys import KeyStore, KeyStoreError, MemoryKeyStore
from golem.models.pulls import PullError, PullManager
from golem.models.router import OLLAMA_BASE_URL, ModelConfigError, ModelRouter
from golem.permissions.policy import PROJECT_POLICY
from golem.secrets import SecretStore, SecretStoreError, check_name
from golem.server.dispatcher import (
    APPROVAL_NOT_FOUND,
    ARTIFACT_NOT_FOUND,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_TOOL_ARGS,
    KEY_REJECTED,
    KEY_UNCHECKED,
    KEYCHAIN_UNAVAILABLE,
    MESSAGE_NOT_FOUND,
    MODEL_NOT_CONFIGURED,
    MODEL_PULL_FAILED,
    OLLAMA_FAILED,
    PROTOCOL_MISMATCH,
    RUN_NOT_FOUND,
    SESSION_BUSY,
    SESSION_NOT_FOUND,
    SKILL_NOT_FOUND,
    Method,
    RequestContext,
    RpcCallError,
)
from golem.server.mcp_catalog import mcp_catalog, runtime_install, runtime_install_cancel
from golem.server.mcp_edit import (
    config_raw_get,
    config_raw_set,
    config_raw_set_protected,
    mcp_add,
    mcp_get,
    mcp_remove,
    mcp_update,
)
from golem.server.mcp_import import mcp_import_apply, mcp_import_scan
from golem.server.mcp_try import mcp_call, mcp_logs, mcp_test
from golem.sessions.manager import (
    ApprovalNotFoundError,
    BlankTitleError,
    InvalidToolArgsError,
    MessageNotFoundError,
    RuleWriteError,
    RunNotFoundError,
    SchemaMismatchError,
    SessionBusyError,
    SessionManager,
    SessionNotFoundError,
    SpanNotFoundError,
)
from golem.sessions.summaries import summarize
from golem.skills.invoke import SkillInvokeError
from golem.skills.pinned import SkillPinError
from golem.skills.registry import listed_skill
from golem.tools.registry import ToolScope
from golem_protocol.commands import (
    ApprovalRespondParams,
    ApprovalRespondResult,
    ArtifactReadParams,
    ArtifactReadResult,
    AuthKeyStatus,
    AuthListParams,
    AuthListResult,
    AuthRemoveParams,
    AuthRemoveResult,
    AuthSetParams,
    AuthSetResult,
    ConfigAllowance,
    ConfigGetParams,
    ConfigGetResult,
    ConfigRawGetParams,
    ConfigRawSetParams,
    ConfigRule,
    DaemonStatus,
    FsListDirsParams,
    FsListDirsResult,
    HelloParams,
    HelloResult,
    InspectMessage,
    ListedModel,
    ListedProvider,
    LocalServer,
    McpAddParams,
    McpCallParams,
    McpCatalogParams,
    McpImportApplyParams,
    McpImportScanParams,
    McpListParams,
    McpListResult,
    McpLogsParams,
    McpRemoveParams,
    McpServer,
    McpServerParams,
    McpSetEnabledParams,
    McpTestParams,
    McpToggleParams,
    McpToggleResult,
    McpToolInfo,
    McpToolsResult,
    McpUpdateParams,
    MessageSendParams,
    MessageSendResult,
    ModelCategory,
    ModelDeleteParams,
    ModelDeleteResult,
    ModelListParams,
    ModelListResult,
    ModelMemory,
    ModelOption,
    ModelOptionsGetParams,
    ModelOptionsGetResult,
    ModelOptionsSaved,
    ModelOptionsSetParams,
    ModelOptionsSetResult,
    ModelPriceInfo,
    ModelProbeParams,
    ModelProbeResult,
    ModelPullCancelParams,
    ModelPullCancelResult,
    ModelPullParams,
    ModelPullResult,
    ModelSetDefaultParams,
    ModelSetDefaultResult,
    ModelSetup,
    OllamaInstallCancelParams,
    OllamaInstallCancelResult,
    OllamaInstallParams,
    OllamaInstallResult,
    OllamaStartParams,
    OllamaStartResult,
    PingParams,
    PolicyEditResult,
    PolicyRemoveParams,
    PolicyUpdateParams,
    RunCancelParams,
    RunCancelResult,
    RuntimeInstallCancelParams,
    RuntimeInstallParams,
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
    SessionRevokeParams,
    SessionRevokeResult,
    SessionSetModelParams,
    SessionSetModelResult,
    SessionSetOptionsParams,
    SessionSetOptionsResult,
    SessionSetSkillsParams,
    SessionSetSkillsResult,
    SetupRow,
    SetupStatusParams,
    SetupStatusResult,
    SkillListParams,
    SkillListResult,
    TraceGetParams,
    TraceGetResult,
    TraceSpanParams,
    TraceSpanResult,
)
from golem_protocol.events import Ping
from golem_protocol.rpc import ModelOptionsSavedNotification
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

log = logging.getLogger("golem.server")

MCP_PREFIX = "mcp/"


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
        local_servers=await _local_servers(ctx),
    )


async def _local_servers(ctx: RequestContext) -> list[LocalServer]:
    local = ctx.state.local_servers
    if local is None:
        return []
    servers: list[LocalServer] = []
    for status in local.statuses():
        memory = None
        if status.owner == "golem" and status.pid is not None:
            memory = await asyncio.to_thread(ollama.memory_mb, status.pid)
        servers.append(
            LocalServer(
                provider=status.provider,
                base_url=status.base_url,
                owner=status.owner,
                pid=status.pid,
                memory_mb=memory,
            )
        )
    return servers


def _configured_model(ctx: RequestContext) -> tuple[str | None, str | None, str | None]:
    sessions = ctx.state.sessions
    if sessions is None:
        return None, None, None
    identity = sessions.configured_model()
    return identity.profile, identity.provider, identity.name


def _check_cwd(cwd: str | None) -> None:
    """Refuse a project folder that is not an absolute path to a folder that exists."""
    if cwd is None:
        return
    if not Path(cwd).is_absolute():
        raise RpcCallError(INVALID_PARAMS, "cwd must be an absolute path")
    if not Path(cwd).is_dir():
        raise RpcCallError(INVALID_PARAMS, f"There is no folder at {cwd}.")


async def _ping(ctx: RequestContext, params: PingParams) -> Ping:
    del ctx
    return Ping(type="system.ping", nonce=params.nonce)


async def _session_create(ctx: RequestContext, params: SessionCreateParams) -> SessionCreateResult:
    sessions = _sessions(ctx)
    _check_cwd(params.cwd)
    try:
        session_id = await sessions.create(params.model_profile, cwd=params.cwd)
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
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
    _check_cwd(params.cwd)
    sessions = _sessions(ctx)
    if params.watch:
        found = await sessions.watch(params.limit, ctx.connection)
    else:
        found = await sessions.recent(params.limit, params.cwd)
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
    _check_cwd(params.cwd)
    try:
        run_id = await sessions.send(
            params.session_id, params.text, cwd=params.cwd, skill=params.skill
        )
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    except SkillInvokeError as exc:
        raise RpcCallError(SKILL_NOT_FOUND, str(exc)) from exc
    return MessageSendResult(run_id=run_id)


async def _fs_list_dirs(ctx: RequestContext, params: FsListDirsParams) -> FsListDirsResult:
    del ctx
    if params.path is not None and not Path(params.path).is_absolute():
        raise RpcCallError(INVALID_PARAMS, "path must be an absolute path")
    try:
        return list_dirs(None if params.path is None else Path(params.path), Path.home())
    except FolderError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def _approval_respond(
    ctx: RequestContext, params: ApprovalRespondParams
) -> ApprovalRespondResult:
    sessions = _sessions(ctx)
    try:
        run_id = await sessions.respond(
            params.session_id, params.call_id, params.decision, params.args
        )
    except ApprovalNotFoundError as exc:
        raise RpcCallError(APPROVAL_NOT_FOUND, "no run waits on this tool call") from exc
    except InvalidToolArgsError as exc:
        raise RpcCallError(INVALID_TOOL_ARGS, str(exc)) from exc
    except RuleWriteError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the rule: {exc}") from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return ApprovalRespondResult(run_id=run_id)


async def _artifact_read(ctx: RequestContext, params: ArtifactReadParams) -> ArtifactReadResult:
    artifacts = ctx.state.artifacts
    if artifacts is None:
        raise RpcCallError(INTERNAL_ERROR, "artifacts are not ready")
    page = await artifacts.read(params.session_id, params.artifact_id, params.offset, params.limit)
    if page is None:
        raise RpcCallError(ARTIFACT_NOT_FOUND, "no such artifact in this session")
    return ArtifactReadResult(text=page.text, offset=page.offset, size=page.size)


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
        message_count=view.stored,
        messages=[
            InspectMessage(role=message.role, text=message.text) for message in view.messages
        ],
    )


async def _trace_get(ctx: RequestContext, params: TraceGetParams) -> TraceGetResult:
    try:
        title, runs = await _sessions(ctx).trace(params.session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return TraceGetResult(session_id=params.session_id, title=title, runs=runs)


async def _trace_span(ctx: RequestContext, params: TraceSpanParams) -> TraceSpanResult:
    try:
        return await _sessions(ctx).trace_span(params.session_id, params.span_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except SpanNotFoundError as exc:
        raise RpcCallError(INVALID_PARAMS, "span not found") from exc


async def _auth_set(ctx: RequestContext, params: AuthSetParams) -> AuthSetResult:
    key = params.key.get_secret_value().strip()
    if key == "" or any(char.isspace() for char in key):
        raise RpcCallError(INVALID_PARAMS, "the key is empty or has spaces in it")
    if params.provider.startswith(MCP_PREFIX):
        secrets = _mcp_secrets(ctx, params.provider)
        try:
            await asyncio.to_thread(secrets.set, params.provider, key)
        except SecretStoreError as exc:
            raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
        log.info("stored secret %s", params.provider)
        if ctx.state.mcp is not None:
            ctx.state.mcp.secret_changed(params.provider)
        return AuthSetResult(provider=params.provider)
    router = _sessions(ctx).router
    store = _key_store(router, params.provider)
    models: int | None = None
    if params.check and ctx.state.models is not None:
        # Tried first, so a key the provider refuses never replaces a working one.
        try:
            models = await ctx.state.models.check_key(params.provider, key)
        except KeyRejected as exc:
            raise RpcCallError(KEY_REJECTED, str(exc)) from exc
        except KeyUnchecked as exc:
            raise RpcCallError(KEY_UNCHECKED, str(exc)) from exc
    try:
        await asyncio.to_thread(store.set, params.provider, key)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    log.info("stored key provider=%s checked=%s", params.provider, models is not None)
    return AuthSetResult(provider=params.provider, models=models)


async def _auth_remove(ctx: RequestContext, params: AuthRemoveParams) -> AuthRemoveResult:
    if params.provider.startswith(MCP_PREFIX):
        secrets = _mcp_secrets(ctx, params.provider)
        try:
            removed = await asyncio.to_thread(secrets.delete, params.provider)
        except SecretStoreError as exc:
            raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
        log.info("removed secret %s removed=%s", params.provider, removed)
        return AuthRemoveResult(provider=params.provider, removed=removed)
    router = _sessions(ctx).router
    store = _key_store(router, params.provider)
    try:
        removed = await asyncio.to_thread(store.delete, params.provider)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    log.info("removed key provider=%s removed=%s", params.provider, removed)
    return AuthRemoveResult(provider=params.provider, removed=removed)


def _mcp_secrets(ctx: RequestContext, name: str) -> SecretStore:
    """The store for an MCP server's secret, once ``name`` is ``mcp/<name>``."""
    try:
        check_name(name)
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    if ctx.state.secrets is None:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, "this daemon has no secret store")
    return ctx.state.secrets


async def _auth_list(ctx: RequestContext, params: AuthListParams) -> AuthListResult:
    del params
    router = _sessions(ctx).router
    try:
        statuses = await asyncio.to_thread(router.key_statuses)
        stored = await asyncio.to_thread(_mcp_stored, ctx)
    except KeyStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    keys = [
        AuthKeyStatus(
            provider=status.provider,
            takes_key=status.takes_key,
            needs_key=status.needs_key,
            env_var=status.env_var,
            source=status.source,
        )
        for status in statuses
    ]
    secrets = [
        AuthKeyStatus(
            provider=name, takes_key=True, needs_key=True, source="keychain" if found else None
        )
        for name, found in stored
    ]
    return AuthListResult(providers=[*keys, *secrets])


def _mcp_stored(ctx: RequestContext) -> list[tuple[str, bool]]:
    """Each ``mcp/…`` secret the MCP servers name, and whether the store has it."""
    mcp, secrets = ctx.state.mcp, ctx.state.secrets
    if mcp is None or secrets is None:
        return []
    return [(name, bool(secrets.get(name))) for name in mcp.secret_names()]


async def _model_list(ctx: RequestContext, params: ModelListParams) -> ModelListResult:
    models = ctx.state.models
    if models is None:
        raise RpcCallError(INTERNAL_ERROR, "models are not ready")
    listing = await models.list(refresh=params.refresh, show_all=params.show_all)
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
                tags=list(model.tags),
                categories=cast(list[ModelCategory], list(model.categories)),
                recommended=model.recommended,
                recommended_for=cast(list[ModelCategory], list(model.recommended_for)),
            )
            for model in listing.models
        ],
        providers=[
            ListedProvider(provider=item.provider, status=item.status, stale=item.stale)
            for item in listing.providers
        ],
        disk_free_gb=listing.disk_free_gb,
        setup=ModelSetup(
            ollama_installed=listing.setup.ollama_installed,
            ollama_running=listing.setup.ollama_running,
            keys=list(listing.setup.keys),
            default_status=listing.setup.default_status,
        ),
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


def _ollama_name(model: str) -> str:
    return model.strip().removeprefix("ollama/")


async def _model_options_get(
    ctx: RequestContext, params: ModelOptionsGetParams
) -> ModelOptionsGetResult:
    name = _ollama_name(params.model)
    discovery = ctx.state.models
    own = {} if discovery is None else await discovery.ollama_parameters(f"ollama/{name}")
    config_file = ctx.state.paths.config_file
    try:
        saved = await asyncio.to_thread(read_model_options, config_file, name)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read {config_file}: {exc}") from exc
    session: dict[str, float | str] | None = None
    if params.session_id is not None:
        try:
            session = await _sessions(ctx).session_options(params.session_id)
        except (SessionNotFoundError, SchemaMismatchError) as exc:
            raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    memory: ModelMemory | None = None
    if discovery is not None and discovery.ram_gb is not None:
        size_gb = await discovery.ollama_size_gb(f"ollama/{name}")
        if size_gb is not None:
            memory = ModelMemory(
                ram_gb=discovery.ram_gb,
                size_gb=size_gb,
                kv_gb_per_1k_tokens=hardware.KV_GB_PER_1K_TOKENS,
                overhead_gb=hardware.OVERHEAD_GB,
                fits_share=hardware.FITS_SHARE,
                tight_share=hardware.TIGHT_SHARE,
            )
    values = model_options.defaults(own)
    default_from: dict[str, Literal["modelfile", "ollama"]] = {}
    if "num_ctx" in values:
        default_from["num_ctx"] = "modelfile"
    elif discovery is not None:
        seen = discovery.default_ctx(f"ollama/{name}")
        if seen is not None:
            values["num_ctx"] = seen
            default_from["num_ctx"] = "ollama"
    return ModelOptionsGetResult(
        model=name,
        options=[
            ModelOption(
                name=row.name,
                label=row.label,
                kind=row.kind,
                minimum=row.minimum,
                maximum=row.maximum,
                step=row.step,
                default=row.default,
                short=row.short,
                long=row.long,
            )
            for row in model_options.OPTIONS
        ],
        defaults=values,
        default_from=default_from,
        saved=saved,
        session=session,
        memory=memory,
    )


async def _model_options_set(
    ctx: RequestContext, params: ModelOptionsSetParams
) -> ModelOptionsSetResult:
    name = _ollama_name(params.model)
    config_file = ctx.state.paths.config_file
    try:
        saved = await asyncio.to_thread(set_model_options, config_file, name, params.options)
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("model options model=%s saved=%s", name, sorted(saved))
    ctx.state.broadcast(
        ModelOptionsSavedNotification(params=ModelOptionsSaved(model=name, saved=saved))
    )
    return ModelOptionsSetResult(model=name, saved=saved)


async def _session_set_options(
    ctx: RequestContext, params: SessionSetOptionsParams
) -> SessionSetOptionsResult:
    try:
        options = await _sessions(ctx).set_options(params.session_id, params.options)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    log.info("session options session=%s options=%s", params.session_id, sorted(options))
    return SessionSetOptionsResult(session_id=params.session_id, options=options)


async def _config_get(ctx: RequestContext, params: ConfigGetParams) -> ConfigGetResult:
    policy, tools = ctx.state.policy, ctx.state.tools
    if policy is None or tools is None:
        raise RpcCallError(INTERNAL_ERROR, "tools are not ready")
    _check_cwd(params.cwd)
    paths = ctx.state.paths
    try:
        settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    except ValueError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"{paths.config_file} does not validate: {exc}") from exc
    root = None if params.cwd is None else Path(params.cwd)
    rules = await asyncio.to_thread(policy.rules, root, tools)
    project = None if root is None else root / PROJECT_POLICY
    allowed: list[ConfigAllowance] = []
    if params.session_id is not None:
        try:
            pairs = await _sessions(ctx).allowances(params.session_id)
        except SessionNotFoundError as exc:
            raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
        allowed = [ConfigAllowance(tool=tool, subject=subject) for tool, subject in pairs]
    return ConfigGetResult(
        config_file=str(paths.config_file),
        default_model=_sessions(ctx).router.default,
        log_level=settings.log_level,
        session_titles=settings.session_titles,
        trusted_projects=settings.trusted_projects,
        project_policy=str(project) if project is not None and project.is_file() else None,
        project_trusted=None if root is None else policy.trusted(root),
        rules=[
            ConfigRule(
                tool=rule.rule.tool,
                match=rule.rule.match,
                path=rule.rule.path,
                action=rule.rule.action,
                source=rule.source,
                ignored=rule.ignored,
                file=rule.file,
                index=rule.index,
            )
            for rule in rules
        ],
        session_allowed=allowed,
    )


async def _policy_update(ctx: RequestContext, params: PolicyUpdateParams) -> PolicyEditResult:
    return await _edit_policy(ctx, params.target, params.cwd, params.index, params.action)


async def _policy_remove(ctx: RequestContext, params: PolicyRemoveParams) -> PolicyEditResult:
    return await _edit_policy(ctx, params.target, params.cwd, params.index, None)


async def _edit_policy(
    ctx: RequestContext,
    target: Literal["user", "project"],
    cwd: str | None,
    index: int,
    action: Literal["allow", "ask", "deny"] | None,
) -> PolicyEditResult:
    policy = ctx.state.policy
    if policy is None:
        raise RpcCallError(INTERNAL_ERROR, "tools are not ready")
    _check_cwd(cwd)
    root = None if cwd is None else Path(cwd)
    try:
        path = policy.file(target, root)
        await asyncio.to_thread(policy.edit, target, root, index, action)
    except RuleIndexError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the rules: {exc}") from exc
    log.info("rule %d in %s: %s", index, path, action or "removed")
    return PolicyEditResult(file=str(path))


async def _session_revoke(ctx: RequestContext, params: SessionRevokeParams) -> SessionRevokeResult:
    try:
        revoked = await _sessions(ctx).revoke(params.session_id, params.tool, params.subject)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    return SessionRevokeResult(revoked=revoked)


async def _mcp_list(ctx: RequestContext, params: McpListParams) -> McpListResult:
    mcp = ctx.state.mcp
    if mcp is None:
        return McpListResult(servers=[])
    if params.session_id is None:
        return McpListResult(servers=mcp.statuses())
    scope = await _tool_scope(ctx, params.session_id)
    return McpListResult(servers=mcp.statuses(scope))


async def _skill_list(ctx: RequestContext, params: SkillListParams) -> SkillListResult:
    _check_cwd(params.cwd)
    skills = ctx.state.skills
    if skills is None:
        return SkillListResult(skills=[])
    view = skills.view(None if params.cwd is None else Path(params.cwd))
    return SkillListResult(skills=[listed_skill(entry) for entry in view.listed])


async def _session_set_skills(
    ctx: RequestContext, params: SessionSetSkillsParams
) -> SessionSetSkillsResult:
    both = sorted(set(params.pin) & set(params.unpin))
    if both:
        raise RpcCallError(INVALID_PARAMS, f"{both[0]} is in both pin and unpin")
    try:
        skills = await _sessions(ctx).set_skills(params.session_id, params.pin, params.unpin)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except SkillPinError as exc:
        raise RpcCallError(SKILL_NOT_FOUND, str(exc)) from exc
    return SessionSetSkillsResult(session_id=params.session_id, skills=skills)


async def _mcp_enable(ctx: RequestContext, params: McpToggleParams) -> McpToggleResult:
    return await _mcp_toggle(ctx, params, True)


async def _mcp_disable(ctx: RequestContext, params: McpToggleParams) -> McpToggleResult:
    return await _mcp_toggle(ctx, params, False)


async def _mcp_toggle(ctx: RequestContext, params: McpToggleParams, on: bool) -> McpToggleResult:
    mcp = ctx.state.mcp
    if mcp is None:
        raise RpcCallError(INTERNAL_ERROR, "MCP servers are not ready")
    scope = await _tool_scope(ctx, params.session_id)
    try:
        mcp.check_toggle(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    names = await _sessions(ctx).set_mcp(params.session_id, params.name, on)
    if on:
        mcp.start_for(replace(scope, enabled=frozenset(names)))
    return McpToggleResult(session_id=params.session_id, mcp_servers=names)


async def _mcp_tools(ctx: RequestContext, params: McpServerParams) -> McpToolsResult:
    mcp = _mcp(ctx)
    scope = await _optional_scope(ctx, params.session_id)
    try:
        listed = mcp.tool_list(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    tools = [
        McpToolInfo(
            name=tool.name,
            description=tool.description,
            hidden=tool.hidden,
            schema_tokens=tool.schema_tokens,
            input_schema=tool.input_schema,
        )
        for tool in listed
    ]
    return McpToolsResult(name=params.name, tools=tools)


async def _mcp_restart(ctx: RequestContext, params: McpServerParams) -> McpServer:
    mcp = _mcp(ctx)
    scope = await _optional_scope(ctx, params.session_id)
    try:
        return mcp.restart(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def _mcp_set_enabled(ctx: RequestContext, params: McpSetEnabledParams) -> McpServer:
    mcp = _mcp(ctx)
    scope = await _optional_scope(ctx, params.session_id)
    try:
        path = mcp.config_file(scope, params.name)
        await asyncio.to_thread(set_mcp_enabled, path, params.name, params.enabled)
        mcp.reload(path)
        return mcp.status(scope, params.name)
    except (McpServerError, McpTableError) as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc


def _mcp(ctx: RequestContext) -> McpSupervisor:
    if ctx.state.mcp is None:
        raise RpcCallError(INTERNAL_ERROR, "MCP servers are not ready")
    return ctx.state.mcp


async def _optional_scope(ctx: RequestContext, session_id: str | None) -> ToolScope:
    return ToolScope() if session_id is None else await _tool_scope(ctx, session_id)


async def _tool_scope(ctx: RequestContext, session_id: str) -> ToolScope:
    try:
        return await _sessions(ctx).tool_scope(session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, f"session not found: {session_id}") from exc


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


async def _setup_status(ctx: RequestContext, _params: SetupStatusParams) -> SetupStatusResult:
    keys = _sessions(ctx).router.keys or MemoryKeyStore()
    secrets = ctx.state.secrets
    checks = await asyncio.to_thread(
        run_checks,
        ctx.state.paths,
        MacPlatform(),
        keys,
        (lambda _name: None) if secrets is None else secrets.get,
        live_mcp=None if ctx.state.mcp is None else ctx.state.mcp.statuses(),
    )
    return SetupStatusResult(
        rows=[
            SetupRow(
                part=check.part,
                name=check.name,
                state=check.status,
                detail=check.detail,
                fix=check.fix,
                action=check.action,
                target=check.target,
            )
            for check in checks
        ]
    )


def _installer(ctx: RequestContext) -> OllamaInstaller:
    installer = ctx.state.installer
    if installer is None:
        raise RpcCallError(INTERNAL_ERROR, "the installer is not ready")
    return installer


async def _ollama_install(ctx: RequestContext, _params: OllamaInstallParams) -> OllamaInstallResult:
    try:
        started = await _installer(ctx).start()
    except InstallError as exc:
        raise RpcCallError(OLLAMA_FAILED, str(exc), {"no_brew": exc.no_brew}) from exc
    return OllamaInstallResult(started=started)


async def _ollama_install_cancel(
    ctx: RequestContext, _params: OllamaInstallCancelParams
) -> OllamaInstallCancelResult:
    return OllamaInstallCancelResult(cancelled=await _installer(ctx).cancel())


async def _ollama_start(ctx: RequestContext, _params: OllamaStartParams) -> OllamaStartResult:
    local = ctx.state.local_servers
    provider = _sessions(ctx).router.provider("ollama")
    if local is None or provider is None or provider.kind != "ollama":
        raise RpcCallError(INVALID_PARAMS, "no local Ollama is set up")
    server = local.get("ollama", provider.base_url or OLLAMA_BASE_URL)
    if server is None:
        raise RpcCallError(INVALID_PARAMS, "Ollama is not on this machine")
    try:
        running = await server.ensure_running()
    except ModelUnreachable as exc:
        raise RpcCallError(OLLAMA_FAILED, str(exc)) from exc
    return OllamaStartResult(running=running)


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
        "config.get": Method("config.get", ConfigGetParams, True, _config_get),
        "policy.update": Method("policy.update", PolicyUpdateParams, True, _policy_update),
        "policy.remove": Method("policy.remove", PolicyRemoveParams, True, _policy_remove),
        "session.revoke": Method("session.revoke", SessionRevokeParams, True, _session_revoke),
        "session.attach": Method("session.attach", SessionAttachParams, True, _session_attach),
        "session.detach": Method("session.detach", SessionDetachParams, True, _session_detach),
        "session.list": Method("session.list", SessionListParams, True, _session_list),
        "session.fork": Method("session.fork", SessionForkParams, True, _session_fork),
        "session.close": Method("session.close", SessionCloseParams, True, _session_close),
        "session.rename": Method("session.rename", SessionRenameParams, True, _session_rename),
        "message.send": Method("message.send", MessageSendParams, True, _message_send),
        "approval.respond": Method(
            "approval.respond", ApprovalRespondParams, True, _approval_respond
        ),
        "run.cancel": Method("run.cancel", RunCancelParams, True, _run_cancel),
        "artifact.read": Method("artifact.read", ArtifactReadParams, True, _artifact_read),
        "session.inspect": Method("session.inspect", SessionInspectParams, True, _session_inspect),
        "trace.get": Method("trace.get", TraceGetParams, True, _trace_get),
        "trace.span": Method("trace.span", TraceSpanParams, True, _trace_span),
        "auth.set": Method("auth.set", AuthSetParams, True, _auth_set),
        "auth.remove": Method("auth.remove", AuthRemoveParams, True, _auth_remove),
        "auth.list": Method("auth.list", AuthListParams, True, _auth_list),
        "model.list": Method("model.list", ModelListParams, True, _model_list),
        "mcp.list": Method("mcp.list", McpListParams, True, _mcp_list),
        "mcp.enable": Method("mcp.enable", McpToggleParams, True, _mcp_enable),
        "mcp.disable": Method("mcp.disable", McpToggleParams, True, _mcp_disable),
        "mcp.tools": Method("mcp.tools", McpServerParams, True, _mcp_tools),
        "mcp.restart": Method("mcp.restart", McpServerParams, True, _mcp_restart),
        "mcp.set_enabled": Method("mcp.set_enabled", McpSetEnabledParams, True, _mcp_set_enabled),
        "mcp.add": Method("mcp.add", McpAddParams, True, mcp_add),
        "mcp.remove": Method("mcp.remove", McpRemoveParams, True, mcp_remove),
        "mcp.get": Method("mcp.get", McpServerParams, True, mcp_get),
        "mcp.update": Method("mcp.update", McpUpdateParams, True, mcp_update),
        "mcp.test": Method("mcp.test", McpTestParams, True, mcp_test),
        "mcp.catalog": Method("mcp.catalog", McpCatalogParams, True, mcp_catalog),
        "mcp.import.scan": Method("mcp.import.scan", McpImportScanParams, True, mcp_import_scan),
        "mcp.import.apply": Method(
            "mcp.import.apply", McpImportApplyParams, True, mcp_import_apply
        ),
        "runtime.install": Method("runtime.install", RuntimeInstallParams, True, runtime_install),
        "runtime.install_cancel": Method(
            "runtime.install_cancel", RuntimeInstallCancelParams, True, runtime_install_cancel
        ),
        "mcp.logs": Method("mcp.logs", McpLogsParams, True, mcp_logs),
        "mcp.call": Method("mcp.call", McpCallParams, True, mcp_call),
        "config.raw.get": Method("config.raw.get", ConfigRawGetParams, True, config_raw_get),
        "config.raw.set": Method("config.raw.set", ConfigRawSetParams, True, config_raw_set),
        "config.raw.set_protected": Method(
            "config.raw.set_protected", ConfigRawSetParams, True, config_raw_set_protected
        ),
        "skill.list": Method("skill.list", SkillListParams, True, _skill_list),
        "session.set_skills": Method(
            "session.set_skills", SessionSetSkillsParams, True, _session_set_skills
        ),
        "model.probe": Method("model.probe", ModelProbeParams, True, _model_probe),
        "model.pull": Method("model.pull", ModelPullParams, True, _model_pull),
        "model.pull_cancel": Method(
            "model.pull_cancel", ModelPullCancelParams, True, _model_pull_cancel
        ),
        "model.delete": Method("model.delete", ModelDeleteParams, True, _model_delete),
        "model.set_default": Method(
            "model.set_default", ModelSetDefaultParams, True, _model_set_default
        ),
        "model.options.get": Method(
            "model.options.get", ModelOptionsGetParams, True, _model_options_get
        ),
        "model.options.set": Method(
            "model.options.set", ModelOptionsSetParams, True, _model_options_set
        ),
        "session.set_options": Method(
            "session.set_options", SessionSetOptionsParams, True, _session_set_options
        ),
        "fs.list_dirs": Method("fs.list_dirs", FsListDirsParams, True, _fs_list_dirs),
        "setup.status": Method("setup.status", SetupStatusParams, True, _setup_status),
        "ollama.install": Method("ollama.install", OllamaInstallParams, True, _ollama_install),
        "ollama.install_cancel": Method(
            "ollama.install_cancel", OllamaInstallCancelParams, True, _ollama_install_cancel
        ),
        "ollama.start": Method("ollama.start", OllamaStartParams, True, _ollama_start),
        "session.set_model": Method(
            "session.set_model", SessionSetModelParams, True, _session_set_model
        ),
    }
