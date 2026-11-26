"""Daemon commands: hello, status, ping, sessions, chat, keys, models, MCP, and skills."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from pathlib import Path
from typing import Literal, cast

from pydantic import BaseModel, ConfigDict

from golem import __version__, install_info
from golem.coding import commit as commit_git
from golem.coding import plain_changes
from golem.coding.changes import (
    ChangeStore,
    FileChange,
    before_run,
    net_files,
    revert_hunk,
    status_of,
)
from golem.coding.files import list_paths, read_text
from golem.config import load_settings
from golem.config_edit import (
    McpTableError,
    RawConflictError,
    RuleIndexError,
    read_model_options,
    set_default_model,
    set_keys,
    set_mcp_enabled,
    set_model_options,
    set_permission_mode,
)
from golem.doctor import MacPlatform, run_checks
from golem.folders import (
    DialogBusyError,
    DialogUnsupportedError,
    FolderError,
    RevealFailedError,
    choose_folder,
    dialog_supported,
    list_dirs,
    reveal_folder,
)
from golem.gitinfo import git_branches, git_info
from golem.mcp import McpServerError, McpSupervisor
from golem.models import hardware, ollama
from golem.models import options as model_options
from golem.models.bench import NoLocalModel
from golem.models.check import CheckError
from golem.models.discovery import KeyRejected, KeyUnchecked
from golem.models.errors import ModelUnreachable
from golem.models.huggingface import HuggingFace, HuggingFaceError
from golem.models.install import InstallError, OllamaInstaller
from golem.models.keys import KeyStore, KeyStoreError, MemoryKeyStore
from golem.models.ollama_library import OllamaLibraryError
from golem.models.pulls import PullError, PullManager
from golem.models.router import OLLAMA_BASE_URL, ModelConfigError, ModelRouter
from golem.models.tiers import blended
from golem.permissions.policy import PROJECT_POLICY
from golem.secrets import SecretStore, SecretStoreError, check_name
from golem.server.agents_edit import (
    agent_infos,
    agents_copy,
    agents_delete,
    agents_keep,
    agents_save,
    agents_set_default_limits,
    agents_set_limits,
    agents_set_wish,
)
from golem.server.chat_edit import (
    chat_draft,
    chat_get,
    chat_prompt,
    chat_set,
    chat_suggestion_dismiss,
    chat_suggestions,
)
from golem.server.data_rpc import (
    data_add,
    data_cancel,
    data_describe,
    data_extension_install,
    data_inspect,
    data_list,
    data_query,
    data_remove,
    data_update,
)
from golem.server.device_rpc import (
    connection_identify,
    device_list,
    device_pair_begin,
    device_pair_confirm,
    device_pair_request,
    device_rename,
    device_revoke,
    device_sync,
    relay_dh,
    relay_sign,
)
from golem.server.dispatcher import (
    APPROVAL_NOT_FOUND,
    ARTIFACT_NOT_FOUND,
    BRANCH_SWITCH_FAILED,
    BUDGET_SPENT,
    BUSY,
    HELPER_CONFLICT,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_TOOL_ARGS,
    KEY_REJECTED,
    KEY_UNCHECKED,
    KEYCHAIN_UNAVAILABLE,
    LOCAL_ONLY,
    MESSAGE_NOT_FOUND,
    MODEL_NOT_CONFIGURED,
    MODEL_PULL_FAILED,
    NOT_A_REPO,
    NOT_LOCAL,
    OLLAMA_FAILED,
    PROTOCOL_MISMATCH,
    RUN_NOT_FOUND,
    SESSION_BUSY,
    SESSION_NOT_FOUND,
    SKILL_NOT_FOUND,
    UNSUPPORTED,
    Method,
    RequestContext,
    RpcCallError,
)
from golem.server.evals_rpc import (
    evals_apply,
    evals_delete,
    evals_get,
    evals_list,
    evals_plan,
    evals_resume,
    evals_start,
    evals_stop,
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
from golem.server.mcp_login import mcp_login, mcp_logout
from golem.server.mcp_model import turn_on
from golem.server.mcp_try import mcp_call, mcp_logs, mcp_test
from golem.server.memory_rpc import (
    memory_delete,
    memory_export,
    memory_get,
    memory_list,
    memory_settings,
    memory_update,
    memory_write,
)
from golem.server.notifications_edit import notifications_get, notifications_set
from golem.server.ollama_settings import ollama_settings_get, ollama_settings_set
from golem.server.routines import (
    routine_get,
    routine_list,
    routine_preview,
    routine_remove,
    routine_run,
    routine_update,
    run_list,
)
from golem.server.routing_edit import routing_get, routing_set
from golem.server.skills_edit import (
    skill_create,
    skill_create_protected,
    skill_read,
    skill_set_disabled,
    skill_write,
    skill_write_protected,
)
from golem.server.workflows import (
    workflow_cancel,
    workflow_check,
    workflow_get,
    workflow_list,
    workflow_propose,
    workflow_resume,
    workflow_review_answer,
    workflow_save,
    workflow_start,
    workflow_status,
)
from golem.sessions.manager import (
    ApprovalNotFoundError,
    BlankTitleError,
    BudgetSpentError,
    ConsentAnswerError,
    GrowRefusedError,
    HelperConflictError,
    HelperCopyError,
    HelperSessionError,
    HelperTrimmedError,
    InvalidToolArgsError,
    MessageNotFoundError,
    NotAHelperBatchError,
    NotAHelperError,
    RuleWriteError,
    RunNotFoundError,
    SchemaMismatchError,
    SessionBusyError,
    SessionManager,
    SessionNotFoundError,
    SpanNotFoundError,
)
from golem.sessions.summaries import summarize
from golem.sessions.usage import EVER, Reference, Totals
from golem.skills.index import build_index
from golem.skills.invoke import SkillInvokeError
from golem.skills.pinned import SkillPinError
from golem.skills.registry import listed_skill
from golem.tools.paths import NO_FOLDER, writable
from golem.tools.registry import ToolError, ToolScope
from golem.tools.write import DIFF_CHARS, Change, apply, diff_counts, diff_text
from golem_protocol.commands import (
    AgentsCopyParams,
    AgentsDeleteParams,
    AgentsGetParams,
    AgentsGetResult,
    AgentsKeepParams,
    AgentsListParams,
    AgentsListResult,
    AgentsSaveParams,
    AgentsSetDefaultLimitsParams,
    AgentsSetLimitsParams,
    AgentsSetWishParams,
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
    ChangedFile,
    ChangesCommitInfoParams,
    ChangesCommitInfoResult,
    ChangesCommitParams,
    ChangesCommitResult,
    ChangesDiffParams,
    ChangesDiffResult,
    ChangesListParams,
    ChangesListResult,
    ChangesRevertParams,
    ChangesRevertResult,
    ChangesSuggestMessageParams,
    ChangesSuggestMessageResult,
    ChatDraftParams,
    ChatGetParams,
    ChatPromptParams,
    ChatSetParams,
    ChatSuggestionDismissParams,
    ChatSuggestionsParams,
    ConfigAllowance,
    ConfigGetParams,
    ConfigGetResult,
    ConfigLadder,
    ConfigRawGetParams,
    ConfigRawSetParams,
    ConfigRouting,
    ConfigRule,
    ConnectionIdentifyParams,
    CostAgentRow,
    CostDayRow,
    CostGetParams,
    CostGetResult,
    CostModelRow,
    CostRoleRow,
    CostTotals,
    DaemonStatus,
    DataAddParams,
    DataCancelParams,
    DataDescribeParams,
    DataExtensionInstallParams,
    DataInspectParams,
    DataListParams,
    DataQueryParams,
    DataRemoveParams,
    DataUpdateParams,
    DeviceListParams,
    DevicePairBeginParams,
    DevicePairConfirmParams,
    DevicePairRequestParams,
    DeviceRenameParams,
    DeviceRevokeParams,
    DeviceSyncParams,
    EvalRoutingParams,
    EvalRoutingResult,
    EvalsApplyParams,
    EvalsDeleteParams,
    EvalsGetParams,
    EvalsListParams,
    EvalsPlanParams,
    EvalsResumeParams,
    EvalsStartParams,
    EvalsStopParams,
    FileListParams,
    FileListResult,
    FileReadParams,
    FileReadResult,
    FsChooseFolderParams,
    FsChooseFolderResult,
    FsListDirsParams,
    FsListDirsResult,
    FsRevealParams,
    FsRevealResult,
    GitBranchesParams,
    GitBranchesResult,
    GitInfoParams,
    GitInfoResult,
    HelloParams,
    HelloResult,
    HelperApplyParams,
    HelperApplyResult,
    HelperDiscardParams,
    HelperDiscardResult,
    HelperRetryParams,
    HelperRetryResult,
    HelpersRespondParams,
    HelpersRespondResult,
    HelperStopParams,
    HelperStopResult,
    HfFilesParams,
    HfFilesResult,
    HfRepo,
    HfSearchParams,
    HfSearchResult,
    HfSize,
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
    MemoryDeleteParams,
    MemoryExportParams,
    MemoryGetParams,
    MemoryListParams,
    MemorySettingsParams,
    MemoryUpdateParams,
    MemoryWriteParams,
    MessageSendParams,
    MessageSendResult,
    ModelBenchParams,
    ModelBenchResult,
    ModelCategory,
    ModelCheckParams,
    ModelCheckResult,
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
    ModelPullCleanupParams,
    ModelPullCleanupResult,
    ModelPullParams,
    ModelPullResult,
    ModelScoreInfo,
    ModelScoreResetParams,
    ModelScoreResetResult,
    ModelSetDefaultParams,
    ModelSetDefaultResult,
    ModelSetup,
    ModelSpeedInfo,
    ModelStarParams,
    ModelStarResult,
    NotificationsGetParams,
    NotificationsSetParams,
    NotifyTestParams,
    NotifyTestResult,
    OllamaInstallCancelParams,
    OllamaInstallCancelResult,
    OllamaInstallParams,
    OllamaInstallResult,
    OllamaLibraryModel,
    OllamaLibraryParams,
    OllamaLibraryResult,
    OllamaSettingsGetParams,
    OllamaSettingsSetParams,
    OllamaStartParams,
    OllamaStartResult,
    PermissionsSetModeParams,
    PermissionsSetModeResult,
    PingParams,
    PolicyEditResult,
    PolicyRemoveParams,
    PolicyUpdateParams,
    RelayDhParams,
    RelaySignParams,
    RevertConflict,
    RevertTarget,
    RouteConsentAnswerParams,
    RouteConsentAnswerResult,
    RoutineGetParams,
    RoutineListParams,
    RoutinePreviewParams,
    RoutineRemoveParams,
    RoutineRunParams,
    RoutineUpdateParams,
    RoutingGetParams,
    RoutingSetParams,
    RunCancelParams,
    RunCancelResult,
    RunListParams,
    RuntimeInstallCancelParams,
    RuntimeInstallParams,
    SessionAttachParams,
    SessionAttachResult,
    SessionCloseParams,
    SessionCloseResult,
    SessionCompactParams,
    SessionCompactResult,
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
    SessionSetChecksParams,
    SessionSetChecksResult,
    SessionSetModelParams,
    SessionSetModelResult,
    SessionSetModeParams,
    SessionSetModeResult,
    SessionSetOptionsParams,
    SessionSetOptionsResult,
    SessionSetPlanParams,
    SessionSetPlanResult,
    SessionSetRouteParams,
    SessionSetRouteResult,
    SessionSetSkillsParams,
    SessionSetSkillsResult,
    SessionSummary,
    SetupInstall,
    SetupJob,
    SetupPaths,
    SetupRow,
    SetupStatusParams,
    SetupStatusResult,
    SkillCreateParams,
    SkillListParams,
    SkillListResult,
    SkillReadParams,
    SkillSetDisabledParams,
    SkillWriteParams,
    TraceGetParams,
    TraceGetResult,
    TraceSpanParams,
    TraceSpanResult,
    WorkflowCancelParams,
    WorkflowCheckParams,
    WorkflowGetParams,
    WorkflowListParams,
    WorkflowProposeParams,
    WorkflowResumeParams,
    WorkflowReviewAnswerParams,
    WorkflowSaveParams,
    WorkflowStartParams,
    WorkflowStatusParams,
)
from golem_protocol.events import FileChangedData, Ping
from golem_protocol.rpc import ModelOptionsSavedNotification
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

log = logging.getLogger("golem.server")

MCP_PREFIX = "mcp/"


class _EmptyParams(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _local_ui(ctx: RequestContext) -> bool:
    """Whether this connection is a page on the daemon's Mac that may open the folder dialog.

    The gateway serves pages on 127.0.0.1 only, and a phone or another machine reaches the
    daemon through a gateway session that names its device with ``connection.identify``
    before anything else. A connection with no device is therefore on this Mac.
    """
    return ctx.connection.device is None and dialog_supported()


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
        local_ui=_local_ui(ctx),
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


async def _switch_branch(cwd: str | None, branch: str, create: bool) -> None:
    """Put ``cwd`` on ``branch`` before a session starts. Local changes go along."""
    if cwd is None:
        raise RpcCallError(INVALID_PARAMS, "branch needs a cwd")
    if branch.startswith("-"):
        raise RpcCallError(INVALID_PARAMS, "branch cannot start with a dash")
    inside = await commit_git.run_git(cwd, "rev-parse", "--is-inside-work-tree")
    if not inside.ok:
        raise RpcCallError(NOT_A_REPO, f"{cwd} is not a git repository.", {"reason": "not_a_repo"})
    current = await commit_git.run_git(cwd, "branch", "--show-current")
    if current.ok and current.output.strip() == branch:
        return
    args = ("switch", "-c", branch) if create else ("switch", branch)
    switched = await commit_git.run_git(cwd, *args)
    if not switched.ok:
        message = switched.output.strip() or "git could not switch branches."
        raise RpcCallError(BRANCH_SWITCH_FAILED, message, {"reason": "branch_switch_failed"})


async def _session_create(ctx: RequestContext, params: SessionCreateParams) -> SessionCreateResult:
    sessions = _sessions(ctx)
    _check_cwd(params.cwd)
    if params.branch is not None:
        await _switch_branch(params.cwd, params.branch, params.create_branch)
    try:
        session_id = await sessions.create(
            params.model_profile,
            cwd=params.cwd,
            origin=params.origin,
            plan_first=params.plan_first,
        )
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
    summaries: list[SessionSummary] = []
    for item in found:
        own = await sessions.pending(item)
        helpers = await sessions.helpers(item)
        summaries.append(
            summarize(
                item,
                sessions.local_only(item.session.cwd),
                own,
                await sessions.wait(item),
                helpers,
                sessions.step(item.session.session_id),
                await sessions.pending_items(item, own, helpers),
                await sessions.branch(item.session.cwd),
            )
        )
    return SessionListResult(sessions=summaries)


async def _session_fork(ctx: RequestContext, params: SessionForkParams) -> SessionForkResult:
    try:
        session_id = await _sessions(ctx).fork(params.session_id, params.at_message_id)
    except MessageNotFoundError as exc:
        raise RpcCallError(MESSAGE_NOT_FOUND, "message not found") from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except HelperTrimmedError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
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
            params.session_id,
            params.text,
            cwd=params.cwd,
            skill=params.skill,
            stronger=params.stronger,
        )
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except HelperSessionError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    except ModelConfigError as exc:
        code = LOCAL_ONLY if exc.code == "local_only" else MODEL_NOT_CONFIGURED
        raise RpcCallError(code, str(exc)) from exc
    except BudgetSpentError as exc:
        raise RpcCallError(BUDGET_SPENT, str(exc)) from exc
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


async def _git_info(ctx: RequestContext, params: GitInfoParams) -> GitInfoResult:
    del ctx
    try:
        return await git_info(params.path, Path.home())
    except FolderError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def _git_branches(ctx: RequestContext, params: GitBranchesParams) -> GitBranchesResult:
    del ctx
    try:
        return await git_branches(params.path, Path.home())
    except FolderError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def _fs_choose_folder(
    ctx: RequestContext, params: FsChooseFolderParams
) -> FsChooseFolderResult:
    if ctx.connection.device is not None:
        raise RpcCallError(
            NOT_LOCAL,
            "The folder dialog opens only for a page on this Mac.",
            {"reason": "not_local"},
        )
    if params.start is not None and not Path(params.start).is_absolute():
        raise RpcCallError(INVALID_PARAMS, "start must be an absolute path")
    try:
        path = await choose_folder(
            None if params.start is None else Path(params.start), Path.home()
        )
    except DialogUnsupportedError as exc:
        raise RpcCallError(UNSUPPORTED, str(exc), {"reason": "unsupported"}) from exc
    except DialogBusyError as exc:
        raise RpcCallError(BUSY, str(exc), {"reason": "busy"}) from exc
    except FolderError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    return FsChooseFolderResult(path=path)


async def _fs_reveal(ctx: RequestContext, params: FsRevealParams) -> FsRevealResult:
    if ctx.connection.device is not None:
        raise RpcCallError(
            NOT_LOCAL,
            "Open in Finder works only for a page on this Mac.",
            {"reason": "not_local"},
        )
    try:
        await reveal_folder(params.path, Path.home())
    except DialogUnsupportedError as exc:
        raise RpcCallError(UNSUPPORTED, str(exc), {"reason": "unsupported"}) from exc
    except RevealFailedError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except FolderError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return FsRevealResult()


async def _route_consent_answer(
    ctx: RequestContext, params: RouteConsentAnswerParams
) -> RouteConsentAnswerResult:
    try:
        run_id = await _sessions(ctx).answer_consent(
            params.session_id, params.run_id, params.answer
        )
    except ApprovalNotFoundError as exc:
        raise RpcCallError(APPROVAL_NOT_FOUND, "no run waits on this question") from exc
    except ConsentAnswerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return RouteConsentAnswerResult(run_id=run_id)


async def _approval_respond(
    ctx: RequestContext, params: ApprovalRespondParams
) -> ApprovalRespondResult:
    sessions = _sessions(ctx)
    try:
        run_id = await sessions.respond(
            params.session_id,
            params.call_id,
            params.decision,
            params.args,
            params.scope,
            device=ctx.connection.device,
        )
    except NotAHelperBatchError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
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


async def _helpers_respond(
    ctx: RequestContext, params: HelpersRespondParams
) -> HelpersRespondResult:
    try:
        run_id = await _sessions(ctx).respond_helpers(
            params.session_id,
            params.call_id,
            params.run,
            cheaper=params.cheaper,
            device=ctx.connection.device,
        )
    except ApprovalNotFoundError as exc:
        raise RpcCallError(APPROVAL_NOT_FOUND, "no run waits on this question") from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return HelpersRespondResult(run_id=run_id)


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


async def _helper_stop(ctx: RequestContext, params: HelperStopParams) -> HelperStopResult:
    try:
        stopped = await _sessions(ctx).stop_helper(params.session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except NotAHelperError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return HelperStopResult(stopped=stopped)


async def _helper_apply(ctx: RequestContext, params: HelperApplyParams) -> HelperApplyResult:
    try:
        ids = await _sessions(ctx).apply_helper(params.session_id, params.helper_id)
    except HelperConflictError as exc:
        raise RpcCallError(HELPER_CONFLICT, str(exc), {"path": exc.path}) from exc
    except HelperCopyError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return HelperApplyResult(change_ids=ids)


async def _helper_discard(ctx: RequestContext, params: HelperDiscardParams) -> HelperDiscardResult:
    try:
        await _sessions(ctx).discard_helper(params.session_id, params.helper_id)
    except HelperCopyError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return HelperDiscardResult()


async def _helper_retry(ctx: RequestContext, params: HelperRetryParams) -> HelperRetryResult:
    try:
        helper_id = await _sessions(ctx).retry_helper(params.session_id, params.helper_id)
    except (HelperCopyError, ToolError) as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return HelperRetryResult(helper_id=helper_id)


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


def _changes(ctx: RequestContext) -> ChangeStore:
    changes = ctx.state.changes
    if changes is None:
        raise RpcCallError(INTERNAL_ERROR, "changes are not ready")
    return changes


def _disk_sha(path: Path) -> str | None:
    """The sha256 of the file's text. None for no file, and "" for one that is not UTF-8."""
    try:
        text = path.read_bytes().decode("utf-8")
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError):
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _disk_text(path: Path) -> str | None:
    """The file's text, None when there is no file or it is not UTF-8."""
    try:
        return path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None


