export { Attachments } from "./attachments.ts";
export { backoffDelayMs } from "./backoff.ts";
export {
  connectGolem,
  DAEMON_DOWN_CLOSE_CODE,
  KEYCHAIN_UNAVAILABLE,
  KEY_REJECTED,
  KEY_UNCHECKED,
  OLLAMA_FAILED,
  BUDGET_SPENT,
  LOCAL_ONLY,
  MESSAGE_NOT_FOUND,
  MODEL_PULL_FAILED,
  APPROVAL_NOT_FOUND,
  INVALID_TOOL_ARGS,
  ARTIFACT_NOT_FOUND,
  SKILL_NOT_FOUND,
  MODEL_NOT_CONFIGURED,
  RpcError,
  UNAUTHORIZED_CLOSE_CODE,
  RUN_NOT_FOUND,
  SESSION_BUSY,
  HELPER_CONFLICT,
  NOT_A_REPO,
  BRANCH_SWITCH_FAILED,
  SESSION_NOT_FOUND,
  type AgentLimitsChange,
  type ApprovalChoice,
  type ConsentChoice,
  type ChangesDiffTarget,
  type ChangesRevertTarget,
  type RoutinePreviewCheck,
  type SendOptions,
  type ChatEvent,
  type ConnectionState,
  type ConnectOptions,
  type GolemClient,
  type OllamaInstallUpdate,
  type RuntimeInstallUpdate,
  type BenchUpdate,
  type EvalUpdate,
  type CheckUpdate,
  type PullUpdate,
  type SessionSummary,
} from "./connect.ts";
export type { Dial, Link } from "./link.ts";
export { wsDial } from "./ws-link.ts";
export type { HfFilesResult } from "../../protocol/gen/hf-files-result.ts";
export type { HfRepo } from "../../protocol/gen/hf-repo.ts";
export type { HfSearchResult } from "../../protocol/gen/hf-search-result.ts";
export type { HfSize } from "../../protocol/gen/hf-size.ts";
export type { OllamaLibraryModel } from "../../protocol/gen/ollama-library-model.ts";
export type { OllamaLibraryResult } from "../../protocol/gen/ollama-library-result.ts";
export type { OllamaLibrarySize } from "../../protocol/gen/ollama-library-size.ts";
export type { ModelProbeResult } from "../../protocol/gen/model-probe-result.ts";
export type { McpListResult } from "../../protocol/gen/mcp-list-result.ts";
export type { McpCatalogEntry } from "../../protocol/gen/mcp-catalog-entry.ts";
export type { McpCatalogInput } from "../../protocol/gen/mcp-catalog-input.ts";
export type { McpCatalogResult } from "../../protocol/gen/mcp-catalog-result.ts";
export type { McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";
export type { McpServerConfig } from "../../protocol/gen/mcp-server-detail.ts";
export type { ConfigRawGetResult } from "../../protocol/gen/config-raw-get-result.ts";
export type { ConfigRawResult } from "../../protocol/gen/config-raw-result.ts";
export type { McpImportApplyParams } from "../../protocol/gen/mcp-import-apply-params.ts";
export type { McpImportApplyResult } from "../../protocol/gen/mcp-import-apply-result.ts";
export type { McpImportCandidate } from "../../protocol/gen/mcp-import-candidate.ts";
export type { McpImportScanResult } from "../../protocol/gen/mcp-import-scan-result.ts";
export type { McpCallResult } from "../../protocol/gen/mcp-call-result.ts";
export type { McpLogsResult } from "../../protocol/gen/mcp-logs-result.ts";
export type { McpServerLog } from "../../protocol/gen/mcp-server-log.ts";
export type { McpTestProgress } from "../../protocol/gen/mcp-test-progress.ts";
export type { McpTestResult } from "../../protocol/gen/mcp-test-result.ts";
export type { McpUpdateParams } from "../../protocol/gen/mcp-update-params.ts";
export type { DeviceInfo } from "../../protocol/gen/device-info.ts";
export type { DeviceListResult } from "../../protocol/gen/device-list-result.ts";
export type { DevicePairBeginResult } from "../../protocol/gen/device-pair-begin-result.ts";
export type { DevicePairChanged } from "../../protocol/gen/device-pair-changed.ts";
export type { DevicePairConfirmResult } from "../../protocol/gen/device-pair-confirm-result.ts";
export type { DeviceRenameResult } from "../../protocol/gen/device-rename-result.ts";
export type { DeviceRevokeResult } from "../../protocol/gen/device-revoke-result.ts";
export type { DeviceRule } from "../../protocol/gen/device-rule.ts";
export type { PairingDevice } from "../../protocol/gen/pairing-device.ts";
export type { MemoryChanged } from "../../protocol/gen/memory-changed.ts";
export type { DataAddParams } from "../../protocol/gen/data-add-params.ts";
export type { DataAddResult } from "../../protocol/gen/data-add-result.ts";
export type { DataChanged } from "../../protocol/gen/data-changed.ts";
export type { DataColumn } from "../../protocol/gen/data-column.ts";
export type { DataCancelResult } from "../../protocol/gen/data-cancel-result.ts";
export type { DataDescribeResult } from "../../protocol/gen/data-describe-result.ts";
export type { DataInspectResult } from "../../protocol/gen/data-inspect-result.ts";
export type { DataListResult } from "../../protocol/gen/data-list-result.ts";
export type { DataNotesDraftResult } from "../../protocol/gen/data-notes-draft-result.ts";
export type { DataNotesGetResult } from "../../protocol/gen/data-notes-get-result.ts";
export type { DataNotesSetResult } from "../../protocol/gen/data-notes-set-result.ts";
export type { DataQueryParams } from "../../protocol/gen/data-query-params.ts";
export type { DataResult } from "../../protocol/gen/data-result.ts";
export type { DataRemoveResult } from "../../protocol/gen/data-remove-result.ts";
export type { DataSavedQuery } from "../../protocol/gen/data-saved-query.ts";
export type { DataSource } from "../../protocol/gen/data-source.ts";
export type { DataTable } from "../../protocol/gen/data-table.ts";
export type { DataUpdateParams } from "../../protocol/gen/data-update-params.ts";
export type { DataUpdateResult } from "../../protocol/gen/data-update-result.ts";
export type { MemoryDeleteParams } from "../../protocol/gen/memory-delete-params.ts";
export type { MemoryDeleteResult } from "../../protocol/gen/memory-delete-result.ts";
export type { MemoryExportParams } from "../../protocol/gen/memory-export-params.ts";
export type { MemoryExportResult } from "../../protocol/gen/memory-export-result.ts";
export type { MemoryGetResult } from "../../protocol/gen/memory-get-result.ts";
export type { MemoryItem } from "../../protocol/gen/memory-item.ts";
export type { MemoryListParams } from "../../protocol/gen/memory-list-params.ts";
export type { MemoryListResult } from "../../protocol/gen/memory-list-result.ts";
export type { MemorySettings } from "../../protocol/gen/memory-settings.ts";
export type { MemorySettingsResult } from "../../protocol/gen/memory-settings-result.ts";
export type { MemoryUpdateParams } from "../../protocol/gen/memory-update-params.ts";
export type { MemoryUpdateResult } from "../../protocol/gen/memory-update-result.ts";
export type { MemoryWriteParams } from "../../protocol/gen/memory-write-params.ts";
export type { MemoryWriteResult } from "../../protocol/gen/memory-write-result.ts";
export type { RoutineConfig, RoutineWatchConfig } from "../../protocol/gen/routine-config.ts";
export type { RoutineGetResult } from "../../protocol/gen/routine-get-result.ts";
export type { RoutineInfo } from "../../protocol/gen/routine-info.ts";
export type { RoutineIssue } from "../../protocol/gen/routine-issue.ts";
export type { RoutineListResult } from "../../protocol/gen/routine-list-result.ts";
export type { RoutinePreviewResult } from "../../protocol/gen/routine-preview-result.ts";
export type { RoutineRunResult } from "../../protocol/gen/routine-run-result.ts";
export type { RoutineRunSummary } from "../../protocol/gen/routine-run-summary.ts";
export type { WorkflowCancelResult } from "../../protocol/gen/workflow-cancel-result.ts";
export type { WorkflowEntryInfo } from "../../protocol/gen/workflow-entry-info.ts";
export type { WorkflowCheckResult } from "../../protocol/gen/workflow-check-result.ts";
export type { WorkflowProposeResult } from "../../protocol/gen/workflow-propose-result.ts";
export type { WorkflowGetResult } from "../../protocol/gen/workflow-get-result.ts";
export type { WorkflowProblem } from "../../protocol/gen/workflow-problem.ts";
export type { WorkflowSaveResult } from "../../protocol/gen/workflow-save-result.ts";
export type { WorkflowInputInfo } from "../../protocol/gen/workflow-input-info.ts";
export type { WorkflowOutlineStep } from "../../protocol/gen/workflow-outline-step.ts";
export type { WorkflowTriggerInfo } from "../../protocol/gen/workflow-trigger-info.ts";
export type { WorkflowListResult } from "../../protocol/gen/workflow-list-result.ts";
export type { WorkflowResumeResult } from "../../protocol/gen/workflow-resume-result.ts";
export type { WorkflowReviewAnswerResult } from "../../protocol/gen/workflow-review-answer-result.ts";
export type { WorkflowRunEvent } from "../../protocol/gen/workflow-run-event.ts";
export type { WorkflowStartResult } from "../../protocol/gen/workflow-start-result.ts";
export type { WorkflowStatusResult } from "../../protocol/gen/workflow-status-result.ts";
export type { WorkflowStepEvent } from "../../protocol/gen/workflow-step-event.ts";
export type { WorkflowNotice } from "./connect.ts";
export type { RunInfo } from "../../protocol/gen/run-info.ts";
export type { RunListResult } from "../../protocol/gen/run-list-result.ts";
export type { RoutineUpdateResult } from "../../protocol/gen/routine-update-result.ts";
export type { RuntimeName } from "./runtime.ts";
export type { RuntimeInstallDone } from "../../protocol/gen/runtime-install-done.ts";
export type { McpAddParams } from "../../protocol/gen/mcp-add-params.ts";
export type { McpRemoveResult } from "../../protocol/gen/mcp-remove-result.ts";
export type { McpServer } from "../../protocol/gen/mcp-server.ts";
export type { McpLoginDone } from "../../protocol/gen/mcp-login-done.ts";
export type { McpLoginResult } from "../../protocol/gen/mcp-login-result.ts";
export type { KeychainWait } from "../../protocol/gen/keychain-wait.ts";
export type { ModelServerStatus } from "../../protocol/gen/model-server-status.ts";
export type { ModelMemory } from "../../protocol/gen/model-memory.ts";
export type { ModelOption } from "../../protocol/gen/model-option.ts";
export type { ModelOptionsGetResult } from "../../protocol/gen/model-options-get-result.ts";
export type { ModelOptionsSaved } from "../../protocol/gen/model-options-saved.ts";
export type { ModelOptionsSetResult } from "../../protocol/gen/model-options-set-result.ts";
export type { PermissionsSetModeParams } from "../../protocol/gen/permissions-set-mode-params.ts";
export type { PermissionsSetModeResult } from "../../protocol/gen/permissions-set-mode-result.ts";
export type { SessionSetModeParams } from "../../protocol/gen/session-set-mode-params.ts";
export type { SessionCompactParams } from "../../protocol/gen/session-compact-params.ts";
export type { SessionCompactResult } from "../../protocol/gen/session-compact-result.ts";
export type { SessionSetModeResult } from "../../protocol/gen/session-set-mode-result.ts";
export type { SessionSetOptionsResult } from "../../protocol/gen/session-set-options-result.ts";
export type { McpToggleResult } from "../../protocol/gen/mcp-toggle-result.ts";
export type { SessionSetSkillsResult } from "../../protocol/gen/session-set-skills-result.ts";
export type { ArtifactReadResult } from "../../protocol/gen/artifact-read-result.ts";
export type { ChangesCommitResult } from "../../protocol/gen/changes-commit-result.ts";
export type { ChangesCommitInfoResult } from "../../protocol/gen/changes-commit-info-result.ts";
export type { ChangesSuggestMessageResult } from "../../protocol/gen/changes-suggest-message-result.ts";
export type { ChangesDiffResult } from "../../protocol/gen/changes-diff-result.ts";
export type { ChangedFile, ChangesListResult } from "../../protocol/gen/changes-list-result.ts";
export type { ChangesRevertResult, RevertConflict } from "../../protocol/gen/changes-revert-result.ts";
export type { FileListResult } from "../../protocol/gen/file-list-result.ts";
export type { FileReadResult } from "../../protocol/gen/file-read-result.ts";
export type { McpToolInfo, McpToolsResult } from "../../protocol/gen/mcp-tools-result.ts";
export type { TraceContext } from "../../protocol/gen/trace-context.ts";
export type { TraceContextEvent } from "../../protocol/gen/trace-context-event.ts";
export type { TraceContextItem } from "../../protocol/gen/trace-context-item.ts";
export type { TraceContextPart } from "../../protocol/gen/trace-context-part.ts";
export type { PromptSectionInfo } from "../../protocol/gen/prompt-section-info.ts";
export type { OllamaSettingsSetParams } from "../../protocol/gen/ollama-settings-set-params.ts";
export type { OllamaSettingsSetResult } from "../../protocol/gen/ollama-settings-set-result.ts";
export type { OllamaSettingsValues } from "../../protocol/gen/ollama-settings-values.ts";
export type { ChatSetParams } from "../../protocol/gen/chat-set-params.ts";
export type { ChatSetResult } from "../../protocol/gen/chat-set-result.ts";
export type { ChatPromptParams } from "../../protocol/gen/chat-prompt-params.ts";
export type { ChatPromptResult } from "../../protocol/gen/chat-prompt-result.ts";
export type { ChatPromptPart } from "../../protocol/gen/chat-prompt-part.ts";
export type { ChatDraftResult } from "../../protocol/gen/chat-draft-result.ts";
export type { ChatSuggestionsResult } from "../../protocol/gen/chat-suggestions-result.ts";
export type { ChatSuggestion } from "../../protocol/gen/chat-suggestion.ts";
export type { ChatSuggestionDismissResult } from "../../protocol/gen/chat-suggestion-dismiss-result.ts";
export type { ChatValues } from "../../protocol/gen/chat-values.ts";
export type { NotificationsSetParams } from "../../protocol/gen/notifications-set-params.ts";
export type { NotificationsSetResult } from "../../protocol/gen/notifications-set-result.ts";
export type { NotificationsValues } from "../../protocol/gen/notifications-values.ts";
export type { NotifyTestResult } from "../../protocol/gen/notify-test-result.ts";
export type { RoutingGetResult } from "../../protocol/gen/routing-get-result.ts";
export type { RoutingSetParams } from "../../protocol/gen/routing-set-params.ts";
export type { RoutingSetResult } from "../../protocol/gen/routing-set-result.ts";
export type { RoutingBudget } from "../../protocol/gen/routing-budget.ts";
export type { RoutingContext } from "../../protocol/gen/routing-context.ts";
export type { RoutingLadder } from "../../protocol/gen/routing-ladder.ts";
export type { RoutingPicked } from "../../protocol/gen/routing-picked.ts";
export type { RoutingRoles } from "../../protocol/gen/routing-roles.ts";
export type { RoutingValues } from "../../protocol/gen/routing-values.ts";
export type { CostDayRow, CostGetResult, CostModelRow, CostTotals } from "../../protocol/gen/cost-get-result.ts";
export type { EvalRoutingResult, EvalScenarioRow, EvalTopSession } from "../../protocol/gen/eval-routing-result.ts";
export type { TraceGetResult } from "../../protocol/gen/trace-get-result.ts";
export type { TraceMessage } from "../../protocol/gen/trace-message.ts";
export type { TraceHelperModelSpan } from "../../protocol/gen/trace-helper-model-span.ts";
export type { TraceHelperToolSpan } from "../../protocol/gen/trace-helper-tool-span.ts";
export type { TraceModelSpan } from "../../protocol/gen/trace-model-span.ts";
export type { TraceRunSpan } from "../../protocol/gen/trace-run-span.ts";
export type { TraceSpan } from "../../protocol/gen/trace-span.ts";
export type { TraceSpanResult } from "../../protocol/gen/trace-span-result.ts";
export type { TraceTokens } from "../../protocol/gen/trace-tokens.ts";
export type { TraceToolSpan } from "../../protocol/gen/trace-tool-span.ts";
export type { SkillCall } from "../../protocol/gen/skill-call.ts";
export type { SkillCreateResult } from "../../protocol/gen/skill-create-result.ts";
export type { SkillReadResult } from "../../protocol/gen/skill-read-result.ts";
export type { ListedSkill, SkillListResult } from "../../protocol/gen/skill-list-result.ts";
export type { AgentInfo, AgentLimits } from "../../protocol/gen/agent-info.ts";
export type { AgentsListResult } from "../../protocol/gen/agents-list-result.ts";
export type { AgentsCopyResult } from "../../protocol/gen/agents-copy-result.ts";
export type { AgentsDeleteResult } from "../../protocol/gen/agents-delete-result.ts";
export type { AgentsSaveProblem } from "../../protocol/gen/agents-save-problem.ts";
export type { AgentsSaveResult } from "../../protocol/gen/agents-save-result.ts";
export type { AgentsKeepResult } from "../../protocol/gen/agents-keep-result.ts";
export type { AgentsKeepValues } from "../../protocol/gen/agents-keep-values.ts";
export type { AgentsDelegateNumber } from "../../protocol/gen/agents-delegate-number.ts";
export type { AgentsDelegateValues } from "../../protocol/gen/agents-delegate-values.ts";
export type { EvalArmParams } from "../../protocol/gen/eval-arm-params.ts";
export type { EvalArmUsed } from "../../protocol/gen/eval-arm-used.ts";
export type { EvalAsk } from "../../protocol/gen/eval-ask.ts";
export type { EvalEnded } from "../../protocol/gen/eval-ended.ts";
export type { EvalMeasurement } from "../../protocol/gen/eval-measurement.ts";
export type { EvalModelChoice } from "../../protocol/gen/eval-model-choice.ts";
export type { EvalNumber } from "../../protocol/gen/eval-number.ts";
export type { EvalPlanArm } from "../../protocol/gen/eval-plan-arm.ts";
export type { EvalProgress } from "../../protocol/gen/eval-progress.ts";
export type { EvalProposal } from "../../protocol/gen/eval-proposal.ts";
export type { EvalRun } from "../../protocol/gen/eval-run.ts";
export type { EvalStarted } from "../../protocol/gen/eval-started.ts";
export type { EvalSummary } from "../../protocol/gen/eval-summary.ts";
export type { EvalsApplyResult } from "../../protocol/gen/evals-apply-result.ts";
export type { EvalsDeleteResult } from "../../protocol/gen/evals-delete-result.ts";
export type { EvalsGetResult } from "../../protocol/gen/evals-get-result.ts";
export type { EvalsListResult } from "../../protocol/gen/evals-list-result.ts";
export type { EvalsPlanResult } from "../../protocol/gen/evals-plan-result.ts";
export type { EvalsResumeResult } from "../../protocol/gen/evals-resume-result.ts";
export type { EvalsStartParams } from "../../protocol/gen/evals-start-params.ts";
export type { EvalsStartResult } from "../../protocol/gen/evals-start-result.ts";
export type { EvalsStopResult } from "../../protocol/gen/evals-stop-result.ts";
export type { AgentsSetDefaultLimitsParams } from "../../protocol/gen/agents-set-default-limits-params.ts";
export type { AgentsSetLimitsParams } from "../../protocol/gen/agents-set-limits-params.ts";
export type { AgentsSetLimitsResult } from "../../protocol/gen/agents-set-limits-result.ts";
export type { AgentsSetWishResult } from "../../protocol/gen/agents-set-wish-result.ts";
export type { WishResolution } from "../../protocol/gen/wish-resolution.ts";
export type { SkillSetDisabledResult } from "../../protocol/gen/skill-set-disabled-result.ts";
export type { SkillIssue, SkillWriteResult } from "../../protocol/gen/skill-write-result.ts";
export type { AuthKeyStatus, AuthListResult } from "../../protocol/gen/auth-list-result.ts";
export type { ConfigAllowance, ConfigGetResult, ConfigRule } from "../../protocol/gen/config-get-result.ts";
export type { ConfigLadder } from "../../protocol/gen/config-ladder.ts";
export type { ConfigRouting } from "../../protocol/gen/config-routing.ts";
export type { ModelRejection, ModelRoutedData } from "../../protocol/gen/model-routed-data.ts";
export type { SessionSetRouteParams } from "../../protocol/gen/session-set-route-params.ts";
export type { TraceRoute } from "../../protocol/gen/trace-route.ts";
export type { ListedModel, ModelListResult } from "../../protocol/gen/model-list-result.ts";
export type { DirEntry, FsListDirsResult } from "../../protocol/gen/fs-list-dirs-result.ts";
export type { FsChooseFolderResult } from "../../protocol/gen/fs-choose-folder-result.ts";
export type { GitBranch, GitBranchesResult } from "../../protocol/gen/git-branches-result.ts";
export type { FsRevealResult } from "../../protocol/gen/fs-reveal-result.ts";
export type { GitInfoResult, GitWorktree } from "../../protocol/gen/git-info-result.ts";
export type { SetupRow, SetupStatusResult } from "../../protocol/gen/setup-status-result.ts";
export { mergeSummary } from "./session-index.ts";
export { VERSION as GOLEM_VERSION } from "./version.ts";
export {
  formatWireLine,
  pingTotal,
  pushWire,
  WIRE_LIMIT,
  type WireFrame,
  type WireLine,
} from "./wire.ts";
