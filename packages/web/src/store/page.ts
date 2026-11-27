import { OLLAMA_FAILED, RpcError, type ApprovalChoice, type ConfigGetResult, type ConfigRawGetResult, type ConfigRawResult, type FsListDirsResult, type GitBranchesResult, type GitInfoResult, type FsChooseFolderResult, type McpAddParams, type McpCallResult, type McpImportApplyParams, type McpImportApplyResult, type McpImportScanResult, type McpCatalogResult, type McpListResult, type McpLogsResult, type McpServerConfig, type McpServerDetail, type McpServerLog, type McpLoginDone, type McpTestProgress, type McpTestResult, type GolemClient, type RoutinePreviewCheck, type RuntimeName, type SetupStatusResult, type SkillListResult, type AgentsListResult, type AgentsSaveResult, type AgentsDeleteResult, type TraceGetResult, type TraceSpanResult, type ArtifactReadResult, type ChangesDiffResult, type ChangesDiffTarget, type ChangesListResult, type ChangesRevertResult, type ChangesRevertTarget, type ChangesCommitResult, type ChangesCommitInfoResult, type ChangesSuggestMessageResult, type ModelOptionsGetResult, type ModelOptionsSetResult, type SessionSetOptionsResult, type SkillCreateResult, type SkillReadResult, type SkillWriteResult, type AuthListResult, type FileListResult, type FileReadResult, type CostGetResult, type SessionCompactResult, type ConsentChoice, type RoutingGetResult, type RoutingSetParams, type RoutingSetResult, type NotificationsValues, type NotificationsSetParams, type NotificationsSetResult, type NotifyTestResult, type ChatSetParams, type ChatSetResult, type ChatValues, type ChatPromptResult, type ChatDraftResult, type ChatSuggestionsResult, type ChatSuggestionDismissResult, type AgentLimitsChange } from "@golem/client";
import { changeToolFilter, installEventOf, type InstallEvent, type PermissionMode, type CompactAction, type RouteMode, type UseHelpersValue } from "@golem/view";
import type { QueryClient } from "@tanstack/react-query";
import { createDrafts, type Drafts } from "./drafts.ts";
import { createNotes, type Notes } from "./notes.ts";
import { createConnectionStore, type ConnectionStore } from "./connection.ts";
import { createAppInstall, type AppInstallStore } from "./app-install.ts";
import { createPageHost, type PageHostStore } from "./page-host.ts";
import { createNewSession, type NewSessionStore } from "./new-session.ts";
import { CONFIG_KEY } from "./config.ts";
import { DEVICE_LIST_KEY, createPairing, type DeviceListResult, type DeviceRevokeResult, type Pairing } from "./devices.ts";
import { MCP_CATALOG_KEY, MCP_GET_KEY, MCP_LIST_KEY, MCP_TOOLS_KEY, type McpToolsResult } from "./mcp.ts";
import { AGENTS_KEEP_KEY, OLLAMA_SETTINGS_KEY, type OllamaSettingsSetParams, type OllamaSettingsSetResult, type OllamaSettingsValues, CHAT_KEY, PROMPT_KEY, SUGGESTIONS_KEY, NOTIFICATIONS_KEY, type AgentsKeepResult, type AgentsKeepValues } from "./notifications.ts";
import { ROUTING_KEY } from "./routing.ts";
import type { AgentInfo, AgentsListResult as AgentsListed } from "./agents.ts";
import { MODEL_LIST_ALL_KEY, MODEL_LIST_KEY, SETUP_STATUS_KEY, type HfFilesResult, type HfSearchResult, type ModelListResult, type OllamaLibraryResult } from "./models.ts";
import { SKILL_LIST_KEY } from "./skills.ts";
import { MEMORY_LIST_KEY, MEMORY_PAGE, type MemoryExportParams, type MemoryExportResult, type MemoryListRequest, type MemoryListResult, type MemoryPrivacy, type MemoryScope } from "./memory.ts";
import { ROUTINE_GET_KEY, ROUTINE_LIST_KEY, type RoutineGetResult, type RoutineInfo, type RoutineListResult, type RoutineRunResult } from "./routines.ts";
import { RUN_LIST_KEY, type RunListResult } from "./runs.ts";
import { WORKFLOW_LIST_KEY, WORKFLOW_STATUS_KEY, workflowGetKey, type ReviewVerdict, type WorkflowAddStarterResult, type WorkflowCancelResult, type WorkflowCheckResult, type WorkflowProposeResult, type WorkflowSaveResult, type WorkflowGetResult, type WorkflowListResult, type WorkflowStartersResult, type WorkflowReadOutputResult, type WorkflowResumeResult, type WorkflowStatusResult, type WorkflowEditStepResult } from "./workflows.ts";
import { DATA_DESCRIBE_KEY, DATA_LIST_KEY, DATA_NOTES_KEY, dataAnswer, type DataBrowseKeepResult, type DataBrowseKeepView, type DataBrowseResult, type DataBrowseView, type DataProfileResult, type DataAddParams, type DataAnswer, type DataExportParams, type DataExportResult, type DataExtensionName, type DataResult, type DataResultPageParams, type DataDescribeResult, type DataInspectParams, type DataInspectResult, type DataListResult, type DataNotesGetResult, type DataSource, type DataUpdateParams } from "./data.ts";
import { createPulls, type Pulls } from "./pulls.ts";
import { createQueryClient, keepQueriesHonest } from "./query.ts";
import { createRouter, type Router } from "./router.ts";
import { createSessionList, type SessionList } from "./session-list.ts";
import type { Frame, SessionStore } from "./session-store.ts";
import { createSessions, type Sessions } from "./sessions.ts";
import { createSetupStart, type SetupStart } from "./setup-start.ts";

/** What the page needs of the client. */
export type PageClient = Pick<
  GolemClient,
  | "state"
  | "ready"
  | "onState"
  | "onEvent"
  | "onSessionSummary"
  | "onSkillsChanged"
  | "onAgentsChanged"
  | "listAgents"
  | "setAgentWish"
  | "setAgentLimits"
  | "setDefaultAgentLimits"
  | "saveAgent"
  | "copyAgent"
  | "deleteAgent"
  | "agentsKeep"
  | "evalsPlan"
  | "evalsStart"
  | "evalsStop"
  | "evalsResume"
  | "evalsList"
  | "evalsGet"
  | "evalsApply"
  | "evalsDelete"
  | "onEval"
  | "onMemoryChanged"
  | "onDevicesChanged"
  | "onDevicePairChanged"
  | "deviceList"
  | "devicePairBegin"
  | "devicePairConfirm"
  | "deviceRename"
  | "deviceRevoke"
  | "listMemories"
  | "updateMemory"
  | "deleteMemories"
  | "exportMemories"
  | "memorySettings"
  | "onRoutinesChanged"
  | "listRoutines"
  | "listWorkflows"
  | "listData"
  | "describeData"
  | "inspectData"
  | "inspectDatabase"
  | "pageDataResult"
  | "profileData"
  | "browseData"
  | "browseDataKeep"
  | "exportDataResult"
  | "installDataExtension"
  | "addData"
  | "updateData"
  | "removeData"
  | "getDataNotes"
  | "setDataNotes"
  | "draftDataNotes"
  | "onDataChanged"
  | "getWorkflow"
  | "checkWorkflow"
  | "saveWorkflow"
  | "proposeWorkflow"
  | "editWorkflowStep"
  | "startWorkflow"
  | "listWorkflowStarters"
  | "addWorkflowStarter"
  | "workflowStatus"
  | "cancelWorkflow"
  | "resumeWorkflow"
  | "readWorkflowOutput"
  | "answerWorkflowReview"
  | "onWorkflowEvent"
  | "listRuns"
  | "getRoutine"
  | "runRoutine"
  | "removeRoutine"
  | "updateRoutine"
  | "previewRoutine"
  | "onMcpStatus"
  | "onPull"
  | "onModelServer"
  | "status"
  | "attachSession"
  | "detachSession"
  | "watchSessions"
  | "createSession"
  | "sendMessage"
  | "renameSession"
  | "forkSession"
  | "closeSession"
  | "cancelRun"
  | "stopHelper"
  | "listModels"
  | "listSkills"
  | "readSkill"
  | "writeSkill"
  | "createSkill"
  | "setSkillDisabled"
  | "listKeys"
  | "setSkills"
  | "setSessionMode"
  | "setPlan"
  | "setChecks"
  | "setRoute"
  | "compactSession"
  | "getConfig"
  | "listMcp"
  | "mcpTools"
  | "getTrace"
  | "getCost"
  | "getRouting"
  | "getNotifications"
  | "getChat"
  | "setChat"
  | "getChatPrompt"
  | "draftChat"
  | "getChatSuggestions"
  | "dismissChatSuggestion"
  | "setNotifications"
  | "notifyTest"
  | "setRouting"
  | "getTraceSpan"
  | "readArtifact"
  | "changesList"
  | "changesDiff"
  | "changesRevert"
  | "changesCommit"
  | "changesCommitInfo"
  | "changesSuggestMessage"
  | "readFile"
  | "listFiles"
  | "restartMcp"
  | "setMcpEnabled"
  | "enableMcp"
  | "disableMcp"
  | "mcpTest"
  | "mcpLogs"
  | "onMcpLog"
  | "mcpLogin"
  | "mcpLogout"
  | "onMcpLoginDone"
  | "mcpCall"
  | "mcpGet"
  | "updateMcpServer"
  | "addMcpServer"
  | "configRawGet"
  | "configRawSet"
  | "scanMcpImport"
  | "applyMcpImport"
  | "mcpCatalog"
  | "installRuntime"
  | "cancelRuntimeInstall"
  | "onRuntimeInstall"
  | "removeMcpServer"
  | "listDirs"
  | "gitInfo"
  | "gitBranches"
  | "chooseFolder"
  | "reveal"
  | "localUi"
  | "updateRule"
  | "removeRule"
  | "revokeAllowance"
  | "setSessionModel"
  | "setDefaultModel"
  | "starModel"
  | "getOllamaSettings"
  | "setOllamaSettings"
  | "setDefaultPermissionMode"
  | "getModelOptions"
  | "setModelOptions"
  | "setSessionOptions"
  | "onOptionsSaved"
  | "pullModel"
  | "cancelPull"
  | "cleanupPull"
  | "deleteModel"
  | "searchHf"
  | "hfFiles"
  | "ollamaLibrary"
  | "setupStatus"
  | "startOllama"
  | "installOllama"
  | "cancelOllamaInstall"
  | "onOllamaInstall"
  | "respondApproval"
  | "respondHelpers"
  | "applyHelper"
  | "discardHelper"
  | "retryHelper"
  | "answerConsent"
  | "checkNow"
  | "close"