async def _session_folder(ctx: RequestContext, session_id: str) -> str | None:
    try:
        return await _sessions(ctx).cwd_of(session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc


async def _changes_list(ctx: RequestContext, params: ChangesListParams) -> ChangesListResult:
    store = _changes(ctx)
    folder = await _session_folder(ctx, params.session_id)
    if folder is None:
        return ChangesListResult(files=[])
    files: list[ChangedFile] = []
    for net in net_files(await store.list(params.session_id)):
        diff = diff_text(
            net.path, await store.text(net.before_sha), await store.text(net.after_sha)
        )
        added, removed = diff_counts(diff)
        on_disk = await asyncio.to_thread(_disk_sha, Path(folder) / net.path)
        files.append(
            ChangedFile(
                path=net.path,
                status=net.status,
                added=added,
                removed=removed,
                change_ids=list(net.change_ids),
                stale=on_disk != net.after_sha,
            )
        )
    shell = await asyncio.to_thread(plain_changes.tracking, Path(folder))
    return ChangesListResult(files=files, shell=shell)


async def _changes_diff(ctx: RequestContext, params: ChangesDiffParams) -> ChangesDiffResult:
    if (params.path is None) == (params.change_id is None):
        raise RpcCallError(INVALID_PARAMS, "set exactly one of path and change_id")
    store = _changes(ctx)
    await _session_folder(ctx, params.session_id)
    if params.change_id is not None:
        change = await store.get(params.session_id, params.change_id)
        if change is None:
            raise RpcCallError(INVALID_PARAMS, "no such change in this session")
        path, before_sha, after_sha = change.path, change.before_sha, change.after_sha
    else:
        group = [c for c in await store.list(params.session_id) if c.path == params.path]
        if not group:
            raise RpcCallError(INVALID_PARAMS, "this session has not changed that file")
        path, before_sha, after_sha = group[0].path, group[0].before_sha, group[-1].after_sha
    diff = diff_text(path, await store.text(before_sha), await store.text(after_sha))
    return ChangesDiffResult(diff=diff[:DIFF_CHARS], truncated=len(diff) > DIFF_CHARS)


def _text_sha(text: str | None) -> str | None:
    return None if text is None else hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _revert_texts(
    store: ChangeStore, session_id: str, target: RevertTarget
) -> dict[str, tuple[str | None, str]]:
    """For each path a revert writes: its new text (None: delete) and the change it takes back.

    Raises :class:`RpcCallError` for a target that is malformed or names nothing.
    """
    changes = await store.list(session_id)
    last = {change.path: change.change_id for change in changes}
    by_path: dict[str, list[FileChange]] = {}
    for change in changes:
        by_path.setdefault(change.path, []).append(change)
    needs = {
        "change": (target.change_id,),
        "file": (target.path,),
        "hunk": (target.path, target.hunk),
        "run": (target.run_id,),
    }[target.kind]
    given = {
        "change_id": target.change_id,
        "path": target.path,
        "hunk": target.hunk,
        "run_id": target.run_id,
    }
    if any(value is None for value in needs) or sum(v is not None for v in given.values()) != len(
        needs
    ):
        raise RpcCallError(INVALID_PARAMS, f"a {target.kind} target takes only its own fields")
    if target.kind == "change":
        change = await store.get(session_id, cast(str, target.change_id))
        if change is None:
            raise RpcCallError(INVALID_PARAMS, "no such change in this session")
        return {change.path: (await store.text(change.before_sha), change.change_id)}
    if target.kind == "run":
        shas = before_run(changes, cast(str, target.run_id))
        return {path: (await store.text(sha), last[path]) for path, sha in shas.items()}
    group = by_path.get(cast(str, target.path))
    if not group:
        raise RpcCallError(INVALID_PARAMS, "this session has not changed that file")
    path = cast(str, target.path)
    if target.kind == "file":
        return {path: (await store.text(group[0].before_sha), last[path])}
    before = await store.text(group[0].before_sha) or ""
    after = await store.text(group[-1].after_sha) or ""
    try:
        text = revert_hunk(before, after, cast(int, target.hunk))
    except IndexError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return {path: (text, last[path])}


def _write_back(folder: Path, path: str, text: str | None, before: str | None) -> None:
    """Write ``text`` to the file, or delete it for None. Never removes a folder."""
    target = writable(folder, path)
    if text is not None:
        apply(Change(folder, target, path, before, text))
        return
    try:
        target.unlink(missing_ok=True)
    except OSError as exc:
        raise ToolError(f"cannot delete {path}: {exc.strerror or exc}") from exc


async def _changes_revert(ctx: RequestContext, params: ChangesRevertParams) -> ChangesRevertResult:
    store = _changes(ctx)
    sessions = _sessions(ctx)
    try:
        async with sessions.idle(params.session_id) as folder:
            if folder is None:
                raise RpcCallError(INVALID_PARAMS, "this session has no folder")
            root = Path(folder)
            wanted = await _revert_texts(store, params.session_id, params.target)
            last_after = {c.path: c.after_sha for c in await store.list(params.session_id)}
            todo: list[tuple[str, str | None, str]] = []
            conflicts: list[RevertConflict] = []
            for path, (text, reverts) in wanted.items():
                try:
                    writable(root, path)
                except ToolError as exc:
                    raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
                on_disk = await asyncio.to_thread(_disk_sha, root / path)
                if on_disk == _text_sha(text):
                    continue
                if on_disk == "" or (on_disk != last_after[path] and not params.force):
                    conflicts.append(RevertConflict(path=path, reason="changed_on_disk"))
                    continue
                todo.append((path, text, reverts))
            reverted: list[str] = []
            for path, text, reverts in todo:
                before = await asyncio.to_thread(_disk_text, root / path)
                try:
                    await asyncio.to_thread(_write_back, root, path, text, before)
                except ToolError as exc:
                    raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
                change = await store.record(
                    session_id=params.session_id,
                    run_id=None,
                    call_id=None,
                    path=path,
                    before=before,
                    after=text,
                    source="revert",
                    reverts=reverts,
                )
                await sessions.announce_change(
                    params.session_id,
                    FileChangedData(
                        change_id=change.change_id,
                        path=path,
                        status=status_of(change.before_sha, change.after_sha),
                        added=change.added,
                        removed=change.removed,
                        source="revert",
                        reverts=reverts,
                    ),
                )
                reverted.append(path)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return ChangesRevertResult(reverted=reverted, conflicts=conflicts)


async def _session_files(ctx: RequestContext, session_id: str) -> Path:
    folder = await _session_folder(ctx, session_id)
    if folder is None:
        raise RpcCallError(INVALID_PARAMS, NO_FOLDER)
    return Path(folder)


async def _file_read(ctx: RequestContext, params: FileReadParams) -> FileReadResult:
    folder = await _session_files(ctx, params.session_id)
    try:
        return await asyncio.to_thread(read_text, folder, params.path)
    except ToolError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def _file_list(ctx: RequestContext, params: FileListParams) -> FileListResult:
    folder = await _session_files(ctx, params.session_id)
    return await asyncio.to_thread(list_paths, folder, params.query, params.limit, params.hidden)


async def _commit_folder(ctx: RequestContext, session_id: str) -> str:
    folder = await _session_folder(ctx, session_id)
    if folder is None:
        raise RpcCallError(INVALID_PARAMS, "this session has no folder")
    return folder


async def _changes_commit(ctx: RequestContext, params: ChangesCommitParams) -> ChangesCommitResult:
    folder = await _commit_folder(ctx, params.session_id)
    try:
        if await _sessions(ctx).is_busy(params.session_id):
            raise RpcCallError(SESSION_BUSY, "session is busy")
        outcome = await commit_git.commit(folder, params.paths, params.message)
    except ToolError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return ChangesCommitResult(ok=outcome.ok, sha=outcome.sha, output=outcome.output)


async def _changes_commit_info(
    ctx: RequestContext, params: ChangesCommitInfoParams
) -> ChangesCommitInfoResult:
    store = _changes(ctx)
    folder = await _commit_folder(ctx, params.session_id)
    paths = [net.path for net in net_files(await store.list(params.session_id))]
    found = await commit_git.info(folder, paths)
    return ChangesCommitInfoResult(
        repository=found.repository, branch=found.branch, paths=found.paths
    )


async def _changes_suggest_message(
    ctx: RequestContext, params: ChangesSuggestMessageParams
) -> ChangesSuggestMessageResult:
    sessions = _sessions(ctx)
    folder = await _commit_folder(ctx, params.session_id)
    try:
        profile = await sessions.model_profile(params.session_id)
        model = sessions.router.chat_model(
            profile,
            await sessions.session_options(params.session_id),
            local_only=sessions.local_only(await sessions.cwd_of(params.session_id)),
        )
        message = await commit_git.suggest(folder, params.paths, model)
    except ToolError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except commit_git.SuggestError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except ModelConfigError as exc:
        code = LOCAL_ONLY if exc.code == "local_only" else MODEL_NOT_CONFIGURED
        raise RpcCallError(code, str(exc)) from exc
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return ChangesSuggestMessageResult(message=message)


async def _trace_get(ctx: RequestContext, params: TraceGetParams) -> TraceGetResult:
    try:
        title, runs = await _sessions(ctx).trace(params.session_id)
        changes = await _sessions(ctx).trace_context_events(params.session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SchemaMismatchError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, str(exc)) from exc
    return TraceGetResult(
        session_id=params.session_id, title=title, runs=runs, context_events=changes
    )


def _cost_totals(totals: Totals) -> CostTotals:
    return CostTotals(
        calls=totals.calls,
        input=totals.input,
        output=totals.output,
        cost_usd=totals.cost_usd,
        saved_usd=totals.saved_usd,
    )


async def _saved_reference(ctx: RequestContext) -> Reference | None:
    """The model whose prices say what local tokens would have cost.

    The cheapest budget-tier model in the listing that takes tools. Nothing else sets one
    yet: ``[routing.ladder]`` does not exist.
    """
    models = ctx.state.models
    if models is None:
        return None
    best: tuple[float, Reference] | None = None
    for model in (await models.list()).models:
        if model.tier != "budget" or model.tools is False or model.price is None:
            continue
        cost = blended(model.price)
        if cost is not None and (best is None or cost < best[0]):
            best = (cost, Reference(model.ref, model.price))
    return None if best is None else best[1]


async def _cost_get(ctx: RequestContext, params: CostGetParams) -> CostGetResult:
    usage = ctx.state.usage
    if usage is None:
        raise RpcCallError(INTERNAL_ERROR, "usage is not ready")
    reference = await _saved_reference(ctx)
    week = await usage.summary(since_day=usage.days_back(6), reference=reference)
    today = await usage.summary(since_day=usage.today(), reference=reference)
    session = None
    if params.session_id is not None:
        session = _cost_totals(
            (
                await usage.summary(
                    since_day=EVER, session_id=params.session_id, reference=reference
                )
            ).totals
        )
    return CostGetResult(
        today=_cost_totals(today.totals),
        week=_cost_totals(week.totals),
        session=session,
        by_model=[
            CostModelRow(
                provider=row.provider,
                model=row.model,
                tier=cast(Literal["local", "budget", "frontier"] | None, row.tier),
                calls=row.calls,
                input=row.input,
                output=row.output,
                cost_usd=row.cost_usd,
            )
            for row in week.by_model
        ],
        by_day=[
            CostDayRow(
                day=row.day,
                local_tokens=row.local_tokens,
                paid_tokens=row.paid_tokens,
                cost_usd=row.cost_usd,
            )
            for row in week.by_day
        ],
        by_role=[
            CostRoleRow(
                role=row.role,
                calls=row.calls,
                input=row.input,
                output=row.output,
                cost_usd=row.cost_usd,
            )
            for row in week.by_role
        ],
        by_agent=[
            CostAgentRow(
                agent=row.agent,
                calls=row.calls,
                input=row.input,
                output=row.output,
                cost_usd=row.cost_usd,
            )
            for row in week.by_agent
        ],
        saved_reference=week.saved_reference,
    )


async def _eval_routing(ctx: RequestContext, params: EvalRoutingParams) -> EvalRoutingResult:
    try:
        return await _sessions(ctx).eval_routing(params.days, params.session_id, ctx.state.clock())
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc


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
                think_values=list(model.think_values),
                tier=model.tier,
                speed=None
                if model.speed is None
                else ModelSpeedInfo(
                    prompt_tps=model.speed.prompt_tps,
                    reply_tps=model.speed.reply_tps,
                    samples=model.speed.samples,
                ),
                score=None
                if model.score is None
                else ModelScoreInfo(
                    tool_score=model.score.tool_score,
                    calls=model.score.calls,
                    runs=model.score.runs,
                    stepped_up=model.score.stepped_up,
                    retried=model.score.retried,
                    tool_calls=model.score.tool_calls,
                ),
                starred=model.starred,
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
            ollama_stray=listing.setup.ollama_stray,
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


async def _model_score_reset(
    ctx: RequestContext, params: ModelScoreResetParams
) -> ModelScoreResetResult:
    scores = ctx.state.scores
    if scores is None:
        raise RpcCallError(INTERNAL_ERROR, "the scoreboard is not ready")
    await scores.reset(params.ref)
    log.info("score reset ref=%s", params.ref)
    return ModelScoreResetResult(ref=params.ref)


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


async def _model_star(ctx: RequestContext, params: ModelStarParams) -> ModelStarResult:
    """Star or unstar ``params.ref``. The first change writes the menu's whole list."""
    models = ctx.state.models
    if models is None:
        raise RpcCallError(INTERNAL_ERROR, "models are not ready")
    router = _sessions(ctx).router
    current = router.menu_settings().starred
    if current is None:
        # A fresh listing, so the first written list is today's menu, not an older snapshot.
        await models.list()
        current = list(models.default_starred())
    ref = params.ref.strip()
    if params.starred:
        starred = list(current) if ref in current else [*current, ref]
    else:
        starred = [item for item in current if item != ref]
    config_file = ctx.state.paths.config_file
    try:
        await asyncio.to_thread(set_keys, config_file, {"model_menu": {"starred": starred}})
    except RawConflictError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("model star ref=%s starred=%s", ref, params.starred)
    return ModelStarResult(starred=starred)


async def _permissions_set_mode(
    ctx: RequestContext, params: PermissionsSetModeParams
) -> PermissionsSetModeResult:
    config_file = ctx.state.paths.config_file
    try:
        await asyncio.to_thread(set_permission_mode, config_file, params.mode)
    except RawConflictError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("default permission mode=%s", params.mode)
    return PermissionsSetModeResult(mode=params.mode, path=str(config_file))


def _ollama_name(model: str) -> str:
    return model.strip().removeprefix("ollama/")


async def _think_values(ctx: RequestContext, ref: str) -> list[str] | None:
    """What ``think`` takes for ``ref``, or None when golem cannot find out, so any value passes."""
    discovery = ctx.state.models
    if discovery is None:
        return None
    return await discovery.ollama_think_values(ref)


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
    thinks = [] if discovery is None else await discovery.ollama_think_values(f"ollama/{name}")
    values = model_options.defaults(own)
    default_from: dict[str, Literal["modelfile", "ollama", "golem"]] = {}
    plans = _sessions(ctx).router.plans
    plan = None
    if plans is not None and discovery is not None:
        await discovery.learn(f"ollama/{name}")
        plan = plans.planned(name)
    if plan is not None:
        values["num_ctx"] = plan
        default_from["num_ctx"] = "golem"
    elif "num_ctx" in values:
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
                minimum=None if row.kind == "choice" else row.minimum,
                maximum=None if row.kind == "choice" else row.maximum,
                step=None if row.kind == "choice" else row.step,
                default=row.default,
                short=row.short,
                long=row.long,
                values=thinks if row.name == "think" else [],
            )
            for row in model_options.OPTIONS
            if row.name != "think" or thinks
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
    thinks = await _think_values(ctx, f"ollama/{name}") if "think" in params.options else None
    try:
        saved = await asyncio.to_thread(
            set_model_options, config_file, name, params.options, thinks
        )
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
    thinks: list[str] | None = None
    if "think" in params.options:
        try:
            profile = await _sessions(ctx).model_profile(params.session_id)
        except (SessionNotFoundError, SchemaMismatchError) as exc:
            raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
        thinks = await _think_values(ctx, profile)
    try:
        options = await _sessions(ctx).set_options(params.session_id, params.options, thinks)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    log.info("session options session=%s options=%s", params.session_id, sorted(options))
    return SessionSetOptionsResult(session_id=params.session_id, options=options)


