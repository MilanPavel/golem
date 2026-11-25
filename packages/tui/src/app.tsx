import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useStdin, useWindowSize } from "ink";
import {
  MODEL_NOT_CONFIGURED,
  KEY_UNCHECKED,
  OLLAMA_FAILED,
  RpcError,
  SESSION_NOT_FOUND,
  type AgentsKeepValues,
  type ApprovalChoice,
  type ChatEvent,
  type ChangesRevertTarget,
  type ConfigGetResult,
  type ConfigRouting,
  type ConnectionState,
  type GolemClient,
  type ListedModel,
  type McpAddParams,
  type ModelListResult,
  type RoutineRunSummary,
  type SetupRow,
  type SkillCall,
  type WireLine,
  GOLEM_VERSION,
} from "@golem/client";

import {
  createDeltaBatcher,
  CANCELLED_NOTICE,
  downloadEnded,
  emptyChat,
  forkPoint,
  stopWriting,
  writingLabel,
  NO_MODEL_NOTICE,
  noModelChosen,
  advance,
  appendInstallOutput,
  agentInstalled,
  askService,
  engineLines,
  engineSelected,
  guided,
  move,
  OVERVIEW,
  overviewChoices,
  overviewLines,
  pressEngine,
  pressService,
  providerName,
  QUIT_CHOICES,
  quitLines,
  readyLines,
  RUNNING_PAUSE_MS,
  serviceAnswered,
  serviceFailed,
  serviceLines,
  serviceRow,
  serviceTimedOut,
  setupAtStart,
  setupBand,
  single,
  toolsAdded,
  toolsSignInUrl,
  toolsSigningIn,
  toolsFailed,
  toolsOffer,
  toolsRuntimeDone,
  toolsRuntimeOutput,
  toolsStep,
  TOOLS_SKIP,
  type ToolsRuntime,
  type ToolsState,
  welcomeBack,
  withLog,
  hostedProvider,
  keyChecked,
  keychainLines,
  keychainNotice,
  keyLines,
  openKey,
  pressKey as pressKeyPanel,
  pressProvider,
  providerLines,
  providerSelected,
  type KeyInput,
  type KeyState,
  defaultGone,
  modelChoices,
  modelLines,
  modelPullFailed,
  modelSelected,
  OLLAMA_DOWNLOAD_URL,
  ollamaAtOpen,
  ollamaInstallEnded,
  ollamaLines,
  pressModel,
  pressOllama,
  pullBand,
  START_MODEL_PANEL,
  startPull as startPullTrack,
  trackPull,
  warmingLine,
  type ModelPanelState,
  type ModelScope,
  type OllamaState,
  type PullTrack,
  NO_MODEL_BAND,
  type ServiceRunner,
  type ServiceState,
  type InstallTail,
  type SetupFacts,
  type SetupLine,
  type SetupNext,
  type SetupStart,
  type SetupWindow,
  providersUp,
  reduceChat,
  reduceChanges,
  changedPaths,
  noChanges,
  type ChangesState,
  addNote,
  dropNotes,
  noNotes,
  notesChip,
  notesNotice,
  NOTES_CLEARED,
  removeNote,
  takeNotes,
  type NotesState,
  unreadCallNotice,
  RETRY_QUESTION,
  serverUp,
  todoRows,
  type ChatState,
  type DeltaBatcher,
  serviceProblem,
  type ServiceProblem,
  pressStarter,
  starterLines,
  starterPrompts,
  tipAt,
  startersShown,
  type StarterKey,
  type StarterPick,
  changeToolFilter,
  formatLogLine,
  loginDoneText,
  formatTestResult,
  formatTestStep,
  latestModelSpan,
  type ContextAction,
  type ContextReport,
  tuneState,
  tuneChip,
  effectiveMode,
  BUILD_TEXT,
  checksChanged,
  localOnlyLabel,
  modeChanged,
  PLAN_KEYS,
  planChanged,
  modeReport,
  nextMode,
  type PermissionMode,
  type RouteMode,
  withSaved,
  withSession,
  type TuneState,
  foldTry,
  planTry,
  runningTry,
  startedTry,
  tryHeading,
  sessionCostLabel,
  costReportLines,
  routeRows,
  routeReportLines,
  routeStatus,
  shownModel,
  shownModelText,
  canTryStronger,
  lastQuestion,
  NO_STRONGER_NOTICE,
  sessionModelOf,
  isLocalFrom,
  spendRows,
  turnRoutedNote,
  whyLines,
  wishSetup,
  type ChatMessage,
  tryTitle,
  loadingLine,
  type TryRun,
  isUseHelpersQuestion,
  consentShowable,
  reviewItemsOf,
  workerBlocks,
} from "@golem/view";
import { compactWaiting, runCompact } from "./compact.ts";
import { contextKeyLine, contextRowForPress, readContextActions } from "./context-actions.ts";
import { dropTry, startTry, tryLines } from "./try-again.ts";
import { pressTune, tuneKeyOf, tuneLines, tuneLitLines, tuneMemorySpans, tuneOpening, type TuneAction } from "./tune-panel.ts";
import { folderFacts } from "./folder-facts.ts";
import {
  applyComposer,
  invocableSkills,
  committedLine,
  pinnableSkills,
  closedDebug,
  COMMANDS,
  contextSegments,
  fitLine,
  helpLines,
  toggleDebugTab,
  withModelChoices,
  withTuneChoices,
  withSkillChoices,
  type DebugState,
} from "./commands.ts";
import {
  afterInstall,
  closedPicker,
  confirmFor,
  layoutPicker,
  modelNames,
  openPicker,
  pickerHint,
  pickerKeyOf,
  pickerName,
  pressPicker,
  unusableReason,
  withPulls,
  type PickerState,
  type PullState,
} from "./model-picker.ts";
import { ModelPickerView } from "./model-picker.tsx";
import { setupHint, setupKeyOf, type SetupKey, type SetupScreen } from "./setup-frame.ts";
import {
  newToolsUi,
  pressTools,
  toolsKeyOf,
  toolsRan,
  toolsReadyText,
  toolsTyping,
  toolsView,
  type ToolsAct,
  type ToolsUi,
} from "./setup-frame-tools.ts";
import { SetupFrame } from "./setup-frame.tsx";
import { draftAt, edit, editDraft, editFile, insertText, type Draft } from "./edit.ts";
import { collapsePaste, deleteToken, expandPastes, noPastes, type Pastes } from "./paste.ts";
import {
  browseHistory,
  createHistory,
  historyPath,
  leaveHistory,
  recallOrder,
  sessionEntries,
  type HistoryCursor,
} from "./history.ts";
import {
  applySuggestion,
  moveSuggestion,
  suggest,
  suggestionWindow,
  type Suggestion,
} from "./suggest.ts";
import { frameBudget, frameColumns, layoutComposer, moveRow } from "./chrome.ts";
import { peekTip, takeTip, tipCounterPath } from "./tip-counter.ts";
import { planOffered as planOfferedAt } from "./plan-offer.ts";
import { pruneDismissed, runsSignal, runsWaitingLabel } from "./runs-signal.ts";
import { bannerRow, EXPORT_HINT_MS, hintFor, liveHint, type BannerRow, type Hint } from "./hint.ts";
import { holdDebugOffset, layoutDebug, type CheckpointMessage, type DebugTone } from "./debug-view.ts";
import { Header } from "./header.tsx";
import { EXIT_HINT, EXIT_WINDOW_MS, idleInterrupt, pressCtrlC } from "./interrupt.ts";
import {
  classifyPress,
  isF1,
  KEYS,
  keyOverlayLines,
  moveOverlayOffset,
  pressKey,
  type ArgsKey,
  type HelperAskAnswer,
  type KeyEffect,
  type KeyPlace,
  type Press,
  type OverlayLine,
} from "./keys.ts";
import { layoutTranscript, type LayoutLine } from "./layout-chat.ts";
import { DEFAULT_PREFS, loadPrefs, prefsPath, savePref } from "./prefs.ts";
import { ChecksBand } from "./checks-band.tsx";
import { TodoBand } from "./todo-band.tsx";
import { InstallBand } from "./install-band.tsx";
import { RESTARTING, type ServiceControl, type WindowDaemon } from "./service.ts";
import { installEventOf, type InstallState, installRows, reduceInstall, startedInstall } from "./ollama-install.ts";
import { APPROVAL_ROWS, approvalRows, diffLineCount } from "./approval.ts";
import { ApprovalBand } from "./approval-band.tsx";
import { UndoBand } from "./undo-band.tsx";
import {
  foldPrompts,
  NOTHING_TO_UNDO,
  nextUndo,
  noPrompts,
  openUndo,
  pressUndo,
  undoAnswered,
  undoKeyOf,
  undoRows,
  WAIT_FOR_GOLEM,
  type Prompts,
  type UndoBand as UndoBandState,
} from "./undo.ts";
import { ConsentBand } from "./consent-band.tsx";
import { consentRows, type ConsentDiff, type ConsentShow } from "./consent.ts";

/** How many characters of a helper's diff the band reads; it shows the first lines. */
const BRIEF_DIFF_CHARS = 4_000;
import { HelperAskBand } from "./helper-ask-band.tsx";
import {
  helperAskAnswer,
  helperAskLines,
  helperAskRows,
  helperDock,
  isHelperApproval,
  isHelperConsent,
  nextAskKey,
  pagerText,
} from "./helper-ask.ts";
import { useHelperConsent } from "./use-helper-consent.ts";
import { useMeasure } from "./use-measure.ts";
import { layoutMeasure } from "./measure-manager.ts";
import {
  ARGS_EDIT_ROWS,
  type ArgsEdit,
  editedArgs,
  liveArgsEdit,
  parseArgs,
  startArgsEdit,
} from "./approval-edit.ts";
import {
  liveReviewEdit,
  REVIEW_EDIT_ROWS,
  openReviewEdit,
  submitReviewAnswer,
  reviewEditLines,
  reviewLines,
  reviewPager,
  reviewRows,
  startReviewEdit,
  type ReviewEdit,
  type ReviewVerdict,
} from "./review.ts";
import { moveDiffOffset } from "./diff-view.ts";
import { newestArtifact, showInPager } from "./pager.ts";
import {
  closedPermissions,
  layoutPermissions,
  openPermissions,
  permissionsKeyOf,
  pressPermissions,
  type PermissionsState,
} from "./permissions.ts";
import { applyServerStatus, type ServerStates, serverFailedNotice, startingServer } from "./local-servers.ts";
import { type McpList, mcpAlert, mergeMcp } from "./mcp.ts";
import {
  closedMcpManager,
  layoutMcpManager,
  type McpManagerLine,
  mcpAdded,
  mcpAddFailed,
  mcpCallDone,
  mcpCatalogLoaded,
  mcpLoginDone,
  mcpLoginUrl,
  mcpLogsAppended,
  mcpLogsLoaded,
  mcpManagerKeyOf,
  mcpManagerTyping,
  mcpTestDone,
  mcpTestStep,
  type McpManagerAction,
  type McpManagerState,
  type McpTone,
  openMcpAdd,
  openMcpManager,
  pressMcpManager,
} from "./mcp-manager.ts";
import {
  changesKeyOf,
  closedChangesManager,
  layoutChanges,
  openChangesManager,
  pressChanges,
  pressNoteInput,
  type ChangesAction,
  type ChangesData,
  type ChangesLine,
  type ChangesManagerState,
} from "./changes-manager.ts";
import { emptyWorkerPane, pressWorker, runWorkerCall, workerDone, workerKeyOf, type WorkerCall } from "./worker-changes.ts";
import {
  commitErrored,
  commitKeyOf,
  commitRefused,
  openCommitBand,
  pressCommit,
  suggestionArrived,
  suggestionFailed,
  type CommitAction,
  type CommitBand,
} from "./commit-band.ts";
import {
  agentEditProblems,
  agentListFailed,
  agentsFocused,
  agentsManagerKeyOf,
  agentsNoticed,
  agentsWithSaved,
  agentWishFailed,
  closedAgentsManager,
  layoutAgentsManager,
  openAgentsManager,
  pressAgentsManager,
  useHelpersFailed,
  type AgentList,
  type AgentsManagerAction,
  type AgentsManagerState,
} from "./agents-manager.ts";
import {
  closedSkillsManager,
  layoutSkillsManager,
  openNewSkill,
  openSkillsManager,
  pressSkillsManager,
  showSkillDetail,
  skillCreateFailed,
  type SkillList,
  type SkillsManagerAction,
  skillsManagerKeyOf,
  skillsManagerTyping,
  type SkillsManagerState,
} from "./skills-manager.ts";
import {
  closedRoutinesManager,
  layoutRoutinesManager,
  openRoutinesManager,
  pressRoutinesManager,
  routineLineOf,
  routinesManagerKeyOf,
  type RoutineList,
  type RoutinesManagerAction,
  type RoutinesManagerState,
} from "./routines-manager.ts";
import {
  closedRunsManager,
  layoutRunsManager,
  openRunsManager,
  pressRunsManager,
  runsManagerKeyOf,
  type RunList,
  type RunsManagerState,
} from "./runs-manager.ts";
import {
  closedMemoryManager,
  emptyMemoryList,
  layoutMemoryManager,
  memoryEdited,
  memoryListParams,
  memoryManagerKeyOf,
  memoryManagerTyping,
  type MemoryList,
  type MemoryManagerAction,
  type MemoryManagerState,
  openMemoryManager,
  pressMemoryManager,
  projectFolderOf,
  withMemoryMessage,
} from "./memory-manager.ts";
import { MemoryManagerView } from "./memory-manager.tsx";
import { StepsManagerView } from "./helper-chat.tsx";
import {
  batchOrder,
  chatScrollMax,
  closedStepsManager,
  layoutStepsManager,
  openStepsManager,
  pressStepsManager,
  stepsHelpers,
  trimmedAtOf,
  stepsKeyOf,
  type HelperChatData,
  type StepsAction,
  type StepsContext,
  type StepsManagerState,
} from "./steps-view.ts";
import { assistantChars, elapsedSeconds, meterLine, meterPhase, writingNow } from "./progress.ts";
import {
  alertLabel,
  fitSegments,
  modelChip,
  preferModel,
  shortCwd,
  shownSessionTitle,
  startedAtMs,
  helpersLabel,
  statusLabel,
  statusSegments,
  uptimeRefreshMs,
  upgradeBanner,
  versionLabel,
  type ModelInfo,
  type StatusSegment,
} from "./status-label.ts";
import {
  applyProgress,
  applyTabStatus,
  applyWindowTitle,
  TAB_STATUS_ON,
  tabProgress,
  tabState,
  windowTitle,
} from "./window-title.ts";
import { nextOffset, WHEEL_LINES, type PointerSubscribe, type WheelSubscribe } from "./screen.ts";
import {
  dragTo,
  isClick,
  markSpans,
  pointAt,
  selectedColumns,
  selectedText,
  type ChatView,
  type Selection,
} from "./selection.ts";
import {
  closedSwitcher,
  layoutSwitcher,
  NO_SESSIONS,
  openSwitcher,
  pressSwitcher,
  switcherHint,
  type SwitcherKey,
  type SwitcherState,
} from "./switcher.ts";
import { SwitcherView } from "./switcher.tsx";
import {
  CLAY,
  COMPOSER_RULE,
  DIFF_ADD,
  DIFF_ADD_BG,
  DIFF_DEL,
  DIFF_DEL_BG,
  DIFF_HUNK,
  HINT,
  PLACEHOLDER,
  QUESTION_BG,
  QUESTION_FG,
} from "./theme.ts";
import { copiedHint, copyText } from "./clipboard.ts";
import { openUrl } from "./open-url.ts";
import {
  copyAnswer,
  copyCode,
  exportDestination,
  followTail,
  sessionMarkdown,
  writeExport,
  type TailAnchor,
} from "./transcript.ts";
import { useSessionIndex } from "./use-session-index.ts";
import { useSession } from "./use-session.ts";

/** `resend` is the failed message to send again once Ollama and the model are there. */
type Install = { state: InstallState; ref: string; setDefault: boolean; resend: string | null };

/**
 * The setup window as this screen holds it: where it is, and each panel's own state.
 */
type SetupUi = {
  window: SetupWindow;
  service: ServiceState;
  engine: number;
  /** Which picker the Engine, the overview, or the start asked for. */
  path: "local" | "key" | "pick";
  overview: { selected: number; rows: SetupRow[] | null; notice: string | null };
  /** The Quit setup? question, with its selection, or null. */
  quit: number | null;
  ollama: OllamaState;
  model: ModelPanelState;
  /** The Provider panel's selection, and the provider the Key panel is for. */
  provider: number;
  hosted: string | null;
  key: KeyState;
  /** Which models the Model panel offers: this Mac's, every engine's, or with the gone default first. */
  scope: ModelScope;
  ready: { engine: string; model: string } | null;
  /** The Tools panel: the offer, the token being typed, and the run. */
  tools: ToolsUi;
  /** The titles of the servers Tools added, for the Ready panel. */
  toolsRan: string[];
};