>;

/** Thin calls on the client. Their results arrive as events, so there is nothing to merge. */
export type PageActions = {
  /** The measurement of the helper rules (`evals.*`): the plan, start, stop, resume, list, get, apply and delete, and the `eval.*` notifications. */
  evals: Pick<PageClient, "evalsPlan" | "evalsStart" | "evalsStop" | "evalsResume" | "evalsList" | "evalsGet" | "evalsApply" | "evalsDelete" | "onEval">;
  /** Opens the macOS folder dialog on the daemon's Mac, in `start` when given. A null path means the person cancelled. */
  chooseFolder(start: string | null): Promise<FsChooseFolderResult>;
  /** Opens a folder in Finder on the daemon's Mac. Only offered when the page is on that Mac. */
  reveal(path: string): Promise<void>;
  /** Starts a session in `cwd` on `model` (null: the default). */
  createSession(cwd: string | null, model: string | null, branch?: { name: string; create: boolean } | null): Promise<string>;
  /** Edits a memory's text, or sets whether it is in every chat or may go to a paid model. The list is read again. */
  updateMemory(id: string, change: { text?: string; always?: boolean; privacy?: MemoryPrivacy }): Promise<void>;
  /** Renames a paired phone. The list is read again. */
  renameDevice(id: string, name: string): Promise<void>;
  /** Cuts a phone off. It resolves with the "Always allow" rules the phone made, which stay. The list is read again. */
  revokeDevice(id: string): Promise<DeviceRevokeResult>;
  /** Deletes a memory. There is no trash. The list is read again. */
  deleteMemory(id: string): Promise<void>;
  /** The memories of a scope as Markdown or JSON text. */
  exportMemories(params: MemoryExportParams): Promise<MemoryExportResult>;
  /** Sets whether a scope's memories may go to a paid model. The list, which carries the settings, is read again. */
  setMemoryPrivacy(scope: MemoryScope, privacy: MemoryPrivacy): Promise<void>;
  /** Sends a message. With `skill`, the daemon fills the skill's body in from `args`. */
  send(sessionId: string, text: string, skill?: { name: string; args: string }): Promise<void>;
  /** Sends `text` again as a new turn on the tier above the last answer. Rejects with the daemon's reason. */
  sendStronger(sessionId: string, text: string): Promise<void>;
  /** Pins a skill for the session, or unpins it. The pinned list arrives as `chat.activeSkills`. */
  pinSkill(sessionId: string, name: string, pin: boolean): Promise<void>;
  /** The `SKILL.md` of the skill `name` that a session in `cwd` sees, with its `mtime_ns`. */
  readSkill(name: string, cwd: string | null): Promise<SkillReadResult>;
  /**
   * Checks a `SKILL.md` and, unless `dryRun`, writes it when the file is still at `baseMtimeNs`. A refusal
   * to write is in the result (`ok: false`). A project skill of an untrusted project rejects.
   */
  writeSkill(params: { path: string; text: string; baseMtimeNs: number; cwd: string | null; dryRun: boolean }): Promise<SkillWriteResult>;
  /** Makes a skill folder with a `SKILL.md`. A project skill of an untrusted project rejects. */
  createSkill(params: { name: string; description: string; scope: "user" | "project"; cwd: string | null; modelInvocable: boolean }): Promise<SkillCreateResult>;
  /** Sets the model wish of an agent type in the folder's list. Resolves to the type as it is now, and puts it in the list the page holds. */
  setAgentWish(name: string, wish: string, cwd: string | null): Promise<AgentInfo>;
  /**
   * Sets and clears limits of the helpers of an agent type (`agents.set_limits`). Resolves to the type as it is now
   * and puts it in the list the page holds. A wrong value rejects with the daemon's words, and nothing is written.
   */
  setAgentLimits(name: string, change: AgentLimitsChange, cwd: string | null): Promise<AgentInfo>;
  /** Saves the text of an agent file: `name` is the agent being edited (it may be renamed), none for a new one. A refused text is in the result (`ok: false`). The list is read again. */
  saveAgent(text: string, name: string | null, cwd: string | null): Promise<AgentsSaveResult>;
  /** Copies a bundled agent to your own. Resolves to the copy; the list is read again. */
  copyAgent(name: string, cwd: string | null): Promise<AgentInfo>;
  /** Deletes your file of an agent. `agent` is what the name means now, or null; the list is read again. */
  deleteAgent(name: string, cwd: string | null): Promise<AgentsDeleteResult>;
  /** Adds or removes a skill in `[skills] disabled` of config.toml. */
  setSkillDisabled(name: string, disabled: boolean): Promise<void>;
  /** Sets the session's permission mode, or with null follows config.toml. The chip changes from `session.mode.changed`. */
  setMode(sessionId: string, mode: PermissionMode | null): Promise<void>;
  /** Puts a session in plan first, or takes it out. */
  setPlan(sessionId: string, on: boolean): Promise<void>;
  /** Says whether golem may run the project's checks after its edits in this session. The panel changes from `session.checks.changed`. */
  setChecks(sessionId: string, on: boolean): Promise<void>;
  /** Sets how the session picks the model of each turn. The chip changes from `session.updated`. */
  setRoute(sessionId: string, mode: RouteMode): Promise<void>;
  /**
   * Saves `[permissions] mode` in config.toml and shows it at once. A refused save puts the old
   * mode back and throws. Resolves with the file written.
   */
  setDefaultMode(mode: PermissionMode): Promise<string>;
  cancel(runId: string): Promise<void>;
  /** Stops one helper's run (`helper.stop`). The lead goes on with `stopped: cancelled` as its result. */
  stopHelper(sessionId: string): Promise<void>;
  /**
   * Clears old tool results, or summarises old turns with `focus` kept, so the next call sends less.
   * The summary can take a minute. Nothing leaves the transcript. Rejects with `SESSION_BUSY` while a run is open.
   */
  compact(sessionId: string, action: CompactAction, focus: string | null): Promise<SessionCompactResult>;
  /** A commit message the session's model suggests for `paths`. */
  suggestCommitMessage(sessionId: string, paths: string[]): Promise<ChangesSuggestMessageResult>;
  /**
   * Commits `paths` with the person's own git, outside the sandbox. It runs only from their action on
   * the commit screen. A git failure resolves with `ok: false` and git's output. Never pushes.
   */
  commit(sessionId: string, paths: string[], message: string): Promise<ChangesCommitResult>;
  /**
   * Puts back what `target` wrote. Without `force`, a file that changed on disk since golem wrote it is
   * left alone and comes back in `conflicts`. The lists refresh from the `file.changed` events. Rejects while a run is active.
   */
  revert(sessionId: string, target: ChangesRevertTarget, force?: boolean): Promise<ChangesRevertResult>;
  /** Sets the title. What the page shows afterwards comes from the daemon's summary. */
  rename(sessionId: string, title: string): Promise<void>;
  /** Forks at a message, or at the last one without `atMessageId`. Resolves with the new session's id. */
  fork(sessionId: string, atMessageId?: string): Promise<string>;
  close(sessionId: string): Promise<void>;
  /** `scope: "batch"` answers for all the helpers of one delegate call; it does not go with `args`. */
  respond(sessionId: string, callId: string, decision: ApprovalChoice, args?: Readonly<Record<string, unknown>>, scope?: "batch"): Promise<void>;
  /** Answers "start these helpers?" (`helpers.respond`) for the `delegate` call `callId`. `run` false tells the model to do the work in the chat. */
  respondHelpers(sessionId: string, callId: string, run: boolean, cheaper?: boolean): Promise<void>;
  /** Takes a worker's diff into the project. Rejects with an `RpcError` of `HELPER_CONFLICT` when a file changed since the worker copied it. */
  applyHelper(sessionId: string, helperId: string): Promise<void>;
  /** Drops a worker's diff. */
  discardHelper(sessionId: string, helperId: string): Promise<void>;
  /** Starts a worker again on a stronger model. */
  retryHelper(sessionId: string, helperId: string): Promise<void>;
  /** Answers the paid step-up question the session's run waits on. The run goes on in its events. */
  answerConsent(sessionId: string, runId: string, answer: ConsentChoice): Promise<void>;
  /** Switches the session's model. The chip changes from the daemon's `model.selected` event. */
  useModel(sessionId: string, name: string): Promise<void>;
  setDefault(name: string): Promise<void>;
  /** Stars the model for the menu, or takes its star away, and reads the listing again. */
  starModel(ref: string, starred: boolean): Promise<void>;
  /** Changes keys of `[ollama]` in `config.toml`. A refusal is in the result (`ok: false`), and nothing is written then. */
  setOllamaSettings(params: OllamaSettingsSetParams): Promise<OllamaSettingsSetResult>;
  /**
   * Changes keys of the routing, budget and context tables in `config.toml`. A refusal is in the result
   * (`ok: false`, with an error for each wrong setting), not a rejection, and nothing is written then.
   */
  setRouting(params: RoutingSetParams): Promise<RoutingSetResult>;
  /**
   * Changes keys of `[chat]` in `config.toml`. A refusal is in the result (`ok: false`, with an
   * error for each wrong setting), not a rejection, and nothing is written then.
   */
  setChat(params: ChatSetParams): Promise<ChatSetResult>;
  /** Golem drafts instruction lines from the person's own words, with `chat.draft`. Nothing is saved. */
  draftChat(description: string): Promise<ChatDraftResult>;
  /** The line is never suggested again, with `chat.suggestion_dismiss`. */
  dismissChatSuggestion(line: string): Promise<ChatSuggestionDismissResult>;
  /**
   * Changes keys of `[notifications]` in `config.toml`. A refusal is in the result (`ok: false`, with an
   * error for each wrong setting), not a rejection, and nothing is written then.
   */
  setNotifications(params: NotificationsSetParams): Promise<NotificationsSetResult>;
  /**
   * Changes how many days a finished helper's steps are kept (`[agents] keep_days`, `keep_problem_days`; 0 is
   * for ever) or the setting `use_helpers`. A refusal is in the result (`ok: false`), not a rejection, and nothing is written then.
   */
  setAgentsKeep(change: { keep_days?: number; keep_problem_days?: number; use_helpers?: UseHelpersValue }): Promise<AgentsKeepResult>;
  /**
   * Sets and clears the limits of `[agents]` that bound every helper (`agents.set_default_limits`). A refusal is in
   * the result (`ok: false`). The agents are read again, since what a type runs with may change.
   */
  setDefaultAgentLimits(change: AgentLimitsChange): Promise<AgentsKeepResult>;
  /** Posts a sample notification (`notify.test`). `posted` is false when nothing could be shown. */
  notifyTest(): Promise<NotifyTestResult>;
  /** A local model's tunable options with its defaults, what is saved for it, and the session's overrides. */
  modelOptions(model: string, sessionId: string | null): Promise<ModelOptionsGetResult>;
  /** Saves options for the model in config.toml. A `null` value removes one. */
  saveModelOptions(model: string, options: Record<string, number | string | null>): Promise<ModelOptionsSetResult>;
  /** Overrides options for one session from its next run. A `null` value removes one. */
  setSessionOptions(sessionId: string, options: Record<string, number | string | null>): Promise<SessionSetOptionsResult>;
  /** What is saved for a model changed, from any client, until the returned function is called. */
  watchSavedOptions(listener: (model: string, saved: Readonly<Record<string, number | string>>) => void): () => void;
  /**
   * Starts a download. With `after`, the page switches that session to the model when the
   * download ends well, even if the dialog that asked is closed by then.
   */
  pull(ref: string, after?: { sessionId: string }): Promise<void>;
  /** Makes `name` the default model when the download of `ref` ends well, even with every dialog closed. */
  defaultWhenPulled(ref: string, name: string): void;
  /** Stops a download. Ollama keeps the bytes for the next try. */
  cancelPull(ref: string): Promise<void>;
  /** Removes the parts a failed download left on disk. */
  cleanupPull(ref: string): Promise<void>;
  /** Dismiss the failure of a download. */
  forgetPull(ref: string): void;
  remove(ref: string): Promise<void>;
  /** Looks for GGUF repos on Hugging Face. Only the query leaves this Mac. */
  searchHf(query: string): Promise<HfSearchResult>;
  /** The sizes of one Hugging Face repo, each with a fit check for this Mac. */
  hfFiles(repo: string): Promise<HfFilesResult>;
  /** Names of the Ollama library that contain the query, with sizes and fit. An empty query lists them all. */
  ollamaLibrary(query: string): Promise<OllamaLibraryResult>;
  /** Sets an existing rule's action. `cwd` goes with a rule of the folder's `.golem/policy.toml` only. */
  updateRule(target: "user" | "project", index: number, action: "allow" | "ask" | "deny", cwd: string | undefined): Promise<void>;
  /** Deletes a rule. `cwd` goes with a rule of the folder's `.golem/policy.toml` only. */
  removeRule(target: "user" | "project", index: number, cwd: string | undefined): Promise<void>;
  /** Drops something the session allows for the rest of the session. */
  revokeAllowance(sessionId: string, tool: string, subject: string | null): Promise<void>;
  /** Starts a server again. `sessionId` is the one whose project the server may belong to. */
  restartMcp(name: string, sessionId: string | null): Promise<void>;
  /** Writes `enabled` into the file that names the server: on for every chat, off everywhere, or on demand. */
  setMcpEnabled(name: string, enabled: boolean | "on_demand", sessionId: string | null): Promise<void>;
  /** Tests a saved server. `onStep` gets each step as it ends. */
  testMcp(name: string, sessionId: string | null, onStep: (step: McpTestProgress) => void): Promise<McpTestResult>;
  /** The server's last log lines, oldest first. */
  mcpLogs(name: string, sessionId: string | null): Promise<McpLogsResult>;
  /** New log lines of any server, until the returned function is called. */
  watchMcpLog(listener: (log: McpServerLog) => void): () => void;
  /** Starts a sign-in to a hosted server and returns the address to open. `watchMcpLogin` says how it ended. */
  loginMcp(name: string, sessionId: string | null): Promise<string>;
  /** Deletes the server's sign-in. The server stops and needs one again. */
  logoutMcp(name: string, sessionId: string | null): Promise<void>;
  /** A sign-in ended, well or not, until the returned function is called. */
  watchMcpLogin(listener: (done: McpLoginDone) => void): () => void;
  /** Runs one tool by hand, by the server's own tool name. No approval, and no session records it. */
  callMcp(name: string, tool: string, args: Record<string, unknown>, sessionId: string | null): Promise<McpCallResult>;
  /**
   * Hides a tool from the model, or shows it again, by writing the server's `tools.exclude`. Rejects
   * with the reason when the tool is hidden by a pattern the page cannot take out.
   */
  setMcpToolHidden(name: string, tool: string, hide: boolean, sessionId: string | null): Promise<void>;
  /** Removes a server from the user's config, with the token it stored. */
  removeMcp(name: string): Promise<void>;
  /** Fires a routine now. Resolves with the run and the headless session it started; its History row arrives with `routine.fired`. */
  runRoutine(name: string, folder: string | null): Promise<RoutineRunResult>;
  /** Looks at a location before it is added. Nothing is saved. Rejects with the daemon's reason. */
  dataInspect(location: string): Promise<DataInspectResult>;
  /** Connects to a Postgres or MySQL database with a password for this one look, and reads its tables. Nothing is saved. Rejects with the daemon's reason. */
  dataInspectDatabase(params: DataInspectParams): Promise<DataInspectResult>;
  /** One page of a table of a source, sorted and filtered across all of it. Rejects with the daemon's reason, such as a column that is not there. */
  dataBrowse(name: string, table: string, view: DataBrowseView, project: string | null): Promise<DataBrowseResult>;
  /** Keeps the whole current view of a table as a result to export: the same filters, search and sort, no paging. The daemon builds the SQL. */
  dataBrowseKeep(name: string, table: string, view: DataBrowseKeepView, project: string | null): Promise<DataBrowseKeepResult>;
  /** One page of a kept query result. Rejects with the daemon's reason, such as a result that is no longer kept. */
  dataResultPage(params: DataResultPageParams): Promise<DataResult>;
  /** Writes a kept result to a new file. The answer has `needs_extension` and no file when the Excel add-on is not here. Rejects with the reason, such as a file that exists. */
  dataExportResult(params: DataExportParams, project?: string | null): Promise<DataExportResult>;
  /** Downloads the Excel or SQLite add-on, once. The sources are read again. Rejects with the reason, such as no network. */
  dataInstallExtension(name: DataExtensionName): Promise<void>;
  /** Adds a source. The list is read again. Rejects with the daemon's reason. */
  dataAdd(params: DataAddParams): Promise<DataSource>;
  /** Changes the privacy or the watch of a source. The list is read again. */
  dataUpdate(params: DataUpdateParams): Promise<DataSource>;
  /** Forgets a source. The list is read again. */
  dataRemove(name: string): Promise<void>;
  /** Saves the notes of a source. Resolves with the file they were saved to. */
  dataNotesSet(name: string, text: string, project: string | null): Promise<string>;
  /** A proposal for the notes of a source. It is not saved. */
  dataNotesDraft(name: string, project: string | null): Promise<string>;
  /** Starts a run of the workflow `id` with `inputs`. Resolves with the workflow run id, which `/runs/:id` opens it by. */
  startWorkflow(id: string, inputs: Record<string, unknown>, model?: string): Promise<string>;
  /** Writes a starter as a workflow file: in `folder` for a starter that reads a project, in the user's folder when `folder` is null. With `routine` it also makes the starter's routine, and the routine list is read again too. The workflow list is read again. Resolves with the result: its `id` is the new workflow's, which `/workflows/:id` opens it by, and `routine_problem` says why the routine was not made. Rejects with the daemon's reason: the folder is not trusted, the file exists. */
  addWorkflowStarter(id: string, folder: string | null, routine?: boolean): Promise<WorkflowAddStarterResult>;
  /** Checks `code` as the file of the workflow `id`, without writing it: the problems with their lines and steps, and the outline of that text. */
  checkWorkflow(id: string, code: string): Promise<WorkflowCheckResult>;
  /** Asks golem for a change to `code`, the file of the workflow `id`: one model call, the answer checked, nothing written. `previous` is the last proposal and its note, for a refine. Rejects with the daemon's reason, such as no model for that folder. */
  proposeWorkflow(id: string, code: string, ask: string, previous?: { code: string; note: string }): Promise<WorkflowProposeResult>;
  /** Sets one argument of one step in `code`: the new text with its outline and problems. Nothing is written. Rejects with the daemon's reason: a code step, an argument the code computes, a value that is not valid. */
  editWorkflowStep(id: string, code: string, stepId: string, name: string, value: string | number | boolean | null): Promise<WorkflowEditStepResult>;
  /** Writes `code` as the file of the workflow `id`. `baseHash` is the `code_hash` the editor started from. Rejects with the daemon's reason: the file changed on disk, the code has errors, the folder is not trusted. */
  saveWorkflow(id: string, code: string, baseHash: string): Promise<WorkflowSaveResult>;
  /** Stops a workflow run. `cancelled` is false when it had ended already. */
  cancelWorkflow(workflowRunId: string): Promise<WorkflowCancelResult>;
  /** The text of output `index` of a run that is a file path the run marked: cut at a limit, `truncated` says so. Rejects with the daemon's reason. */
  readWorkflowOutput(workflowRunId: string, index: number): Promise<WorkflowReadOutputResult>;
  /** Continues a stopped run; the steps that finished are not run again. Resolves with the run as it is then. */
  resumeWorkflow(workflowRunId: string, model?: string): Promise<WorkflowResumeResult>;
  /** Answers the review `key` of a waiting run. `text` is what an edit says. The run continues once none of its reviews waits. */
  answerWorkflowReview(workflowRunId: string, key: string, verdict: ReviewVerdict, text?: string): Promise<void>;
  /** Deletes a user routine from config.toml. */
  removeRoutine(name: string): Promise<void>;
  /** Writes a user routine: merges `fields` into `name` (a null removes a key), or with `create` makes it. Rejects with the daemon's reason. */
  saveRoutine(name: string, fields: Record<string, unknown>, create: boolean): Promise<RoutineInfo>;
  /** The next three times a schedule fires, as ISO times. Rejects with the daemon's reason when the schedule does not parse. */
  previewRoutine(schedule: string): Promise<readonly string[]>;
  /** What is wrong with a workflow routine's workflow and inputs, in words, from `routine.preview`. Empty when nothing is. Rejects with the daemon's reason. */
  checkRoutine(check: RoutinePreviewCheck): Promise<readonly string[]>;
  /** One server's whole config, with secrets as Keychain references, and the file that names it. */
  getMcp(name: string, sessionId: string | null): Promise<McpServerDetail>;
  /** Replaces the server's `[mcp.<name>]`. `secrets` (by reference) are stored first, and only those sent change. */
  updateMcp(name: string, config: McpServerConfig, secrets: Record<string, string>, sessionId: string | null): Promise<void>;
  /**
   * Finds the servers other apps have (with a session, also that project's files), or reads pasted JSON.
   * Reading changes nothing. The scan's secret values stay in the daemon.
   */
  scanMcpImport(sessionId: string | null, text: string | null): Promise<McpImportScanResult>;
  /** Adds the picked candidates of a scan, once. A pick that fails is in `failed`, and the rest are added. */
  applyMcpImport(params: McpImportApplyParams, sessionId: string | null): Promise<McpImportApplyResult>;
  /** The text of `config.toml` (the session's project's with `project`), and its `mtime_ns`. */
  getConfigRaw(project: boolean, sessionId: string | null): Promise<ConfigRawGetResult>;
  /**
   * Checks a new text and, unless `dryRun`, writes it when the file is still at `baseMtimeNs`. The page's write
   * may not change the protected sections. A refusal is in the result (`ok: false`), not a rejection.
   */
  setConfigRaw(
    params: { text: string; baseMtimeNs: number | null; project: boolean; dryRun: boolean },
    sessionId: string | null,
  ): Promise<ConfigRawResult>;
  /** Adds a server to the user's config and starts it. Rejects with the daemon's reason. */
  addMcp(params: McpAddParams): Promise<void>;
  /** Tries a server that is not saved yet, saving nothing. `onStep` gets each step as it ends. */
  testMcpDraft(
    draft: { catalogId: string; inputs: Record<string, string>; secrets: Record<string, string>; name: string } | { config: McpServerConfig; secrets: Record<string, string> },
    sessionId: string | null,
    onStep: (step: McpTestProgress) => void,
  ): Promise<McpTestResult>;
  /**
   * Installs Node or uv with Homebrew, run by the daemon. `onEvent` gets the output and the end, and
   * the subscription ends with it. Resolves false when an install of it was already running.
   */
  installRuntime(name: RuntimeName, onEvent: (event: InstallEvent) => void): Promise<boolean>;
  cancelRuntimeInstall(name: RuntimeName): Promise<void>;
  /** Turns an on-demand server on or off for one session. */
  toggleMcp(sessionId: string, name: string, on: boolean): Promise<void>;
  /** Asks the providers again, past the daemon's cache, puts the answer in the listing, and returns it. */
  refreshModels(showAll?: boolean): Promise<ModelListResult>;
  /** Starts Ollama. True when it answers afterwards. */
  startOllama(): Promise<boolean>;
  /**
   * Installs Ollama with Homebrew, run by the daemon. `onEvent` gets its output and its end, and
   * the subscription ends with it. Resolves "no_brew" when the Mac has no Homebrew, and rejects
   * for any other refusal.
   */
  installOllama(onEvent: (event: InstallEvent) => void): Promise<"started" | "no_brew">;
  /** Stops the install the daemon is running. */
  cancelOllamaInstall(): Promise<void>;
};