async def _session_set_mode(
    ctx: RequestContext, params: SessionSetModeParams
) -> SessionSetModeResult:
    try:
        mode, override = await _sessions(ctx).set_mode(params.session_id, params.mode)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    log.info("session mode session=%s mode=%s override=%s", params.session_id, mode, override)
    return SessionSetModeResult(session_id=params.session_id, mode=mode, override=override)


async def _session_compact(
    ctx: RequestContext, params: SessionCompactParams
) -> SessionCompactResult:
    try:
        result = await _sessions(ctx).compact(params.session_id, params.action, params.focus)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    except SessionBusyError as exc:
        raise RpcCallError(SESSION_BUSY, "session is busy") from exc
    except GrowRefusedError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except Exception as exc:
        log.warning("session compact failed session=%s", params.session_id, exc_info=True)
        raise RpcCallError(INTERNAL_ERROR, f"could not {params.action}: {exc}") from exc
    log.info(
        "session compact session=%s action=%s count=%d",
        params.session_id,
        params.action,
        result.count,
    )
    return result


async def _session_set_checks(
    ctx: RequestContext, params: SessionSetChecksParams
) -> SessionSetChecksResult:
    try:
        on = await _sessions(ctx).set_checks(params.session_id, params.on)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    log.info("session checks session=%s on=%s", params.session_id, on)
    return SessionSetChecksResult(session_id=params.session_id, on=on)