export function App({
  client,
  onWheel,
  onPointer,
  service,
  sessionId: firstSession,
}: {
  client: GolemClient;
  onWheel?: WheelSubscribe;
  onPointer?: PointerSubscribe;
  service?: ServiceControl;
  /** Follow this session at start, in place of the newest one in the folder (`golem open <id>`). */
  sessionId?: string;
}) {
  const [connection, setConnection] = useState<ConnectionState>(client.state);
  const [problem, setProblem] = useState<ServiceProblem | null>(null);
  const [restarting, setRestarting] = useState(false);
  const problemRef = useRef(problem);
  problemRef.current = problem;
  const restartingRef = useRef(restarting);
  const upgradeRef = useRef<string | null>(null);
  restartingRef.current = restarting;
  useEffect(() => {
    if (service === undefined) {
      return;
    }
    // Each reconnect attempt is a new state, so the file is read again each time.
    const next = serviceProblem(connection, service.startError(), service.installed());
    setProblem(next !== null && service.restart === null ? { ...next, restart: false } : next);
    if (connection.status === "connected") {
      setRestarting(false);
    }
  }, [connection, service]);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [changesState, setChangesState] = useState<ChangesState>(noChanges);
  const [hint, setHint] = useState<Hint | null>(null);
  useEffect(() => {
    if (hint === null) {
      return;
    }
    const timer = setTimeout(
      () => setHint((current) => (current === hint ? null : current)),
      Math.max(0, hint.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [hint]);
  const [draft, setDraft] = useState<Draft>({ text: "", cursor: 0 });
  /** The starter prompt Down moved to, under an empty chat. */
  const [starterPick, setStarterPick] = useState<StarterPick>(null);
  const starterPickRef = useRef(starterPick);
  starterPickRef.current = starterPick;
  const [sessionModel, setSessionModel] = useState<ModelInfo | null>(null);
  const [servers, setServers] = useState<ServerStates>({});
  /** Secrets whose Keychain read waits on macOS, most likely its dialog (`keychain.wait`). */
  const [keychainWaiting, setKeychainWaiting] = useState<readonly string[]>([]);
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const sessionCwdRef = useRef(sessionCwd);
  sessionCwdRef.current = sessionCwd;
  const [perms, setPerms] = useState<PermissionsState>(closedPermissions);
  const permsRef = useRef(perms);
  permsRef.current = perms;
  const [toolOutput, setToolOutput] = useState(false);
  const sessionModelRef = useRef(sessionModel);
  sessionModelRef.current = sessionModel;
  const [daemonModel, setDaemonModel] = useState<ModelInfo | null>(null);
  const [daemonVersion, setDaemonVersion] = useState("");
  const [daemonStartedAt, setDaemonStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [liveTitle, setLiveTitle] = useState<{ sessionId: string; title: string } | null>(null);
  const [offset, setOffset] = useState(0);
  // A selection belongs to one layout: a new message or another width ends it.
  const [chatSelection, setChatSelection] = useState<{ selection: Selection; width: number; messages: number } | null>(
    null,
  );
  const selectionRef = useRef<Selection | null>(null);
  const dragging = useRef(false);
  const selectFrame = useRef<{
    view: ChatView;
    all: readonly LayoutLine[];
    shown: boolean;
    /** The screen row of the pinned question, and the offset a click there scrolls to. */
    pinned: { row: number; offset: number } | null;
  } | null>(null);
  const [tail, setTail] = useState<TailAnchor | null>(null);
  const [showTimes, setShowTimes] = useState(false);
  const [showTodos, setShowTodos] = useState(DEFAULT_PREFS.todos);
  const [showThinking, setShowThinking] = useState(DEFAULT_PREFS.thinking);
  const [tick, setTick] = useState(0);
  const writingStarts = useRef(new Map<string, number>());
  const [debug, setDebug] = useState<DebugState>(closedDebug);
  const [debugOffset, setDebugOffset] = useState(0);
  const [wire, setWire] = useState<readonly WireLine[]>([]);
  const [modelMessages, setModelMessages] = useState<CheckpointMessage[]>([]);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherState>(closedSwitcher);
  const [panel, setPanel] = useState<"help" | "context" | "cost" | null>(null);
  const [contextReport, setContextReport] = useState<ContextReport>({ kind: "loading" });
  /** What `/context` offers under its report: the rows that can run, each on a key. */
  const [contextRows, setContextRows] = useState<ContextAction[]>([]);
  const contextGen = useRef(0);
  /** The lines of the `/cost` panel, or a line saying it is loading or failed. */
  const [costText, setCostText] = useState<string[]>([]);
  const costGen = useRef(0);
  /** The `/tune` panel, or null while it is closed. It takes the keys while it is open. */
  const [tune, setTune] = useState<TuneState | null>(null);
  const tuneRef = useRef(tune);
  tuneRef.current = tune;
  const tuneGen = useRef(0);
  /** The open model's option table, defaults, and saved values, for the status chip and `/tune <option>`. */
  const [chipTune, setChipTune] = useState<TuneState | null>(null);
  /** `[permissions] mode` from config.toml, which a session without a mode of its own follows. */
  const [defaultMode, setDefaultMode] = useState<PermissionMode>("balanced");
  const [ladderConfig, setLadderConfig] = useState<ConfigRouting | null>(null);
  const chipTuneRef = useRef(chipTune);
  chipTuneRef.current = chipTune;
  /** Changes sent and not yet answered. Live updates wait for them, or they would undo the newest key. */
  const tuneSending = useRef(0);
  const tuneQueue = useRef<Promise<void>>(Promise.resolve());
  /** The answer asked again with the panel's values, in a fork. Shown under the panel. */
  const [tryRun, setTryRun] = useState<TryRun | null>(null);
  const tryRef = useRef<TryRun | null>(null);
  const [mcpManager, setMcpManager] = useState<McpManagerState>(closedMcpManager);
  const mcpManagerRef = useRef(mcpManager);
  mcpManagerRef.current = mcpManager;
  const mcpRef = useRef<McpList>({ servers: null, error: null });
  const [mcp, setMcp] = useState<McpList>({ servers: null, error: null });
  mcpRef.current = mcp;
  const [skillsManager, setSkillsManager] = useState<SkillsManagerState>(closedSkillsManager);
  const skillsManagerRef = useRef(skillsManager);
  skillsManagerRef.current = skillsManager;
  const [skillList, setSkillList] = useState<SkillList>({ skills: null, error: null });
  const skillListRef = useRef(skillList);
  skillListRef.current = skillList;
  const [agentsManager, setAgentsManager] = useState<AgentsManagerState>(closedAgentsManager);
  const agentsManagerRef = useRef(agentsManager);
  agentsManagerRef.current = agentsManager;
  const measure = useMeasure(client);
  const [agentList, setAgentList] = useState<AgentList>({ agents: null, error: null });
  const [agentsKeep, setAgentsKeep] = useState<AgentsKeepValues | null>(null);
  const agentListRef = useRef(agentList);
  agentListRef.current = agentList;
  const [routinesManager, setRoutinesManager] = useState<RoutinesManagerState>(closedRoutinesManager);
  const routinesManagerRef = useRef(routinesManager);
  routinesManagerRef.current = routinesManager;
  const [routineList, setRoutineList] = useState<RoutineList>({ routines: null, issues: [], error: null });
  const routineListRef = useRef(routineList);
  routineListRef.current = routineList;
  /** The last runs of the routine whose detail is open, and which routine they are for. */
  const [routineRuns, setRoutineRuns] = useState<{ name: string; folder: string | null; runs: RoutineRunSummary[] } | null>(null);
  const [runsManager, setRunsManager] = useState<RunsManagerState>(closedRunsManager);
  const runsManagerRef = useRef(runsManager);
  runsManagerRef.current = runsManager;
  const [stepsManager, setStepsManager] = useState<StepsManagerState>(closedStepsManager);
  const stepsManagerRef = useRef(stepsManager);
  stepsManagerRef.current = stepsManager;
  /** The `helper.*` events of this chat's lead, which the Steps screen draws its bars from. */
  const helperEventsRef = useRef<ChatEvent[]>([]);
  /** The helper whose chat the Steps screen shows read-only, folded from its own session's events. */
  const [helperChat, setHelperChat] = useState<HelperChatData | null>(null);
  const helperChatRef = useRef<HelperChatData | null>(null);
  const [runList, setRunList] = useState<RunList>({ runs: null, error: null });
  const runListRef = useRef(runList);
  runListRef.current = runList;
  const [memoryManager, setMemoryManager] = useState<MemoryManagerState>(closedMemoryManager);
  const memoryManagerRef = useRef(memoryManager);
  memoryManagerRef.current = memoryManager;
  const [memoryList, setMemoryList] = useState<MemoryList>(emptyMemoryList);
  const memoryListRef = useRef(memoryList);
  memoryListRef.current = memoryList;
  /** Counts the reads, so an answer for a tab or a search the user has left is dropped. */
  const memoryRead = useRef(0);
  /** Sessions whose "needs you" banner Esc put away, until they stop waiting. */
  const [dismissedRuns, setDismissedRuns] = useState<ReadonlySet<string>>(new Set());
  const [changesManager, setChangesManager] = useState<ChangesManagerState>(closedChangesManager);
  /** The agent types that change files: a running helper of one is a worker. Read when `/changes` opens. */
  const [writingAgents, setWritingAgents] = useState<ReadonlySet<string>>(new Set());
  const writingAgentsRef = useRef(writingAgents);
  writingAgentsRef.current = writingAgents;
  /** Bumped on a `helper.*` event while `/changes` is open, so the worker blocks are drawn again. */
  const [, setHelperTick] = useState(0);
  const changesManagerRef = useRef(changesManager);
  changesManagerRef.current = changesManager;
  // What each turn changed and asked, folded from every event, for /undo.
  const changesFold = useRef<ChangesState>(noChanges);
  const promptsFold = useRef<Prompts>(noPrompts);
  const [undoBand, setUndoBand] = useState<UndoBandState | null>(null);
  const undoRef = useRef(undoBand);
  undoRef.current = undoBand;
  const [changes, setChanges] = useState<ChangesData>({ files: null, error: null, diffs: {} });
  const changesRef = useRef(changes);
  changesRef.current = changes;
  // The review notes of each session, for the next message. They live here, not in the daemon.
  const [notesBy, setNotesBy] = useState<ReadonlyMap<string, NotesState>>(() => new Map());
  const notesByRef = useRef(notesBy);
  // The paths whose diff is being read, so a key press does not ask twice.
  const changesAsked = useRef(new Set<string>());
  const budgetBodyRef = useRef(0);
  const stepsSizeRef = useRef({ columns: 80, rows: 24 });
  const helpOpen = panel !== null;
  const [keysOpen, setKeysOpen] = useState(false);
  const [keysOffset, setKeysOffset] = useState(0);
  const [diffScroll, setDiffScroll] = useState({ callId: "", offset: 0 });
  const [argsEditState, setArgsEdit] = useState<ArgsEdit | null>(null);
  const [reviewEditState, setReviewEdit] = useState<ReviewEdit | null>(null);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestPick, setSuggestPick] = useState({ draft: "", index: 0 });
  const [historyCursor, setHistoryCursor] = useState<HistoryCursor | null>(null);
  const [picker, setPicker] = useState<PickerState>(closedPicker);
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const [listing, setListing] = useState<ModelListResult | null>(null);
  const listingRef = useRef(listing);
  listingRef.current = listing;
  // The setup window. It covers the whole screen, except on the panels the picker stands in for.
  const [setup, setSetupState] = useState<SetupUi | null>(null);
  const setupRef = useRef(setup);
  /** Whether the user config has no MCP servers, and the names of those it has. */
  const mcpFactsRef = useRef<{ empty: boolean; names: string[] }>({ empty: false, names: [] });
  setupRef.current = setup;
  const startDecided = useRef(false);
  /** This screen's session, for the banner, which is worked out before the session hook runs. */
  const shownSession = useRef<string | null>(null);
  /** The service answered before the model list came: Engine opens once it does. */
  const awaitingListing = useRef(false);
  const windowDaemon = useRef<WindowDaemon | null>(null);
  /** True while `golem daemon install` runs, so Retry doesn't start a second one. */
  const installing = useRef(false);
  const [setupNow, setSetupNow] = useState(() => Date.now());
  /** `setup.status` for the band's one line, when something is wrong. */
  const [bandRows, setBandRows] = useState<SetupRow[] | null>(null);
  /** The model a working start names in `welcome back`, until the first send. */
  const [welcomeModel, setWelcomeModel] = useState<string | null>(null);
  /** Each download's bytes over time, for its speed and time left. */
  const pullTracks = useRef(new Map<string, PullTrack>());
  /** Local models that answered once in this window, so they are in memory: no `loading …` for them. */
  const warmModels = useRef(new Set<string>());
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const pullsRef = useRef(pulls);
  pullsRef.current = pulls;
  /** Downloads started from the picker switch the session once they end. */
  const useAfterPull = useRef(new Map<string, { setDefault: boolean }>());
  /** Messages to send again once their model has downloaded, after an install from the banner. */
  const sendAfterPull = useRef(new Map<string, string>());
  /** `brew install ollama` from the picker, and the model to download after it. */
  const [install, setInstall] = useState<Install | null>(null);
  const installRef = useRef(install);
  installRef.current = install;
  const stopInstall = useRef<(() => void) | null>(null);
  const cancelInstall = useRef<(() => void) | null>(null);
  const shownListing = withPulls(listing, pulls);
  const draftRef = useRef(draft);
  const startersRef = useRef<readonly string[]>([]);
  const busyRef = useRef(chat.busy);
  const chatRef = useRef(chat);
  const runIdRef = useRef(chat.runId);
  const interrupt = useRef(idleInterrupt);
  const { exit, suspendTerminal } = useApp();
  const { stdin } = useStdin();
  const connectionRef = useRef(connection);
  const debugRef = useRef(debug);
  const switcherRef = useRef(switcher);
  const panelOpen = useRef(false);
  const keysOpenRef = useRef(false);
  const overlayFrame = useRef({ columns: 80, body: 1 });
  const suggestRef = useRef<{ items: Suggestion[]; selected: number; open: boolean }>({
    items: [],
    selected: 0,
    open: false,
  });
  const inspectGen = useRef(0);
  const loadCheckpointRef = useRef<(sessionId: string) => void>(() => undefined);
  const debugLines = useRef(0);
  const onF1 = useRef<() => void>(() => undefined);
  const editing = useRef(false);
  const sentHistory = useRef(createHistory(historyPath()));
  const historyCursorRef = useRef(historyCursor);
  const liveTitleRef = useRef(liveTitle);
  const showTimesRef = useRef(showTimes);
  const showTodosRef = useRef(showTodos);
  showTodosRef.current = showTodos;
  const showThinkingRef = useRef(showThinking);
  showThinkingRef.current = showThinking;
  const prefsLoaded = useRef(false);
  draftRef.current = draft;
  historyCursorRef.current = historyCursor;
  liveTitleRef.current = liveTitle;
  showTimesRef.current = showTimes;
  busyRef.current = chat.busy;
  const approvalRef = useRef(chat.approval);
  approvalRef.current = chat.approval;
  const consentRef = useRef(chat.consent);
  consentRef.current = chat.consent;
  const dockRef = useRef<ReturnType<typeof helperDock>>(null);
  /** The paid question the band shows, and whether it has a brief or diff to show; the artifact whose diff was read. */
  const consentShowRef = useRef<{ runId: string | null; showable: boolean }>({ runId: null, showable: false });
  const briefDiffFetched = useRef<string | null>(null);
  /** The helper session whose paid question the band shows; null for the chat's own. */
  const consentSessionRef = useRef<string | null>(null);
  const argsEdit = liveArgsEdit(argsEditState, chat.approval);
  const argsEditRef = useRef(argsEdit);
  argsEditRef.current = argsEdit;
  // Long pastes behind the tokens in the draft. Sending swaps them back.
  const pastesRef = useRef<Pastes>(noPastes);
  // The column Up and Down aim for, while the draft is the one they left. Any edit makes a new draft.
  const rowGoal = useRef<{ draft: Draft; goal: number | null } | null>(null);
  chatRef.current = chat;
  runIdRef.current = chat.runId;
  connectionRef.current = connection;
  debugRef.current = debug;
  switcherRef.current = switcher;
  panelOpen.current = debug.open;
  keysOpenRef.current = keysOpen;
  const size = useWindowSize();
  const columns = frameColumns(size.columns || 80);
  const rows = size.rows || 24;
  const asking = retryOffer() !== null;
  const upgrade =
    connection.status === "connected"
      ? upgradeBanner(GOLEM_VERSION, daemonVersion, service?.restart != null)
      : null;
  upgradeRef.current = upgrade;
  const serviceText = restarting ? RESTARTING : (problem?.text ?? upgrade);
  const sessions = useSessionIndex(client, connection.status === "connected");
  const setupLine = bandRows === null ? null : setupBand(bandRows);
  // The chat this start opened is not one to come back to.
  const otherChats = sessions.filter((summary) => summary.session_id !== shownSession.current).length;
  const welcomeLine = welcomeModel === null ? null : welcomeBack(welcomeModel, otherChats);
  // Something wrong wins over the greeting.
  const model = preferModel(sessionModel, daemonModel);
  // Before any model is chosen the session's name is only a placeholder.
  const ownChip = listing?.default === null && model.provider === null ? "no model" : modelChip(model.name, model.profile);
  // On auto golem picks the model: the chip says which one the next turn starts on.
  const picked =
    chat.route.mode !== "auto"
      ? null
      : shownModel({
          mode: "auto",
          session: sessionModelOf(model, listing?.models),
          last: chat.route.last,
          models: listing?.models,
          routing: ladderConfig,
        });
  const chip = picked !== null && picked.pick ? shownModelText(picked) : ownChip;
  const answering = assistantChars(chat.messages) > 0;
  const warming = warmingLine({
    busy: chat.busy,
    answered: answering,
    provider: model.provider,
    label: chip,
    serverStarting: servers["ollama"] === "starting",
    cold: model.provider === "ollama" && !warmModels.current.has(chip),
  });
  if (chat.busy && answering && model.provider === "ollama") {
    warmModels.current.add(chip);
  }
  // Before the banner: planOffered() reads sessionRef through currentPlace().
  const batcher = useRef<DeltaBatcher | null>(null);
  if (batcher.current === null) {
    batcher.current = createDeltaBatcher((key, text) => {
      setChat((current) =>
        reduceChat(
          current,
          key.startsWith(THINKING_KEY)
            ? deltaEvent(key.slice(THINKING_KEY.length), text, "message.thinking.delta")
            : deltaEvent(key, text),
        ),
      );
    });
  }

  const session = useSession(client, connection.status === "connected", process.cwd(), {
    onSwitch: (next) => {
      batcher.current?.flush();
      setLiveTitle(null);
      setPanel(null);
      contextGen.current += 1;
      costGen.current += 1;
      showTune(null);
      setKeysOpen(false);
      historyCursorRef.current = null;
      setHistoryCursor(null);
      changesFold.current = noChanges;
      promptsFold.current = noPrompts;
      setUndoBand(null);
      helperEventsRef.current = [];
      closeStepsManager();
      setChat((current) => ({ ...emptyChat, notice: current.notice }));
      setChangesState(noChanges);
      setSessionModel(null);
      setSessionCwd(null);
      setModelMessages([]);
      setModelCount(null);
      setOffset(0);
      if (panelOpen.current) {
        loadCheckpointRef.current(next);
      }
    },
    onError: (error) => {
      setChat((current) => ({ ...current, error: messageOf(error) }));
    },
  }, firstSession);
  const sessionRef = session.ref;
  const sessionId = session.id;
  // What the lead waits for when a helper asks: the items of its summary, one shown at a time (ADR-059).
  const [askPick, setAskPick] = useState<string | null>(null);
  const dock = helperDock(
    sessionId === null ? undefined : sessions.find((summary) => summary.session_id === sessionId),
    askPick,
    Date.now(),
  );
  dockRef.current = dock;
  const helperConsent = useHelperConsent(client, isHelperConsent(dock) ? dock.item.answerSessionId : null);
  // The lead's own approval and question show unless a helper's item is the one shown.
  const ownShown = dock === null || dock.item.helper === null;
  const shownApproval = ownShown ? chat.approval : null;
  const shownConsent = ownShown ? chat.consent : (helperConsent?.consent ?? null);
  const helperBand = !ownShown && shownConsent === null && dock !== null;
  // "Show" on a helper's paid question: the brief, and the first page of its diff, read once when it opens.
  const [briefShownRun, setBriefShownRun] = useState<string | null>(null);
  const [briefDiff, setBriefDiff] = useState<{ id: string; diff: ConsentDiff } | null>(null);
  const briefOpen = shownConsent !== null && briefShownRun === shownConsent.runId;
  const briefDiffId = shownConsent?.diffArtifactId ?? null;
  const briefDiffSession = helperConsent?.sessionId ?? sessionId;
  useEffect(() => {
    if (!briefOpen || briefDiffId === null || briefDiffSession === null) return;
    if (briefDiffFetched.current === `${briefDiffSession}:${briefDiffId}`) return;
    briefDiffFetched.current = `${briefDiffSession}:${briefDiffId}`;
    setBriefDiff({ id: briefDiffId, diff: { state: "loading" } });
    client
      .readArtifact(briefDiffSession, briefDiffId, 0, BRIEF_DIFF_CHARS)
      .then((result) => {
        setBriefDiff({ id: briefDiffId, diff: { state: "ready", text: result.text, size: result.size } });
      })
      .catch(() => {
        setBriefDiff({ id: briefDiffId, diff: { state: "error" } });
      });
  }, [briefOpen, briefDiffId, briefDiffSession, client]);
  const consentShow: ConsentShow = {
    open: briefOpen,
    diff: briefDiff !== null && briefDiff.id === briefDiffId ? briefDiff.diff : { state: "none" },
  };
  consentShowRef.current = { runId: shownConsent?.runId ?? null, showable: shownConsent !== null && consentShowable(shownConsent) !== null };
  const pager = pagerText(dock);
  approvalRef.current = shownApproval;
  consentRef.current = shownConsent;
  consentSessionRef.current = ownShown ? null : (helperConsent?.sessionId ?? null);
  // A workflow review of this session (its run's headless session) shows when nothing else asks; the oldest first.
  const reviews = reviewItemsOf(
    sessions.find((summary) => summary.session_id === sessionId) ?? { session_id: "", status: "closed" },
    Date.now(),
  );
  const shownReview = ownShown && !helperBand && shownApproval === null && shownConsent === null ? (reviews[0] ?? null) : null;
  const reviewEdit = liveReviewEdit(reviewEditState, shownReview);
  const reviewPagerText = reviewPager(0, reviews.length);
  const reviewRef = useRef(shownReview);
  reviewRef.current = shownReview;
  const reviewEditRef = useRef(reviewEdit);
  reviewEditRef.current = reviewEdit;

  const unreadNotice = chat.unreadCall ? unreadCallNotice("tui") : null;
  const planNotice = planOffered() && panel === null ? PLAN_KEYS : null;
  const runsSignalNow = runsSignal(runList.runs, shownSession.current, dismissedRuns);
  const banner = asking
    ? RETRY_QUESTION
    : (keychainNotice(keychainWaiting) ?? chat.error ?? serviceText ?? warming ?? chat.notice ?? unreadNotice ?? planNotice ?? setupLine ?? runsSignalNow.banner?.text ?? welcomeLine);
  const runsBannerShown = runsSignalNow.banner !== null && banner === runsSignalNow.banner.text;
  /** The session whose banner Esc dismisses, while that banner is what shows. */
  const runsBannerRef = useRef<string | null>(null);
  runsBannerRef.current = runsBannerShown ? (runsSignalNow.banner?.sessionId ?? null) : null;
  const hintText = liveHint(hint, Date.now())?.text ?? (runsBannerShown ? "Esc to dismiss" : null);
  const suggestMatches =
    chat.busy ||
    switcher.open ||
    perms.open ||
    mcpManager.open ||
    skillsManager.open ||
    agentsManager.open ||
    routinesManager.open ||
    runsManager.open ||
    stepsManager.open ||
    memoryManager.open ||
    changesManager.open ||
    undoBand !== null ||
    picker.open ||
    keysOpen ||
    suggestDismissed ||
    historyCursor !== null
      ? []
      : suggest(
          draft.text,
          withSkillChoices(
            withTuneChoices(withModelChoices(COMMANDS, modelNames(listing)), chipTune?.options ?? [], chipTune?.defaults ?? {}),
            invocableSkills(skillList.skills ?? []),
            { pinnable: pinnableSkills(skillList.skills ?? []), active: chat.activeSkills },
          ),
        );
  const composerText = draft.text;
  const suggestSelected =
    suggestPick.draft === draft.text ? Math.min(suggestPick.index, Math.max(0, suggestMatches.length - 1)) : 0;
  /** The checks golem offered to run and the session has not answered. */
  const checksOffer = chat.checks.allowed === null ? chat.checks.offered : null;
  const budget = frameBudget({
    rows,
    columns,
    draft: argsEdit !== null ? argsEdit.draft.text : reviewEdit !== null ? reviewEdit.draft.text : composerText,
    busy: chat.busy && argsEdit === null && reviewEdit === null,
    banner: (banner !== null && banner.length > 0) || hintText !== null,
    debug: debug.open,
    suggestions: suggestMatches.length,
    approval:
      helperBand && dock !== null
        ? helperAskRows(dock)
        : shownConsent !== null
        ? consentRows(shownConsent, consentShow, columns)
        : shownApproval !== null
          ? argsEdit !== null
            ? APPROVAL_ROWS
            : approvalRows(shownApproval, rows)
          : shownReview !== null
            ? reviewEdit !== null
              ? APPROVAL_ROWS
              : reviewRows(shownReview, columns, reviewPagerText)
            : undoBand !== null
              ? undoRows(undoBand, rows)
              : 0,
    composerMax: argsEdit !== null ? ARGS_EDIT_ROWS : reviewEdit !== null ? REVIEW_EDIT_ROWS : undefined,
    todos: showTodos ? todoRows(chat.todos) : 0,
    install: install === null ? 0 : installRows(install.state),
    checks: checksOffer === null ? 0 : 1,
  });
  suggestRef.current = {
    items: suggestMatches,
    selected: suggestSelected,
    open: budget.suggestions > 0 && suggestMatches.length > 0,
  };
  overlayFrame.current = { columns, body: budget.body };
  budgetBodyRef.current = budget.body;
  stepsSizeRef.current = { columns, rows: budget.body };
  const diffOffset = chat.approval !== null && diffScroll.callId === chat.approval.callId ? diffScroll.offset : 0;
  const contextSegmentRows = panel === "context" && tune === null ? contextSegments(contextReport, columns) : [];
  const panelLines =
    tune !== null
      ? tuneLines(tune, columns)
      : panel === "help"
        ? helpLines(COMMANDS, columns)
        : panel === "cost"
          ? costText.map((line) => fitLine(line, columns))
        : panel === "context"
          ? [
              ...contextSegmentRows.map((line) => line.map((segment) => segment.text).join("")),
              ...(contextKeyLine(contextRows) === null ? [] : ["", fitLine(contextKeyLine(contextRows) ?? "", columns)]),
            ]
          : [];
  const tryRows = tune !== null && tryRun !== null ? tryLines(tryRun, columns) : [];
  const helpText = !keysOpen && !switcher.open ? panelLines : [];
  const litLines = tune !== null ? tuneLitLines(tune) : [];
  const gauges = tune !== null ? tuneMemorySpans(tune, columns) : [];
  const helpRows: OverlayLine[] = [
    ...helpText.map((text, index) => {
      const gauge = gauges.find((item) => item.line === index);
      return {
        text,
        dim: false,
        accent: litLines.includes(index),
        ...(contextSegmentRows[index] === undefined ? {} : { segments: contextSegmentRows[index] }),
        ...(gauge === undefined ? {} : { gauge: { start: gauge.start, fit: gauge.fit } }),
      };
    }),
    ...(helpText.length > 0 ? tryRows : []),
  ];
  const helpHeight = Math.min(helpRows.length, budget.body);
  const chatHeight = budget.body - helpHeight;
  // Starter prompts fit the session's folder, and show until the first message.
  const starterFolder = sessionCwd ?? process.cwd();
  const folderPrompts = useMemo(() => starterPrompts(folderFacts(starterFolder)), [starterFolder]);
  const starters =
    connection.status === "connected" &&
    chat.approval === null &&
    chat.consent === null &&
    startersShown({ messages: chat.messages.length, draft: draft.text, busy: chat.busy })
      ? folderPrompts
      : [];
  startersRef.current = starters;
  const starterRows = starterLines(starters, starters.length > 0 ? starterPick : null);
  // Seconds count from the first `tool.writing` of a call, on this clock.
  const writingSince = writingStarts.current;
  for (const message of chat.messages) {
    if (message.writing == null) {
      writingSince.delete(message.id);
    } else if (!writingSince.has(message.id)) {
      writingSince.set(message.id, Date.now());
    }
  }
  const writingSeconds = (id: string) => Math.max(0, Math.floor((Date.now() - (writingSince.get(id) ?? Date.now())) / 1000));
  const transcriptOptions = {
    times: showTimes,
    now,
    toolOutput,
    thinking: showThinking,
    writingSeconds,
    checks: chat.checks,
    runId: chat.runId,
    changes: changesState,
    liveRunId: chat.busy ? chat.runId : null,
    commands: COMMANDS.map((command) => command.name),
    notices: chat.notices,
    batches: chat.batches,
    isLocal: isLocalFrom(listing?.models),
    routedNote: (run: readonly ChatMessage[]) => turnRoutedNote(run, chat.route, sessionModelOf(model, listing?.models)),
  };
  const measured = layoutTranscript(chat.messages, columns, chatHeight, offset, transcriptOptions);
  const widthKey = measured.overflow ? Math.max(1, columns - 1) : columns;
  const followed = followTail(tail, measured.lineCount, widthKey, offset);
  const transcript =
    followed.offset === offset
      ? measured
      : layoutTranscript(chat.messages, columns, chatHeight, followed.offset, transcriptOptions);
  const cwd = shortCwd(sessionCwd ?? process.cwd(), homedir());
  const versions = versionLabel(GOLEM_VERSION, daemonVersion);
  const writing = writingNow(chat.messages);
  const writingText = writing === null ? null : writingLabel(writing.writing, writingSeconds(writing.id));
  const phase = meterPhase(
    chat.busy,
    assistantChars(chat.messages),
    chat.approval !== null || chat.consent !== null,
    writing !== null,
  );
  const page = Math.max(1, (keysOpen ? budget.body : Math.max(1, chatHeight)) - 1);
  const debugPage = Math.max(1, budget.debug - 2);

  // One `model.options.get` when the session opens or the model changes, for the tune chip.
  const chipModel = model.provider === "ollama" ? model.name : null;
  useEffect(() => {
    if (connection.status !== "connected" || sessionId === null || chipModel === null) {
      setChipTune(null);
      return;
    }
    let live = true;
    client.getModelOptions(chipModel, sessionId).then(
      (result) => {
        if (live) {
          setChipTune(tuneState(result));
        }
      },
      () => {
        if (live) {
          setChipTune(null);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [client, connection.status, sessionId, chipModel]);

  // One `config.get` when the session opens, for the default mode behind the status segment.
  useEffect(() => {
    if (connection.status !== "connected" || sessionId === null) {
      return;
    }
    let live = true;
    client.getConfig(sessionCwd ?? process.cwd(), sessionId).then(
      (config: ConfigGetResult) => {
        if (live) {
          setDefaultMode(effectiveMode(null, config.default_permission_mode));
          setLadderConfig(config.routing ?? null);
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, connection.status, sessionId, sessionCwd]);

  // What any client saves for the model keeps the chip fresh.
  useEffect(() => {
    return client.onOptionsSaved(({ model: saved, saved: values }) => {
      setChipTune((current) => (current === null ? current : withSaved(current, saved, values)));
    });
  }, [client]);
  // One tip per session: a session seen for the first time takes the next one.
  const tipFile = useRef(tipCounterPath());
  const sessionTips = useRef(new Map<string, number>());
  const nextTip = useRef<number | null>(null);
  function sessionTip(id: string | null): number {
    if (id === null) {
      nextTip.current ??= peekTip(tipFile.current);
      return nextTip.current;
    }
    let count = sessionTips.current.get(id);
    if (count === undefined) {
      count = takeTip(tipFile.current);
      sessionTips.current.set(id, count);
    }
    return count;
  }
  shownSession.current = sessionId;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const indexedTitle = sessions.find((summary) => summary.session_id === sessionId)?.title;
  const titleLabel = shownSessionTitle(sessionId, liveTitle, indexedTitle);
  // The meter ticks every 100 ms. The tab changes at most once a second.
  const titleState = {
    title: titleLabel,
    phase,
    error: chat.error !== null,
    connection: connection.status,
    frame: Math.floor(tick / 10),
    waitingElsewhere: runsSignalNow.count > 0,
  };
  // In iTerm2 the tab status shows the state, so the title has no mark, as for Claude Code.
  const tabTitle = windowTitle(titleState, !TAB_STATUS_ON);
  const shownTabState = tabState(titleState);
  const uptimeSeconds =
    connection.status !== "connected" || daemonStartedAt === null
      ? null
      : Math.max(0, (now - daemonStartedAt) / 1000);
  const uptimeRefresh = uptimeRefreshMs(uptimeSeconds);
  const status = fitSegments(
    statusSegments({
      notes: sessionId === null || changesManager.open ? "" : (notesChip(notesBy.get(sessionId) ?? noNotes) ?? ""),
      connection: statusLabel(connection),
      title: titleLabel,
      model: chip,
      folder: cwd,
      messageCount: sessionId === null ? null : chat.messages.length,
      changedFiles: sessionId === null ? 0 : changedPaths(changesState).length,
      localOnly: localOnlyLabel(sessions.find((summary) => summary.session_id === sessionId)),
      uptimeSeconds,
      freshLines: followed.fresh,
      alert: alertLabel(chat.down, mcpAlert(mcp.servers)),
      runs: runsWaitingLabel(runsSignalNow.count),
      helpers: sessionId === null ? "" : helpersLabel(chat.batches),
      skills: sessionId === null ? [] : chat.activeSkills,
      skippedSkills: chat.skippedSkills,
      context: sessionId === null ? null : chat.context.last,
      route: sessionId === null ? "" : routeStatus(chat.route.mode),
      mode: sessionId === null ? "" : effectiveMode(chat.permissionMode, defaultMode),
      plan: sessionId !== null && chat.plan.on,
      cost: sessionId === null ? "" : sessionCostLabel(chat.messages),
      tune: sessionId === null || chipTune === null ? "" : tuneChip(withSession(chipTune, chat.options), model.provider),
    }),
    columns,
  );

  useEffect(() => () => batcher.current?.stop(), []);
  // The daemon's install goes on after this window closes; only stop listening.
  useEffect(() => () => stopInstall.current?.(), []);

  useEffect(() => {
    void sentHistory.current.load().catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadPrefs(prefsPath()).then(
      (prefs) => {
        if (prefsLoaded.current) {
          return;
        }
        prefsLoaded.current = true;
        setShowTimes(prefs.times);
        setShowTodos(prefs.todos);
        setShowThinking(prefs.thinking);
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    return client.onWire((lines) => {
      setWire(lines);
    });
  }, [client]);

  async function loadCheckpoint(sessionId: string): Promise<void> {
    const gen = ++inspectGen.current;
    try {
      const result = await client.inspectSession(sessionId);
      if (gen !== inspectGen.current) {
        return;
      }
      setModelMessages(result.messages.map((message) => ({ role: message.role, text: message.text })));
      setModelCount(result.message_count);
    } catch (error: unknown) {
      if (gen !== inspectGen.current) {
        return;
      }
      setModelCount(null);
      setChat((current) => ({ ...current, notice: messageOf(error) }));
    }
  }
  loadCheckpointRef.current = (sessionId: string) => {
    void loadCheckpoint(sessionId);
  };

  useEffect(() => {
    if (transcript.offsetFromBottom !== offset) {
      setOffset(transcript.offsetFromBottom);
    }
  }, [offset, transcript.offsetFromBottom]);

  useEffect(() => {
    const anchor = followed.anchor;
    setTail((current) =>
      current !== null &&
      current.lines === anchor.lines &&
      current.columns === anchor.columns &&
      current.fresh === anchor.fresh
        ? current
        : anchor,
    );
    if (followed.offset !== offset) {
      setOffset(followed.offset);
    }
  }, [followed.anchor.lines, followed.anchor.columns, followed.anchor.fresh, followed.offset, offset]);

  useEffect(() => {
    if (onPointer === undefined) {
      return;
    }
    return onPointer((event) => {
      const frame = selectFrame.current;
      if (frame === null) {
        return;
      }
      if (event.kind === "down" && frame.shown && frame.pinned !== null && event.row === frame.pinned.row) {
        dragging.current = false;
        showSelection(null);
        setOffset(frame.pinned.offset);
        return;
      }
      if (event.kind === "down") {
        const point = frame.shown ? pointAt(frame.view, event.row, event.column) : null;
        dragging.current = point !== null;
        showSelection(point === null ? null : { anchor: point, head: point });
        return;
      }
      const current = selectionRef.current;
      if (!dragging.current || current === null) {
        dragging.current = false;
        return;
      }
      if (event.kind === "drag") {
        const { point, scroll } = dragTo(frame.view, event.row, event.column);
        if (scroll !== 0) {
          setOffset((value) => Math.max(0, value + scroll));
        }
        showSelection({ anchor: current.anchor, head: point });
        return;
      }
      dragging.current = false;
      if (isClick(current)) {
        showSelection(null);
        return;
      }
      const text = selectedText(frame.all, current);
      if (text.length === 0) {
        return;
      }
      void copyText(text).then(
        (way) => showHint(copiedHint(way, text)),
        (error: unknown) => setChat((state) => ({ ...state, notice: messageOf(error) })),
      );
    });
  }, [onPointer]);

  useEffect(() => {
    if (onWheel === undefined) {
      return;
    }
    return onWheel((steps) => {
      if (keysOpenRef.current) {
        const frame = overlayFrame.current;
        const count = keyOverlayLines(KEYS, frame.columns).length;
        const visible = Math.max(1, frame.body);
        const max = Math.max(0, count - visible);
        setKeysOffset((current) => Math.max(0, Math.min(max, current - steps * WHEEL_LINES)));
        return;
      }
      if (panelOpen.current) {
        setDebugOffset((current) => nextOffset(current, steps));
        return;
      }
      setOffset((current) => nextOffset(current, steps));
    });
  }, [onWheel]);

  // A lost connection ends the file the model was writing: no `tool.requested` will come for it.
  useEffect(() => {
    if (connection.status === "reconnecting" || connection.status === "closed") {
      setChat(stopWriting);
    }
  }, [connection.status]);

  useEffect(() => {
    if (!chat.busy) {
      return;
    }
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [chat.busy]);

  useEffect(() => {
    setConnection(client.state);
    return client.onState((next) => {
      setConnection(next);
      if (next.status !== "connected") {
        batcher.current?.flush();
      }
    });
  }, [client]);

  useEffect(() => {
    if (connection.status !== "connected") {
      return;
    }
    let cancelled = false;
    void client.status().then(
      (statusResult) => {
        if (cancelled) {
          return;
        }
        const at = Date.now();
        setNow(at);
        setDaemonVersion(statusResult.version);
        setDaemonStartedAt(startedAtMs(at, statusResult.uptime_seconds));
        setDaemonModel({
          profile: statusResult.model_profile ?? null,
          provider: statusResult.model_provider ?? null,
          name: statusResult.model_name ?? null,
        });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client, connection.status]);

  useEffect(() => {
    return client.onEvent((event) => {
      const tried = tryRef.current;
      if (tried !== null && event.session_id === tried.sessionId) {
        setTry(foldTry(tried, event));
        return;
      }
      const watched = helperChatRef.current;
      if (watched !== null && event.session_id === watched.sessionId) {
        const next = { ...watched, chat: reduceChat(watched.chat, event) };
        helperChatRef.current = next;
        setHelperChat(next);
        return;
      }
      if (event.session_id !== sessionRef.current) {
        return;
      }
      if (event.type.startsWith("helper.")) {
        helperEventsRef.current = [...helperEventsRef.current, event].slice(-HELPER_EVENTS_KEPT);
        if (changesManagerRef.current.open) {
          setHelperTick((tick) => tick + 1);
        }
      }
      changesFold.current = reduceChanges(changesFold.current, event);
      promptsFold.current = foldPrompts(promptsFold.current, event);
      if (event.type === "session.created") {
        setSessionCwd(event.data.cwd ?? null);
      }
      if (event.type === "model.selected") {
        // The panel tunes the model it was opened for.
        showTune(null);
      }
      if (event.type === "session.created" || event.type === "model.selected") {
        setSessionModel({
          profile: event.data.model_profile,
          provider: event.data.model_provider ?? null,
          name: event.data.model_name ?? null,
        });
      }
      if (event.type === "session.updated") {
        const { title, cwd: folder } = event.data;
        if (typeof title === "string") {
          setLiveTitle({ sessionId: event.session_id, title });
        }
        if (typeof folder === "string") {
          setSessionCwd(folder);
        }
      }
      if (event.type === "message.delta") {
        batcher.current?.push(event.data.message_id, event.data.text);
        return;
      }
      if (event.type === "message.thinking.delta") {
        batcher.current?.push(`${THINKING_KEY}${event.data.message_id}`, event.data.text);
        return;
      }
      if (
        event.type === "message.completed" ||
        event.type === "run.completed" ||
        event.type === "run.failed"
      ) {
        batcher.current?.flush();
      }
      setChat((current) => reduceChat(current, event));
      setChangesState((current) => reduceChanges(current, event));
      if (event.type === "run.cancelled" && event.data.reason === "user") {
        showHint(CANCELLED_NOTICE);
      }
      if (event.type === "file.changed" && changesManagerRef.current.open) {
        loadChanges(event.session_id, event.data.path);
      }
      if (event.type === "run.completed" && panelOpen.current) {
        loadCheckpointRef.current(event.session_id);
      }
    });
  }, [client, sessionRef]);

  useEffect(() => {
    if (connection.status !== "connected") {
      return;
    }
    loadModels(false);
  }, [client, connection.status]);

  // `/memory` reads its list again when memory changes anywhere, and after a reconnect.
  useEffect(() => {
    if (connection.status !== "connected") {
      return;
    }
    if (memoryManagerRef.current.open) {
      loadMemory();
    }
    return client.onMemoryChanged(() => {
      if (memoryManagerRef.current.open) {
        loadMemory();
      }
    });
  }, [client, connection.status]);

  useEffect(() => {
    if (connection.status === "connected") {
      loadMcp();
    }
  }, [client, connection.status, sessionId]);

  useEffect(() => {
    if (connection.status === "connected") {
      loadSkills();
    }
  }, [client, connection.status, sessionCwd]);

  useEffect(() => {
    return client.onRoutinesChanged(() => {
      if (routinesManagerRef.current.open) {
        loadRoutines();
      }
      // The banner and the status line count waiting runs, so the list is kept current.
      loadRuns();
    });
  }, [client]);

  useEffect(() => {
    if (connection.status === "connected") {
      loadRuns();
    }
  }, [client, connection.status]);

  // A session that stopped waiting is forgotten, so it can show again when it waits again.
  useEffect(() => {
    setDismissedRuns((current) => pruneDismissed(current, runList.runs));
  }, [runList]);

  useEffect(() => {
    // A headless session starting, waiting, or ending changes a run.
    return client.onSessionSummary((summary) => {
      if (summary.origin !== undefined && summary.origin !== "user") {
        loadRuns();
      }
    });
  }, [client]);

  useEffect(() => {
    return client.onSkillsChanged((root) => {
      if (root === null || root === skillsFolder()) {
        loadSkills();
      }
    });
  }, [client]);

  // `/agents` reads its list again when agent files change, but only while it is open.
  useEffect(() => {
    return client.onAgentsChanged((root) => {
      if (agentsManagerRef.current.open && (root === null || root === skillsFolder())) {
        loadAgents();
      }
    });
  }, [client]);

  useEffect(() => {
    return client.onMcpStatus((server) => {
      setMcp((current) =>
        current.servers === null ? current : { servers: mergeMcp(current.servers, server), error: null },
      );
    });
  }, [client]);

  useEffect(() => {
    return client.onMcpLoginDone((done) => {
      void (async () => {
        let tools: number | null = null;
        if (done.ok) {
          tools = await client
            .mcpTools(done.name, sessionRef.current ?? undefined)
            .then((result) => (result.tools.length > 0 ? result.tools.length : null))
            .catch(() => null);
        }
        const text = loginDoneText(done, tools);
        setMcpManager((state) => mcpLoginDone(state, done.name, done.ok, text));
        setChat((state) => ({ ...state, error: null, notice: text }));
        loadMcp();
      })();
    });
  }, [client]);

  useEffect(() => {
    return client.onMcpLog((log) => {
      setMcpManager((state) => mcpLogsAppended(state, log.name, log.lines.map(formatLogLine)));
    });
  }, [client]);

  useEffect(() => {
    return client.onKeychainWait((wait) => {
      setKeychainWaiting((current) => {
        const others = current.filter((name) => name !== wait.name);
        return wait.waiting ? [...others, wait.name] : others;
      });
    });
  }, [client]);

  // A dialog that was open when the daemon went away is gone with it.
  useEffect(() => {
    if (connection.status !== "connected") {
      setKeychainWaiting([]);
    }
  }, [connection.status]);

  useEffect(() => {
    return client.onModelServer((status) => {
      setServers((current) => applyServerStatus(current, status));
      if (status.state === "ready") {
        setChat((current) => serverUp(current, status.provider));
      }
      const notice = serverFailedNotice(status);
      if (notice !== null) {
        // A run that needed the server fails on its own, with the same reason and a hint.
        setChat((current) => (current.busy ? current : { ...current, notice }));
      }
    });
  }, [client]);

  // What another client saves for the open panel's model shows at once.
  useEffect(() => {
    return client.onOptionsSaved(({ model, saved }) => {
      const open = tuneRef.current;
      if (open !== null && tuneSending.current === 0) {
        showTune(withSaved(open, model, saved));
      }
    });
  }, [client]);

  // The session's overrides, from `model.options.changed`, whoever set them.
  useEffect(() => {
    const open = tuneRef.current;
    if (open !== null && tuneSending.current === 0) {
      showTune(withSession(open, chat.options));
    }
  }, [chat.options]);

  useEffect(() => {
    return client.onPull((update) => {
      if (update.kind === "progress") {
        const { ref, progress, status, completed, total } = update.progress;
        setPulls((current) => ({ ...current, [ref]: { progress: progress ?? null, status } }));
        const now = Date.now();
        const listed = listingRef.current?.models.find((model) => model.ref === ref);
        const before = pullTracks.current.get(ref) ?? (listed === undefined ? { completed: 0, total: null, samples: [] } : startPullTrack(listed, now));
        const track = trackPull(before, completed ?? null, total ?? null, now);
        pullTracks.current.set(ref, track);
        updateSetup((ui) => (ui.model.phase === "downloading" && ui.model.ref === ref ? { ...ui, model: { ...ui.model, pull: track } } : ui));
        if (!pickerRef.current.open) {
          const notice = pullBand(listed?.label ?? ref, track);
          setChat((current) =>
            current.notice === null || current.notice.startsWith("downloading ")
              ? { ...current, notice }
              : current,
          );
        }
        return;
      }
      const { ref, ok, error } = update.done;
      pullTracks.current.delete(ref);
      const ui = setupRef.current;
      if (ui !== null && ui.model.phase === "downloading" && ui.model.ref === ref) {
        // The Model panel waited for this one: use it, and go on to Ready.
        setPulls((current) => {
          const next = { ...current };
          delete next[ref];
          return next;
        });
        if (ok) {
          setChat(downloadEnded);
          void client.listModels(false).then((listed) => {
            listingRef.current = listed;
            setListing(listed);
            const model = listed.models.find((each) => each.ref === ref) ?? null;
            chooseModel(model, ref, true);
            modelPicked("ollama", model?.label ?? ref);
          });
        } else {
          updateSetup((now) => ({ ...now, model: modelPullFailed(now.model, error ?? "unknown error") }));
        }
        return;
      }
      setPulls((current) => {
        const next = { ...current };
        delete next[ref];
        return next;
      });
      const after = useAfterPull.current.get(ref);
      useAfterPull.current.delete(ref);
      const resend = sendAfterPull.current.get(ref);
      sendAfterPull.current.delete(ref);
      loadModels(false);
      if (ok && resend !== undefined) {
        setChat(downloadEnded);
        showHint(`${ref} downloaded`);
        sendText(resend);
      } else if (ok && after !== undefined) {
        chooseModel(null, ref, after.setDefault, `${ref} downloaded, and this session uses it now`);
      } else if (ok) {
        setChat(downloadEnded);
        showHint(`${ref} downloaded`);
      } else if (error === "cancelled") {
        setChat(downloadEnded);
        showHint(`stopped downloading ${ref}`);
      } else {
        setChat((current) => ({ ...current, notice: null, error: `download of ${ref} failed: ${error ?? "unknown error"}` }));
      }
    });
  }, [client]);

  // What opens at the start: the window on Service when nothing answers, else what the model list says.
  useEffect(() => {
    if (startDecided.current) {
      return;
    }
    if (connection.status === "reconnecting" || connection.status === "closed") {
      startDecided.current = true;
      const start = serviceAtStart();
      showSetup(newSetup(guided("service", "start"), start.state));
      if (start.reinstall) {
        installService();
      }
      return;
    }
    if (connection.status !== "connected" || listing === null || sessionId === null) {
      return;
    }
    startDecided.current = true;
    applyStart(setupAtStart(true, listing));
  }, [connection, listing, sessionId]);

  useEffect(() => {
    if (awaitingListing.current && listing !== null) {
      awaitingListing.current = false;
      serviceDone();
    }
  }, [listing]);

  // The service answering moves Service on, after a moment of `✓ service running`.
  useEffect(() => {
    const ui = setupRef.current;
    if (connection.status !== "connected" || ui === null || ui.service.phase !== "starting") {
      return;
    }
    if (ui.service.how === "install" && !ui.service.agent) {
      return;
    }
    showSetup({ ...ui, service: serviceAnswered(ui.service, Date.now()) });
  }, [connection, setup?.service]);

  // The window's clock: the seconds, the spinner, and the waits that end on their own.
  const setupTicking =
    setup !== null &&
    (setup.service.phase === "starting" ||
      setup.service.phase === "running" ||
      (setup.window.view === "panel" && setup.window.panel === "ollama" && ["installing", "starting", "waiting"].includes(setup.ollama.phase)) ||
      (setup.window.view === "panel" && setup.window.panel === "model" && setup.model.phase === "downloading") ||
      (setup.window.view === "panel" && setup.window.panel === "key" && (setup.key.phase === "checking" || setup.key.phase === "works")) ||
      (setup.window.view === "panel" && setup.window.panel === "tools" && setup.tools.state?.phase === "run") ||
      (setup.window.view === "overview" && setup.overview.rows === null));
  useEffect(() => {
    if (!setupTicking) {
      return;
    }
    const timer = setInterval(() => {
      setSetupNow(Date.now());
    }, 100);
    return () => clearInterval(timer);
  }, [setupTicking]);

  useEffect(() => {
    const ui = setupRef.current;
    if (ui === null) {
      return;
    }
    const state = ui.service;
    if (state.phase === "running" && setupNow - state.since >= RUNNING_PAUSE_MS) {
      serviceDone();
      return;
    }
    if (state.phase !== "starting") {
      return;
    }
    const own = windowDaemon.current;
    if (state.how === "session" && own !== null && own.exited()) {
      windowDaemon.current = null;
      const said = own.output().trim().split("\n").at(-1) ?? "";
      failService(said.length > 0 ? said : "it stopped before it answered", "golem daemon logs");
      return;
    }
    if (serviceTimedOut(state, setupNow)) {
      const error = service?.startError() ?? null;
      const waited = state.how === "install" && !state.agent ? "the install didn't finish in 3 minutes" : "it didn't answer in 45 seconds";
      failService(error?.reason ?? waited, error?.next ?? "golem daemon logs");
    }
  }, [setupNow]);

  // From the download page, golem goes on by itself once Ollama is on this Mac.
  const waitingForOllama = setup?.window.view === "panel" && setup.window.panel === "ollama" && setup.ollama.phase === "waiting";
  useEffect(() => {
    if (!waitingForOllama) {
      return;
    }
    const timer = setInterval(() => {
      void client.listModels(true).then(
        (listed) => {
          listingRef.current = listed;
          setListing(listed);
          const ui = setupRef.current;
          if (listed.setup.ollama_installed && ui !== null && ui.ollama.phase === "waiting") {
            startOllamaNow();
          }
        },
        () => undefined,
      );
    }, 3_000);
    return () => clearInterval(timer);
  }, [waitingForOllama]);

  useEffect(() => {
    if (uptimeRefresh === null) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, uptimeRefresh);
    return () => clearInterval(timer);
  }, [uptimeRefresh]);

  useEffect(() => {
    applyWindowTitle(tabTitle);
  }, [tabTitle]);

  // Written only when it changes: the phase does not change on every frame.
  const progress = tabProgress(phase);
  useEffect(() => {
    applyProgress(progress);
  }, [progress]);

  useEffect(() => {
    applyTabStatus(shownTabState);
  }, [shownTabState]);

  useEffect(() => {
    if (!draft.text.startsWith("/") || draft.text.startsWith("//")) {
      setSuggestDismissed(false);
    }
  }, [draft.text]);

  // Ink names F1 and then drops it, so the key table never sees that press.
  useEffect(() => {
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (isF1(text)) {
        onF1.current();
      }
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
    };
  }, [stdin]);

  /** Ask for this session's MCP servers again. The panel and the status line read them. */
  function loadMcp(): void {
    client.listMcp(sessionRef.current ?? undefined).then(
      (listed) => {
        setMcp({ servers: listed.servers, error: null });
      },
      (error: unknown) => {
        setMcp({ servers: null, error: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  /** Read the newest model call's context for the `/context` panel: `trace.get`, then `trace.span`. */
  function loadContext(): void {
    const gen = ++contextGen.current;
    const id = sessionRef.current;
    if (id === null) {
      setContextReport({ kind: "none" });
      return;
    }
    if (connectionRef.current.status !== "connected") {
      setContextReport({ kind: "error", message: "not connected" });
      return;
    }
    setContextReport({ kind: "loading" });
    setContextRows([]);
    const current = (): boolean => gen === contextGen.current && sessionRef.current === id;
    void (async () => {
      try {
        const trace = await client.getTrace(id);
        const span = latestModelSpan(trace.runs);
        if (span === null) {
          if (current()) setContextReport({ kind: "none" });
          return;
        }
        const result = await client.getTraceSpan(id, span.id);
        if (current()) setContextReport({ kind: "ready", model: span.model ?? null, context: result.context ?? null, provider: result.provider ?? null });
        const rows = await readContextActions(client, {
          sessionId: id,
          session: { profile: model.profile, provider: model.provider, name: model.name },
          route: chatRef.current.route.mode,
          busy: busyRef.current,
          changed: chatRef.current.context.last?.adjusted === true,
          span: result,
        });
        if (current()) setContextRows(rows);
      } catch (error) {
        if (current()) setContextReport({ kind: "error", message: messageOf(error) });
      }
    })();
  }

  /** `/cost`: `cost.get` for this session, printed as the report. */
  function loadCost(): void {
    const gen = ++costGen.current;
    const id = sessionRef.current;
    if (connectionRef.current.status !== "connected") {
      setCostText(["not connected"]);
      return;
    }
    setCostText(["loading\u2026"]);
    void (async () => {
      try {
        const result = await (id === null ? client.getCost() : client.getCost(id));
        if (gen === costGen.current) setCostText(costReportLines(result));
      } catch (error) {
        if (gen === costGen.current) setCostText([messageOf(error)]);
      }
    })();
  }

  function showTune(next: TuneState | null): void {
    tuneRef.current = next;
    setTune(next);
    if (next === null) {
      tuneGen.current += 1;
      clearTry();
    }
  }

  function setTry(next: TryRun | null): void {
    tryRef.current = next;
    setTryRun(next);
  }

  /** Cancel a running try, stop watching its fork, and hide the block. The fork stays a session. */
  function clearTry(): void {
    const old = tryRef.current;
    if (old !== null) {
      dropTry(client, runningTry(old), old.sessionId);
      setTry(null);
    }
  }

  /** `t`: ask the last question again in a fork with the panel's values, and show the answer. */
  function tryAgain(tune: TuneState): void {
    const id = sessionRef.current;
    const plan = planTry(chatRef.current, tune);
    if (plan.kind === "refused") {
      setChat((current) => ({ ...current, notice: plan.notice }));
      return;
    }
    if (id === null || connectionRef.current.status !== "connected") {
      return;
    }
    clearTry();
    const heading = tryHeading(tune);
    const known = sessionsRef.current.find((summary) => summary.session_id === id)?.title;
    const title = tryTitle(known ?? (liveTitleRef.current?.sessionId === id ? liveTitleRef.current.title : null), plan.text);
    const source = { sessionId: id, cwd: sessionCwdRef.current ?? undefined, profile: sessionModelRef.current?.profile ?? undefined };
    setChat((current) => ({ ...current, notice: null }));
    startTry(client, plan, source, title, (forkId) => setTry(startedTry(forkId, plan, heading))).catch(
      (error: unknown) => {
        clearTry();
        setChat((current) => ({ ...current, error: messageOf(error) }));
      },
    );
  }

  /** Read the model's options and this session's overrides, then open the `/tune` panel. */
  function loadTune(model: string, id: string): void {
    const gen = ++tuneGen.current;
    client.getModelOptions(model, id).then(
      (result) => {
        if (gen === tuneGen.current && sessionRef.current === id) {
          showTune(tuneState(result));
        }
      },
      (error: unknown) => {
        if (gen === tuneGen.current) {
          setChat((current) => ({ ...current, error: messageOf(error) }));
        }
      },
    );
  }

  /** Send one change at once. They go out one at a time, so the last key is the last value written. */
  function sendTune(model: string, action: Extract<TuneAction, { kind: "change" }>): void {
    const id = sessionRef.current;
    const options = { [action.name]: action.value };
    tuneSending.current += 1;
    tuneQueue.current = tuneQueue.current.then(async () => {
      try {
        if (action.target === "saved") {
          const result = await client.setModelOptions(model, options);
          if (tuneSending.current === 1 && tuneRef.current !== null) {
            showTune(withSaved(tuneRef.current, result.model, result.saved));
          }
        } else if (id !== null) {
          const result = await client.setSessionOptions(id, options);
          if (tuneSending.current === 1 && tuneRef.current !== null && sessionRef.current === id) {
            showTune(withSession(tuneRef.current, result.options));
          }
        }
      } catch (error) {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      } finally {
        tuneSending.current -= 1;
      }
    });
  }

  /** A preset goes to the session only. `save` keeps the session's values for the model, then clears them. */
  function sendTunePreset(model: string, action: Extract<TuneAction, { kind: "preset" | "save" }>): void {
    const id = sessionRef.current;
    if (id === null) {
      return;
    }
    tuneSending.current += 1;
    tuneQueue.current = tuneQueue.current.then(async () => {
      try {
        if (action.kind === "preset") {
          const result = await client.setSessionOptions(id, action.options);
          if (tuneSending.current === 1 && tuneRef.current !== null && sessionRef.current === id) {
            showTune(withSession(tuneRef.current, result.options));
          }
        } else {
          const saved = await client.setModelOptions(model, action.save);
          const cleared = await client.setSessionOptions(id, action.clear);
          if (tuneSending.current === 1 && tuneRef.current !== null && sessionRef.current === id) {
            showTune(withSession(withSaved(tuneRef.current, saved.model, saved.saved), cleared.options));
          }
        }
      } catch (error) {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      } finally {
        tuneSending.current -= 1;
      }
    });
  }

  /** Ask the daemon for the catalog. A pick waiting from `/mcp add <id>` goes on when it arrives. */
  function loadMcpCatalog(): void {
    client.mcpCatalog(sessionRef.current ?? undefined).then(
      (listed) => {
        const loaded = mcpCatalogLoaded(mcpManagerRef.current, listed.entries);
        mcpManagerRef.current = loaded.state;
        setMcpManager(loaded.state);
        runMcpAction(loaded.action);
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, notice: `can't load the catalog: ${messageOf(error)}` }));
      },
    );
  }

  /** The folder whose skills this screen shows: the session's, or where the TUI started. */
  function skillsFolder(): string {
    return sessionCwdRef.current ?? process.cwd();
  }

  /** Ask for the routines again, those of this folder's project too. `/routines` reads them. */
  function loadRoutines(): void {
    client.listRoutines([skillsFolder()]).then(
      (listed) => setRoutineList({ routines: listed.routines, issues: listed.issues ?? [], error: null }),
      (error: unknown) => setRoutineList({ routines: null, issues: [], error: messageOf(error) }),
    );
  }

  /** Ask for the runs again. `/runs` reads them. */
  function loadRuns(): void {
    client.listRuns().then(
      (listed) => setRunList({ runs: listed.runs, error: null }),
      (error: unknown) => setRunList({ runs: null, error: messageOf(error) }),
    );
  }

  /** Read one routine's runs, for its detail. */
  function loadRoutineRuns(name: string, folder: string | null): void {
    client.getRoutine(name, folder ?? undefined).then(
      (got) => setRoutineRuns({ name, folder, runs: got.runs ?? [] }),
      () => setRoutineRuns({ name, folder, runs: [] }),
    );
  }

  /** Ask for this folder's agent types again. `/agents` reads them. */
  function loadAgents(): void {
    client.listAgents(skillsFolder()).then(
      (listed) => {
        setAgentList({ agents: listed.agents, error: null });
      },
      (error: unknown) => {
        setAgentList(agentListFailed(error));
      },
    );
    client.agentsKeep().then(
      (result) => setAgentsKeep(result.values ?? null),
      () => setAgentsKeep(null),
    );
  }

  /** Ask for this folder's skills again. `/skills` reads them. */
  function loadSkills(): void {
    client.listSkills(skillsFolder()).then(
      (listed) => {
        setSkillList({ skills: listed.skills, error: null });
      },
      (error: unknown) => {
        setSkillList({ skills: null, error: messageOf(error) });
      },
    );
  }

  /** The project folder of this chat's folder, which the project tab of `/memory` reads. */
  function memoryFolder(): string {
    return projectFolderOf(skillsFolder(), existsSync, (path) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    });
  }

  /** Read `/memory`'s list for the tab and search it shows. With `after`, the next page is added to it. */
  function loadMemory(after?: string): void {
    const read = ++memoryRead.current;
    client.listMemories(memoryListParams(memoryManagerRef.current, memoryFolder(), after)).then(
      (result) => {
        if (read !== memoryRead.current) {
          return;
        }
        const before = after === undefined ? [] : (memoryListRef.current.items ?? []);
        setMemoryList({
          items: [...before, ...result.items],
          total: result.total,
          counts: result.counts,
          settings: result.settings,
          error: null,
        });
      },
      (error: unknown) => {
        if (read === memoryRead.current) {
          setMemoryList({ ...emptyMemoryList, error: messageOf(error) });
        }
      },
    );
  }

  function showMemoryManager(next: MemoryManagerState): void {
    memoryManagerRef.current = next;
    setMemoryManager(next);
  }

  function onMemoryManagerPress(press: Press): void {
    const key = memoryManagerKeyOf(press, memoryManagerTyping(memoryManagerRef.current));
    if (key === null) {
      return;
    }
    const pressed = pressMemoryManager(memoryManagerRef.current, memoryListRef.current, key);
    showMemoryManager(pressed.state);
    runMemoryAction(pressed.action);
  }

  function runMemoryAction(action: MemoryManagerAction): void {
    const say = (message: string) => showMemoryManager(withMemoryMessage(memoryManagerRef.current, message));
    const failed = (error: unknown) => say(messageOf(error));
    if (action.kind === "close") {
      showMemoryManager(closedMemoryManager);
    } else if (action.kind === "reload") {
      memoryListRef.current = { ...emptyMemoryList, counts: memoryListRef.current.counts, settings: memoryListRef.current.settings };
      setMemoryList(memoryListRef.current);
      loadMemory();
    } else if (action.kind === "more") {
      loadMemory(action.after);
    } else if (action.kind === "edit") {
      void editMemoryText(action.id, action.text);
    } else if (action.kind === "delete") {
      client.deleteMemories([action.id]).then(() => {
        say("deleted");
        loadMemory();
      }, failed);
    } else if (action.kind === "pin") {
      client.updateMemory({ id: action.id, always: action.always }).then(() => {
        say(action.always ? "in every chat" : "not in every chat");
        loadMemory();
      }, failed);
    } else if (action.kind === "export") {
      const folder = action.scope === "project" ? memoryFolder() : undefined;
      client.exportMemories({ format: "markdown", scope: action.scope, ...(folder === undefined ? {} : { folder }) }).then(
        async (exported) => {
          const path = join(skillsFolder(), action.file);
          try {
            // Never over a file that is there, and readable by you only: it may hold private notes.
            await writeFile(path, exported.text, { encoding: "utf8", flag: "wx", mode: 0o600 });
            say(`exported ${exported.count} to ${path}`);
          } catch (error) {
            const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
            say(exists ? `${path} is already there. Move it away, then export again.` : messageOf(error));
          }
        },
        failed,
      );
    }
  }

  /** Edit a memory's text in `$EDITOR` on a temporary file, then save it with `memory.update`. */
  async function editMemoryText(id: string, text: string): Promise<void> {
    if (editing.current) {
      return;
    }
    editing.current = true;
    let message = "";
    const dir = await mkdtemp(join(tmpdir(), "golem-memory-"));
    try {
      const file = join(dir, "memory.md");
      await writeFile(file, text, "utf8");
      if (!(await editFile(file, suspendTerminal))) {
        message = "the editor did not exit cleanly";
      } else {
        const edited = memoryEdited(text, await readFile(file, "utf8"));
        if (edited.kind === "same") {
          message = "no change";
        } else if (edited.kind === "empty") {
          message = "an empty memory is not saved, use d to delete it";
        } else {
          await client.updateMemory({ id, text: edited.text });
          message = "saved";
        }
      }
    } catch (error) {
      message = messageOf(error);
    } finally {
      editing.current = false;
      await rm(dir, { recursive: true, force: true });
    }
    showMemoryManager(withMemoryMessage(memoryManagerRef.current, message));
    loadMemory();
  }

  function submit(): void {
    const outcome = applyComposer(
      debugRef.current,
      expandPastes(draftRef.current.text, pastesRef.current),
      invocableSkills(skillListRef.current.skills ?? []),
      { pinnable: pinnableSkills(skillListRef.current.skills ?? []), active: chatRef.current.activeSkills },
      chipTuneRef.current?.options ?? [],
    );
    if (outcome.kind === "idle") {
      return;
    }
    if (
      (outcome.kind === "send" || outcome.kind === "skill") &&
      (busyRef.current || sessionRef.current === null || connectionRef.current.status !== "connected")
    ) {
      return;
    }
    endHistory();
    if (outcome.kind === "help") {
      setDraft(draftAt(""));
      setPanel("help");
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setChat((current) => ({ ...current, notice: null }));
      return;
    }
    if (outcome.kind === "tune-set") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      const id = sessionRef.current;
      if (id === null) {
        setChat((current) => ({ ...current, notice: "Tuning needs a session." }));
        return;
      }
      client.setSessionOptions(id, { [outcome.name]: outcome.value }).then(
        () => setChat((current) => ({ ...current, notice: outcome.notice })),
        (error: unknown) => setChat((current) => ({ ...current, error: messageOf(error) })),
      );
      return;
    }
    if (outcome.kind === "tune") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setPanel(null);
      const model = sessionModelRef.current;
      const opening = tuneOpening({
        connected: connectionRef.current.status === "connected",
        sessionId: sessionRef.current,
        provider: model?.provider ?? null,
        name: model?.name ?? null,
      });
      if (opening.kind === "notice") {
        setChat((current) => ({ ...current, notice: opening.text }));
        return;
      }
      setChat((current) => ({ ...current, notice: null }));
      loadTune(opening.model, opening.sessionId);
      return;
    }
    if (outcome.kind === "cost") {
      setDraft(draftAt(""));
      setPanel("cost");
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setChat((current) => ({ ...current, notice: null }));
      loadCost();
      return;
    }
    if (outcome.kind === "context") {
      setDraft(draftAt(""));
      setPanel("context");
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setChat((current) => ({ ...current, notice: null }));
      loadContext();
      return;
    }
    setPanel(null);
    if (outcome.kind === "mcp") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      const opened = openMcpManager(sessionCwdRef.current ?? process.cwd());
      mcpManagerRef.current = opened;
      setMcpManager(opened);
      loadMcp();
      loadMcpCatalog();
      return;
    }
    if (outcome.kind === "mcp-add") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      const opened = openMcpAdd(sessionCwdRef.current ?? process.cwd(), outcome.id);
      mcpManagerRef.current = opened;
      setMcpManager(opened);
      loadMcp();
      loadMcpCatalog();
      return;
    }
    if (outcome.kind === "config") {
      setDraft(draftAt(""));
      setChat((current) => ({
        ...current,
        notice: `The config file opens in your editor with: golem config edit${outcome.project ? " --project" : ""}`,
      }));
      return;
    }
    if (outcome.kind === "changes") {
      const id = sessionRef.current;
      if (id === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showChangesManager(openChangesManager());
      loadChanges(id, null);
      loadWriters();
      return;
    }
    if (outcome.kind === "commit") {
      const id = sessionRef.current;
      if (id === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showChangesManager(openChangesManager());
      loadChanges(id, null);
      loadWriters();
      openCommit(id);
      return;
    }
    if (outcome.kind === "notes") {
      const id = sessionRef.current;
      setDraft(draftAt(""));
      if (outcome.clear && id !== null) {
        putNotes(id, noNotes);
      }
      setChat((state) => ({ ...state, notice: outcome.clear ? NOTES_CLEARED : notesNotice(notesOf(id)) }));
      return;
    }
    if (outcome.kind === "undo") {
      setDraft(draftAt(""));
      startUndo();
      return;
    }
    if (outcome.kind === "skills") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      const opened = openSkillsManager();
      skillsManagerRef.current = opened;
      setSkillsManager(opened);
      loadSkills();
      return;
    }
    if (outcome.kind === "agents") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showAgentsManager(openAgentsManager());
      setAgentList({ agents: null, error: null });
      loadAgents();
      return;
    }
    if (outcome.kind === "routines") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showRoutinesManager(openRoutinesManager());
      loadRoutines();
      return;
    }
    if (outcome.kind === "steps") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showStepsManager(openStepsManager());
      return;
    }
    if (outcome.kind === "runs") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showRunsManager(openRunsManager());
      loadRuns();
      return;
    }
    if (outcome.kind === "memory") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showMemoryManager(openMemoryManager());
      memoryListRef.current = emptyMemoryList;
      setMemoryList(emptyMemoryList);
      loadMemory();
      return;
    }
    if (outcome.kind === "skill-new") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      showSkillsManager(openNewSkill());
      loadSkills();
      return;
    }
    if (outcome.kind === "mcp-toggle") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const toggle = outcome.on ? client.enableMcp(current, outcome.name) : client.disableMcp(current, outcome.name);
      toggle.then(
        () => {
          const notice = `${outcome.name} is ${outcome.on ? "on" : "off"} for this session`;
          setChat((state) => ({ ...state, notice }));
          loadMcp();
        },
        (error: unknown) => {
          const notice = error instanceof Error ? error.message : String(error);
          setChat((state) => ({ ...state, notice }));
        },
      );
      return;
    }
    if (outcome.kind === "checks") {
      setDraft(draftAt(""));
      if (sessionRef.current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      answerChecks(outcome.on, true);
      return;
    }
    if (outcome.kind === "mode") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const own = chatRef.current.permissionMode;
      if (outcome.mode === "show") {
        const shown = effectiveMode(own, defaultMode);
        setChat((state) => ({ ...state, notice: modeReport(shown, own !== null, defaultMode) }));
        return;
      }
      changeMode(current, outcome.mode);
      return;
    }
    if (outcome.kind === "plan") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const on = outcome.on === "toggle" ? !chatRef.current.plan.on : outcome.on;
      client.setPlan(current, on).then(
        () => {
          const notice = planChanged(on);
          setChat((state) => ({ ...state, notice }));
        },
        (error: unknown) => {
          setChat((state) => ({ ...state, notice: messageOf(error) }));
        },
      );
      return;
    }
    if (outcome.kind === "route") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      if (outcome.mode === "why") {
        const last = chatRef.current.route.last;
        if (last === null) {
          setChat((state) => ({ ...state, notice: "No model was routed in this session yet." }));
          return;
        }
        costGen.current += 1;
        setCostText(whyLines(last, chatRef.current.route.mode).map((line) => fitLine(line, columns)));
      } else if (outcome.mode === "show") {
        loadRoute(current);
      } else {
        changeRoute(current, outcome.mode);
        return;
      }
      setPanel("cost");
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setChat((state) => ({ ...state, notice: null }));
      return;
    }
    if (outcome.kind === "stronger") {
      setDraft(draftAt(""));
      tryStronger();
      return;
    }
    if (outcome.kind === "skill-pin") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current === null) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const change = outcome.pin ? { pin: [outcome.name] } : { unpin: [outcome.name] };
      client.setSkills(current, change).then(
        () => {
          const notice = outcome.pin
            ? `${outcome.name} is pinned for this session`
            : `${outcome.name} is unpinned`;
          setChat((state) => ({ ...state, notice }));
        },
        (error: unknown) => {
          const notice = error instanceof Error ? error.message : String(error);
          setChat((state) => ({ ...state, notice }));
        },
      );
      return;
    }
    if (outcome.kind === "unknown") {
      setChat((current) => ({ ...current, notice: outcome.notice }));
      return;
    }
    if (outcome.kind === "permissions") {
      setDraft(draftAt(""));
      const opened = openPermissions();
      permsRef.current = opened;
      setPerms(opened);
      loadPermissions();
      return;
    }
    if (outcome.kind === "sessions") {
      setDraft(draftAt(""));
      setSwitcher(openSwitcher(sessionRef.current));
      return;
    }
    if (outcome.kind === "setup") {
      setDraft(draftAt(""));
      openSetup(OVERVIEW);
      loadModels(false);
      return;
    }
    if (outcome.kind === "model") {
      setDraft(draftAt(""));
      if (outcome.name === null) {
        const next = openPicker(currentModelRef());
        pickerRef.current = next;
        setPicker(next);
        setSwitcher(closedSwitcher);
        loadModels(false);
        return;
      }
      const name = outcome.name;
      const known = listingRef.current?.models.find((model) => model.ref === name || (model.profiles ?? []).includes(name));
      chooseModel(known ?? null, name, false);
      return;
    }
    if (outcome.kind === "model-pull" || outcome.kind === "model-rm") {
      setDraft(draftAt(""));
      confirmFromCommand(outcome.kind === "model-pull" ? "pull" : "delete", outcome.name);
      return;
    }
    if (outcome.kind === "login") {
      setDraft(draftAt(""));
      openKeyPanel(outcome.provider, "chat");
      return;
    }
    if (outcome.kind === "logout") {
      setDraft(draftAt(""));
      removeKey(outcome.provider);
      return;
    }
    if (outcome.kind === "new") {
      setDraft(draftAt(""));
      session.startNew();
      return;
    }
    if (outcome.kind === "fork") {
      setDraft(draftAt(""));
      forkHere();
      return;
    }
    if (outcome.kind === "compact") {
      setDraft(draftAt(""));
      compactHere(outcome.action, outcome.focus);
      return;
    }
    if (outcome.kind === "title") {
      setDraft(draftAt(""));
      retitle(outcome.title);
      return;
    }
    if (outcome.kind === "close-session") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      if (current !== null && connectionRef.current.status === "connected") {
        closeHere(current, false);
      }
      return;
    }
    if (outcome.kind === "copy") {
      setDraft(draftAt(""));
      const text = outcome.code ? copyCode(chatRef.current.messages) : copyAnswer(chatRef.current.messages);
      if (text === null) {
        showHint(outcome.code ? "no code block to copy" : "nothing to copy yet");
        return;
      }
      void copyText(text).then(
        (way) => {
          showHint(copiedHint(way, text));
        },
        (error: unknown) => {
          setChat((current) => ({ ...current, notice: messageOf(error) }));
        },
      );
      return;
    }
    if (outcome.kind === "artifact") {
      setDraft(draftAt(""));
      const current = sessionRef.current;
      const id = outcome.id ?? newestArtifact(chatRef.current.messages);
      if (current === null || id === null) {
        showHint("no tool output was long enough to keep");
        return;
      }
      void client
        .readArtifact(current, id)
        .then((page) => showInPager(page.text, suspendTerminal))
        .catch((error: unknown) => {
          setChat((state) => ({ ...state, notice: messageOf(error) }));
        });
      return;
    }
    if (outcome.kind === "export") {
      setDraft(draftAt(""));
      const title = shownSessionTitle(
        sessionRef.current,
        liveTitleRef.current,
        sessionsRef.current.find((summary) => summary.session_id === sessionRef.current)?.title,
      );
      const file = exportDestination({ home: homedir(), title, given: outcome.path });
      void writeExport(file, sessionMarkdown(title, chatRef.current.messages)).then(
        () => {
          // Longer than other hints: it names a file you may want to open.
          showHint(`exported to ${file}`, EXPORT_HINT_MS);
        },
        (error: unknown) => {
          setChat((current) => ({ ...current, notice: messageOf(error) }));
        },
      );
      return;
    }
    if (outcome.kind === "time") {
      setDraft(draftAt(""));
      prefsLoaded.current = true;
      const next = !showTimesRef.current;
      showTimesRef.current = next;
      setShowTimes(next);
      showHint(next ? "timestamps on" : "timestamps off");
      void savePref(prefsPath(), "times", next).catch(() => undefined);
      return;
    }
    if (outcome.kind === "todos") {
      setDraft(draftAt(""));
      prefsLoaded.current = true;
      const next = !showTodosRef.current;
      showTodosRef.current = next;
      setShowTodos(next);
      showHint(next ? "todo list shown" : "todo list hidden");
      void savePref(prefsPath(), "todos", next).catch(() => undefined);
      return;
    }
    if (outcome.kind === "thinking") {
      setDraft(draftAt(""));
      prefsLoaded.current = true;
      const next = !showThinkingRef.current;
      showThinkingRef.current = next;
      setShowThinking(next);
      showHint(next ? "thinking shown" : "thinking hidden");
      void savePref(prefsPath(), "thinking", next).catch(() => undefined);
      return;
    }
    if (outcome.kind === "detail") {
      setDraft(draftAt(""));
      showHint("/detail is a setting of the web page");
      return;
    }
    if (outcome.kind === "local") {
      showDebug(outcome.debug);
      setDraft(draftAt(outcome.restore ?? ""));
      setChat((current) => ({ ...current, notice: outcome.notice }));
      if (outcome.refreshModel) {
        const current = sessionRef.current;
        if (current !== null && connectionRef.current.status === "connected") {
          loadCheckpointRef.current(current);
        }
      }
      return;
    }
    if (sessionRef.current === null) {
      return;
    }
    showDebug(outcome.debug);
    setDraft(draftAt(""));
    // The draft is gone, so its pastes are too. The numbers keep counting.
    pastesRef.current = { next: pastesRef.current.next, texts: new Map() };
    if (outcome.kind === "send") {
      // The notes go out ahead of the message, and are dropped once the send worked.
      const taken = notesOf(sessionRef.current);
      sendText(outcome.text, undefined, taken.notes.length === 0 ? undefined : takeNotes(taken, outcome.text));
      return;
    }
    sendText(outcome.text, { name: outcome.name, args: outcome.args });
  }

  /**
   * Send `text` to this session. On an error it goes back into the composer.
   * With `skill`, the daemon runs that skill once, and `text` is the line as typed.
   */
  function sendText(text: string, skill?: SkillCall, withReview?: { text: string; ids: readonly string[] }): void {
    const currentSession = sessionRef.current;
    if (currentSession === null || busyRef.current || connectionRef.current.status !== "connected") {
      setDraft(draftAt(text));
      return;
    }
    setOffset(0);
    setWelcomeModel(null);
    setChat((current) => ({ ...current, notice: null }));
    const options = skill === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), skill };
    void client.sendMessage(currentSession, withReview?.text ?? text, options).then(
      () => {
        sentHistory.current.remember(text);
        if (withReview !== undefined) {
          putNotes(currentSession, dropNotes(notesOf(currentSession), withReview.ids));
        }
      },
      (error: unknown) => {
        setDraft(draftAt(text));
        if (error instanceof RpcError && error.code === SESSION_NOT_FOUND) {
          setChat((current) => ({ ...current, notice: "session was not found; started a new one" }));
          session.startNew();
          return;
        }
        if (error instanceof RpcError && noModelChosen(error.code, error.message, MODEL_NOT_CONFIGURED)) {
          setChat((current) => ({ ...current, busy: false, error: NO_MODEL_NOTICE }));
          openSetup(guided("engine", "send"));
          return;
        }
        setChat((current) => ({ ...current, busy: false, error: messageOf(error) }));
      },
    );
  }

  function showSetup(next: SetupUi | null): void {
    if (next !== null && next.window.view === "panel" && next.window.panel !== "tools" && next.window.panel !== "ready") {
      readMcpFacts();
    }
    setupRef.current = next;
    setSetupState(next);
  }

  function newSetup(window: SetupWindow, state: ServiceState): SetupUi {
    return {
      window,
      service: state,
      engine: engineSelected(listingRef.current),
      path: "pick",
      overview: { selected: 0, rows: null, notice: null },
      quit: null,
      ready: null,
      tools: newToolsUi(),
      toolsRan: [],
      ollama: { phase: "missing", selected: 0, note: null },
      model: START_MODEL_PANEL,
      scope: { kind: "local" },
      provider: 0,
      hosted: null,
      key: openKey("anthropic", null),
    };
  }

  /** Who runs the service that answers: launchd, this terminal, or someone else. Null when none answers. */
  function serviceRunner(): ServiceRunner | null {
    if (connectionRef.current.status !== "connected") {
      return null;
    }
    if (windowDaemon.current !== null && !windowDaemon.current.exited()) {
      return "window";
    }
    return service?.installed() === true ? "launchd" : "other";
  }

  /**
   * The Service panel when nothing answers at the start. With no launch agent
   * it asks. With one that launchd runs, launchd is starting it, or it failed
   * and said why. With one launchd doesn't run, such as after `brew uninstall`
   * or `launchctl bootout`, it is installed again: the plist says yes was given.
   */
  function serviceAtStart(): { state: ServiceState; reinstall: boolean } {
    if (service?.installed() !== true) {
      return { state: askService(null), reinstall: false };
    }
    const error = service.startError();
    if (error !== null) {
      const failed: ServiceState = { phase: "starting", how: "install", agent: true, since: Date.now() };
      return { state: serviceFailed(failed, error.reason, error.next), reinstall: false };
    }
    const loaded = service.agentLoaded();
    return { state: { phase: "starting", how: "install", agent: loaded, since: Date.now() }, reinstall: !loaded };
  }

  function setupFacts(): SetupFacts {
    return { ollamaRunning: listingRef.current?.setup.ollama_running === true, mcpEmpty: mcpFactsRef.current.empty };
  }

  /**
   * Read the user's own MCP servers for the navigation: Tools is offered when the config has
   * none. It is read as the early panels open and not again, so Ready still counts Tools as a
   * step after Tools added some.
   */
  function readMcpFacts(): void {
    void client.listMcp().then(
      (listed) => {
        const own = listed.servers.filter((server) => server.project == null).map((server) => server.name);
        mcpFactsRef.current = { empty: own.length === 0, names: own };
        setSetupNow(Date.now());
      },
      () => undefined,
    );
  }

  /** Open the window. The overview reads `setup.status` as it opens. */
  function openSetup(window: SetupWindow): void {
    setSwitcher(closedSwitcher);
    pickerRef.current = closedPicker;
    setPicker(closedPicker);
    const ui = newSetup(window, askService(serviceRunner()));
    if (window.view === "overview") {
      showSetup(ui);
      recheck();
      return;
    }
    goSetup({ kind: "window", window }, ui);
  }

  /** Close the window and go to the chat. The band says what is still wrong. */
  function closeSetup(): void {
    showSetup(null);
    refreshBand();
  }

  /** Go where the navigation table says. */
  function goSetup(next: SetupNext, ui: SetupUi): void {
    if (next.kind === "quit") {
      exit();
      return;
    }
    if (next.kind === "chat") {
      closeSetup();
      return;
    }
    const window = next.window;
    const moved: SetupUi = { ...ui, window, quit: null };
    if (ui.window.view === "panel" && ui.window.panel === "tools") {
      // Leaving Tools: Ready names what was added, and no token outlives the panel.
      moved.toolsRan = [...ui.toolsRan, ...toolsRan(ui.tools.state)];
      moved.tools = newToolsUi();
    }
    if (window.view === "overview") {
      showSetup({ ...moved, overview: { ...ui.overview, selected: 0 } });
      recheck();
      return;
    }
    if (window.panel === "service" && ui.service.phase !== "starting") {
      moved.service = askService(serviceRunner());
    }
    if (window.panel === "engine") {
      moved.engine = engineSelected(listingRef.current);
    }
    if (window.panel === "ollama") {
      const opened = ollamaAtOpen(listingRef.current, Date.now());
      if (opened === "running") {
        goSetup(advance(window, { kind: "done" }, setupFacts()), moved);
        return;
      }
      moved.ollama = opened;
      showSetup(moved);
      if (opened.phase === "starting") {
        startOllamaNow();
      }
      return;
    }
    if (window.panel === "model") {
      moved.scope = moved.path === "key" && moved.hosted !== null && window.mode === "guided"
        ? { kind: "provider", provider: moved.hosted }
        : modelScope(window);
      const listing = listingRef.current;
      const selected = listing === null ? 0 : modelSelected(modelChoices(listing, moved.scope, false));
      moved.model = { phase: "pick", selected, all: false };
    }
    if (window.panel === "provider") {
      moved.provider = providerSelected(listingRef.current);
    }
    if (window.panel === "tools") {
      moved.tools = newToolsUi();
      showSetup(moved);
      loadTools(window.mode);
      return;
    }
    if (window.panel === "key") {
      const hosted = moved.hosted ?? "anthropic";
      moved.hosted = hosted;
      moved.key = openKey(hosted, shellKey(hosted));
    }
    showSetup(moved);
  }

  /** The provider's key from the terminal golem was started in. The daemon never reads the shell. */
  function shellKey(provider: string): string | null {
    const name = hostedProvider(provider)?.env;
    const value = name === undefined ? undefined : process.env[name];
    return value === undefined || value.trim().length === 0 ? null : value.trim();
  }

  /** `/login` and Add an API key: the Key panel for `provider`, or the Provider panel first. */
  function openKeyPanel(provider: string | null, origin: "chat" | "overview", from?: SetupUi): void {
    const window = single(provider === null ? "provider" : "key", origin);
    const ui = from ?? newSetup(window, askService(serviceRunner()));
    setSwitcher(closedSwitcher);
    goSetup({ kind: "window", window }, { ...ui, hosted: provider, path: "key" });
  }

  /** Read the catalog for the Tools offer. A guided window with nothing to offer moves on. */
  function loadTools(mode: "guided" | "single"): void {
    client.mcpCatalog().then(
      (listed) => {
        const ui = setupRef.current;
        if (ui === null || ui.window.view !== "panel" || ui.window.panel !== "tools" || ui.tools.state !== null) {
          return;
        }
        const state = toolsOffer(listed.entries, mode);
        if (state.rows.length === 0 && mode === "guided") {
          goSetup(advance(ui.window, TOOLS_SKIP, setupFacts()), ui);
          return;
        }
        showSetup({ ...ui, tools: { ...ui.tools, state } });
      },
      (error: unknown) => updateTools((tools) => ({ ...tools, error: messageOf(error) })),
    );
  }

  function updateTools(change: (tools: ToolsUi) => ToolsUi): void {
    updateSetup((ui) => (ui.window.view === "panel" && ui.window.panel === "tools" ? { ...ui, tools: change(ui.tools) } : ui));
  }

  /** The Tools model changes only when the panel still has a model to change. */
  function changeToolsState(change: (state: ToolsState) => ToolsState): void {
    updateTools((tools) => (tools.state === null ? tools : { ...tools, state: change(tools.state) }));
  }

  /** Take the model's next effect, one at a time, until the run has nothing left to do. */
  function driveTools(): void {
    const ui = setupRef.current;
    const state = ui?.tools.state;
    if (ui === null || state == null || ui.window.view !== "panel" || ui.window.panel !== "tools") {
      return;
    }
    const stepped = toolsStep(state);
    const effect = stepped.effect;
    if (effect.kind === "none") {
      return;
    }
    showSetup({ ...ui, tools: { ...ui.tools, state: stepped.state } });
    if (effect.kind === "install") {
      installToolsRuntime(effect.runtime);
    } else {
      addToolsServer(effect.id, effect.params);
    }
  }

  /** Node or uv through the daemon, as Ollama is; its output reaches the row that waits for it. */
  function installToolsRuntime(runtime: ToolsRuntime): void {
    const stop = client.onRuntimeInstall((update) => {
      if (update.kind === "output") {
        if (update.name === runtime) {
          changeToolsState((state) => toolsRuntimeOutput(state, runtime, update.text));
        }
        return;
      }
      if (update.done.name !== runtime) {
        return;
      }
      stop();
      const done = update.done;
      changeToolsState((state) => toolsRuntimeDone(state, runtime, done.ok, done.error ?? null));
      driveTools();
    });
    client.installRuntime(runtime).catch((error: unknown) => {
      stop();
      changeToolsState((state) => toolsRuntimeDone(state, runtime, false, messageOf(error)));
      driveTools();
    });
  }

  /**
   * Add a server and try it. The token goes only to the daemon, which keeps it in the Keychain,
   * and the row drops it when the add ends. A server this panel saved before is taken out first.
   */
  function addToolsServer(id: string, params: McpAddParams): void {
    void (async () => {
      if (setupRef.current?.tools.created.includes(params.name) === true) {
        await client.removeMcpServer(params.name).catch(() => undefined);
        updateTools((tools) => ({ ...tools, created: tools.created.filter((name) => name !== params.name) }));
      }
      const server = await client.addMcpServer(params);
      updateTools((tools) => ({ ...tools, created: [...tools.created, server.name] }));
      if (setupRef.current?.tools.state?.rows.find((row) => row.id === id)?.oauth === true) {
        await signInToolsServer(id, server.name);
        return;
      }
      const result = await client.mcpTest({ name: server.name });
      if (result.ok) {
        changeToolsState((state) => toolsAdded(state, id, result.tools?.length ?? 0));
      } else {
        const step = result.steps.find((each) => each.state === "failed");
        changeToolsState((state) => toolsFailed(state, id, result.hint ?? step?.detail ?? "the server didn't start"));
      }
    })()
      .catch((error: unknown) => changeToolsState((state) => toolsFailed(state, id, messageOf(error))))
      .finally(driveTools);
  }

  /** A hosted server that signs in with the browser: open the address and wait for the daemon to say it ended. */
  function signInToolsServer(id: string, name: string): Promise<void> {
    changeToolsState((state) => toolsSigningIn(state, id));
    return new Promise<void>((resolve) => {
      const finish = (change: (state: ToolsState) => ToolsState): void => {
        stop();
        changeToolsState(change);
        resolve();
      };
      const stop = client.onMcpLoginDone((done) => {
        if (done.name !== name) {
          return;
        }
        if (!done.ok) {
          finish((state) => toolsFailed(state, id, done.error ?? `could not sign in to ${name}`));
          return;
        }
        void client
          .mcpTools(name)
          .then((result) => result.tools.length, () => 0)
          .then((count) => finish((state) => toolsAdded(state, id, count)));
      });
      client.mcpLogin(name).then(
        (started) => {
          changeToolsState((state) => toolsSignInUrl(state, id, started.authorize_url));
          openUrl(started.authorize_url);
        },
        (error: unknown) => finish((state) => toolsFailed(state, id, messageOf(error))),
      );
    });
  }

  function onToolsPress(ui: SetupUi, press: Press): void {
    const key = toolsKeyOf(press, toolsTyping(ui.tools));
    if (key === null) {
      return;
    }
    if (key.kind === "interrupt" || key.kind === "quit") {
      showSetup({ ...ui, quit: 0 });
      return;
    }
    const pressed = pressTools(ui.tools, key);
    showSetup({ ...ui, tools: pressed.ui });
    runToolsAct(pressed.act, pressed.ui);
  }

  function runToolsAct(act: ToolsAct, tools: ToolsUi): void {
    const ui = setupRef.current;
    if (ui === null || ui.window.view !== "panel") {
      return;
    }
    switch (act.kind) {
      case "none":
        return;
      case "step":
        driveTools();
        return;
      case "leave":
        goSetup(advance(ui.window, act.result, setupFacts()), ui);
        return;
      case "stop":
        if (act.runtime !== null) {
          void client.cancelRuntimeInstall(act.runtime).catch(() => undefined);
        }
        return;
      case "remove":
        void client.removeMcpServer(act.name).catch(() => undefined);
        return;
      case "logs": {
        const row = tools.state?.rows.find((each) => each.id === act.id);
        if (row === undefined) {
          return;
        }
        const show = (lines: string[]) => updateTools((now) => ({ ...now, log: { title: `${row.title} · log`, lines } }));
        client.mcpLogs(row.name).then((logs) => show(logs.lines.map(formatLogLine)), (error: unknown) => show([messageOf(error)]));
        return;
      }
    }
  }

  function onProviderKey(ui: SetupUi, window: SetupWindow & { view: "panel" }, key: SetupKey): void {
    if (key === "back") {
      goSetup(advance(window, { kind: "cancelled" }, setupFacts()), ui);
      return;
    }
    if (key !== "up" && key !== "down" && key !== "enter") {
      return;
    }
    const pressed = pressProvider(listingRef.current, ui.provider, key);
    if (pressed.provider === null) {
      showSetup({ ...ui, provider: pressed.selected });
      return;
    }
    goSetup(advance(window, { kind: "provider", provider: pressed.provider }, setupFacts()), {
      ...ui,
      provider: pressed.selected,
      hosted: pressed.provider,
    });
  }

  /** The Key panel takes raw keys: q and r are letters of a key there. */
  function keyInputOf(press: Press, typing: boolean): KeyInput | "interrupt" | null {
    switch (press.name) {
      case "escape":
        return { kind: "back" };
      case "return":
        return { kind: "enter" };
      case "ctrl-c":
        return "interrupt";
      case "up":
        return typing ? null : { kind: "up" };
      case "down":
        return typing ? null : { kind: "down" };
      case "backspace":
        return { kind: "delete" };
      case "ctrl-u":
      case "ctrl-w":
        return { kind: "clear" };
      default:
        break;
    }
    if ((press.name === null || press.name === "question") && !press.ctrl && !press.meta && press.input.length > 0) {
      return typing ? { kind: "text", text: press.input } : null;
    }
    return null;
  }

  function onKeyInput(ui: SetupUi, window: SetupWindow & { view: "panel" }, input: KeyInput): void {
    const pressed = pressKeyPanel(ui.key, input, Date.now());
    showSetup({ ...ui, key: pressed.state });
    const effect = pressed.effect;
    if (effect.kind === "back") {
      goSetup(advance(window, { kind: "cancelled" }, setupFacts()), ui);
      return;
    }
    if (effect.kind !== "check") {
      return;
    }
    const key = effect.key === "shell" ? (shellKey(effect.provider) ?? "") : effect.key.typed;
    void client.setKey(effect.provider, key).then(
      (result) => {
        updateSetup((now) => ({ ...now, key: keyChecked(now.key, { ok: true, models: result.models ?? null }, Date.now()) }));
        // The first read of the new key by this daemon may wait on the Keychain dialog.
        void client.listModels(true).then(
          (listed) => {
            listingRef.current = listed;
            setListing(listed);
            setChat((current) => providersUp(current, listed.providers));
            const now = setupRef.current;
            if (now === null || now.window.view !== "panel" || now.window.panel !== "key") {
              return;
            }
            const name = hostedProvider(effect.provider)?.name ?? effect.provider;
            goSetup(advance(now.window, { kind: "done" }, setupFacts()), {
              ...now,
              overview: { ...now.overview, notice: `${name} key saved` },
            });
            if (now.window.mode === "single" && now.window.origin === "chat") {
              setChat((current) => ({ ...current, error: null, notice: `${name} key saved in the Keychain · /model to use it` }));
            }
          },
          (error: unknown) => {
            updateSetup((now) => ({ ...now, key: { phase: "typing", provider: effect.provider, value: "", error: `models: ${messageOf(error)}` } }));
          },
        );
      },
      (error: unknown) => {
        const reason =
          error instanceof RpcError && error.code === KEY_UNCHECKED
            ? `couldn't check it: ${error.message}`
            : messageOf(error);
        updateSetup((now) => ({ ...now, key: keyChecked(now.key, { ok: false, reason }, Date.now()) }));
      },
    );
  }

  /** Guided mode offers this Mac's models. Alone it offers every engine's, or names a default that is gone. */
  function modelScope(window: SetupWindow & { view: "panel" }): ModelScope {
    if (window.mode === "guided") {
      return { kind: "local" };
    }
    const listing = listingRef.current;
    if (window.origin === "start" && listing !== null && listing.default !== null && defaultGone(listing)) {
      return { kind: "gone", name: listing.default };
    }
    return { kind: "all", current: currentModelRef() ?? listing?.default ?? null };
  }

  function updateSetup(change: (ui: SetupUi) => SetupUi): void {
    const ui = setupRef.current;
    if (ui !== null) {
      showSetup(change(ui));
    }
  }

  /** Start Ollama, list the models again, and go on to the Model panel. */
  function startOllamaNow(): void {
    updateSetup((ui) => ({ ...ui, ollama: { phase: "starting", since: Date.now(), installed: ui.ollama.phase === "starting" && ui.ollama.installed } }));
    void client
      .startOllama()
      .then(async (result) => {
        if (!result.running) {
          throw new Error("Ollama didn't start");
        }
        const listed = await client.listModels(true);
        listingRef.current = listed;
        setListing(listed);
        setChat((current) => providersUp(current, listed.providers));
        const ui = setupRef.current;
        if (ui !== null && ui.window.view === "panel" && ui.window.panel === "ollama") {
          goSetup(advance(ui.window, { kind: "done" }, { ollamaRunning: true }), ui);
        }
      })
      .catch((error: unknown) => {
        updateSetup((ui) => ({ ...ui, ollama: { phase: "failed", reason: messageOf(error), selected: 0 } }));
      });
  }

  /** The daemon installs Ollama with Homebrew; its output reaches every window. */
  function installOllamaHere(): void {
    let tail: InstallTail = { last: "", partial: "" };
    const stop = client.onOllamaInstall((update) => {
      const event = installEventOf(update);
      if (event.kind === "output") {
        tail = appendInstallOutput(tail, event.text);
        const last = tail.last;
        updateSetup((ui) => (ui.ollama.phase === "installing" ? { ...ui, ollama: { ...ui.ollama, last } } : ui));
        return;
      }
      stop();
      const outcome = event.kind === "error" ? "failed" : event.stopped ? "stopped" : event.code === 0 ? "installed" : "failed";
      const reason = event.kind === "error" ? event.message : tail.last.length > 0 ? tail.last : "brew install ollama failed";
      updateSetup((ui) => ({ ...ui, ollama: ollamaInstallEnded(ui.ollama, outcome, reason, Date.now()) }));
      if (outcome === "installed") {
        startOllamaNow();
      }
    });
    client.installOllama().catch((error: unknown) => {
      stop();
      if (error instanceof RpcError && error.code === OLLAMA_FAILED && error.data?.["no_brew"] === true) {
        updateSetup((ui) => ({ ...ui, ollama: ollamaInstallEnded(ui.ollama, "no_brew", "", Date.now()) }));
        openDownloadPage();
        return;
      }
      updateSetup((ui) => ({ ...ui, ollama: ollamaInstallEnded(ui.ollama, "failed", messageOf(error), Date.now()) }));
    });
  }

  function openDownloadPage(): void {
    try {
      spawn("open", [OLLAMA_DOWNLOAD_URL], { stdio: "ignore", detached: true }).unref();
    } catch {
      // The panel still names the page.
    }
  }

  function onOllamaKey(ui: SetupUi, window: SetupWindow & { view: "panel" }, key: SetupKey): void {
    if (key !== "up" && key !== "down" && key !== "enter" && key !== "back") {
      return;
    }
    const pressed = pressOllama(ui.ollama, key, Date.now());
    showSetup({ ...ui, ollama: pressed.state });
    switch (pressed.effect.kind) {
      case "install":
        installOllamaHere();
        break;
      case "website":
        openDownloadPage();
        break;
      case "cancel":
        void client.cancelOllamaInstall().catch(() => undefined);
        break;
      case "back":
        goSetup(advance(window, { kind: "cancelled" }, setupFacts()), ui);
        break;
      case "none":
        break;
    }
  }

  function onModelKey(ui: SetupUi, window: SetupWindow & { view: "panel" }, key: SetupKey): void {
    if (key !== "up" && key !== "down" && key !== "enter" && key !== "back") {
      return;
    }
    const pressed = pressModel(withPulls(listingRef.current, pullsRef.current), ui.scope, ui.model, key, Date.now());
    showSetup({ ...ui, model: pressed.state });
    const effect = pressed.effect;
    switch (effect.kind) {
      case "choose":
        chooseModel(effect.model, pickerName(effect.model), true);
        modelPicked(effect.model.provider, effect.model.label);
        break;
      case "pull":
        pullTracks.current.set(effect.model.ref, startPullTrack(effect.model, Date.now()));
        startPull(effect.model.ref, false, true);
        break;
      case "background":
        if (ui.model.phase === "downloading") {
          // The download goes on in the band, and the model is used once it is in.
          useAfterPull.current.set(ui.model.ref, { setDefault: true });
        }
        goSetup(advance({ ...window, panel: "model" }, { kind: "background" }, setupFacts()), ui);
        break;
      case "back":
        goSetup(advance(window, { kind: "cancelled" }, setupFacts()), ui);
        break;
      case "none":
        break;
    }
  }

  /** The start's decision, once the service answers and the model list is in. */
  function applyStart(start: SetupStart | null): void {
    if (start === null) {
      return;
    }
    if (start.kind === "none") {
      showSetup(null);
      const listed = listingRef.current?.models.find(
        (model) => model.ref === listingRef.current?.default || (model.profiles ?? []).includes(listingRef.current?.default ?? ""),
      );
      setWelcomeModel(listed?.label ?? listingRef.current?.default ?? "");
      refreshBand();
      return;
    }
    if (start.kind === "auto") {
      showSetup(null);
      chooseModel(start.model, pickerName(start.model), true, `Using ${start.model.ref}, the only model ready. /setup to change.`);
      return;
    }
    // A default that is gone is named by the Model panel itself (E3).
    goSetup({ kind: "window", window: start.window }, newSetup(start.window, askService(serviceRunner())));
  }

  /** Service is done: on to Engine, or, at the start, wherever the model list says. */
  function serviceDone(): void {
    const ui = setupRef.current;
    if (ui === null || ui.window.view !== "panel") {
      return;
    }
    const settled: SetupUi = { ...ui, service: askService(serviceRunner()) };
    if (ui.window.origin === "start") {
      const start = setupAtStart(true, listingRef.current);
      if (start === null) {
        showSetup(settled);
        awaitingListing.current = true;
        return;
      }
      if (start.kind !== "window" || start.window.view !== "panel" || start.window.panel !== "engine") {
        applyStart(start);
        return;
      }
    }
    goSetup(advance(ui.window, { kind: "done" }, setupFacts()), settled);
  }

  function updateService(change: (state: ServiceState) => ServiceState): void {
    const ui = setupRef.current;
    if (ui !== null) {
      showSetup({ ...ui, service: change(ui.service) });
    }
  }

  function failService(reason: string, next: string): void {
    updateService((state) => serviceFailed(state, reason, next));
  }

  /** `golem daemon install`, then launchd starts the service and the client finds it. */
  function installService(): void {
    const install = service?.install ?? null;
    if (install === null) {
      failService("this golem can't install its service", "golem install");
      return;
    }
    // Retry while the first install still runs waits for that one.
    if (installing.current) {
      return;
    }
    windowDaemon.current?.stop();
    windowDaemon.current = null;
    installing.current = true;
    install()
      .then(
        () => updateService((state) => agentInstalled(state, Date.now())),
        (error: unknown) => failService(messageOf(error), "golem daemon logs"),
      )
      .finally(() => {
        installing.current = false;
      });
  }

  /** The service as a child of this terminal. From launchd's, the launch agent goes first. */
  function serveHere(): void {
    const serve = service?.serve ?? null;
    if (serve === null) {
      failService("this golem can't start its service", "golem daemon install");
      return;
    }
    const start = (): void => {
      try {
        windowDaemon.current = serve();
      } catch (error) {
        failService(messageOf(error), "golem daemon logs");
      }
    };
    const uninstall = service?.uninstall ?? null;
    if (service?.installed() === true && uninstall !== null) {
      uninstall().then(start, (error: unknown) => failService(messageOf(error), "golem daemon logs"));
      return;
    }
    start();
  }

  /** Stop and remove the service. golem can't answer without it, so it quits. */
  function removeService(): void {
    const uninstall = service?.uninstall ?? null;
    windowDaemon.current?.stop();
    windowDaemon.current = null;
    if (uninstall === null) {
      exit();
      return;
    }
    uninstall().then(
      () => exit(),
      (error: unknown) => failService(messageOf(error), "golem daemon uninstall"),
    );
  }

  /** A model was chosen in the picker: Ready in guided mode, else back where the panel came from. */
  function modelPicked(provider: string | null, label: string): void {
    const ui = setupRef.current;
    if (ui === null || ui.window.view !== "panel") {
      return;
    }
    const engine = provider === "ollama" ? "Ollama on this Mac" : provider === null ? "" : `${providerName(provider)} with an API key`;
    const ready = { engine, model: `${label} · saved as default` };
    const asModel: SetupWindow = { ...ui.window, panel: "model" };
    // Back on the overview, it says what changed.
    const overview = { ...ui.overview, notice: `default is now ${label}` };
    goSetup(advance(asModel, { kind: "done" }, setupFacts()), { ...ui, ready, overview });
  }

  /** Read `setup.status` again for the overview and the band. */
  function recheck(): void {
    readMcpFacts();
    const ui = setupRef.current;
    if (ui !== null && ui.window.view === "overview") {
      showSetup({ ...ui, overview: { ...ui.overview, rows: null } });
    }
    void client.setupStatus().then(
      (result) => {
        setBandRows(result.rows);
        const now = setupRef.current;
        if (now !== null && now.window.view === "overview") {
          const count = overviewChoices(result.rows, undefined, setupFacts()).length;
          showSetup({
            ...now,
            overview: { ...now.overview, rows: result.rows, selected: Math.min(now.overview.selected, count - 1) },
          });
        }
      },
      (error: unknown) => {
        const now = setupRef.current;
        if (now !== null && now.window.view === "overview") {
          showSetup({ ...now, overview: { ...now.overview, rows: [], notice: `couldn't check: ${messageOf(error)}` } });
        }
      },
    );
  }

  function refreshBand(): void {
    if (connectionRef.current.status !== "connected") {
      return;
    }
    void client.setupStatus().then(
      (result) => setBandRows(result.rows),
      () => undefined,
    );
  }

  function onSetupPress(press: Press): void {
    const ui = setupRef.current;
    if (ui !== null && ui.quit === null && ui.window.view === "panel" && ui.window.panel === "key") {
      const input = keyInputOf(press, ui.key.phase === "typing");
      if (input === "interrupt") {
        showSetup({ ...ui, quit: 0 });
      } else if (input !== null) {
        onKeyInput(ui, ui.window, input);
      }
      return;
    }
    if (ui !== null && ui.quit === null && ui.window.view === "panel" && ui.window.panel === "tools") {
      onToolsPress(ui, press);
      return;
    }
    const key = setupKeyOf(press);
    if (ui === null || key === null) {
      return;
    }
    if (ui.quit !== null) {
      if (key === "interrupt") {
        exit();
        return;
      }
      onQuitKey(ui, ui.quit, key);
      return;
    }
    if (key === "quit" || key === "interrupt") {
      if (ui.window.view === "overview" || ui.window.panel === "ready") {
        closeSetup();
      } else if (ui.window.panel === "service" && serviceRunner() === null) {
        exit();
      } else {
        showSetup({ ...ui, quit: 0 });
      }
      return;
    }
    if (ui.window.view === "overview") {
      onOverviewKey(ui, key);
      return;
    }
    if (ui.window.panel === "service") {
      onServiceKey(ui, key);
    } else if (ui.window.panel === "engine") {
      onEngineKey(ui, ui.window, key);
    } else if (ui.window.panel === "ollama") {
      onOllamaKey(ui, ui.window, key);
    } else if (ui.window.panel === "model") {
      onModelKey(ui, ui.window, key);
    } else if (ui.window.panel === "provider") {
      onProviderKey(ui, ui.window, key);
    } else if (ui.window.panel === "ready" && key === "enter") {
      closeSetup();
    }
  }

  function onQuitKey(ui: SetupUi, selected: number, key: SetupKey): void {
    if (key === "up" || key === "down") {
      showSetup({ ...ui, quit: move(selected, QUIT_CHOICES.length, key) });
    } else if (key === "back") {
      showSetup({ ...ui, quit: null });
    } else if (key === "enter") {
      if (QUIT_CHOICES[selected]?.id === "quit") {
        closeSetup();
      } else {
        showSetup({ ...ui, quit: null });
      }
    }
  }

  function onServiceKey(ui: SetupUi, key: SetupKey): void {
    if (key === "recheck" || key === "quit" || key === "interrupt") {
      return;
    }
    const now = Date.now();
    if (key === "back" && ui.service.phase !== "confirm") {
      if (ui.service.phase !== "starting" && ui.service.phase !== "running") {
        goSetup(advance(ui.window, { kind: "cancelled" }, setupFacts()), ui);
      }
      return;
    }
    const pressed = pressService(ui.service, key, now);
    showSetup({ ...ui, service: pressed.state });
    switch (pressed.effect.kind) {
      case "install":
        installService();
        break;
      case "session":
        serveHere();
        break;
      case "done":
        serviceDone();
        break;
      case "remove":
        removeService();
        break;
      case "log": {
        const own = windowDaemon.current;
        const log = own !== null ? own.output().trim().split("\n").slice(-8) : (service?.logTail() ?? []);
        updateService((state) => withLog(state, log.length > 0 ? log : ["the log is empty"]));
        break;
      }
      case "quit":
        exit();
        break;
      case "none":
        break;
    }
  }

  function onEngineKey(ui: SetupUi, window: SetupWindow & { view: "panel" }, key: SetupKey): void {
    if (key === "back") {
      goSetup(advance(window, { kind: "cancelled" }, setupFacts()), ui);
      return;
    }
    if (key !== "up" && key !== "down" && key !== "enter") {
      return;
    }
    const pressed = pressEngine(window.origin, listingRef.current, ui.engine, key);
    const result = pressed.result;
    if (result === null) {
      showSetup({ ...ui, engine: pressed.selected });
      return;
    }
    const path = result.kind === "key" ? "key" : "local";
    goSetup(advance(window, result, setupFacts()), { ...ui, engine: pressed.selected, path });
  }

  function onOverviewKey(ui: SetupUi, key: SetupKey): void {
    const rows = ui.overview.rows;
    if (key === "back") {
      closeSetup();
      return;
    }
    if (key === "recheck") {
      showSetup({ ...ui, overview: { ...ui.overview, notice: null } });
      recheck();
      return;
    }
    if (rows === null || key === "quit" || key === "interrupt") {
      return;
    }
    const choices = overviewChoices(rows, undefined, setupFacts());
    if (key === "up" || key === "down") {
      showSetup({ ...ui, overview: { ...ui.overview, selected: move(ui.overview.selected, choices.length, key) } });
      return;
    }
    const choice = choices[ui.overview.selected];
    if (choice === undefined) {
      return;
    }
    if (choice.kind === "service") {
      return;
    }
    if (choice.kind === "guided") {
      goSetup({ kind: "window", window: guided("service", "overview") }, { ...ui, service: askService(serviceRunner()) });
      return;
    }
    switch (choice.action) {
      case "start_ollama":
        showSetup({ ...ui, overview: { ...ui.overview, notice: "starting Ollama…" } });
        void client.startOllama().then(
          (result) => {
            const now = setupRef.current;
            if (now !== null && now.window.view === "overview") {
              showSetup({ ...now, overview: { ...now.overview, notice: result.running ? "Ollama is running" : "Ollama didn't start" } });
            }
            loadModels(true);
            recheck();
          },
          (error: unknown) => {
            const now = setupRef.current;
            if (now !== null) {
              showSetup({ ...now, overview: { ...now.overview, notice: `Ollama didn't start: ${messageOf(error)}` } });
            }
          },
        );
        return;
      case "install_ollama":
        goSetup({ kind: "window", window: single("ollama", "overview") }, { ...ui, path: "local" });
        return;
      case "pick_model":
        goSetup({ kind: "window", window: single("model", "overview") }, { ...ui, path: "pick" });
        return;
      case "set_key":
        openKeyPanel(choice.target, "overview", ui);
        return;
      case "add_tools":
        goSetup({ kind: "window", window: single("tools", "overview") }, ui);
        return;
      case "edit_config":
        return;
    }
  }

  /** What the window shows now, and which hints go with it. */
  function setupView(ui: SetupUi, now: number): { lines: SetupLine[]; screen: SetupScreen; adds?: number } {
    if (ui.quit !== null) {
      return { lines: quitLines(ui.quit), screen: "quit" };
    }
    if (ui.window.view === "overview") {
      const row = serviceRow(serviceRunner(), daemonVersion);
      return { lines: overviewLines(ui.overview.rows, row, ui.overview.selected, ui.overview.notice, setupFacts()), screen: "overview" };
    }
    switch (ui.window.panel) {
      case "service": {
        const phase = ui.service.phase;
        const screen: SetupScreen =
          phase === "starting" || phase === "running" ? "service-wait" : phase === "failed" ? "service-failed" : "service-ask";
        return { lines: serviceLines(ui.service, now), screen };
      }
      case "engine":
        return { lines: engineLines(ui.window.origin, listingRef.current, ui.engine), screen: "engine" };
      case "ollama":
        return {
          lines: ollamaLines(ui.ollama, now),
          screen:
            ui.ollama.phase === "installing"
              ? "ollama-installing"
              : ui.ollama.phase === "waiting"
                ? "ollama-waiting"
                : ui.ollama.phase === "starting"
                  ? "service-wait"
                  : "ollama-ask",
        };
      case "model":
        return {
          lines: modelLines(withPulls(listingRef.current, pullsRef.current), ui.scope, ui.model, now),
          screen:
            ui.model.phase === "downloading"
              ? "model-downloading"
              : ui.scope.kind === "gone"
                ? "model-gone"
                : ui.scope.kind === "local"
                  ? "model-local"
                  : "model",
        };
      case "provider":
        return { lines: providerLines(listingRef.current, ui.provider), screen: "provider" };
      case "key":
        return {
          lines: keyLines(ui.key, now),
          screen: ui.key.phase === "typing" ? "key-typing" : ui.key.phase === "found" ? "provider" : "service-wait",
        };
      case "tools":
        return toolsView(ui.tools);
      case "ready": {
        const runner = serviceRunner();
        const service = runner === "launchd" ? "running, starts at login" : runner === "window" ? "running while this terminal is open" : "running";
        return { lines: readyLines({
            service,
            ...(ui.ready ?? { engine: "", model: "" }),
            tools: toolsReadyText(ui.toolsRan, mcpFactsRef.current.names),
          }), screen: "ready" };
      }
      default:
        return { lines: [], screen: "ready" };
    }
  }

  function loadModels(refresh: boolean): void {
    // Show all belongs to the open picker. Anything else lists the catalog's models.
    void client.listModels(refresh, pickerRef.current.showAll).then(
      (result) => {
        listingRef.current = result;
        setListing(result);
        setChat((current) => providersUp(current, result.providers));
      },
      (error: unknown) => {
        setChat((current) => ({ ...current, error: `models: ${messageOf(error)}` }));
      },
    );
  }

  /** Switch this session to `name`, and make it the default when `setDefault`. */
  function chooseModel(model: ListedModel | null, name: string, setDefault: boolean, notice?: string): void {
    const reason = model === null ? null : unusableReason(model);
    if (reason !== null) {
      setChat((current) => ({ ...current, notice: reason }));
      return;
    }
    const current = sessionRef.current;
    const switched =
      current === null ? Promise.resolve(null) : client.setSessionModel(current, name).then((result) => result);
    void switched
      .then(async (result) => {
        if (setDefault) {
          await client.setDefaultModel(name);
          setDaemonModel({
            profile: name,
            provider: result?.model_provider ?? model?.provider ?? null,
            name: result?.model_name ?? null,
          });
        }
        pickerRef.current = closedPicker;
        setPicker(closedPicker);
        refreshBand();
        const label = result?.model_name ?? name;
        // The daemon pins an auto chat to a model chosen by hand.
        const pinned = current !== null && chatRef.current.route.mode === "auto";
        setChat((state) => ({
          ...state,
          error: null,
          notice: notice ?? (pinned ? `pinned to ${label}` : setDefault ? `${label} for this session and new ones` : `${label} from the next message`),
        }));
      })
      .catch((error: unknown) => {
        setChat((state) => ({ ...state, notice: null, error: messageOf(error) }));
      });
  }

  /** Select in the chat at the current width and message count, or clear it. */
  function showSelection(next: Selection | null): void {
    selectionRef.current = next;
    const frame = selectFrame.current;
    setChatSelection(
      next === null || frame === null
        ? null
        : { selection: next, width: frame.view.width, messages: chatRef.current.messages.length },
    );
  }

  /** A short message on the right of the banner's row, gone after `ms`. */
  function showHint(text: string, ms?: number): void {
    setHint(hintFor(text, Date.now(), ms));
  }

  function showInstall(next: Install | null): void {
    installRef.current = next;
    setInstall(next);
  }

  /**
   * Have the daemon install Ollama with Homebrew, then offer to download `ref`
   * and use it. With `resend`, download it without asking and send that
   * message again.
   */
  function startInstall(ref: string, setDefault: boolean, resend: string | null = null): void {
    pickerRef.current = closedPicker;
    setPicker(closedPicker);
    showInstall({ state: startedInstall, ref, setDefault, resend });
    const stopListening = client.onOllamaInstall((update) => {
      const current = installRef.current;
      if (current === null) {
        return;
      }
      const state = reduceInstall(current.state, installEventOf(update));
      showInstall({ ...current, state });
      if (state.phase !== "running") {
        stopListening();
        stopInstall.current = null;
      }
      if (state.phase === "done") {
        onInstalled(ref, setDefault, resend);
      }
    });
    stopInstall.current = stopListening;
    cancelInstall.current = () => {
      void client.cancelOllamaInstall().catch(() => undefined);
    };
    // `started` is false when another window already runs it: its output reaches this one too.
    client.installOllama().catch((error: unknown) => {
      stopListening();
      stopInstall.current = null;
      const current = installRef.current;
      if (current === null) {
        return;
      }
      if (error instanceof RpcError && error.code === OLLAMA_FAILED && error.data?.["no_brew"] === true) {
        showInstall({ ...current, state: { phase: "no_brew" } });
        return;
      }
      showInstall({ ...current, state: reduceInstall(current.state, { kind: "error", message: messageOf(error) }) });
    });
  }

  /** The daemon finds the new binary on its next look, and starts Ollama for the listing. */
  function onInstalled(ref: string, setDefault: boolean, resend: string | null): void {
    const provider = ref.slice(0, ref.indexOf("/"));
    setChat((current) => ({ ...serverUp(current, provider), error: null, notice: "Ollama is installed" }));
    void client.listModels(true).then(
      (result) => {
        listingRef.current = result;
        setListing(result);
        setChat((current) => providersUp(current, result.providers));
        showInstall(null);
        const next = afterInstall(result, ref, setDefault);
        if (resend !== null && next.kind === "confirm") {
          // The answer in the banner covered the download too.
          sendAfterPull.current.set(ref, resend);
          startPull(ref, false, setDefault);
        } else if (resend !== null && next.kind === "choose") {
          sendText(resend);
        } else if (next.kind === "confirm") {
          const opened = openPicker(currentModelRef(), false, next.confirm);
          pickerRef.current = opened;
          setPicker(opened);
        } else if (next.kind === "choose") {
          chooseModel(next.model, next.name, next.setDefault);
        } else {
          setChat((current) => ({ ...current, notice: next.text }));
        }
      },
      (error: unknown) => {
        showInstall(null);
        setChat((current) => ({ ...current, error: `models: ${messageOf(error)}` }));
      },
    );
  }

  function startPull(ref: string, use: boolean, setDefault: boolean): void {
    if (use) {
      useAfterPull.current.set(ref, { setDefault });
    }
    setPulls((current) => ({ ...current, [ref]: { progress: null, status: "starting" } }));
    void client.pullModel(ref).then(
      (result) => {
        setChat((current) => ({
          ...current,
          error: null,
          notice: result.started ? `downloading ${result.ref}` : `${result.ref} is already downloading`,
        }));
      },
      (error: unknown) => {
        useAfterPull.current.delete(ref);
        sendAfterPull.current.delete(ref);
        setPulls((current) => {
          const next = { ...current };
          delete next[ref];
          return next;
        });
        setChat((current) => ({ ...current, notice: null, error: messageOf(error) }));
      },
    );
  }

  /** `/model pull` and `/model rm`: look the model up, then ask in the picker. */
  function confirmFromCommand(kind: "pull" | "delete", name: string): void {
    void client.probeModel(name).then(
      (probe) => {
        if (kind === "pull" && probe.installed) {
          setChat((current) => ({ ...current, notice: `${probe.ref} is already installed` }));
          return;
        }
        if (kind === "pull" && probe.exists === false) {
          setChat((current) => ({ ...current, notice: `no model named ${name} in the Ollama library` }));
          return;
        }
        if (kind === "delete" && !probe.installed) {
          setChat((current) => ({ ...current, notice: `${probe.ref} is not installed` }));
          return;
        }
        const confirm = confirmFor(kind, {
          ref: probe.ref,
          label: probe.ref,
          provider: probe.ref.slice(0, probe.ref.indexOf("/")),
          source: kind === "pull" ? "catalog" : "installed",
          status: kind === "pull" ? "not_installed" : "ready",
          size_gb: probe.size_gb ?? null,
          fit: probe.fit ?? null,
          tier: "local",
        });
        const next = openPicker(currentModelRef(), false, { ...confirm, use: false });
        pickerRef.current = next;
        setPicker(next);
        setSwitcher(closedSwitcher);
        loadModels(false);
      },
      (error: unknown) => {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      },
    );
  }

  /** Sets the session's permission mode. The status segment changes from `session.mode.changed`. */
  function changeMode(id: string, mode: PermissionMode | null): void {
    client.setSessionMode(id, mode).then(
      () => {
        const notice = modeChanged(mode, defaultMode);
        setChat((state) => ({ ...state, notice }));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, notice: messageOf(error) }));
      },
    );
  }

  function changeRoute(id: string, mode: RouteMode): void {
    client.setRoute(id, mode).then(
      () => {
        setChat((state) => ({ ...state, notice: `Route: ${mode}. It applies from the next turn.` }));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, notice: messageOf(error) }));
      },
    );
  }

  /** `/stronger`: send the last question again as a new turn on the tier above the last answer. */
  function tryStronger(): void {
    const id = sessionRef.current;
    const chat = chatRef.current;
    const question = lastQuestion(chat.messages);
    if (id === null || connectionRef.current.status !== "connected") return;
    if (chat.route.mode !== "auto") {
      setChat((state) => ({ ...state, notice: "/stronger needs route auto: /route auto" }));
      return;
    }
    if (chat.busy || question === null) {
      setChat((state) => ({ ...state, notice: "Wait for the answer, then try again." }));
      return;
    }
    void (async () => {
      try {
        const [models, config] = await Promise.all([
          client.listModels(false),
          client.getConfig(sessionCwdRef.current ?? process.cwd(), id),
        ]);
        const idle = !chatRef.current.busy;
        const routing = config.routing;
        if (!canTryStronger({ mode: chat.route.mode, idle, models: models.models, routing, last: chat.route.last })) {
          setChat((state) => ({ ...state, notice: NO_STRONGER_NOTICE }));
          return;
        }
        setChat((state) => ({ ...state, notice: null }));
        await client.sendMessage(id, question, { cwd: process.cwd(), stronger: true });
      } catch (error: unknown) {
        setChat((state) => ({ ...state, notice: messageOf(error) }));
      }
    })();
  }

  /** `/route`: the mode, the ladder, and the spend, printed as a panel. */
  function loadRoute(id: string): void {
    const gen = ++costGen.current;
    setCostText(["loading…"]);
    void (async () => {
      try {
        const [models, config, cost] = await Promise.all([
          client.listModels(false),
          client.getConfig(sessionCwdRef.current ?? process.cwd(), id),
          client.getCost(id),
        ]);
        const own = sessionModelOf(preferModel(sessionModelRef.current, daemonModel), models.models);
        const lines = routeReportLines(
          chatRef.current.route.mode,
          routeRows(chatRef.current.route.mode, models.models, config.routing, own),
          spendRows(cost, config.routing),
        );
        if (gen === costGen.current) setCostText(lines);
      } catch (error) {
        if (gen === costGen.current) setCostText([messageOf(error)]);
      }
    })();
  }

  function loadPermissions(): void {
    const current = sessionRef.current;
    client.getConfig(sessionCwdRef.current ?? process.cwd(), current ?? undefined).then(
      (config: ConfigGetResult) => {
        setPerms((state) => (state.open ? { ...state, config } : state));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, error: messageOf(error) }));
      },
    );
  }

  function onPermissionsPress(press: Press): void {
    const key = permissionsKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressPermissions(permsRef.current, key);
    permsRef.current = pressed.state;
    setPerms(pressed.state);
    const action = pressed.action;
    const folder = sessionCwdRef.current ?? process.cwd();
    const done = (notice: string) => () => {
      setChat((state) => ({ ...state, error: null, notice }));
      loadPermissions();
    };
    const failed = (error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    };
    if (action.kind === "refresh") {
      loadPermissions();
    } else if (action.kind === "notice") {
      setChat((state) => ({ ...state, notice: action.text }));
    } else if (action.kind === "update") {
      const where = action.target === "project" ? folder : undefined;
      void client
        .updateRule(action.target, action.index, action.action, where)
        .then(done(`rule ${action.index} now ${action.action}s`), failed);
    } else if (action.kind === "remove") {
      const where = action.target === "project" ? folder : undefined;
      void client.removeRule(action.target, action.index, where).then(done(`rule ${action.index} removed`), failed);
    } else if (action.kind === "revoke") {
      const current = sessionRef.current;
      if (current !== null) {
        void client
          .revokeAllowance(current, action.tool, action.subject)
          .then(done(`${action.tool} is no longer allowed for this session`), failed);
      }
    }
  }

  function onMcpManagerPress(press: Press): void {
    const key = mcpManagerKeyOf(press, mcpManagerTyping(mcpManagerRef.current));
    if (key === null) {
      return;
    }
    const pressed = pressMcpManager(mcpManagerRef.current, mcpRef.current.servers ?? [], key);
    mcpManagerRef.current = pressed.state;
    setMcpManager(pressed.state);
    runMcpAction(pressed.action);
  }

  function runMcpAction(action: McpManagerAction): void {
    const session = sessionRef.current ?? undefined;
    const done = (notice: string) => () => {
      setChat((state) => ({ ...state, error: null, notice }));
      loadMcp();
    };
    const failed = (error: unknown) => {
      setChat((state) => ({ ...state, notice: messageOf(error) }));
    };
    if (action.kind === "add") {
      // The token, if any, goes only to the daemon: not into the chat, a notice, or a log.
      client.addMcpServer(action.params).then(
        (server) => {
          const merged = mergeMcp(mcpRef.current.servers ?? [], server);
          setMcp({ servers: merged, error: null });
          const next = mcpAdded(mcpManagerRef.current, merged, server.name);
          mcpManagerRef.current = next;
          setMcpManager(next);
          done(`added ${server.name} · ${server.state}`)();
          loadMcpCatalog();
        },
        (error: unknown) => {
          const next = mcpAddFailed(mcpManagerRef.current, messageOf(error));
          mcpManagerRef.current = next;
          setMcpManager(next);
        },
      );
    } else if (action.kind === "load-tools") {
      client.mcpTools(action.name, session).then((tools) => {
        setMcpManager((state) => (state.view.kind === "tools" && state.view.name === action.name ? { ...state, tools } : state));
      }, failed);
    } else if (action.kind === "test") {
      client
        .mcpTest({ name: action.name, ...(session === undefined ? {} : { sessionId: session }) }, (progress) => {
          const line = formatTestStep(progress);
          if (line !== null) {
            setMcpManager((state) => mcpTestStep(state, action.name, line));
          }
        })
        .then(
          (result) => setMcpManager((state) => mcpTestDone(state, action.name, result.ok, formatTestResult(result).split("\n"))),
          (error: unknown) => setMcpManager((state) => mcpTestDone(state, action.name, false, [messageOf(error)])),
        );
    } else if (action.kind === "load-logs") {
      client.mcpLogs(action.name, session === undefined ? {} : { sessionId: session }).then(
        (logs) => setMcpManager((state) => mcpLogsLoaded(state, action.name, logs.lines.map(formatLogLine))),
        (error: unknown) => setMcpManager((state) => mcpLogsLoaded(state, action.name, [messageOf(error)])),
      );
    } else if (action.kind === "remove") {
      client.removeMcpServer(action.name).then(done(`removed ${action.name}`), failed);
    } else if (action.kind === "toggle-tool") {
      void (async () => {
        const detail = await client.mcpGet(action.name, session);
        const change = action.hide
          ? changeToolFilter(detail.config, [action.tool], [])
          : changeToolFilter(detail.config, [], [action.tool]);
        if (!change.ok) {
          setChat((state) => ({ ...state, notice: change.message }));
          return;
        }
        await client.updateMcpServer({ name: action.name, config: change.config, ...(session === undefined ? {} : { session_id: session }) });
        const tools = await client.mcpTools(action.name, session);
        setMcpManager((state) => (state.view.kind === "tools" && state.view.name === action.name ? { ...state, tools } : state));
        done(`${action.tool} is ${action.hide ? "hidden from" : "shown to"} the model`)();
      })().catch(failed);
    } else if (action.kind === "call") {
      client
        .mcpCall({ name: action.name, tool: action.tool, arguments: action.arguments, ...(session === undefined ? {} : { sessionId: session }) })
        .then(
          (result) =>
            setMcpManager((state) => mcpCallDone(state, action.name, action.tool, { text: result.text, failed: result.is_error })),
          (error: unknown) => setMcpManager((state) => mcpCallDone(state, action.name, action.tool, { error: messageOf(error) })),
        );
    } else if (action.kind === "session") {
      if (session === undefined) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const toggle = action.on ? client.enableMcp(session, action.name) : client.disableMcp(session, action.name);
      toggle.then(done(`${action.name} is ${action.on ? "on" : "off"} for this session`), failed);
    } else if (action.kind === "login") {
      client.mcpLogin(action.name, session).then(
        (started) => {
          setMcpManager((state) => mcpLoginUrl(state, action.name, started.authorize_url));
          openUrl(started.authorize_url);
          void copyText(started.authorize_url).catch(() => undefined);
        },
        (error: unknown) => setMcpManager((state) => mcpLoginDone(state, action.name, false, messageOf(error))),
      );
    } else if (action.kind === "logout") {
      client.mcpLogout(action.name, session).then(done(`signed out of ${action.name}`), failed);
    } else if (action.kind === "restart") {
      client.restartMcp(action.name, session).then(done(`reconnecting ${action.name}…`), failed);
    } else if (action.kind === "set-enabled") {
      const what =
        action.enabled === false ? "disabled everywhere" : action.enabled === true ? "on for every chat" : "on demand";
      client.setMcpEnabled(action.name, action.enabled, session).then(done(`${action.name} is ${what}`), failed);
    }
  }

  function say(notice: string): void {
    setChat((state) => ({ ...state, error: null, notice }));
  }

  /** `/undo`: ask about the newest turn that is not undone. */
  function startUndo(): void {
    if (sessionRef.current === null) {
      say("open a session first");
      return;
    }
    if (busyRef.current) {
      say(WAIT_FOR_GOLEM);
      return;
    }
    const offer = nextUndo(changesFold.current, promptsFold.current);
    if (offer === null) {
      say(NOTHING_TO_UNDO);
      return;
    }
    setChat((state) => ({ ...state, error: null, notice: null }));
    showUndo(openUndo(offer));
  }

  function showUndo(next: UndoBandState | null): void {
    undoRef.current = next;
    setUndoBand(next);
  }

  function onUndoPress(press: Press): void {
    const band = undoRef.current;
    const key = undoKeyOf(press);
    if (band === null || key === null) {
      return;
    }
    const pressed = pressUndo(band, key);
    showUndo(pressed.band);
    const action = pressed.action;
    const id = sessionRef.current;
    if (action.kind !== "revert" || pressed.band === null || id === null) {
      return;
    }
    void client.changesRevert(id, { kind: "run", runId: action.runId }, action.force).then(
      (result) => {
        const current = undoRef.current;
        if (current === null) {
          return;
        }
        const answered = undoAnswered(current, result);
        showUndo(answered.band);
        if (answered.notice !== null) {
          say(answered.notice);
        }
      },
      (error: unknown) => {
        showUndo(null);
        setChat((state) => ({ ...state, notice: null, error: messageOf(error) }));
      },
    );
  }

  function showChangesManager(next: ChangesManagerState): void {
    changesManagerRef.current = next;
    setChangesManager(next);
  }

  function showChanges(next: ChangesData): void {
    changesRef.current = next;
    setChanges(next);
  }

  /** Read the file list, then the diff of the selected file. `stale` is a path whose diff changed. */
  function loadChanges(id: string, stale: string | null): void {
    if (stale !== null) {
      changesAsked.current.delete(stale);
      const diffs = { ...changesRef.current.diffs };
      delete diffs[stale];
      showChanges({ ...changesRef.current, diffs });
    }
    client.changesList(id).then(
      (result) => {
        if (!changesManagerRef.current.open) {
          return;
        }
        showChanges({ ...changesRef.current, files: result.files, shell: result.shell ?? "git", error: null });
        const path = result.files[Math.min(changesManagerRef.current.file, result.files.length - 1)]?.path;
        if (path !== undefined) {
          loadChangesDiff(id, path);
        }
      },
      (error: unknown) => showChanges({ ...changesRef.current, error: messageOf(error) }),
    );
  }

  function loadChangesDiff(id: string, path: string): void {
    if (changesAsked.current.has(path) || changesRef.current.diffs[path] !== undefined) {
      return;
    }
    changesAsked.current.add(path);
    client.changesDiff(id, { path }).then(
      (result) => showChanges({ ...changesRef.current, diffs: { ...changesRef.current.diffs, [path]: result.diff } }),
      (error: unknown) => {
        changesAsked.current.delete(path);
        showChanges({ ...changesRef.current, failed: { ...changesRef.current.failed, [path]: messageOf(error) } });
      },
    );
  }

  /** Ask git about the folder, then open the band. Nothing is committed until the person presses enter in it. */
  function openCommit(id: string): void {
    const note = (text: string): void => {
      if (changesManagerRef.current.open) showChangesManager({ ...changesManagerRef.current, note: text });
    };
    client.changesCommitInfo(id).then(
      (info) => {
        if (!changesManagerRef.current.open) {
          return;
        }
        if (!info.repository) {
          note("not a git repository");
        } else if (info.paths.length === 0) {
          note("nothing to commit");
        } else {
          showChangesManager({ ...changesManagerRef.current, note: null, commit: openCommitBand(info) });
          askSuggestion(id, info.paths, null);
        }
      },
      (error: unknown) => note(messageOf(error)),
    );
  }

  function updateCommitBand(change: (band: CommitBand) => CommitBand): void {
    const current = changesManagerRef.current;
    if (current.commit !== null && current.commit !== undefined) {
      showChangesManager({ ...current, commit: change(current.commit) });
    }
  }

  /** `replaceAt` is the band's edit count when the person asked again: the answer then replaces the message if they typed nothing since. */
  function askSuggestion(id: string, paths: readonly string[], replaceAt: number | null): void {
    client.changesSuggestMessage(id, [...paths]).then(
      (result) => updateCommitBand((band) => suggestionArrived(band, result.message, replaceAt)),
      () => updateCommitBand(suggestionFailed),
    );
  }

  function runCommitAction(action: CommitAction, band: CommitBand): void {
    const id = sessionRef.current;
    if (action.kind === "close") {
      showChangesManager({ ...changesManagerRef.current, commit: null });
    } else if (action.kind === "suggest" && id !== null) {
      askSuggestion(id, band.paths, action.edits);
    } else if (action.kind === "commit" && id !== null) {
      client.changesCommit(id, [...band.paths], action.message).then(
        (result) => {
          if (!result.ok) {
            updateCommitBand((current) => commitRefused(current, result.output));
            return;
          }
          const said = committedLine(result.sha);
          showChangesManager({ ...changesManagerRef.current, commit: null, note: said });
          setChat((state) => ({ ...state, notice: said }));
          loadChanges(id, null);
        },
        (error: unknown) => updateCommitBand((current) => commitErrored(current, messageOf(error))),
      );
    }
  }

  function onCommitBandPress(press: Press, band: CommitBand): void {
    const key = commitKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressCommit(band, key, busyRef.current);
    updateCommitBand(() => pressed.band);
    runCommitAction(pressed.action, pressed.band);
  }

  function notesOf(id: string | null): NotesState {
    return id === null ? noNotes : (notesByRef.current.get(id) ?? noNotes);
  }

  function putNotes(id: string, next: NotesState): void {
    const all = new Map(notesByRef.current);
    if (next.notes.length === 0) {
      all.delete(id);
    } else {
      all.set(id, next);
    }
    notesByRef.current = all;
    setNotesBy(all);
  }

  /** The data the review screen draws: what the daemon said, and the notes of this session. */
  function changesWithNotes(): ChangesData {
    return { ...changesRef.current, notes: notesOf(sessionRef.current).notes };
  }

  /** The agent types that change files, so a running helper of one shows as a worker. */
  function loadWriters(): void {
    client.listAgents(skillsFolder()).then(
      (listed) => {
        setWritingAgents(new Set(listed.agents.filter((info) => (info.changing_tools ?? []).length > 0).map((info) => info.name)));
      },
      () => undefined,
    );
  }

  function currentWorkerBlocks() {
    return workerBlocks(helperEventsRef.current, { writes: (agent) => writingAgentsRef.current.has(agent) });
  }

  function changesWorkers(): { blocks: ReturnType<typeof currentWorkerBlocks>; folder: string } {
    return { blocks: currentWorkerBlocks(), folder: shortCwd(sessionCwdRef.current ?? process.cwd(), homedir()) };
  }

  function runWorker(call: WorkerCall): void {
    const id = sessionRef.current;
    if (id === null) {
      return;
    }
    void runWorkerCall(client, id, call).then((result) => {
      const current = changesManagerRef.current;
      if (!current.open) {
        return;
      }
      showChangesManager({ ...current, workers: workerDone(current.workers ?? emptyWorkerPane, result) });
      if (call.kind === "apply" || call.kind === "apply-green") {
        loadChanges(id, null);
      }
    });
  }

  function runChangesAction(action: ChangesAction): void {
    const id = sessionRef.current;
    if (action.kind === "add-note" && id !== null) {
      putNotes(id, addNote(notesOf(id), action.note));
    } else if (action.kind === "remove-notes" && id !== null) {
      putNotes(id, action.ids.reduce(removeNote, notesOf(id)));
    } else if (action.kind === "commit-info" && sessionRef.current !== null) {
      openCommit(sessionRef.current);
    } else if (action.kind === "close") {
      changesAsked.current.clear();
      showChanges({ files: null, error: null, diffs: {} });
    } else if (action.kind === "load" && sessionRef.current !== null) {
      loadChangesDiff(sessionRef.current, action.path);
    } else if (action.kind === "revert" && sessionRef.current !== null) {
      revertFromChanges(sessionRef.current, action.target);
    }
  }

  function revertFromChanges(id: string, target: ChangesRevertTarget): void {
    const tell = (message: string): void => {
      if (changesManagerRef.current.open) {
        showChangesManager({ ...changesManagerRef.current, message });
      }
    };
    client.changesRevert(id, target).then(
      (result) => {
        const left = result.conflicts.map((conflict) => conflict.path);
        if (left.length > 0) {
          tell(`${left.join(", ")} changed since golem wrote it, so it was left alone.`);
        } else {
          const count = result.reverted.length;
          tell(`Undone: ${count} ${count === 1 ? "file" : "files"} put back.`);
        }
        loadChanges(id, "path" in target ? target.path : null);
      },
      (error: unknown) => tell(messageOf(error)),
    );
  }

  function onChangesManagerPress(press: Press): void {
    const band = changesManagerRef.current.commit;
    if (band !== null && band !== undefined) {
      onCommitBandPress(press, band);
      return;
    }
    if (changesManagerRef.current.input !== null) {
      const typed = pressNoteInput(changesManagerRef.current, press);
      showChangesManager(typed.state);
      runChangesAction(typed.action);
      return;
    }
    const pane = changesManagerRef.current.workers ?? emptyWorkerPane;
    const workerKey = changesManagerRef.current.confirm === null ? workerKeyOf(press) : null;
    if (workerKey !== null) {
      const worked = pressWorker(pane, currentWorkerBlocks(), workerKey);
      if (!worked.pass) {
        showChangesManager({ ...changesManagerRef.current, workers: worked.pane });
        if (worked.call !== null) {
          runWorker(worked.call);
        }
        return;
      }
    }
    // With the workers focused, the keys of the files wait: `x` would remove a note, `u` undo a hunk.
    const key = pane.focus && changesManagerRef.current.confirm === null && press.name !== "escape" ? null : changesKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressChanges(
      changesManagerRef.current,
      changesWithNotes(),
      key,
      Math.max(1, budgetBodyRef.current - 3),
      busyRef.current,
    );
    showChangesManager(pressed.state);
    runChangesAction(pressed.action);
  }

  function onRunsManagerPress(press: Press): void {
    const key = runsManagerKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressRunsManager(runsManagerRef.current, runListRef.current.runs ?? [], key, Date.now());
    showRunsManager(pressed.state);
    if (pressed.action.kind === "open") {
      // The chat replays the run's events, so a run that waits shows its approval band.
      showRunsManager(closedRunsManager);
      session.switchTo(pressed.action.sessionId);
    }
  }

  function showRunsManager(next: RunsManagerState): void {
    runsManagerRef.current = next;
    setRunsManager(next);
  }

  function onRoutinesManagerPress(press: Press): void {
    const key = routinesManagerKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressRoutinesManager(routinesManagerRef.current, routineListRef.current.routines ?? [], key);
    showRoutinesManager(pressed.state);
    runRoutinesAction(pressed.action);
  }

  function showRoutinesManager(next: RoutinesManagerState): void {
    routinesManagerRef.current = next;
    setRoutinesManager(next);
  }

  function runRoutinesAction(action: RoutinesManagerAction): void {
    const notify = (notice: string) => setChat((state) => ({ ...state, notice }));
    const failed = (error: unknown) => notify(messageOf(error));
    if (action.kind === "close") {
      setRoutineRuns(null);
    } else if (action.kind === "notice") {
      notify(action.text);
    } else if (action.kind === "load-runs") {
      setRoutineRuns(null);
      loadRoutineRuns(action.name, action.folder);
    } else if (action.kind === "run") {
      client.runRoutine(action.name, action.folder ?? undefined).then(() => {
        notify(`${action.name} is running`);
        loadRoutines();
        loadRoutineRuns(action.name, action.folder);
      }, failed);
    } else if (action.kind === "set-paused") {
      client.updateRoutine(action.name, { enabled: !action.paused }).then(() => {
        notify(action.paused ? `${action.name} is paused` : `${action.name} is resumed`);
        loadRoutines();
      }, failed);
    } else if (action.kind === "open-run") {
      showRoutinesManager(closedRoutinesManager);
      setRoutineRuns(null);
      session.switchTo(action.sessionId);
    } else if (action.kind === "edit") {
      void editRoutineFile(action.path, action.name);
    }
  }

  /** Open `config.toml` at the routine's `[[routine]]` in `$EDITOR`, then read the routines again. */
  async function editRoutineFile(path: string, name: string): Promise<void> {
    if (editing.current) {
      return;
    }
    editing.current = true;
    let notice = "";
    try {
      const text = await readFile(path, "utf8").catch(() => "");
      const saved = await editFile(path, suspendTerminal, undefined, process.env, routineLineOf(text, name) ?? undefined);
      notice = saved ? "" : "the editor did not exit cleanly";
    } catch (error) {
      notice = messageOf(error);
    } finally {
      editing.current = false;
    }
    try {
      const listed = await client.listRoutines([skillsFolder()]);
      setRoutineList({ routines: listed.routines, issues: listed.issues ?? [], error: null });
      const first = listed.issues?.[0];
      if (notice === "") {
        notice =
          first === undefined
            ? `${path} saved · reloaded · ✔ ${listed.routines.length} ${listed.routines.length === 1 ? "routine" : "routines"}`
            : `✘ ${first.file}${first.line === null || first.line === undefined ? "" : `:${first.line}`}: ${first.message}`;
      }
    } catch (error) {
      notice = notice === "" ? messageOf(error) : notice;
    }
    setChat((state) => ({ ...state, notice }));
  }

  function showStepsManager(next: StepsManagerState): void {
    stepsManagerRef.current = next;
    setStepsManager(next);
  }

  /** Leave the Steps screen and stop following any helper it showed. */
  function closeStepsManager(): void {
    stopWatching();
    if (stepsManagerRef.current.open) showStepsManager(closedStepsManager);
  }

  function stopWatching(): void {
    const watched = helperChatRef.current;
    helperChatRef.current = null;
    setHelperChat(null);
    if (watched !== null) void client.detachSession(watched.sessionId).catch(() => undefined);
  }

  function stepsContext(): StepsContext {
    const now = Date.now();
    const events = helperEventsRef.current;
    const isLocal = isLocalFrom(listingRef.current?.models);
    const state = stepsManagerRef.current;
    return {
      order: batchOrder(chatRef.current.batches),
      helpers: (callId) => stepsHelpers(callId, events, now, isLocal),
      chatMax: chatScrollMax({ state, helper: helperChatRef.current, trimmedAt: trimmedAtOf(sessionsRef.current, helperChatRef.current?.sessionId), now, columns: stepsSizeRef.current.columns, rows: stepsSizeRef.current.rows }),
    };
  }

  /** The helper sessions of a `delegate` call, from the lead's log. */
  function helperRefsOf(callId: string) {
    for (const message of chatRef.current.messages) {
      const found = message.tools?.find((tool) => tool.callId === callId);
      if (found !== undefined) return found.child?.helpers ?? [];
    }
    return [];
  }

  function onStepsAction(action: StepsAction): void {
    if (action.kind === "close") {
      closeStepsManager();
      return;
    }
    if (action.kind === "leave-chat") {
      stopWatching();
      return;
    }
    if (action.kind === "none") return;
    const ref = helperRefsOf(action.callId).find((item) => item.index === action.index);
    if (ref === undefined) return;
    if (action.kind === "stop") {
      client.stopHelper(ref.id).then(
        (result) => showHint(result.stopped ? `Stopped ${ref.label || ref.agent}` : `${ref.label || ref.agent} had already ended`),
        (error: unknown) => showHint(`Could not stop ${ref.label || ref.agent}: ${messageOf(error)}`),
      );
      return;
    }
    if (action.kind === "continue") {
      if (trimmedAtOf(sessionsRef.current, ref.id) !== null) {
        showHint("This helper's steps were removed, so it cannot be continued.");
        return;
      }
      client.forkSession(ref.id).then(
        (result) => {
          closeStepsManager();
          session.switchTo(result.session_id);
          setChat((state) => ({ ...state, notice: "continued as a chat of your own" }));
        },
        (error: unknown) => showHint(`Could not continue ${ref.label || ref.agent}: ${messageOf(error)}`),
      );
      return;
    }
    stopWatching();
    const data: HelperChatData = { sessionId: ref.id, chat: emptyChat, error: null };
    helperChatRef.current = data;
    setHelperChat(data);
    client.attachSession(ref.id).catch((error: unknown) => {
      if (helperChatRef.current?.sessionId !== ref.id) return;
      const failed = { ...data, error: `Could not open this helper: ${messageOf(error)}` };
      helperChatRef.current = failed;
      setHelperChat(failed);
    });
  }

  function onStepsManagerPress(press: Press): void {
    const key = stepsKeyOf(press);
    if (key === null) return;
    const pressed = pressStepsManager(stepsManagerRef.current, stepsContext(), key);
    showStepsManager(pressed.state);
    onStepsAction(pressed.action);
  }

  function onAgentsManagerPress(press: Press): void {
    const key = agentsManagerKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressAgentsManager(agentsManagerRef.current, agentListRef.current.agents ?? [], key, {
      setup: wishSetup(listing?.models),
      models: listing?.models ?? [],
      columns,
      rows: budget.body,
      useHelpers: agentsKeep === null ? null : (agentsKeep.use_helpers ?? "when_needed"),
    });
    showAgentsManager(pressed.state);
    onAgentsAction(pressed.action);
  }

  function onAgentsAction(action: AgentsManagerAction): void {
    switch (action.kind) {
      case "measure":
        measure.open();
        return;
      case "set_wish":
        saveAgentWish(action.name, action.wish);
        return;
      case "use_helpers":
        saveUseHelpers(action.value);
        return;
      case "copy":
        void changeAgentFiles(async () => {
          const copy = await client.copyAgent(action.name, skillsFolder());
          return { focus: copy, notice: `copied · ${copy.name} is yours now and hides the bundled one` };
        });
        return;
      case "delete":
        void changeAgentFiles(async () => {
          const deleted = await client.deleteAgent(action.name, skillsFolder());
          const back = deleted.agent ?? null;
          return { focus: back, notice: back === null ? `${action.name} deleted` : `${action.name} deleted · the ${back.origin} ${back.name} is back` };
        });
        return;
      case "edit":
        void editAgentText(action.text, action.name);
        return;
      default:
        return;
    }
  }

  /**
   * Run one change of the agent files (copy, delete, save), read the list again and put the manager on what
   * changed: the new agent chosen, with one plain line on what happened, or on why it failed.
   */
  async function changeAgentFiles(change: () => Promise<{ focus: { name: string; origin: string } | null; notice: string }>): Promise<void> {
    try {
      const done = await change();
      const listed = await client.listAgents(skillsFolder());
      setAgentList({ agents: listed.agents, error: null });
      showAgentsManager(agentsFocused(agentsManagerRef.current, listed.agents, done.focus, done.notice));
    } catch (error) {
      showAgentsManager(agentsNoticed(agentsManagerRef.current, messageOf(error)));
    }
  }

  /**
   * Edit an agent's text in `$EDITOR` on a temporary file, never on the real one. When the editor closes,
   * `agents.save` checks that the text parses and only then writes the file. With problems, the manager shows
   * them with their lines and keeps the text so the editor can open on it again.
   */
  async function editAgentText(text: string, name?: string): Promise<void> {
    if (editing.current) {
      return;
    }
    editing.current = true;
    const dir = await mkdtemp(join(tmpdir(), "golem-agent-"));
    let notice = "";
    let saved: Awaited<ReturnType<typeof client.saveAgent>> | null = null;
    let edited = text;
    try {
      const file = join(dir, "agent.md");
      await writeFile(file, text, "utf8");
      if (!(await editFile(file, suspendTerminal))) {
        notice = "the editor did not exit cleanly, nothing was saved";
      } else {
        edited = await readFile(file, "utf8");
        if (edited === text) {
          notice = "no change";
        } else {
          saved = await client.saveAgent(edited, name, skillsFolder());
        }
      }
    } catch (error) {
      notice = messageOf(error);
    } finally {
      editing.current = false;
      await rm(dir, { recursive: true, force: true });
    }
    if (saved === null) {
      showAgentsManager(agentsNoticed(agentsManagerRef.current, notice));
    } else if (!saved.ok) {
      showAgentsManager(agentEditProblems(agentsManagerRef.current, { text: edited, ...(name === undefined ? {} : { name }) }, saved.problems ?? []));
    } else {
      const agent = saved.agent ?? null;
      await changeAgentFiles(async () => ({ focus: agent, notice: `${agent?.name ?? "agent"} saved` }));
    }
  }

  /** `agents.set_wish`: on an answer the row shows it; on a refusal one plain line shows and the old value stays. */
  function saveAgentWish(name: string, wish: string): void {
    client.setAgentWish(name, wish, skillsFolder()).then(
      (saved) => {
        const list = agentListRef.current.agents;
        if (list !== null) {
          setAgentList({ agents: agentsWithSaved(list, saved), error: null });
        }
      },
      (error: unknown) => showAgentsManager(agentWishFailed(agentsManagerRef.current, error)),
    );
  }

  /** `agents.keep` with `use_helpers`: on an answer the line shows the saved position; on a refusal one plain line shows. */
  function saveUseHelpers(value: "when_needed" | "ask" | "never"): void {
    client.agentsKeep({ use_helpers: value }).then(
      (result) => setAgentsKeep(result.values ?? null),
      (error: unknown) => showAgentsManager(useHelpersFailed(agentsManagerRef.current, error)),
    );
  }

  function showAgentsManager(next: AgentsManagerState): void {
    agentsManagerRef.current = next;
    setAgentsManager(next);
  }

  function onSkillsManagerPress(press: Press): void {
    const key = skillsManagerKeyOf(press, skillsManagerTyping(skillsManagerRef.current));
    if (key === null) {
      return;
    }
    const pressed = pressSkillsManager(
      skillsManagerRef.current,
      skillListRef.current.skills ?? [],
      key,
      chatRef.current.activeSkills,
    );
    showSkillsManager(pressed.state);
    runSkillsAction(pressed.action);
  }

  function showSkillsManager(next: SkillsManagerState): void {
    skillsManagerRef.current = next;
    setSkillsManager(next);
  }

  function runSkillsAction(action: SkillsManagerAction): void {
    const notify = (notice: string) => setChat((state) => ({ ...state, notice }));
    const failed = (error: unknown) => notify(messageOf(error));
    if (action.kind === "run") {
      showSkillsManager(closedSkillsManager);
      setDraft(draftAt(`/${action.name} `));
    } else if (action.kind === "pin") {
      const current = sessionRef.current;
      if (current === null) {
        notify("open a session first");
        return;
      }
      const change = action.pin ? { pin: [action.name] } : { unpin: [action.name] };
      client
        .setSkills(current, change)
        .then(() => notify(action.pin ? `${action.name} is pinned for this session` : `${action.name} is unpinned`), failed);
    } else if (action.kind === "edit") {
      void editSkillFile(action.path);
    } else if (action.kind === "copy") {
      void copyBundledSkill(action.name);
    } else if (action.kind === "set-disabled") {
      client.setSkillDisabled(action.name, action.disabled).then(() => {
        notify(action.disabled ? `${action.name} is turned off` : `${action.name} is turned on`);
        loadSkills();
      }, failed);
    } else if (action.kind === "reveal") {
      revealInFolder(join(action.path, "SKILL.md"));
    } else if (action.kind === "create") {
      const where = action.scope === "user" ? {} : { cwd: skillsFolder() };
      client
        .createSkill({ name: action.name, scope: action.scope, description: action.description, ...where }, { local: true })
        .then(
          (created) => editSkillFile(dirname(created.path)),
          (error: unknown) => showSkillsManager(skillCreateFailed(skillsManagerRef.current, messageOf(error))),
        );
    }
  }

  /**
   * Open a skill's real `SKILL.md` in `$EDITOR`, then read the skills again and
   * show that skill's detail, with its errors if the file is now broken.
   */
  async function editSkillFile(folder: string): Promise<void> {
    if (editing.current) {
      return;
    }
    editing.current = true;
    let notice = "";
    try {
      const saved = await editFile(join(folder, "SKILL.md"), suspendTerminal);
      notice = saved ? "" : "the editor did not exit cleanly";
    } catch (error) {
      notice = messageOf(error);
    } finally {
      editing.current = false;
    }
    try {
      const listed = await client.listSkills(skillsFolder());
      setSkillList({ skills: listed.skills, error: null });
      const skill = listed.skills.find((item) => item.path === folder);
      if (skill !== undefined && notice === "") {
        const first = skill.errors?.[0];
        notice = skill.usable
          ? `${skill.name} saved · reloaded · ✔ usable`
          : first !== undefined
            ? `✘ ${skill.name}: ${first}`
            : `${skill.name} saved · reloaded · not usable`;
      }
    } catch (error) {
      notice = notice === "" ? messageOf(error) : notice;
    }
    showSkillsManager(showSkillDetail(skillsManagerRef.current, folder));
    if (notice !== "") {
      setChat((state) => ({ ...state, notice }));
    }
  }

  /** A bundled skill is read-only, so Copy to Yours makes `~/.golem/skills/<name>` with the same text. */
  async function copyBundledSkill(name: string): Promise<void> {
    try {
      const folder = skillsFolder();
      const original = await client.readSkill(name, folder);
      if (original.source !== "bundled") {
        throw new Error(`${name} is hidden by another skill: edit that one`);
      }
      const bundled = skillListRef.current.skills?.find((item) => item.name === name && item.source === "bundled");
      const created = await client.createSkill(
        { name, scope: "user", description: bundled?.description || name },
        { local: true },
      );
      const written = await client.writeSkill(
        { path: created.path, text: original.text, baseMtimeNs: created.mtime_ns },
        { local: true },
      );
      if (!written.written) {
        throw new Error(written.errors?.[0]?.message ?? `could not copy ${name}`);
      }
      const listed = await client.listSkills(folder);
      setSkillList({ skills: listed.skills, error: null });
      showSkillsManager(showSkillDetail(skillsManagerRef.current, dirname(created.path)));
      setChat((state) => ({ ...state, notice: `${name} is copied to ~/.golem/skills and now yours to edit` }));
    } catch (error) {
      setChat((state) => ({ ...state, notice: messageOf(error) }));
    }
  }

  /** Show a file in Finder, or its folder in the desktop's file manager. */
  function revealInFolder(file: string): void {
    const [bin, args] =
      process.platform === "darwin" ? (["open", ["-R", file]] as const) : (["xdg-open", [dirname(file)]] as const);
    const failed = () => setChat((state) => ({ ...state, notice: `could not open ${dirname(file)}` }));
    try {
      const child = spawn(bin, args, { stdio: "ignore", detached: true });
      child.on("error", failed);
      child.unref();
    } catch {
      failed();
    }
  }

  function onTunePress(press: Press): void {
    const state = tuneRef.current;
    const key = tuneKeyOf(press);
    if (state === null || key === null) {
      return;
    }
    const pressed = pressTune(state, key);
    showTune(pressed.state);
    if (pressed.action.kind === "close") {
      showTune(null);
    } else if (pressed.action.kind === "try") {
      tryAgain(pressed.state);
    } else if (pressed.action.kind === "change") {
      sendTune(pressed.state.model, pressed.action);
    } else if (pressed.action.kind === "preset" || pressed.action.kind === "save") {
      sendTunePreset(pressed.state.model, pressed.action);
    }
  }

  function onPickerPress(press: Press): void {
    const state = pickerRef.current;
    const key = pickerKeyOf(state, press);
    if (key === null) {
      return;
    }
    const pressed = pressPicker(state, withPulls(listingRef.current, pullsRef.current), key);
    pickerRef.current = pressed.state;
    setPicker(pressed.state);
    const action = pressed.action;
    if (action.kind === "refresh") {
      setChat((current) => ({ ...current, notice: "refreshing models…" }));
      loadModels(true);
    } else if (action.kind === "show-all") {
      setChat((current) => ({
        ...current,
        notice: action.on ? "showing every live model that calls tools" : "showing the current models",
      }));
      loadModels(false);
    } else if (action.kind === "choose") {
      chooseModel(action.model, action.name, action.setDefault);
    } else if (action.kind === "notice") {
      setChat((current) => ({ ...current, notice: action.text }));
    } else if (action.kind === "pull") {
      startPull(action.ref, action.use, action.setDefault);
    } else if (action.kind === "install") {
      startInstall(action.ref, action.setDefault);
    } else if (action.kind === "cancel-pull") {
      void client.cancelPull(action.ref).catch((error: unknown) => {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      });
    } else if (action.kind === "delete") {
      void client.deleteModel(action.ref).then(
        (result) => {
          setChat((current) => ({
            ...current,
            error: null,
            notice: result.deleted ? `removed ${result.ref}` : `${result.ref} was not installed`,
          }));
          loadModels(false);
        },
        (error: unknown) => {
          setChat((current) => ({ ...current, error: messageOf(error) }));
        },
      );
    } else if (action.kind === "star") {
      void client.starModel(action.ref, action.starred).then(
        () => {
          setChat((current) => ({ ...current, error: null, notice: `${action.starred ? "starred" : "unstarred"} ${action.ref}` }));
          loadModels(false);
        },
        (error: unknown) => {
          setChat((current) => ({ ...current, error: messageOf(error) }));
        },
      );
    } else if (action.kind === "close") {
      setChat((current) => ({ ...current, notice: state.firstRun ? NO_MODEL_BAND : null }));
    }
  }

  function removeKey(provider: string): void {
    void client.removeKey(provider).then(
      (result) => {
        setChat((current) => ({
          ...current,
          error: null,
          notice: result.removed ? `${provider} key removed from the Keychain` : `no ${provider} key was stored`,
        }));
      },
      (error: unknown) => {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      },
    );
  }

  function endHistory(): void {
    if (historyCursorRef.current === null) {
      return;
    }
    historyCursorRef.current = null;
    setHistoryCursor(null);
  }

  function applyHistory(key: "older" | "newer" | "close"): void {
    const entries = recallOrder(sessionEntries(chatRef.current.messages), sentHistory.current.snapshot());
    if (key === "close") {
      const left = leaveHistory(historyCursorRef.current, draftRef.current.text);
      historyCursorRef.current = null;
      setHistoryCursor(null);
      setDraft(draftAt(left.text));
      return;
    }
    const next = browseHistory(historyCursorRef.current, key, entries, draftRef.current.text);
    if (next.cursor === historyCursorRef.current && next.text === draftRef.current.text) {
      return;
    }
    historyCursorRef.current = next.cursor;
    setHistoryCursor(next.cursor);
    setDraft(draftAt(next.text));
  }

  function onCtrlC(): void {
    const connected = connectionRef.current.status === "connected";
    const pressed = pressCtrlC(interrupt.current, connected ? runIdRef.current : null, Date.now());
    interrupt.current = pressed.state;
    const action = pressed.action;
    if (action.kind === "exit") {
      exit();
      return;
    }
    if (action.kind === "arm") {
      showHint(EXIT_HINT, EXIT_WINDOW_MS);
      return;
    }
    showHint("cancelling…", EXIT_WINDOW_MS);
    void client.cancelRun(action.runId).catch((error: unknown) => {
      setChat((current) => ({ ...current, notice: null, error: messageOf(error) }));
    });
  }

  function forkHere(): void {
    const current = sessionRef.current;
    const at = forkPoint(chatRef.current.messages);
    if (at === null) {
      setChat((state) => ({ ...state, notice: "nothing to fork yet" }));
      return;
    }
    if (current === null || connectionRef.current.status !== "connected") {
      return;
    }
    void client.forkSession(current, at).then(
      (result) => {
        session.switchTo(result.session_id);
        setChat((state) => ({ ...state, notice: "forked; this is the new session" }));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, error: messageOf(error) }));
      },
    );
  }

  function retitle(title: string | null): void {
    const current = sessionRef.current;
    if (title === null) {
      const known = sessionsRef.current.find((summary) => summary.session_id === current)?.title;
      setChat((state) => ({ ...state, notice: titleNotice(known ?? null) }));
      return;
    }
    if (current === null || connectionRef.current.status !== "connected") {
      return;
    }
    void client.renameSession(current, title).then(
      (result) => {
        setChat((state) => ({ ...state, error: null, notice: titleNotice(result.title) }));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, error: messageOf(error) }));
      },
    );
  }

  function compactHere(action: "clear" | "summarise" | "grow", focus: string | null): void {
    const current = sessionRef.current;
    if (current === null || connectionRef.current.status !== "connected") {
      return;
    }
    if (busyRef.current) {
      setChat((state) => ({ ...state, notice: "wait for the answer to finish before compacting" }));
      return;
    }
    setChat((state) => ({ ...state, error: null, notice: compactWaiting(action) }));
    void runCompact(client, current, action, focus).then(
      (notice) => {
        setChat((state) => ({ ...state, error: null, notice }));
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, notice: null, error: messageOf(error) }));
      },
    );
  }

  function closeHere(sessionId: string, stayInSwitcher: boolean): void {
    void client.closeSession(sessionId).then(
      () => {
        setChat((current) => ({ ...current, error: null, notice: "closed" }));
        if (sessionRef.current === sessionId) {
          const next = sessionsRef.current.find(
            (summary) => summary.session_id !== sessionId && summary.status !== "closed",
          );
          if (next === undefined) {
            session.startNew();
          } else {
            session.switchTo(next.session_id);
          }
        }
        if (!stayInSwitcher) {
          setSwitcher(closedSwitcher);
        }
      },
      (error: unknown) => {
        setChat((current) => ({ ...current, error: messageOf(error) }));
      },
    );
  }

  function onSwitcherKey(key: SwitcherKey): void {
    const pressed = pressSwitcher(switcherRef.current, sessionsRef.current, key, sessionRef.current);
    setSwitcher(pressed.state);
    const action = pressed.action;
    if (action.kind === "open") {
      session.switchTo(action.sessionId);
    } else if (action.kind === "new") {
      session.startNew();
    } else if (action.kind === "close-session") {
      closeHere(action.sessionId, true);
    }
  }

  function showDebug(next: DebugState): void {
    if (next.open !== debugRef.current.open || next.tab !== debugRef.current.tab) {
      debugLines.current = 0;
      setDebugOffset(0);
    }
    setDebug(next);
  }

  function currentPlace(): KeyPlace {
    return {
      overlay: keysOpen,
      help: helpOpen,
      switcher: switcherRef.current.open,
      switcherConfirm: switcherRef.current.confirm,
      switcherFiltering: switcherRef.current.query.length > 0,
      debug: debugRef.current.open,
      draftEmpty: draftRef.current.text.length === 0,
      busy: busyRef.current,
      connected: connectionRef.current.status === "connected" && sessionRef.current !== null,
      suggestions: suggestRef.current.open,
      history: historyCursorRef.current !== null,
      approval: approvalRef.current !== null,
      helperAsk: isHelperApproval(dockRef.current),
      useHelpers: isUseHelpersQuestion(approvalRef.current),
      useHelpersCheaper: isUseHelpersQuestion(approvalRef.current) && (approvalRef.current?.estimate?.cheaperModel ?? null) !== null,
      askPages: (dockRef.current?.items.length ?? 0) > 1,
      approvalDiff: approvalRef.current !== null && approvalRef.current.diff !== null,
      approvalEdit: argsEditRef.current !== null,
      review: reviewRef.current !== null,
      reviewEdit: reviewEditRef.current !== null,
      question: chatRef.current.checks.allowed === null && chatRef.current.checks.offered !== null,
      consent: consentRef.current !== null,
      consentShow: consentShowRef.current.showable,
    };
  }

  function applyKeyEffect(effect: KeyEffect): void {
    switch (effect.kind) {
      case "cancel":
        onCtrlC();
        return;
      case "toggle-overlay":
        setKeysOpen((open) => !open);
        setKeysOffset(0);
        return;
      case "close-overlay":
        setKeysOpen(false);
        setKeysOffset(0);
        return;
      case "close-help":
        setPanel(null);
        return;
      case "scroll-overlay":
        setKeysOffset((current) =>
          moveOverlayOffset(
            current,
            effect.toward,
            keyOverlayLines(KEYS, columns).length,
            Math.max(1, budget.body),
          ),
        );
        return;
      case "scroll":
        scrollView(effect.target, effect.toward);
        return;
      case "close-debug":
        showDebug({ ...debugRef.current, open: false });
        return;
      case "debug-tab":
        switchDebugTab();
        return;
      case "suggest":
        applySuggestKey(effect.key);
        return;
      case "history":
        applyHistory(effect.key);
        return;
      case "switcher":
        onSwitcherKey(effect.key);
        return;
      case "submit":
        submit();
        return;
      case "edit":
        setDraft(
          (effect.op === "backspace" ? deleteToken(draftRef.current, pastesRef.current) : null) ??
            edit(draftRef.current, effect.op),
        );
        return;
      case "move-row": {
        const current = draftRef.current;
        const goal = rowGoal.current?.draft === current ? rowGoal.current.goal : null;
        const moved = moveRow(current.text, current.cursor, columns, effect.direction, goal);
        const next = { text: current.text, cursor: moved.cursor };
        rowGoal.current = { draft: next, goal: moved.goal };
        setDraft(next);
        return;
      }
      case "edit-external":
        void openEditor();
        return;
      case "approve":
        answerApproval(effect.decision);
        return;
      case "checks":
        answerChecks(effect.on, false);
        return;
      case "consent":
        answerConsent(effect.answer);
        return;
      case "consent-show": {
        const run = consentShowRef.current.runId;
        if (run !== null) setBriefShownRun((current) => (current === run ? null : run));
        return;
      }
      case "helper-ask":
        answerHelperAsk(effect.answer);
        return;
      case "helpers-run":
        answerHelpers(effect.run, effect.cheaper === true);
        return;
      case "ask-next":
        if (dockRef.current !== null) setAskPick(nextAskKey(dockRef.current));
        return;
      case "edit-args":
        if (approvalRef.current !== null) {
          setArgsEdit(startArgsEdit(approvalRef.current));
        }
        return;
      case "args":
        onArgsKey(effect.key);
        return;
      case "review":
        answerReview(effect.verdict);
        return;
      case "review-edit":
        if (reviewRef.current !== null) {
          const item = reviewRef.current;
          setReviewEdit(startReviewEdit(item));
          void openReviewEdit(client, item).then((opened) =>
            setReviewEdit((state) => (state !== null && state.workflowRunId === opened.workflowRunId && state.key === opened.key && state.loading ? opened : state)),
          );
        }
        return;
      case "review-args":
        onReviewKey(effect.key);
        return;
      case "scroll-diff": {
        const pending = approvalRef.current;
        const window = Math.max(0, budget.approval - APPROVAL_ROWS);
        if (pending !== null) {
          const total = diffLineCount(pending);
          setDiffScroll((current) => ({
            callId: pending.callId,
            offset: moveDiffOffset(
              current.callId === pending.callId ? current.offset : 0,
              effect.toward,
              effect.line,
              total,
              window,
            ),
          }));
        }
        return;
      }
      case "restart-service":
        if (serviceRestartable()) {
          restartService();
        }
        return;
      case "cycle-mode": {
        const current = sessionRef.current;
        if (current !== null) {
          changeMode(current, nextMode(effectiveMode(chatRef.current.permissionMode, defaultMode)));
        }
        return;
      }
      case "toggle-tools":
        setToolOutput((shown) => {
          const next = !shown;
          setChat((current) => ({ ...current, notice: next ? "tool output shown" : "tool output hidden" }));
          return next;
        });
        return;
      case "insert":
        setDraft(insertText(draftRef.current, effect.text));
        return;
      case "ignore":
        return;
    }
  }

  /** Tells the daemon whether golem may run the project's checks. The question closes from `session.checks.changed`. */
  function answerChecks(on: boolean, say: boolean): void {
    const current = sessionRef.current;
    if (current === null) {
      return;
    }
    client.setChecks(current, on).then(
      () => {
        if (say) {
          setChat((state) => ({ ...state, notice: checksChanged(on) }));
        }
      },
      (error: unknown) => {
        setChat((state) => ({ ...state, error: messageOf(error) }));
      },
    );
  }

  function answerApproval(decision: ApprovalChoice): void {
    const pending = approvalRef.current;
    const current = sessionRef.current;
    if (pending === null || current === null) {
      return;
    }
    void client.respondApproval(current, pending.callId, decision).catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
  }

  /** A key on "start these helpers?": `helpers.respond` with the lead's session and the `delegate` call. */
  function answerHelpers(run: boolean, cheaper = false): void {
    const pending = approvalRef.current;
    const current = sessionRef.current;
    if (pending === null || current === null || !isUseHelpersQuestion(pending)) {
      return;
    }
    const sent = cheaper ? client.respondHelpers(current, pending.callId, true, true) : client.respondHelpers(current, pending.callId, run);
    void sent.catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
  }

  /** A key on a helper's tool call: the answer goes to the helper's session, with the scope. */
  function answerHelperAsk(answer: HelperAskAnswer): void {
    const shown = dockRef.current;
    if (shown === null) return;
    const sent = helperAskAnswer(shown.item, answer);
    if (sent === null) return;
    const done =
      sent.scope === undefined
        ? client.respondApproval(sent.sessionId, sent.callId, sent.decision)
        : client.respondApproval(sent.sessionId, sent.callId, sent.decision, undefined, sent.scope);
    void done.catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
  }

  function answerConsent(answer: "session" | "once" | "local"): void {
    const pending = consentRef.current;
    const current = consentSessionRef.current ?? sessionRef.current;
    if (pending === null || current === null || !pending.alternatives.includes(answer)) {
      return;
    }
    void client.answerConsent(current, pending.runId, answer).catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
  }

  /** y or n on a workflow review: the answer goes to `workflow.review.answer` with the item's run and key. */
  function answerReview(verdict: ReviewVerdict, text?: string): Promise<unknown> | null {
    const item = reviewRef.current;
    if (item === null) return null;
    const sent = submitReviewAnswer(client, item, verdict, text);
    void sent.catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
    return sent;
  }

  /** A key while a review's draft is open in the editor. */
  function onReviewKey(key: ArgsKey): void {
    const current = reviewEditRef.current;
    if (current === null || current.submitting) return;
    if (key.kind === "cancel") {
      setReviewEdit(null);
      return;
    }
    if (current.loading) return;
    if (key.kind === "edit" || key.kind === "insert") {
      const draft = key.kind === "edit" ? edit(current.draft, key.op) : insertText(current.draft, key.text);
      setReviewEdit({ ...current, draft, error: null });
      return;
    }
    const text = current.draft.text.trim();
    if (text === "") {
      setReviewEdit({ ...current, error: "Write the reply, or press Esc to go back" });
      return;
    }
    setReviewEdit({ ...current, submitting: true, error: null });
    const sent = submitReviewAnswer(client, current, "edit", current.draft.text);
    void sent.then(
      () => setReviewEdit(null),
      (error: unknown) => setReviewEdit((state) => (state === null ? null : { ...state, submitting: false, error: messageOf(error) })),
    );
  }

  function onArgsKey(key: ArgsKey): void {
    const current = argsEditRef.current;
    const pending = approvalRef.current;
    if (current === null || pending === null || current.submitting) {
      return;
    }
    if (key.kind === "cancel") {
      setArgsEdit(null);
      return;
    }
    if (key.kind === "edit" || key.kind === "insert") {
      const draft = key.kind === "edit" ? edit(current.draft, key.op) : insertText(current.draft, key.text);
      setArgsEdit({ ...current, draft, error: null });
      return;
    }
    const parsed = parseArgs(current.draft.text);
    const session = sessionRef.current;
    if (!parsed.ok) {
      setArgsEdit({ ...current, error: parsed.error });
      return;
    }
    if (session === null) {
      return;
    }
    setArgsEdit({ ...current, submitting: true, error: null });
    const args = editedArgs(pending, parsed.args) ?? undefined;
    client.respondApproval(session, current.callId, "allow", args).catch((error: unknown) =>
      setArgsEdit((state) => (state === null ? null : { ...state, submitting: false, error: messageOf(error) })),
    );
  }

  async function openEditor(): Promise<void> {
    if (editing.current || busyRef.current || switcherRef.current.open || keysOpenRef.current) {
      return;
    }
    if (connectionRef.current.status !== "connected" || sessionRef.current === null) {
      return;
    }
    editing.current = true;
    try {
      const saved = await editDraft(expandPastes(draftRef.current.text, pastesRef.current), suspendTerminal);
      if (saved !== null) {
        setDraft(draftAt(saved));
      }
    } catch {
      // The editor did not start. The draft stays.
    } finally {
      editing.current = false;
    }
  }

  function switchDebugTab(): void {
    const next = toggleDebugTab(debugRef.current);
    showDebug(next);
    if (next.tab === "model" && sessionRef.current !== null && connectionRef.current.status === "connected") {
      loadCheckpointRef.current(sessionRef.current);
    }
  }

  function applySuggestKey(key: "up" | "down" | "tab" | "enter" | "close"): void {
    if (key === "close") {
      setSuggestDismissed(true);
      return;
    }
    const current = suggestRef.current;
    if (key === "up" || key === "down") {
      setSuggestPick({
        draft: draftRef.current.text,
        index: moveSuggestion(current.selected, key, current.items.length),
      });
      return;
    }
    const next = applySuggestion(draftRef.current.text, current.items, current.selected, key);
    if (next.draft !== draftRef.current.text) {
      setDraft(draftAt(next.draft));
    }
    if (next.submit) {
      submit();
      return;
    }
    if (key === "tab" && next.draft === draftRef.current.text && debugRef.current.open) {
      switchDebugTab();
    }
  }

  function scrollView(target: "debug" | "transcript", toward: "up" | "down" | "start" | "end"): void {
    const step = target === "debug" ? debugPage : page;
    const move = target === "debug" ? setDebugOffset : setOffset;
    if (toward === "up") {
      move((value) => value + step);
      return;
    }
    if (toward === "down") {
      move((value) => Math.max(0, value - step));
      return;
    }
    if (toward === "start") {
      move(Number.MAX_SAFE_INTEGER);
      return;
    }
    move(0);
  }

  onF1.current = () => {
    applyKeyEffect(pressKey(currentPlace(), { name: "f1", input: "", ctrl: false, meta: false }));
  };

  useInput((input, key) => {
    if (key.eventType === "release") {
      return;
    }
    const press = classifyPress(input, key);
    if (selectionRef.current !== null && press.name === "escape") {
      showSelection(null);
      return;
    }
    if (setupRef.current !== null) {
      onSetupPress(press);
      return;
    }
    if (tuneRef.current !== null && !keysOpenRef.current && press.name !== "f1") {
      onTunePress(press);
      return;
    }
    if (pickerRef.current.open && !keysOpenRef.current && press.name !== "f1") {
      onPickerPress(press);
      return;
    }
    if (permsRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onPermissionsPress(press);
      return;
    }
    if (mcpManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onMcpManagerPress(press);
      return;
    }
    if (skillsManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onSkillsManagerPress(press);
      return;
    }
    if (measure.state.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      measure.press(press);
      return;
    }
    if (agentsManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onAgentsManagerPress(press);
      return;
    }
    if (routinesManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onRoutinesManagerPress(press);
      return;
    }
    if (stepsManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onStepsManagerPress(press);
      return;
    }
    if (runsManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onRunsManagerPress(press);
      return;
    }
    if (memoryManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onMemoryManagerPress(press);
      return;
    }
    if (undoRef.current !== null && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onUndoPress(press);
      return;
    }
    if (changesManagerRef.current.open && !keysOpenRef.current && press.name !== "f1" && press.name !== "ctrl-c") {
      onChangesManagerPress(press);
      return;
    }
    const installing = installRef.current;
    if (installing !== null && press.name === "escape" && !keysOpenRef.current) {
      // Esc stops brew while it runs, and puts the band away after.
      if (installing.state.phase === "running") {
        cancelInstall.current?.();
      } else {
        showInstall(null);
      }
      return;
    }
    if (restartOffered() && press.name === null && !press.ctrl && !press.meta && press.input === "r") {
      restartService();
      return;
    }
    const retry = retryOffer();
    if (retry !== null && !keysOpenRef.current && (press.name === "return" || press.name === "escape")) {
      const enter = press.name === "return";
      // Esc leaves the banner as it was; Enter swaps it for the install band.
      setChat((current) => ({ ...current, retry: null, error: enter ? null : current.error }));
      if (enter) {
        startInstall(retry.ref, false, retry.text);
      }
      return;
    }
    const runsBanner = runsBannerRef.current;
    if (press.name === "escape" && runsBanner !== null) {
      const place = currentPlace();
      const owned =
        place.overlay || place.help || place.switcher || place.debug || place.suggestions || place.history ||
        place.approval || place.consent || place.question;
      if (!owned) {
        setDismissedRuns((current) => new Set(current).add(runsBanner));
        return;
      }
    }
    if (press.name === "return" && !keysOpenRef.current && planOffered()) {
      buildPlan();
      return;
    }
    if (onContextPress(press)) {
      return;
    }
    if (onStarterPress(press.name)) {
      return;
    }
    applyKeyEffect(pressKey(currentPlace(), press));
  });

  /** The newest plan waits for an answer and nothing else has the keys: Enter on an empty composer builds it. */
  function planOffered(): boolean {
    return planOfferedAt(chatRef.current.plan, currentPlace(), {
      retry: retryOffer() !== null,
      install: installRef.current !== null,
      setup: setupRef.current !== null,
    });
  }

  /** "Build it": plan first goes off, then the build message is sent as any other. */
  function buildPlan(): void {
    const current = sessionRef.current;
    if (current === null) {
      return;
    }
    client.setPlan(current, false).then(
      () => sendText(BUILD_TEXT),
      (error: unknown) => {
        setChat((state) => ({ ...state, notice: messageOf(error) }));
      },
    );
  }

  /** Down moves into the starter prompts, and Enter puts one in the composer. True when the key was theirs. */
  /** The `/context` panel is open on an empty draft: c, s, g and m run the row they name. */
  function onContextPress(press: Press): boolean {
    if (panel !== "context" || tuneRef.current !== null || keysOpenRef.current || switcherRef.current.open) {
      return false;
    }
    if (draftRef.current.text.length > 0) {
      return false;
    }
    const row = contextRowForPress(contextRows, press);
    const id = sessionRef.current;
    if (row === null || id === null) {
      return false;
    }
    setPanel(null);
    if (row.id === "larger") {
      changeRoute(id, "auto");
    } else {
      compactHere(row.id, null);
    }
    return true;
  }

  function onStarterPress(name: string | null): boolean {
    const key: StarterKey | null =
      name === "up" || name === "down" || name === "escape" ? name : name === "return" ? "enter" : null;
    const place = currentPlace();
    if (
      key === null ||
      startersRef.current.length === 0 ||
      place.overlay ||
      place.help ||
      place.switcher ||
      place.debug ||
      place.history
    ) {
      return false;
    }
    const pressed = pressStarter(starterPickRef.current, key, startersRef.current);
    if (pressed.kind === "pass") {
      return false;
    }
    if (pressed.kind === "pick") {
      starterPickRef.current = pressed.pick;
      setStarterPick(pressed.pick);
      return true;
    }
    starterPickRef.current = null;
    setStarterPick(null);
    setDraft(draftAt(pressed.text));
    return true;
  }

  /** `r` restarts a service that is installed but does not answer, with an empty composer. */
  function restartOffered(): boolean {
    return (
      problemRef.current?.restart === true &&
      !restartingRef.current &&
      draftRef.current.text === "" &&
      !keysOpenRef.current
    );
  }

  /** Ctrl-R restarts whenever the banner offers it: a service that does not answer, or one older than this golem. */
  function serviceRestartable(): boolean {
    return (
      service?.restart != null &&
      !restartingRef.current &&
      (problemRef.current?.restart === true || upgradeRef.current !== null)
    );
  }

  function restartService(): void {
    const restart = service?.restart;
    if (restart === null || restart === undefined) {
      return;
    }
    setRestarting(true);
    restart().then(
      () => setRestarting(false),
      (error: unknown) => {
        setRestarting(false);
        setChat((current) => ({ ...current, error: `golem daemon restart failed: ${messageOf(error)}` }));
      },
    );
  }

  /** The banner's install question: after a missing Ollama stopped a message, with an empty composer. */
  function retryOffer(): { ref: string; text: string } | null {
    const retry = chatRef.current.retry;
    const ref = currentModelRef();
    if (retry === null || ref === null || !ref.startsWith(`${retry.provider}/`)) {
      return null;
    }
    if (
      draftRef.current.text !== "" ||
      busyRef.current ||
      installRef.current !== null ||
      switcherRef.current.open ||
      pickerRef.current.open
    ) {
      return null;
    }
    return { ref, text: retry.text };
  }

  usePaste((text) => {
    const ui = setupRef.current;
    if (ui !== null) {
      // Only the Key panel takes a paste: the key.
      if (ui.window.view === "panel" && ui.window.panel === "key") {
        onKeyInput(ui, ui.window, { kind: "text", text });
      } else if (ui.window.view === "panel" && ui.window.panel === "tools" && ui.quit === null && toolsTyping(ui.tools)) {
        showSetup({ ...ui, tools: pressTools(ui.tools, { kind: "text", text }).ui });
      }
      return;
    }
    if (
      busyRef.current ||
      switcherRef.current.open ||
      pickerRef.current.open ||
      permsRef.current.open ||
      mcpManagerRef.current.open ||
      skillsManagerRef.current.open ||
      agentsManagerRef.current.open ||
      routinesManagerRef.current.open ||
      runsManagerRef.current.open ||
      stepsManagerRef.current.open ||
      memoryManagerRef.current.open ||
      changesManagerRef.current.open ||
      tuneRef.current !== null ||
      keysOpenRef.current
    ) {
      return;
    }
    if (connectionRef.current.status !== "connected" || sessionRef.current === null) {
      return;
    }
    if (argsEditRef.current !== null) {
      setDraft(insertText(draftRef.current, text));
      return;
    }
    const pasted = collapsePaste(pastesRef.current, text);
    pastesRef.current = pasted.pastes;
    setDraft(insertText(draftRef.current, pasted.insert));
  });

  function currentModelRef(): string | null {
    const name = sessionModelRef.current?.profile ?? null;
    const found = listingRef.current?.models.find(
      (model) => name !== null && (model.ref === name || (model.profiles ?? []).includes(name)),
    );
    return found?.ref ?? null;
  }

  const contentWidth = transcript.gutter === null ? columns : Math.max(1, columns - 1);
  const placeholder = tipAt(sessionTip(sessionId));
  const firstShown = transcript.lineCount - transcript.offsetFromBottom - transcript.lines.length;
  const selection =
    chatSelection !== null && chatSelection.width === contentWidth && chatSelection.messages === chat.messages.length
      ? chatSelection.selection
      : null;
  selectionRef.current = selection;
  const pinnedRows = transcript.pinned === null ? 0 : 1;
  selectFrame.current = {
    view: {
      top: budget.header + pinnedRows,
      rows: transcript.lines.length,
      first: firstShown,
      count: transcript.lineCount,
      width: contentWidth,
    },
    all: transcript.all,
    pinned: transcript.pinned === null ? null : { row: budget.header, offset: transcript.pinned.offset },
    shown: !keysOpen && !picker.open && !mcpManager.open && !skillsManager.open && !agentsManager.open && !routinesManager.open && !runsManager.open && !stepsManager.open && !memoryManager.open && !changesManager.open && !perms.open && !switcher.open,
  };
  const composer =
    argsEdit !== null
      ? layoutComposer(argsEdit.draft.text, argsEdit.draft.cursor, columns, budget.composer, false)
      : reviewEdit !== null
        ? layoutComposer(reviewEdit.draft.text, reviewEdit.draft.cursor, columns, budget.composer, false)
        : layoutComposer(draft.text, draft.cursor, columns, budget.composer, chat.busy, placeholder);
  const debugLayout = layoutDebug({
    debug,
    rows: budget.debug,
    columns,
    wire,
    messages: modelMessages,
    screenCount: chat.messages.length,
    modelCount,
    offsetFromBottom: debugOffset,
  });

  useEffect(() => {
    const previous = debugLines.current;
    const nextCount = debugLayout.lineCount;
    const held = holdDebugOffset(debugOffset, previous, nextCount);
    debugLines.current = nextCount;
    if (held !== debugOffset) {
      setDebugOffset(held);
      return;
    }
    if (debugLayout.offsetFromBottom !== debugOffset) {
      setDebugOffset(debugLayout.offsetFromBottom);
    }
  }, [debugLayout.lineCount, debugLayout.offsetFromBottom, debugOffset]);

  if (setup !== null) {
    const view = setupView(setup, setupNow);
    // The Key panel says this itself while it checks a key.
    const keyPanelSays =
      setup.window.view === "panel" && setup.window.panel === "key" && (setup.key.phase === "checking" || setup.key.phase === "works");
    const shown = keyPanelSays ? view : { ...view, lines: [...view.lines, ...keychainLines(keychainWaiting)] };
    return (
      <SetupFrame
        window={setup.window}
        facts={setupFacts()}
        lines={shown.lines}
        hint={setupHint(shown.screen, setup.window, shown.adds ?? 0)}
        version={`golem ${GOLEM_VERSION}`}
        columns={size.columns || 80}
        rows={rows}
        frame={Math.floor(setupNow / 100)}
      />
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      <Header
        mode={budget.mode}
        version={versions.text}
        versionWarn={versions.warn}
        model={chip}
        cwd={cwd}
        columns={columns}
      />
      {keysOpen ? (
        <LineList
          lines={keyOverlayLines(KEYS, columns)}
          columns={columns}
          height={budget.body}
          offset={keysOffset}
        />
      ) : picker.open ? (
        <ModelPickerView
          rows={layoutPicker({
            state: picker,
            listing: shownListing,
            current: sessionModel?.profile ?? null,
            columns,
            rows: budget.body - 1,
          })}
          columns={columns}
          height={budget.body}
          hint={pickerHint(picker, shownListing?.ram_gb ?? null)}
        />
      ) : mcpManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutMcpManager({
            state: mcpManager,
            servers: mcp.servers,
            error: mcp.error,
            home: homedir(),
            columns,
            rows: budget.body,
          }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
          ))}
        </Box>
      ) : skillsManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutSkillsManager({
            state: skillsManager,
            skills: skillList.skills,
            error: skillList.error,
            cwd: sessionCwd ?? process.cwd(),
            home: homedir(),
            columns,
            rows: budget.body,
            pinned: chat.activeSkills,
          }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
          ))}
        </Box>
      ) : agentsManager.open && measure.state.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutMeasure({ state: measure.state, data: measure.data, columns, rows: budget.body }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
          ))}
        </Box>
      ) : agentsManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutAgentsManager({
            state: agentsManager,
            agents: agentList.agents,
            error: agentList.error,
            cwd: sessionCwd ?? process.cwd(),
            home: homedir(),
            columns,
            rows: budget.body,
            setup: wishSetup(listing?.models),
            models: listing?.models,
            keep: agentsKeep,
          }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
          ))}
        </Box>
      ) : routinesManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutRoutinesManager({
            state: routinesManager,
            list: routineList,
            runs: routinesManager.view.kind === "detail" ? (routineRuns?.runs ?? null) : null,
            now: Date.now(),
            home: homedir(),
            columns,
            rows: budget.body,
          }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
          ))}
        </Box>
      ) : stepsManager.open ? (
        <StepsManagerView
          lines={layoutStepsManager({
            state: stepsManager,
            batches: chat.batches,
            events: helperEventsRef.current,
            refs: helperRefsOf,
            helper: helperChat,
            trimmedAt: trimmedAtOf(sessions, helperChat?.sessionId),
            lead: titleLabel,
            now: Date.now(),
            columns,
            rows: budget.body,
            isLocal: isLocalFrom(shownListing?.models),
          })}
          columns={columns}
          height={budget.body}
        />
      ) : runsManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutRunsManager({ state: runsManager, list: runList, now: Date.now(), columns, rows: budget.body }).map(
            (line, index) => (
              <McpManagerRow key={index} line={line} />
            ),
          )}
        </Box>
      ) : memoryManager.open ? (
        <MemoryManagerView
          lines={layoutMemoryManager({
            state: memoryManager,
            list: memoryList,
            folder: memoryFolder(),
            home: homedir(),
            columns,
            rows: budget.body,
          })}
          columns={columns}
          height={budget.body}
        />
      ) : changesManager.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutChanges(changesManager, { ...changes, notes: notesOf(sessionId).notes, workers: changesWorkers() }, columns, budget.body).map((line, index) => (
            <ChangesRow key={index} line={line} />
          ))}
        </Box>
      ) : perms.open ? (
        <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
          {layoutPermissions(perms, columns, budget.body).map((line, index) => (
            <Text key={index} wrap="truncate-end" inverse={line.selected} dimColor={line.dim && !line.selected}>
              {line.text}
            </Text>
          ))}
        </Box>
      ) : switcher.open ? (
        <SwitcherView
          rows={layoutSwitcher({
            state: switcher,
            sessions,
            current: sessionId,
            now: Date.now(),
            columns,
            rows: budget.body - 1,
          })}
          columns={columns}
          height={budget.body}
          hint={switcherHint(switcher, sessions)}
          empty={switcher.query.length > 0 ? "No matching sessions." : NO_SESSIONS}
        />
      ) : (
      <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
        <Box flexDirection="column" width={columns} height={chatHeight} flexShrink={0} overflow="hidden">
          {chatHeight > 0 && chat.messages.length === 0 ? <Text dimColor>Type a message.</Text> : null}
          {chat.messages.length === 0 && starterRows.length > 0 && chatHeight > starterRows.length + 1 ? (
            <Box flexDirection="column" marginTop={1}>
              {starterRows.map((row, index) => (
                <Text key={index} bold={row.selected} dimColor={row.dim} wrap="truncate">
                  {row.text}
                </Text>
              ))}
            </Box>
          ) : null}
          {transcript.pinned !== null ? (
            <Box width={columns} height={1} overflow="hidden">
              <Box width={contentWidth} height={1} backgroundColor={QUESTION_BG}>
                <LineView line={transcript.pinned.line} columns={null} />
              </Box>
              {transcript.gutter !== null ? <Text dimColor>{transcript.gutter[0] ?? " "}</Text> : null}
            </Box>
          ) : null}
          {transcript.lines.map((line, index) => (
            <Box key={index} width={columns} height={1} overflow="hidden">
              <Box
                width={contentWidth}
                height={1}
                backgroundColor={line.role === "user" ? QUESTION_BG : undefined}
              >
                <LineView
                  line={line}
                  columns={selection === null ? null : selectedColumns(selection, firstShown + index)}
                />
              </Box>
              {transcript.gutter !== null ? (
                <Text dimColor>{transcript.gutter[index + pinnedRows] ?? " "}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
        {helpHeight > 0 ? (
          <LineList
            lines={helpRows}
            columns={columns}
            height={helpHeight}
            offset={0}
            color="yellow"
          />
        ) : null}
      </Box>
      )}
      {budget.debug > 0 ? (
        <Box
          flexDirection="column"
          width={columns}
          height={budget.debug}
          flexShrink={0}
          overflow="hidden"
          backgroundColor={QUESTION_BG}
        >
          {debugLayout.rows.map((row, index) => {
            const text = row.spans.map((span) => span.text).join("");
            const pad = " ".repeat(Math.max(0, columns - text.length));
            return (
              <Box key={index} width={columns} height={1} overflow="hidden" backgroundColor={QUESTION_BG}>
                <Text wrap="truncate-end" backgroundColor={QUESTION_BG}>
                  {row.spans.map((span, spanIndex) => (
                    <Text
                      key={spanIndex}
                      dimColor={span.tone === "dim"}
                      bold={span.tone === "active"}
                      color={toneColor(span.tone)}
                      backgroundColor={QUESTION_BG}
                      wrap="truncate-end"
                    >
                      {span.text.length > 0 ? span.text : " "}
                    </Text>
                  ))}
                  <Text backgroundColor={QUESTION_BG}>{pad}</Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
      {budget.banner > 0 && (banner !== null || hintText !== null) ? (
        <BannerLine
          row={bannerRow(banner, hintText, columns)}
          color={(chat.error !== null || (problem !== null && !restarting)) && !asking ? "red" : "yellow"}
        />
      ) : null}
      {budget.meter > 0 && phase !== null ? (
        <Text wrap="truncate-end">
          {meterLine(
            phase,
            assistantChars(chat.messages),
            elapsedSeconds(chat.runStartedAt, Date.now()),
            tick,
            columns,
            startingServer(servers, model.provider),
            chat.localWait,
            writingText,
            chat.loading === null ? null : loadingLine(chat.loading.model, chat.loading.window),
            chat.wait,
          )}
        </Text>
      ) : null}
      {budget.install > 0 && install !== null ? (
        <InstallBand state={install.state} columns={columns} height={budget.install} />
      ) : null}
      {budget.checks > 0 && checksOffer !== null ? (
        <ChecksBand offered={checksOffer} columns={columns} height={budget.checks} />
      ) : null}
      {budget.todos > 0 ? <TodoBand todos={chat.todos} columns={columns} height={budget.todos} /> : null}
      {budget.approval > 0 && helperBand && dock !== null ? (
        <HelperAskBand lines={helperAskLines(dock, columns)} columns={columns} height={budget.approval} />
      ) : budget.approval > 0 && shownConsent !== null ? (
        <ConsentBand consent={shownConsent} columns={columns} height={budget.approval} pager={pager} show={consentShow} />
      ) : budget.approval > 0 && shownApproval !== null ? (
        <ApprovalBand
          approval={shownApproval}
          edit={argsEdit}
          columns={columns}
          height={budget.approval}
          offset={diffOffset}
          pager={pager}
        />
      ) : budget.approval > 0 && shownReview !== null ? (
        <HelperAskBand
          lines={reviewEdit === null ? reviewLines(shownReview, columns, reviewPagerText) : reviewEditLines(shownReview, reviewEdit, columns)}
          columns={columns}
          height={budget.approval}
        />
      ) : budget.approval > 0 && undoBand !== null ? (
        <UndoBand band={undoBand} columns={columns} height={budget.approval} />
      ) : budget.suggestions > 0 ? (
        <SuggestionBand
          items={suggestMatches}
          selected={suggestSelected}
          columns={columns}
          height={budget.suggestions}
        />
      ) : null}
      {budget.rules > 0 ? <ComposerRule columns={columns} /> : null}
      {budget.composer > 0 ? (
        <Box flexDirection="column" width={columns} height={budget.composer} flexShrink={0}>
          {composer.map((line, index) => {
            const at = line.cursorAt;
            const after = at !== null && at >= line.text.length;
            const point = at !== null && !after ? codePointSize(line.text, at) : 0;
            const dim = line.placeholder === true;
            return (
              <Box key={index} width={columns} height={1} overflow="hidden">
                <Text wrap="truncate-end">
                  {line.prefix}
                  <Text color={dim ? PLACEHOLDER : undefined}>
                    {at === null ? line.text : line.text.slice(0, at)}
                    {at !== null && after ? <Text inverse> </Text> : null}
                    {at !== null && !after ? <Text inverse>{line.text.slice(at, at + point)}</Text> : null}
                    {at !== null && !after ? line.text.slice(at + point) : null}
                  </Text>
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
      {budget.rules > 1 ? <ComposerRule columns={columns} /> : null}
      {budget.status > 0 ? (
        <Text wrap="truncate-end">
          {status.map((segment, index) => (
            <StatusSegmentView
              key={segment.id}
              segment={segment}
              connection={connection}
              leading={index > 0}
            />
          ))}
        </Text>
      ) : null}
    </Box>
  );
}

/** The banner's row: the banner on the left, a hint on the right. */
function BannerLine({ row, color }: { row: BannerRow; color: string }) {
  return (
    <Text wrap="truncate-end">
      <Text color={color}>{row.left}</Text>
      {row.gap}
      <Text color={HINT}>{row.right}</Text>
    </Text>
  );
}

/** A dim rule above or below the composer. */
function ComposerRule({ columns }: { columns: number }) {
  return (
    <Text color={COMPOSER_RULE} wrap="truncate-end">
      {"─".repeat(Math.max(0, columns))}
    </Text>
  );
}

function LineView({ line, columns }: { line: LayoutLine; columns: [number, number] | null }) {
  const user = line.role === "user";
  const backgroundColor = user ? QUESTION_BG : undefined;
  const color = user ? QUESTION_FG : undefined;
  if (line.spans.every((span) => span.text.length === 0)) {
    return <Text backgroundColor={backgroundColor}> </Text>;
  }
  return (
    <Text wrap="truncate-end">
      {markSpans(line.spans, columns).map(({ span, selected }, index) => (
        <Text
          key={index}
          bold={span.bold}
          italic={span.italic}
          dimColor={span.dim === true}
          color={
            span.color !== undefined
              ? span.color
              : span.tone === "add"
              ? DIFF_ADD
              : span.tone === "del"
                ? DIFF_DEL
                : span.warn === true
                  ? "yellow"
                  : span.dim === true
                  ? undefined
                  : span.code === true && !user
                    ? "cyan"
                    : color
          }
          backgroundColor={span.tone === "add" ? DIFF_ADD_BG : span.tone === "del" ? DIFF_DEL_BG : backgroundColor}
          inverse={selected}
          wrap="truncate-end"
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

function SuggestionBand({
  items,
  selected,
  columns,
  height,
}: {
  items: readonly Suggestion[];
  selected: number;
  columns: number;
  height: number;
}) {
  const view = suggestionWindow(items.length, selected, height);
  const shown = items.slice(view.start, view.start + height);
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {shown.map((item, offset) => {
        const active = view.start + offset === view.index;
        return (
          <Text key={view.start + offset} wrap="truncate-end">
            <Text bold={active}>{item.label}</Text>
            {active && item.description.length > 0 ? <Text dimColor>{`  ${item.description}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}

function codePointSize(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff ? 2 : 1;
}

function titleNotice(title: string | null): string {
  return title === null ? "this session has no title yet; /title <name> sets one" : `title: ${title}`;
}

function LineList({
  lines,
  columns,
  height,
  offset,
  color,
}: {
  lines: readonly OverlayLine[];
  columns: number;
  height: number;
  offset: number;
  color?: "yellow";
}) {
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - height)));
  const shown = lines.slice(start, start + Math.max(0, height));
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {shown.map((line, index) => (
        <Text
          key={index}
          dimColor={line.dim}
          color={line.dim ? undefined : line.accent === true ? CLAY : color}
          wrap="truncate-end"
        >
          {line.segments !== undefined ? (
            line.segments.map((segment, at) => (
              <Text key={at} color={segment.color}>
                {segment.text}
              </Text>
            ))
          ) : line.gauge === undefined ? (
            line.text.length === 0 ? " " : line.text
          ) : (
            <>
              {line.text.slice(0, line.gauge.start)}
              <Text
                dimColor={line.gauge.fit === "fits"}
                color={line.gauge.fit === "tight" ? "yellow" : line.gauge.fit === "too_big" ? "red" : undefined}
              >
                {line.text.slice(line.gauge.start)}
              </Text>
            </>
          )}
        </Text>
      ))}
    </Box>
  );
}

/** Batcher key prefix that keeps a reply's thinking apart from its text. */
/** How many `helper.*` events of the lead the Steps screen keeps. */
const HELPER_EVENTS_KEPT = 4000;
const THINKING_KEY = "thinking:";

function deltaEvent(messageId: string, text: string, type: "message.delta" | "message.thinking.delta" = "message.delta") {
  return {
    seq: 1,
    session_id: "local",
    run_id: "local",
    ts: "",
    type,
    data: { message_id: messageId, text },
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "request failed";
}

function toneColor(tone: DebugTone): string | undefined {
  if (tone === "active") {
    return CLAY;
  }
  if (tone === "note") {
    return "yellow";
  }
  if (tone === "plain" || tone === "pending") {
    return QUESTION_FG;
  }
  return undefined;
}

function StatusSegmentView({
  segment,
  connection,
  leading,
}: {
  segment: StatusSegment;
  connection: ConnectionState;
  leading: boolean;
}) {
  const text = leading ? `  ${segment.text}` : segment.text;
  if (segment.tone === "connection") {
    return <Text color={colorFor(connection)}>{text}</Text>;
  }
  if (segment.tone === "model") {
    return (
      <Text color={CLAY} bold>
        {text}
      </Text>
    );
  }
  if (segment.tone === "title") {
    return <Text bold>{text}</Text>;
  }
  if (segment.tone === "fresh" || segment.tone === "warn") {
    return <Text color="yellow">{text}</Text>;
  }
  if (segment.tone === "alert") {
    return <Text color="red">{text}</Text>;
  }
  return <Text dimColor>{text}</Text>;
}

function ChangesRow({ line }: { line: ChangesLine }) {
  const color = line.tone === "add" ? DIFF_ADD : line.tone === "del" ? DIFF_DEL : line.tone === "hunk" ? DIFF_HUNK : undefined;
  return (
    <Text wrap="truncate-end" bold={line.bold === true} dimColor={line.dim === true || line.tone === "meta"}>
      {line.left === null ? null : (
        <>
          <Text inverse={line.leftSelected === true}>{line.left}</Text>
          {"│"}
        </>
      )}
      <Text color={color}>{line.text}</Text>
    </Text>
  );
}

function McpManagerRow({ line }: { line: McpManagerLine }) {
  return (
    <Text wrap="truncate-end" bold={line.bold === true || line.selected === true} dimColor={line.dim === true}>
      {line.prefix ?? ""}
      {line.mark ? <Text color={mcpToneColor(line.mark.tone)}>{`${line.mark.text} `}</Text> : null}
      {line.text}
    </Text>
  );
}

function mcpToneColor(tone: McpTone): "green" | "red" | "yellow" | "gray" {
  if (tone === "ok") {
    return "green";
  }
  if (tone === "bad") {
    return "red";
  }
  return tone === "wait" ? "yellow" : "gray";
}

function colorFor(state: ConnectionState): "green" | "yellow" | "red" {
  if (state.status === "connected") {
    return "green";
  }
  if (state.status === "connecting" || state.status === "reconnecting") {
    return "yellow";
  }
  return "red";
}