/** What each query key fetches. */
export type PageQueries = {
  modelList(showAll?: boolean): Promise<ModelListResult>;
  /** The overview rows, from the same checks as `golem doctor`. */
  setupStatus(): Promise<SetupStatusResult>;
  /** Where each provider's key is kept. Never a key. */
  keys(): Promise<AuthListResult>;
  /** The skills a folder sees. `null` is no folder. */
  skillList(cwd: string | null): Promise<SkillListResult>;
  /** The agent types a folder sees. `null` is no folder. */
  agentList(cwd: string | null): Promise<AgentsListResult>;
  /** One page of a scope's memories, with the counts of every scope and the `[memory]` settings. */
  memoryList(request: MemoryListRequest): Promise<MemoryListResult>;
  /** Every paired phone, revoked ones last. */
  deviceList(): Promise<DeviceListResult>;
  /** The routines, with each one's next and last run. */
  routineList(): Promise<RoutineListResult>;
  /** The workflows of the user and of `folders`, each with its state. */
  workflowList(folders: readonly string[]): Promise<WorkflowListResult>;
  /** The starter workflows golem ships. */
  workflowStarters(): Promise<WorkflowStartersResult>;
  /** One workflow with its outline steps and the text of its file. */
  workflowGet(id: string): Promise<WorkflowGetResult>;
  /** One run of a workflow, with its steps and the reviews that wait. */
  workflowStatus(workflowRunId: string): Promise<WorkflowStatusResult>;
  /** Every data source the person can see, or the news that the daemon does not know `data.list`. */
  dataList(project: string | null): Promise<DataAnswer<DataListResult>>;
  /** One source with its tables and sample. With `table`, that table's sample on its own. */
  dataDescribe(name: string, table: string | null, project: string | null): Promise<DataAnswer<DataDescribeResult>>;
  /** The shape of each column of one table of a source, or the news that the daemon does not know `data.profile`. */
  dataProfile(name: string, table: string, project: string | null): Promise<DataAnswer<DataProfileResult>>;
  /** The notes of a source. */
  dataNotes(name: string, project: string | null): Promise<DataAnswer<DataNotesGetResult>>;
  /** The runs, one per headless session, newest first. With `sessionId`, that session's row alone. */
  runList(sessionId: string | null): Promise<RunListResult>;
  /** One routine and its recent runs, newest first. `folder` is a project routine's project, null a user routine. */
  routineGet(name: string, folder: string | null): Promise<RoutineGetResult>;
  /** The tool rules in check order, and what the session allows. `null` is no folder or no session. */
  config(cwd: string | null, sessionId: string | null): Promise<ConfigGetResult>;
  /** The MCP servers a session sees. `null` is no session. */
  mcpList(sessionId: string | null): Promise<McpListResult>;
  /** One server's tools, with their descriptions. */
  mcpTools(name: string, sessionId: string | null): Promise<McpToolsResult>;
  /** What model calls cost, from `cost.get`. With a session, its own spend is in the result too. */
  cost(sessionId?: string): Promise<CostGetResult>;
  /** The routing, budget and context settings, from `routing.get`. */
  routing(): Promise<RoutingGetResult>;
  /** The `[ollama]` settings, from `ollama.settings.get`. */
  ollamaSettings(): Promise<OllamaSettingsValues>;
  /** The defaults for every new chat, from `chat.get`. */
  chat(): Promise<ChatValues>;
  /** What the model of a new chat reads, from `chat.prompt`. Lines stand in for the saved ones for this answer only. */
  chatPrompt(instructions: readonly string[] | null): Promise<ChatPromptResult>;
  /** Lines suggested from the person's chats and memory, from `chat.suggestions`. */
  chatSuggestions(): Promise<ChatSuggestionsResult>;
  /** The `[notifications]` settings, from `notifications.get`. */
  notifications(): Promise<NotificationsValues>;
  /** How long a finished helper's steps are kept, from `agents.keep`. */
  agentsKeep(): Promise<AgentsKeepValues>;
  /** A session's runs as a tree of spans. */
  trace(sessionId: string): Promise<TraceGetResult>;
  /** The servers golem offers to add, with what each needs here. */
  mcpCatalog(sessionId: string | null): Promise<McpCatalogResult>;
  /** What one span took in and gave out. */
  traceSpan(sessionId: string, spanId: string): Promise<TraceSpanResult>;
  /** `limit` characters of a session's artifact from `offset`. */
  artifact(sessionId: string, artifactId: string, offset: number, limit: number): Promise<ArtifactReadResult>;
  /** The files a session changed, each as its net change. */
  changesList(sessionId: string): Promise<ChangesListResult>;
  /** The diff of one file or of one change of a session. */
  changesDiff(sessionId: string, target: ChangesDiffTarget): Promise<ChangesDiffResult>;
  /** Put back a change, a file, a hunk or a turn. A file changed on disk comes back in `conflicts`. */
  changesRevert(sessionId: string, target: ChangesRevertTarget, force?: boolean): Promise<ChangesRevertResult>;
  /** Whether the session folder is in a git work tree, its branch, and which changed files git sees. */
  changesCommitInfo(sessionId: string): Promise<ChangesCommitInfoResult>;
  /** The start of one text file of the session's folder. */
  readFile(sessionId: string, path: string): Promise<FileReadResult>;
  /** Files of the session's folder whose path holds `query`. */
  listFiles(sessionId: string, query?: string, limit?: number, hidden?: boolean): Promise<FileListResult>;
  /** The folders directly under `path` in the home folder; `null` is home itself. */
  dirs(path: string | null): Promise<FsListDirsResult>;
  /** The repo a folder belongs to: its branch and its worktrees. */
  gitInfo(path: string): Promise<GitInfoResult>;
  /** The local branches of the folder's repo. */
  gitBranches(path: string): Promise<GitBranchesResult>;
  /** Whether the daemon offers the macOS folder dialog to this page. Known once the link is up. */
  localUi(): Promise<boolean>;
};