async def _session_set_route(
    ctx: RequestContext, params: SessionSetRouteParams
) -> SessionSetRouteResult:
    try:
        mode = await _sessions(ctx).set_route(params.session_id, params.mode)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    log.info("session route session=%s mode=%s", params.session_id, mode)
    return SessionSetRouteResult(session_id=params.session_id, mode=mode)


async def _session_set_plan(
    ctx: RequestContext, params: SessionSetPlanParams
) -> SessionSetPlanResult:
    try:
        on = await _sessions(ctx).set_plan(params.session_id, params.on)
    except (SessionNotFoundError, SchemaMismatchError) as exc:
        raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    log.info("session plan first session=%s on=%s", params.session_id, on)
    return SessionSetPlanResult(session_id=params.session_id, on=on)


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
    default_mode = policy.default_mode()
    mode = default_mode
    if params.session_id is not None:
        try:
            mode = await _sessions(ctx).permission_mode(params.session_id)
        except (SessionNotFoundError, SchemaMismatchError) as exc:
            raise RpcCallError(SESSION_NOT_FOUND, "session not found") from exc
    rules = await asyncio.to_thread(policy.rules, root, tools, mode)
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
        default_permission_mode=default_mode,
        permission_mode=mode,
        routing=ConfigRouting(
            ladder=ConfigLadder(
                local=settings.routing.ladder.local,
                budget=settings.routing.ladder.budget,
                frontier=settings.routing.ladder.frontier,
            ),
            daily_usd=settings.budget.daily_usd,
            session_usd=settings.budget.session_usd,
        ),
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
        notifications_open_in=settings.notifications.open_in,
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
    indexed = {id(entry) for entry in build_index(view, skills.index_budget).entries}
    return SkillListResult(
        skills=[listed_skill(entry, indexed=id(entry) in indexed) for entry in view.listed]
    )


async def _agents_list(ctx: RequestContext, params: AgentsListParams) -> AgentsListResult:
    return AgentsListResult(agents=[info for info, _ in await agent_infos(ctx, params.cwd)])


async def _agents_get(ctx: RequestContext, params: AgentsGetParams) -> AgentsGetResult:
    found = await agent_infos(ctx, params.cwd)
    named = [pair for pair in found if pair[0].name == params.name]
    # The one a name resolves to: a usable one (trusted, no errors), else any listed copy, so a
    # blocked or broken file can still be looked at. The protocol defines no error for an unknown
    # agent, so it is invalid params, as for a name in both lists of session.set_skills.
    pick = next((pair for pair in named if pair[0].trusted and not pair[0].errors), None)
    pick = pick or next(iter(named), None)
    if pick is None:
        raise RpcCallError(INVALID_PARAMS, f"There is no agent named {params.name}.")
    info, agent = pick
    # A blocked agent's prompt is not sent: its folder is not trusted.
    prompt = agent.body if info.trusted else ""
    return AgentsGetResult.model_validate({**info.model_dump(), "prompt": prompt})


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
    if on:
        names = await turn_on(_sessions(ctx), mcp, params.session_id, scope, params.name)
    else:
        names = await _sessions(ctx).set_mcp(params.session_id, params.name, False)
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
            read_only=tool.read_only,
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