export type Page = {
  connection: ConnectionStore;
  /** Whether a job keeps the gateway running, read from `/healthz` at start and when the link comes back. */
  pageHost: PageHostStore;
  /** Whether the page can become an app, and the saved install prompt. */
  appInstall: AppInstallStore;
  sessions: Sessions;
  sessionList: SessionList;
  newSession: NewSessionStore;
  drafts: Drafts;
  notes: Notes;
  pulls: Pulls;
  /** The pairing of a phone this page opened, if any. */
  pairing: Pairing;
  setupStart: SetupStart;
  queryClient: QueryClient;
  queries: PageQueries;
  router: Router;
  actions: PageActions;
  /**
   * Use a session: it opens on the first acquire and closes after the last release. The close
   * waits one tick, so a release followed at once by an acquire (React's strict-mode remount)
   * keeps the attachment.
   */
  acquire(id: string): { store: SessionStore; release(): void };
  start(): void;
  stop(): void;
};

export type PageOptions = { pageHost?: PageHostStore; appInstall?: AppInstallStore; frame?: Frame; doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> };

/** Everything the page holds, built on one client. */
export function createPage(client: PageClient, options: PageOptions = {}): Page {
  const connection = createConnectionStore(() => client);
  const pageHost = options.pageHost ?? createPageHost();
  const appInstall = options.appInstall ?? createAppInstall();
  const sessions = createSessions(client, options.frame);
  const sessionList = createSessionList(client);
  const newSession = createNewSession();
  const drafts = createDrafts();
  const notes = createNotes();
  const queryClient = createQueryClient();
  const pulls = createPulls(client, Date.now, () => {
    void queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
    void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
  });
  const pairing = createPairing(client, queryClient);
  const setupStart = createSetupStart();
  const router = createRouter();
  const doc = options.doc ?? document;
  const uses = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> | undefined }>();
  let stopQueries: (() => void) | undefined;
  let stopHost: (() => void) | undefined;
  let started = false;

  function onVisibility(): void {
    if (doc.visibilityState === "visible") {
      client.checkNow();
    }
  }

  return {
    connection,
    pageHost,
    appInstall,
    sessions,
    sessionList,
    newSession,
    drafts,
    notes,
    pulls,
    pairing,
    setupStart,
    queryClient,
    queries: {
      modelList: (showAll = false) => client.listModels(false, showAll),
      setupStatus: () => client.setupStatus(),
      // Only the key-less fields are kept: whatever else a reply carried never reaches the cache or the tree (ADR-028).
      keys: async () => ({
        providers: (await client.listKeys()).providers.map(({ provider, takes_key, needs_key, source, env_var }) => ({ provider, takes_key, needs_key, source, env_var })),
      }),
      skillList: (cwd) => (cwd === null ? client.listSkills() : client.listSkills(cwd)),
      agentList: (cwd) => (cwd === null ? client.listAgents() : client.listAgents(cwd)),
      memoryList: ({ scope, query, after }) =>
        client.listMemories({ scope, limit: MEMORY_PAGE, ...(query === "" ? {} : { query }), ...(after === null ? {} : { after }) }),
      deviceList: () => client.deviceList(),
      routineList: () => client.listRoutines(),
      workflowList: (folders) => client.listWorkflows([...folders]),
      workflowStarters: () => client.listWorkflowStarters(),
      workflowGet: (id) => client.getWorkflow(id),
      workflowStatus: (workflowRunId) => client.workflowStatus(workflowRunId),
      dataList: (project) => dataAnswer(() => (project === null ? client.listData() : client.listData(project))),
      dataDescribe: (name, table, project) => dataAnswer(() => (project !== null ? client.describeData(name, table ?? undefined, project) : table === null ? client.describeData(name) : client.describeData(name, table))),
      dataProfile: (name, table, project) => dataAnswer(() => (project === null ? client.profileData(name, table) : client.profileData(name, table, project))),
      dataNotes: (name, project) => dataAnswer(() => (project === null ? client.getDataNotes(name) : client.getDataNotes(name, project))),
      runList: (sessionId) => (sessionId === null ? client.listRuns() : client.listRuns({ sessionId })),
      routineGet: (name, folder) => (folder === null ? client.getRoutine(name) : client.getRoutine(name, folder)),
      config: (cwd, sessionId) => client.getConfig(cwd ?? undefined, sessionId ?? undefined),
      mcpList: (sessionId) => client.listMcp(sessionId ?? undefined),
      mcpTools: (name, sessionId) => client.mcpTools(name, sessionId ?? undefined),
      cost: (sessionId) => (sessionId === undefined ? client.getCost() : client.getCost(sessionId)),
      routing: () => client.getRouting(),
      ollamaSettings: () => client.getOllamaSettings(),
      chat: () => client.getChat(),
      chatSuggestions: () => client.getChatSuggestions(),
      chatPrompt: (instructions) => client.getChatPrompt(instructions === null ? {} : { instructions: [...instructions] }),
      notifications: () => client.getNotifications(),
      agentsKeep: async () => {
        const result = await client.agentsKeep();
        if (result.values == null) throw new Error("agents.keep gave no values");
        return result.values;
      },
      trace: (sessionId) => client.getTrace(sessionId),
      traceSpan: (sessionId, spanId) => client.getTraceSpan(sessionId, spanId),
      artifact: (sessionId, artifactId, offset, limit) => client.readArtifact(sessionId, artifactId, offset, limit),
      changesList: (sessionId) => client.changesList(sessionId),
      changesDiff: (sessionId, target) => client.changesDiff(sessionId, target),
      changesRevert: (sessionId, target, force) => client.changesRevert(sessionId, target, force),
      changesCommitInfo: (sessionId) => client.changesCommitInfo(sessionId),
      readFile: (sessionId, path) => client.readFile(sessionId, path),
      listFiles: (sessionId, query, limit, hidden) => client.listFiles(sessionId, query, limit, hidden),
      mcpCatalog: (sessionId) => client.mcpCatalog(sessionId ?? undefined),
      dirs: (path) => (path === null ? client.listDirs() : client.listDirs(path)),
      gitInfo: (path) => client.gitInfo(path),
      gitBranches: (path) => client.gitBranches(path),
      localUi: async () => {
        await client.ready;
        return client.localUi;
      },
    },
    router,
    actions: {
      evals: {
        evalsPlan: (arms, models) => client.evalsPlan(arms, models),
        evalsStart: (params) => client.evalsStart(params),
        evalsStop: (id) => client.evalsStop(id),
        evalsResume: (id, allowTight, ownRisk) => (ownRisk === undefined ? client.evalsResume(id, allowTight) : client.evalsResume(id, allowTight, ownRisk)),
        evalsList: () => client.evalsList(),
        evalsGet: (id) => client.evalsGet(id),
        // The numbers are in config.toml now, so what the Rules tab read before is stale.
        evalsApply: async (id) => {
          const result = await client.evalsApply(id);
          if (result.ok) await queryClient.invalidateQueries({ queryKey: AGENTS_KEEP_KEY });
          return result;
        },
        evalsDelete: (id) => client.evalsDelete(id),
        onEval: (listener) => client.onEval(listener),
      },
      chooseFolder: (start) => client.chooseFolder(start),
      reveal: async (path) => {
        await client.reveal(path);
      },
      async createSession(cwd, model, branch) {
        const options: { cwd?: string; modelProfile?: string; branch?: string; createBranch?: boolean } = {};
        if (cwd !== null) options.cwd = cwd;
        if (model !== null) options.modelProfile = model;
        if (branch != null) {
          options.branch = branch.name;
          if (branch.create) options.createBranch = true;
        }
        const created = await client.createSession(Object.keys(options).length === 0 ? undefined : options);
        return created.session_id;
      },
      async send(sessionId, text, skill) {
        if (skill === undefined) await client.sendMessage(sessionId, text);
        else await client.sendMessage(sessionId, text, { skill });
      },
      async sendStronger(sessionId, text) {
        await client.sendMessage(sessionId, text, { stronger: true });
      },
      async renameDevice(id, name) {
        try {
          await client.deviceRename(id, name);
        } finally {
          void queryClient.invalidateQueries({ queryKey: DEVICE_LIST_KEY });
        }
      },
      async revokeDevice(id) {
        try {
          return await client.deviceRevoke(id);
        } finally {
          void queryClient.invalidateQueries({ queryKey: DEVICE_LIST_KEY });
        }
      },
      async updateMemory(id, change) {
        try {
          await client.updateMemory({ id, ...change });
        } finally {
          void queryClient.invalidateQueries({ queryKey: MEMORY_LIST_KEY });
        }
      },
      async deleteMemory(id) {
        try {
          await client.deleteMemories([id]);
        } finally {
          void queryClient.invalidateQueries({ queryKey: MEMORY_LIST_KEY });
        }
      },
      exportMemories: (params) => client.exportMemories(params),
      async setMemoryPrivacy(scope, privacy) {
        try {
          await client.memorySettings({ scope, privacy });
        } finally {
          void queryClient.invalidateQueries({ queryKey: MEMORY_LIST_KEY });
        }
      },
      async pinSkill(sessionId, name, pin) {
        await client.setSkills(sessionId, pin ? { pin: [name] } : { unpin: [name] });
      },
      readSkill: (name, cwd) => (cwd === null ? client.readSkill(name) : client.readSkill(name, cwd)),
      async writeSkill({ path, text, baseMtimeNs, cwd, dryRun }) {
        const result = await client.writeSkill({ path, text, baseMtimeNs, dryRun, ...(cwd === null ? {} : { cwd }) });
        if (result.written) void queryClient.invalidateQueries({ queryKey: SKILL_LIST_KEY });
        return result;
      },
      async createSkill({ name, description, scope, cwd, modelInvocable }) {
        const created = await client.createSkill({ name, description, scope, modelInvocable, ...(cwd === null ? {} : { cwd }) });
        void queryClient.invalidateQueries({ queryKey: SKILL_LIST_KEY });
        return created;
      },
      async setAgentWish(name, wish, cwd) {
        const updated = cwd === null ? await client.setAgentWish(name, wish) : await client.setAgentWish(name, wish, cwd);
        queryClient.setQueryData<AgentsListed>(["agents.list", cwd], (list) =>
          list === undefined ? list : { ...list, agents: list.agents.map((agent) => (agent.name === name && agent.origin === updated.origin ? updated : agent)) },
        );
        return updated;
      },
      async setAgentLimits(name, change, cwd) {
        const updated = cwd === null ? await client.setAgentLimits(name, change) : await client.setAgentLimits(name, change, cwd);
        queryClient.setQueryData<AgentsListed>(["agents.list", cwd], (list) =>
          list === undefined ? list : { ...list, agents: list.agents.map((agent) => (agent.name === name && agent.origin === updated.origin ? updated : agent)) },
        );
        return updated;
      },
      async saveAgent(text, name, cwd) {
        const result = await client.saveAgent(text, name ?? undefined, cwd ?? undefined);
        if (result.ok) await queryClient.invalidateQueries({ queryKey: ["agents.list"] });
        return result;
      },
      async copyAgent(name, cwd) {
        const copy = await client.copyAgent(name, cwd ?? undefined);
        await queryClient.invalidateQueries({ queryKey: ["agents.list"] });
        return copy;
      },
      async deleteAgent(name, cwd) {
        const result = await client.deleteAgent(name, cwd ?? undefined);
        await queryClient.invalidateQueries({ queryKey: ["agents.list"] });
        return result;
      },
      async setSkillDisabled(name, disabled) {
        await client.setSkillDisabled(name, disabled);
        void queryClient.invalidateQueries({ queryKey: SKILL_LIST_KEY });
      },
      async setMode(sessionId, mode) {
        try {
          await client.setSessionMode(sessionId, mode);
        } finally {
          // The rules were built for a mode, so Settings reads them again.
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async setPlan(sessionId, on) {
        await client.setPlan(sessionId, on);
      },
      async setChecks(sessionId, on) {
        await client.setChecks(sessionId, on);
      },
      async suggestCommitMessage(sessionId, paths) {
        return client.changesSuggestMessage(sessionId, paths);
      },
      async commit(sessionId, paths, message) {
        try {
          return await client.changesCommit(sessionId, paths, message);
        } finally {
          await queryClient.invalidateQueries({ queryKey: ["changes.commit_info", sessionId] });
        }
      },
      revert: (sessionId, target, force) => client.changesRevert(sessionId, target, force),
      async setRoute(sessionId, mode) {
        await client.setRoute(sessionId, mode);
      },
      async compact(sessionId, action, focus) {
        return client.compactSession(sessionId, action, focus ?? undefined);
      },
      async setDefaultMode(mode) {
        const before = queryClient.getQueriesData<ConfigGetResult>({ queryKey: CONFIG_KEY });
        queryClient.setQueriesData<ConfigGetResult>({ queryKey: CONFIG_KEY }, (old) =>
          old === undefined ? old : { ...old, default_permission_mode: mode },
        );
        try {
          return (await client.setDefaultPermissionMode(mode)).path;
        } catch (failure) {
          for (const [key, data] of before) queryClient.setQueryData(key, data);
          throw failure;
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
          await queryClient.invalidateQueries({ queryKey: CHAT_KEY });
        }
      },
      async cancel(runId) {
        await client.cancelRun(runId);
      },
      async stopHelper(sessionId) {
        await client.stopHelper(sessionId);
      },
      async rename(sessionId, title) {
        await client.renameSession(sessionId, title);
      },
      async fork(sessionId, atMessageId) {
        const forked = atMessageId === undefined ? await client.forkSession(sessionId) : await client.forkSession(sessionId, atMessageId);
        return forked.session_id;
      },
      async close(sessionId) {
        await client.closeSession(sessionId);
      },
      async respond(sessionId, callId, decision, args, scope) {
        if (scope !== undefined) await client.respondApproval(sessionId, callId, decision, args, scope);
        else if (args === undefined) await client.respondApproval(sessionId, callId, decision);
        else await client.respondApproval(sessionId, callId, decision, args);
      },
      async respondHelpers(sessionId, callId, run, cheaper) {
        if (cheaper === true) await client.respondHelpers(sessionId, callId, run, true);
        else await client.respondHelpers(sessionId, callId, run);
      },
      async applyHelper(sessionId, helperId) {
        await client.applyHelper(sessionId, helperId);
      },
      async discardHelper(sessionId, helperId) {
        await client.discardHelper(sessionId, helperId);
      },
      async retryHelper(sessionId, helperId) {
        await client.retryHelper(sessionId, helperId);
      },
      async answerConsent(sessionId, runId, answer) {
        await client.answerConsent(sessionId, runId, answer);
      },
      async updateRule(target, index, action, cwd) {
        try {
          if (cwd === undefined) await client.updateRule(target, index, action);
          else await client.updateRule(target, index, action, cwd);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async removeRule(target, index, cwd) {
        try {
          if (cwd === undefined) await client.removeRule(target, index);
          else await client.removeRule(target, index, cwd);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async restartMcp(name, sessionId) {
        try {
          await client.restartMcp(name, sessionId ?? undefined);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      async setMcpEnabled(name, enabled, sessionId) {
        try {
          await client.setMcpEnabled(name, enabled, sessionId ?? undefined);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      testMcp: (name, sessionId, onStep) => client.mcpTest({ name, ...(sessionId === null ? {} : { sessionId }) }, onStep),
      mcpLogs: (name, sessionId) => client.mcpLogs(name, sessionId === null ? {} : { sessionId }),
      watchMcpLog: (listener) => client.onMcpLog(listener),
      async loginMcp(name, sessionId) {
        const result = await client.mcpLogin(name, sessionId ?? undefined);
        return result.authorize_url;
      },
      async logoutMcp(name, sessionId) {
        try {
          await client.mcpLogout(name, sessionId ?? undefined);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      watchMcpLogin: (listener) => client.onMcpLoginDone(listener),
      callMcp: (name, tool, args, sessionId) => client.mcpCall({ name, tool, arguments: args, ...(sessionId === null ? {} : { sessionId }) }),
      async setMcpToolHidden(name, tool, hide, sessionId) {
        const detail = await client.mcpGet(name, sessionId ?? undefined);
        const change = hide ? changeToolFilter(detail.config, [tool], []) : changeToolFilter(detail.config, [], [tool]);
        if (!change.ok) throw new Error(change.message);
        try {
          await client.updateMcpServer({ name, config: change.config, ...(sessionId === null ? {} : { session_id: sessionId }) });
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_TOOLS_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      dataInspect: (location) => client.inspectData(location),
      dataInspectDatabase: (params) => client.inspectDatabase(params),
      dataBrowse: (name, table, view, project) => client.browseData({ source: name, table, ...view, ...(project === null ? {} : { project }) }),
      dataBrowseKeep: (name, table, view, project) => client.browseDataKeep({ source: name, table, ...view, ...(project === null ? {} : { project }) }),
      dataResultPage: (params) => client.pageDataResult(params.result_id, params.offset, params.limit),
      dataExportResult: (params, project) => (project == null ? client.exportDataResult(params.result_id, params.path, params.format) : client.exportDataResult(params.result_id, params.path, params.format, undefined, project)),
      async dataInstallExtension(name) {
        try {
          await client.installDataExtension(name);
        } finally {
          await queryClient.invalidateQueries({ queryKey: DATA_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: DATA_DESCRIBE_KEY });
        }
      },
      async dataAdd(params) {
        try {
          return (await client.addData(params)).source;
        } finally {
          await queryClient.invalidateQueries({ queryKey: DATA_LIST_KEY });
        }
      },
      async dataUpdate(params) {
        try {
          return (await client.updateData(params)).source;
        } finally {
          await queryClient.invalidateQueries({ queryKey: DATA_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: [...DATA_DESCRIBE_KEY, params.name] });
        }
      },
      async dataRemove(name) {
        try {
          await client.removeData(name);
        } finally {
          await queryClient.invalidateQueries({ queryKey: DATA_LIST_KEY });
        }
      },
      async dataNotesSet(name, text, project) {
        const saved = await (project === null ? client.setDataNotes(name, text) : client.setDataNotes(name, text, project));
        await queryClient.invalidateQueries({ queryKey: [...DATA_NOTES_KEY, name] });
        return saved.path;
      },
      dataNotesDraft: async (name, project) => (await (project === null ? client.draftDataNotes(name) : client.draftDataNotes(name, project))).text,
      async startWorkflow(id, inputs, model) {
        const started = await (model === undefined ? client.startWorkflow(id, inputs) : client.startWorkflow(id, inputs, model));
        void queryClient.invalidateQueries({ queryKey: RUN_LIST_KEY });
        return started.workflow_run_id;
      },
      async addWorkflowStarter(id, folder, routine = false) {
        try {
          return await (routine ? client.addWorkflowStarter(id, folder ?? undefined, true) : folder === null ? client.addWorkflowStarter(id) : client.addWorkflowStarter(id, folder));
        } finally {
          await queryClient.invalidateQueries({ queryKey: WORKFLOW_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: ROUTINE_LIST_KEY });
        }
      },
      checkWorkflow: (id, code) => client.checkWorkflow(id, code),
      proposeWorkflow: (id, code, ask, previous) => client.proposeWorkflow(id, code, ask, previous),
      editWorkflowStep: (id, code, stepId, name, value) => client.editWorkflowStep(id, code, stepId, name, value),
      async saveWorkflow(id, code, baseHash) {
        const saved = await client.saveWorkflow(id, code, baseHash);
        void queryClient.invalidateQueries({ queryKey: workflowGetKey(id) });
        void queryClient.invalidateQueries({ queryKey: WORKFLOW_LIST_KEY });
        return saved;
      },
      async runRoutine(name, folder) {
        try {
          return await (folder === null ? client.runRoutine(name) : client.runRoutine(name, folder));
        } finally {
          await queryClient.invalidateQueries({ queryKey: ROUTINE_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: ROUTINE_GET_KEY });
        }
      },
      async cancelWorkflow(workflowRunId) {
        try {
          return await client.cancelWorkflow(workflowRunId);
        } finally {
          await queryClient.invalidateQueries({ queryKey: WORKFLOW_STATUS_KEY });
          await queryClient.invalidateQueries({ queryKey: RUN_LIST_KEY });
        }
      },
      readWorkflowOutput: (workflowRunId, index) => client.readWorkflowOutput(workflowRunId, index),
      async resumeWorkflow(workflowRunId, model) {
        try {
          return await (model === undefined ? client.resumeWorkflow(workflowRunId) : client.resumeWorkflow(workflowRunId, model));
        } finally {
          await queryClient.invalidateQueries({ queryKey: WORKFLOW_STATUS_KEY });
          await queryClient.invalidateQueries({ queryKey: RUN_LIST_KEY });
        }
      },
      async answerWorkflowReview(workflowRunId, key, verdict, text) {
        try {
          await client.answerWorkflowReview(workflowRunId, key, verdict, text);
        } finally {
          await queryClient.invalidateQueries({ queryKey: WORKFLOW_STATUS_KEY });
          await queryClient.invalidateQueries({ queryKey: RUN_LIST_KEY });
        }
      },
      async saveRoutine(name, fields, create) {
        try {
          return (await client.updateRoutine(name, fields, { create })).routine;
        } finally {
          await queryClient.invalidateQueries({ queryKey: ROUTINE_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: ROUTINE_GET_KEY });
        }
      },
      async checkRoutine(check) {
        return (await client.previewRoutine(null, check)).problems ?? [];
      },
      async previewRoutine(schedule) {
        return (await client.previewRoutine(schedule)).next;
      },
      async removeRoutine(name) {
        try {
          await client.removeRoutine(name);
        } finally {
          await queryClient.invalidateQueries({ queryKey: ROUTINE_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: ROUTINE_GET_KEY });
        }
      },
      async removeMcp(name) {
        try {
          await client.removeMcpServer(name);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        }
      },
      getMcp: (name, sessionId) => client.mcpGet(name, sessionId ?? undefined),
      async updateMcp(name, config, secrets, sessionId) {
        try {
          await client.updateMcpServer({
            name,
            config,
            ...(Object.keys(secrets).length === 0 ? {} : { secrets }),
            ...(sessionId === null ? {} : { session_id: sessionId }),
          });
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_TOOLS_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_GET_KEY });
        }
      },
      scanMcpImport: (sessionId, text) => client.scanMcpImport({ ...(sessionId === null ? {} : { sessionId }), ...(text === null ? {} : { text }) }),
      async applyMcpImport(params, sessionId) {
        try {
          return await client.applyMcpImport({ ...params, ...(sessionId === null ? {} : { session_id: sessionId }) });
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        }
      },
      getConfigRaw: (project, sessionId) => client.configRawGet({ scope: project ? "project" : "user", ...(sessionId === null ? {} : { sessionId }) }),
      async setConfigRaw(params, sessionId) {
        const result = await client.configRawSet({
          text: params.text,
          baseMtimeNs: params.baseMtimeNs,
          scope: params.project ? "project" : "user",
          dryRun: params.dryRun,
          ...(sessionId === null ? {} : { sessionId }),
        });
        if (!params.dryRun && result.ok) {
          // The file may have changed servers, the catalog's "added", and the rules.
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
        return result;
      },
      async addMcp(params) {
        try {
          await client.addMcpServer(params);
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
          await queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        }
      },
      testMcpDraft: (draft, sessionId, onStep) => {
        const session = sessionId === null ? {} : { sessionId };
        return client.mcpTest(
          "catalogId" in draft
            ? { catalogId: draft.catalogId, inputs: draft.inputs, secrets: draft.secrets, name: draft.name, ...session }
            : { config: draft.config, secrets: draft.secrets, ...session },
          onStep,
        );
      },
      async installRuntime(name, onEvent) {
        let off: (() => void) | null = null;
        const end = (): void => {
          off?.();
          off = null;
        };
        off = client.onRuntimeInstall((update) => {
          if (update.kind === "output") {
            if (update.name === name) onEvent({ kind: "output", text: update.text });
            return;
          }
          if (update.done.name !== name) return;
          end();
          onEvent(
            update.done.ok
              ? { kind: "exit", code: 0, stopped: false }
              : update.done.error == null
                ? { kind: "exit", code: null, stopped: true }
                : { kind: "error", message: update.done.error },
          );
          void queryClient.invalidateQueries({ queryKey: MCP_CATALOG_KEY });
        });
        try {
          const result = await client.installRuntime(name);
          if (!result.started) end();
          return result.started;
        } catch (failure) {
          end();
          throw failure;
        }
      },
      async cancelRuntimeInstall(name) {
        await client.cancelRuntimeInstall(name);
      },
      async toggleMcp(sessionId, name, on) {
        try {
          await (on ? client.enableMcp(sessionId, name) : client.disableMcp(sessionId, name));
        } finally {
          await queryClient.invalidateQueries({ queryKey: MCP_LIST_KEY });
        }
      },
      async revokeAllowance(sessionId, tool, subject) {
        try {
          await client.revokeAllowance(sessionId, tool, subject);
        } finally {
          await queryClient.invalidateQueries({ queryKey: CONFIG_KEY });
        }
      },
      async setRouting(params) {
        const result = await client.setRouting(params);
        if (result.ok) {
          // A new price limit moves models between tiers.
          await queryClient.invalidateQueries({ queryKey: ROUTING_KEY });
          await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
        }
        return result;
      },
      async setChat(params) {
        const result = await client.setChat(params);
        if (result.ok) {
          await queryClient.invalidateQueries({ queryKey: CHAT_KEY });
          await queryClient.invalidateQueries({ queryKey: PROMPT_KEY });
        }
        return result;
      },
      draftChat: (description) => client.draftChat(description),
      async dismissChatSuggestion(line) {
        const result = await client.dismissChatSuggestion(line);
        await queryClient.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
        return result;
      },
      async setNotifications(params) {
        const result = await client.setNotifications(params);
        if (result.ok) await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
        return result;
      },
      async setAgentsKeep(change) {
        const result = await client.agentsKeep(change);
        if (result.ok) await queryClient.invalidateQueries({ queryKey: AGENTS_KEEP_KEY });
        return result;
      },
      async setDefaultAgentLimits(change) {
        const result = await client.setDefaultAgentLimits(change);
        if (result.ok) {
          await queryClient.invalidateQueries({ queryKey: AGENTS_KEEP_KEY });
          await queryClient.invalidateQueries({ queryKey: ["agents.list"] });
        }
        return result;
      },
      notifyTest: () => client.notifyTest(),
      async modelOptions(model, sessionId) {
        return client.getModelOptions(model, sessionId ?? undefined);
      },
      async saveModelOptions(model, options) {
        return client.setModelOptions(model, options);
      },
      async setSessionOptions(sessionId, options) {
        return client.setSessionOptions(sessionId, options);
      },
      watchSavedOptions(listener) {
        return client.onOptionsSaved(({ model, saved }) => listener(model, saved));
      },
      async useModel(sessionId, name) {
        await client.setSessionModel(sessionId, name);
      },
      async setDefault(name) {
        await client.setDefaultModel(name);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
        await queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
      },
      async starModel(ref, starred) {
        await client.starModel(ref, starred);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
      },
      async setOllamaSettings(params) {
        const result = await client.setOllamaSettings(params);
        if (result.ok) await queryClient.invalidateQueries({ queryKey: OLLAMA_SETTINGS_KEY });
        return result;
      },
      async pull(ref, after) {
        pulls.begin(ref);
        if (after !== undefined) pulls.switchWhenDone(ref, after.sessionId);
        try {
          await client.pullModel(ref);
        } catch (error) {
          pulls.abort(ref);
          throw error;
        }
      },
      defaultWhenPulled(ref, name) {
        pulls.defaultWhenDone(ref, name);
      },
      forgetPull(ref) {
        pulls.forget(ref);
      },
      async cancelPull(ref) {
        pulls.forget(ref);
        await client.cancelPull(ref);
      },
      async cleanupPull(ref) {
        await client.cleanupPull(ref);
        pulls.cleaned(ref);
      },
      searchHf(query) {
        return client.searchHf(query);
      },
      hfFiles(repo) {
        return client.hfFiles(repo);
      },
      ollamaLibrary(query) {
        return client.ollamaLibrary(query);
      },
      async remove(ref) {
        await client.deleteModel(ref);
        await queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
      },
      async refreshModels(showAll = false) {
        const listing = await client.listModels(true, showAll);
        queryClient.setQueryData(showAll ? MODEL_LIST_ALL_KEY : MODEL_LIST_KEY, listing);
        void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
        return listing;
      },
      async startOllama() {
        const { running } = await client.startOllama();
        void queryClient.invalidateQueries({ queryKey: MODEL_LIST_KEY });
        void queryClient.invalidateQueries({ queryKey: SETUP_STATUS_KEY });
        return running;
      },
      async installOllama(onEvent) {
        const off = client.onOllamaInstall((update) => {
          const event = installEventOf(update);
          if (event.kind !== "output") off();
          onEvent(event);
        });
        try {
          await client.installOllama();
          return "started";
        } catch (error) {
          off();
          if (error instanceof RpcError && error.code === OLLAMA_FAILED && error.data?.["no_brew"] === true) return "no_brew";
          throw error;
        }
      },
      async cancelOllamaInstall() {
        await client.cancelOllamaInstall();
      },
    },
    acquire(id) {
      const use = uses.get(id) ?? { count: 0, timer: undefined };
      uses.set(id, use);
      clearTimeout(use.timer);
      use.timer = undefined;
      use.count += 1;
      const store = sessions.open(id);
      let released = false;
      return {
        store,
        release() {
          if (released) {
            return;
          }
          released = true;
          use.count -= 1;
          if (use.count > 0) {
            return;
          }
          use.timer = setTimeout(() => {
            use.timer = undefined;
            if (use.count === 0 && uses.get(id) === use) {
              uses.delete(id);
              sessions.close(id);
            }
          }, 0);
        },
      };
    },
    start() {
      if (started) {
        return;
      }
      started = true;
      connection.start();
      void pageHost.refresh();
      let linked = false;
      stopHost = connection.subscribe(() => {
        const up = connection.getSnapshot().state.status === "connected";
        if (up && !linked) {
          void pageHost.refresh();
        }
        linked = up;
      });
      sessionList.start();
      pulls.start();
      pairing.start();
      stopQueries = keepQueriesHonest(client, queryClient);
      doc.addEventListener("visibilitychange", onVisibility);
    },
    stop() {
      started = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      stopQueries?.();
      stopQueries = undefined;
      stopHost?.();
      stopHost = undefined;
      sessionList.stop();
      pulls.stop();
      pairing.stop();
      sessions.stop();
      router.stop();
      queryClient.clear();
      connection.stop();
    },
  };
}