async def _model_check(ctx: RequestContext, params: ModelCheckParams) -> ModelCheckResult:
    checks = ctx.state.checks
    if checks is None:
        raise RpcCallError(INTERNAL_ERROR, "checks are not ready")
    try:
        ref, started = checks.start(params.name)
    except CheckError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    return ModelCheckResult(ref=ref, started=started)


async def _model_bench(ctx: RequestContext, params: ModelBenchParams) -> ModelBenchResult:
    """Start a benchmark of a local model. The numbers are only right on an idle machine.

    The run's calls do not take dispatcher slots and the run holds no line, so a chat that
    uses the same server during it shares the server and slows the numbers down.
    """
    benches = ctx.state.benches
    if benches is None:
        raise RpcCallError(INTERNAL_ERROR, "benchmarks are not ready")
    try:
        ref, started = benches.start(params.ref, params.engine)
    except NoLocalModel as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    return ModelBenchResult(ref=ref, started=started)


def _hf(ctx: RequestContext) -> HuggingFace:
    hf = ctx.state.hf
    if hf is None:
        raise RpcCallError(INTERNAL_ERROR, "Hugging Face search is not ready")
    return hf


async def _hf_search(ctx: RequestContext, params: HfSearchParams) -> HfSearchResult:
    try:
        repos = await _hf(ctx).search(params.query, params.limit)
    except HuggingFaceError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return HfSearchResult(repos=[HfRepo(**repo) for repo in repos])


async def _hf_files(ctx: RequestContext, params: HfFilesParams) -> HfFilesResult:
    try:
        sizes = await _hf(ctx).sizes(params.repo)
    except HuggingFaceError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return HfFilesResult(repo=params.repo, sizes=[HfSize(**size) for size in sizes])


async def _ollama_library(ctx: RequestContext, params: OllamaLibraryParams) -> OllamaLibraryResult:
    library = ctx.state.ollama_library
    if library is None:
        raise RpcCallError(INTERNAL_ERROR, "The Ollama library is not ready")
    discovery = ctx.state.models
    installed: set[str] = set()
    if discovery is not None:
        # The cache is empty before the first listing: list once, so no model is wrongly missing.
        listed_models = discovery.cached() or (await discovery.list()).models
        installed = {
            listed.ref.partition("/")[2] for listed in listed_models if listed.source == "installed"
        }
    try:
        models = await library.search(params.query, installed)
    except OllamaLibraryError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return OllamaLibraryResult(models=[OllamaLibraryModel(**model) for model in models])


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


async def _model_pull_cleanup(
    ctx: RequestContext, params: ModelPullCleanupParams
) -> ModelPullCleanupResult:
    try:
        ref, freed_gb = _pulls(ctx).cleanup(params.ref)
    except PullError as exc:
        raise RpcCallError(MODEL_PULL_FAILED, str(exc)) from exc
    return ModelPullCleanupResult(ref=ref, freed_gb=freed_gb)


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
    facts = await asyncio.to_thread(install_info.install_facts)
    return SetupStatusResult(
        install=SetupInstall(
            method=facts.method,
            version=facts.version,
            binary=facts.binary,
            daemon_binary=facts.daemon_binary,
        ),
        paths=SetupPaths(**install_info.path_facts(ctx.state.paths)),
        jobs=[
            SetupJob(label=job.label, plist=job.plist, loaded=job.loaded, pid=job.pid)
            for job in await asyncio.to_thread(install_info.jobs)
        ],
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
        ],
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


async def _notify_test(ctx: RequestContext, _params: NotifyTestParams) -> NotifyTestResult:
    notifier = ctx.state.notifier
    if notifier is None:
        raise RpcCallError(INVALID_PARAMS, "the daemon is not ready for notifications yet")
    posted = await notifier.test()
    return NotifyTestResult(posted=posted, mechanism=notifier.poster.name)


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
        "helpers.respond": Method("helpers.respond", HelpersRespondParams, True, _helpers_respond),
        "route.consent.answer": Method(
            "route.consent.answer", RouteConsentAnswerParams, True, _route_consent_answer
        ),
        "run.cancel": Method("run.cancel", RunCancelParams, True, _run_cancel),
        "helper.stop": Method("helper.stop", HelperStopParams, True, _helper_stop),
        "helper.apply": Method("helper.apply", HelperApplyParams, True, _helper_apply),
        "helper.discard": Method("helper.discard", HelperDiscardParams, True, _helper_discard),
        "helper.retry": Method("helper.retry", HelperRetryParams, True, _helper_retry),
        "artifact.read": Method("artifact.read", ArtifactReadParams, True, _artifact_read),
        "changes.list": Method("changes.list", ChangesListParams, True, _changes_list),
        "changes.diff": Method("changes.diff", ChangesDiffParams, True, _changes_diff),
        "changes.revert": Method("changes.revert", ChangesRevertParams, True, _changes_revert),
        "file.read": Method("file.read", FileReadParams, True, _file_read),
        "file.list": Method("file.list", FileListParams, True, _file_list),
        "changes.commit": Method("changes.commit", ChangesCommitParams, True, _changes_commit),
        "changes.commit_info": Method(
            "changes.commit_info", ChangesCommitInfoParams, True, _changes_commit_info
        ),
        "changes.suggest_message": Method(
            "changes.suggest_message", ChangesSuggestMessageParams, True, _changes_suggest_message
        ),
        "session.inspect": Method("session.inspect", SessionInspectParams, True, _session_inspect),
        "cost.get": Method("cost.get", CostGetParams, True, _cost_get),
        "eval.routing": Method("eval.routing", EvalRoutingParams, True, _eval_routing),
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
        "mcp.login": Method("mcp.login", McpServerParams, True, mcp_login),
        "mcp.logout": Method("mcp.logout", McpServerParams, True, mcp_logout),
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
        "chat.get": Method("chat.get", ChatGetParams, True, chat_get),
        "chat.prompt": Method("chat.prompt", ChatPromptParams, True, chat_prompt),
        "chat.set": Method("chat.set", ChatSetParams, True, chat_set),
        "chat.draft": Method("chat.draft", ChatDraftParams, True, chat_draft),
        "chat.suggestions": Method(
            "chat.suggestions", ChatSuggestionsParams, True, chat_suggestions
        ),
        "chat.suggestion_dismiss": Method(
            "chat.suggestion_dismiss",
            ChatSuggestionDismissParams,
            True,
            chat_suggestion_dismiss,
        ),
        "notifications.get": Method(
            "notifications.get", NotificationsGetParams, True, notifications_get
        ),
        "notifications.set": Method(
            "notifications.set", NotificationsSetParams, True, notifications_set
        ),
        "ollama.settings.get": Method(
            "ollama.settings.get", OllamaSettingsGetParams, True, ollama_settings_get
        ),
        "ollama.settings.set": Method(
            "ollama.settings.set", OllamaSettingsSetParams, True, ollama_settings_set
        ),
        "routing.get": Method("routing.get", RoutingGetParams, True, routing_get),
        "routing.set": Method("routing.set", RoutingSetParams, True, routing_set),
        "agents.list": Method("agents.list", AgentsListParams, True, _agents_list),
        "agents.get": Method("agents.get", AgentsGetParams, True, _agents_get),
        "agents.set_wish": Method("agents.set_wish", AgentsSetWishParams, True, agents_set_wish),
        "agents.keep": Method("agents.keep", AgentsKeepParams, True, agents_keep),
        "evals.plan": Method("evals.plan", EvalsPlanParams, True, evals_plan),
        "evals.start": Method("evals.start", EvalsStartParams, True, evals_start),
        "evals.stop": Method("evals.stop", EvalsStopParams, True, evals_stop),
        "evals.resume": Method("evals.resume", EvalsResumeParams, True, evals_resume),
        "evals.list": Method("evals.list", EvalsListParams, True, evals_list),
        "evals.get": Method("evals.get", EvalsGetParams, True, evals_get),
        "evals.apply": Method("evals.apply", EvalsApplyParams, True, evals_apply),
        "evals.delete": Method("evals.delete", EvalsDeleteParams, True, evals_delete),
        "agents.set_limits": Method(
            "agents.set_limits", AgentsSetLimitsParams, True, agents_set_limits
        ),
        "agents.set_default_limits": Method(
            "agents.set_default_limits",
            AgentsSetDefaultLimitsParams,
            True,
            agents_set_default_limits,
        ),
        "agents.save": Method("agents.save", AgentsSaveParams, True, agents_save),
        "agents.copy": Method("agents.copy", AgentsCopyParams, True, agents_copy),
        "agents.delete": Method("agents.delete", AgentsDeleteParams, True, agents_delete),
        "skill.list": Method("skill.list", SkillListParams, True, _skill_list),
        "skill.read": Method("skill.read", SkillReadParams, True, skill_read),
        "skill.write": Method("skill.write", SkillWriteParams, True, skill_write),
        "skill.write_protected": Method(
            "skill.write_protected", SkillWriteParams, True, skill_write_protected
        ),
        "skill.create": Method("skill.create", SkillCreateParams, True, skill_create),
        "skill.create_protected": Method(
            "skill.create_protected", SkillCreateParams, True, skill_create_protected
        ),
        "skill.set_disabled": Method(
            "skill.set_disabled", SkillSetDisabledParams, True, skill_set_disabled
        ),
        "routine.list": Method("routine.list", RoutineListParams, True, routine_list),
        "routine.get": Method("routine.get", RoutineGetParams, True, routine_get),
        "routine.update": Method("routine.update", RoutineUpdateParams, True, routine_update),
        "routine.remove": Method("routine.remove", RoutineRemoveParams, True, routine_remove),
        "routine.run": Method("routine.run", RoutineRunParams, True, routine_run),
        "routine.preview": Method("routine.preview", RoutinePreviewParams, True, routine_preview),
        "workflow.list": Method("workflow.list", WorkflowListParams, True, workflow_list),
        "workflow.get": Method("workflow.get", WorkflowGetParams, True, workflow_get),
        "workflow.check": Method("workflow.check", WorkflowCheckParams, True, workflow_check),
        "workflow.propose": Method(
            "workflow.propose", WorkflowProposeParams, True, workflow_propose
        ),
        "workflow.save": Method("workflow.save", WorkflowSaveParams, True, workflow_save),
        "workflow.start": Method("workflow.start", WorkflowStartParams, True, workflow_start),
        "workflow.status": Method("workflow.status", WorkflowStatusParams, True, workflow_status),
        "workflow.cancel": Method("workflow.cancel", WorkflowCancelParams, True, workflow_cancel),
        "workflow.resume": Method("workflow.resume", WorkflowResumeParams, True, workflow_resume),
        "workflow.review.answer": Method(
            "workflow.review.answer",
            WorkflowReviewAnswerParams,
            True,
            workflow_review_answer,
        ),
        "run.list": Method("run.list", RunListParams, True, run_list),
        "session.set_skills": Method(
            "session.set_skills", SessionSetSkillsParams, True, _session_set_skills
        ),
        "model.probe": Method("model.probe", ModelProbeParams, True, _model_probe),
        "model.bench": Method("model.bench", ModelBenchParams, True, _model_bench),
        "model.check": Method("model.check", ModelCheckParams, True, _model_check),
        "hf.search": Method("hf.search", HfSearchParams, True, _hf_search),
        "hf.files": Method("hf.files", HfFilesParams, True, _hf_files),
        "ollama.library": Method("ollama.library", OllamaLibraryParams, True, _ollama_library),
        "model.pull": Method("model.pull", ModelPullParams, True, _model_pull),
        "model.pull_cancel": Method(
            "model.pull_cancel", ModelPullCancelParams, True, _model_pull_cancel
        ),
        "model.pull_cleanup": Method(
            "model.pull_cleanup", ModelPullCleanupParams, True, _model_pull_cleanup
        ),
        "model.delete": Method("model.delete", ModelDeleteParams, True, _model_delete),
        "model.score_reset": Method(
            "model.score_reset", ModelScoreResetParams, True, _model_score_reset
        ),
        "model.star": Method("model.star", ModelStarParams, True, _model_star),
        "model.set_default": Method(
            "model.set_default", ModelSetDefaultParams, True, _model_set_default
        ),
        "permissions.set_mode": Method(
            "permissions.set_mode", PermissionsSetModeParams, True, _permissions_set_mode
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
        "session.set_mode": Method(
            "session.set_mode", SessionSetModeParams, True, _session_set_mode
        ),
        "session.set_route": Method(
            "session.set_route", SessionSetRouteParams, True, _session_set_route
        ),
        "session.compact": Method("session.compact", SessionCompactParams, True, _session_compact),
        "session.set_checks": Method(
            "session.set_checks", SessionSetChecksParams, True, _session_set_checks
        ),
        "session.set_plan": Method(
            "session.set_plan", SessionSetPlanParams, True, _session_set_plan
        ),
        "fs.list_dirs": Method("fs.list_dirs", FsListDirsParams, True, _fs_list_dirs),
        "git.info": Method("git.info", GitInfoParams, True, _git_info),
        "git.branches": Method("git.branches", GitBranchesParams, True, _git_branches),
        "fs.choose_folder": Method(
            "fs.choose_folder", FsChooseFolderParams, True, _fs_choose_folder
        ),
        "fs.reveal": Method("fs.reveal", FsRevealParams, True, _fs_reveal),
        "setup.status": Method("setup.status", SetupStatusParams, True, _setup_status),
        "ollama.install": Method("ollama.install", OllamaInstallParams, True, _ollama_install),
        "ollama.install_cancel": Method(
            "ollama.install_cancel", OllamaInstallCancelParams, True, _ollama_install_cancel
        ),
        "notify.test": Method("notify.test", NotifyTestParams, True, _notify_test),
        "ollama.start": Method("ollama.start", OllamaStartParams, True, _ollama_start),
        "session.set_model": Method(
            "session.set_model", SessionSetModelParams, True, _session_set_model
        ),
        "memory.list": Method("memory.list", MemoryListParams, True, memory_list),
        "memory.get": Method("memory.get", MemoryGetParams, True, memory_get),
        "memory.write": Method("memory.write", MemoryWriteParams, True, memory_write),
        "memory.update": Method("memory.update", MemoryUpdateParams, True, memory_update),
        "memory.delete": Method("memory.delete", MemoryDeleteParams, True, memory_delete),
        "memory.export": Method("memory.export", MemoryExportParams, True, memory_export),
        "memory.settings": Method("memory.settings", MemorySettingsParams, True, memory_settings),
        "data.list": Method("data.list", DataListParams, True, data_list),
        "data.describe": Method("data.describe", DataDescribeParams, True, data_describe),
        "data.query": Method("data.query", DataQueryParams, True, data_query),
        "data.cancel": Method("data.cancel", DataCancelParams, True, data_cancel),
        "data.inspect": Method("data.inspect", DataInspectParams, True, data_inspect),
        "data.add": Method("data.add", DataAddParams, True, data_add),
        "data.update": Method("data.update", DataUpdateParams, True, data_update),
        "data.remove": Method("data.remove", DataRemoveParams, True, data_remove),
        "data.extension.install": Method(
            "data.extension.install", DataExtensionInstallParams, True, data_extension_install
        ),
        "relay.sign": Method("relay.sign", RelaySignParams, True, relay_sign),
        "relay.dh": Method("relay.dh", RelayDhParams, True, relay_dh),
        "device.sync": Method("device.sync", DeviceSyncParams, True, device_sync),
        "device.pair.request": Method(
            "device.pair.request", DevicePairRequestParams, True, device_pair_request
        ),
        "device.list": Method("device.list", DeviceListParams, True, device_list),
        "device.pair.begin": Method(
            "device.pair.begin", DevicePairBeginParams, True, device_pair_begin
        ),
        "device.pair.confirm": Method(
            "device.pair.confirm", DevicePairConfirmParams, True, device_pair_confirm
        ),
        "device.rename": Method("device.rename", DeviceRenameParams, True, device_rename),
        "device.revoke": Method("device.revoke", DeviceRevokeParams, True, device_revoke),
        # Before hello: the gateway names the device before anything the phone sent arrives.
        "connection.identify": Method(
            "connection.identify", ConnectionIdentifyParams, False, connection_identify
        ),
    }
