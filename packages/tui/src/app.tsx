import { homedir } from "node:os";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useStdin, useWindowSize } from "ink";
import {
  RpcError,
  SESSION_NOT_FOUND,
  type ApprovalChoice,
  type ConfigGetResult,
  type ConnectionState,
  type GolemClient,
  type ListedModel,
  type ModelListResult,
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
  providersUp,
  reduceChat,
  RETRY_QUESTION,
  serverUp,
  todoRows,
  type ChatState,
  type DeltaBatcher,
} from "@golem/view";
import {
  applyComposer,
  invocableSkills,
  closedDebug,
  COMMANDS,
  helpLines,
  toggleDebugTab,
  withModelChoices,
  withSkillChoices,
  type DebugState,
} from "./commands.ts";
import {
  afterInstall,
  closedPicker,
  confirmFor,
  firstRunChoice,
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
import { draftAt, edit, editDraft, insertText, type Draft } from "./edit.ts";
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
import { frameBudget, frameColumns, layoutComposer, moveRow, placeholderFor } from "./chrome.ts";
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
  type KeyEffect,
  type KeyPlace,
  type Press,
  type OverlayLine,
} from "./keys.ts";
import { layoutTranscript, type LayoutLine } from "./layout-chat.ts";
import { DEFAULT_PREFS, loadPrefs, prefsPath, savePref } from "./prefs.ts";
import { TodoBand } from "./todo-band.tsx";
import { InstallBand } from "./install-band.tsx";
import { findBrew, type InstallState, installRows, reduceInstall, runInstall, startedInstall } from "./ollama-install.ts";
import {
  maskSecret,
  openSecret,
  pasteSecret,
  pressSecret,
  secretNotice,
  type SecretPrompt,
  type SecretStep,
} from "./secret.ts";
import { APPROVAL_ROWS, approvalRows, diffLineCount } from "./approval.ts";
import { ApprovalBand } from "./approval-band.tsx";
import {
  ARGS_EDIT_ROWS,
  type ArgsEdit,
  editedArgs,
  liveArgsEdit,
  parseArgs,
  startArgsEdit,
} from "./approval-edit.ts";
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
  mcpManagerKeyOf,
  type McpManagerState,
  type McpTone,
  openMcpManager,
  pressMcpManager,
} from "./mcp-manager.ts";
import {
  closedSkillsManager,
  layoutSkillsManager,
  openSkillsManager,
  pressSkillsManager,
  type SkillList,
  skillsManagerKeyOf,
  type SkillsManagerState,
} from "./skills-manager.ts";
import { assistantChars, elapsedSeconds, meterLine, meterPhase } from "./progress.ts";
import {
  alertLabel,
  fitSegments,
  modelChip,
  preferModel,
  shortCwd,
  shownSessionTitle,
  startedAtMs,
  statusLabel,
  statusSegments,
  uptimeRefreshMs,
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
import { CLAY, COMPOSER_RULE, HINT, PLACEHOLDER, QUESTION_BG, QUESTION_FG } from "./theme.ts";
import { copiedHint, copyText } from "./clipboard.ts";
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

export function App({
  client,
  onWheel,
  onPointer,
}: {
  client: GolemClient;
  onWheel?: WheelSubscribe;
  onPointer?: PointerSubscribe;
}) {
  const [connection, setConnection] = useState<ConnectionState>(client.state);
  const [chat, setChat] = useState<ChatState>(emptyChat);
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
  const [sessionModel, setSessionModel] = useState<ModelInfo | null>(null);
  const [servers, setServers] = useState<ServerStates>({});
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
  const [tick, setTick] = useState(0);
  const [debug, setDebug] = useState<DebugState>(closedDebug);
  const [debugOffset, setDebugOffset] = useState(0);
  const [wire, setWire] = useState<readonly WireLine[]>([]);
  const [modelMessages, setModelMessages] = useState<CheckpointMessage[]>([]);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherState>(closedSwitcher);
  const [panel, setPanel] = useState<"help" | null>(null);
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
  const helpOpen = panel !== null;
  const [keysOpen, setKeysOpen] = useState(false);
  const [keysOffset, setKeysOffset] = useState(0);
  const [diffScroll, setDiffScroll] = useState({ callId: "", offset: 0 });
  const [argsEditState, setArgsEdit] = useState<ArgsEdit | null>(null);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [suggestPick, setSuggestPick] = useState({ draft: "", index: 0 });
  const [historyCursor, setHistoryCursor] = useState<HistoryCursor | null>(null);
  const [secret, setSecret] = useState<SecretPrompt | null>(null);
  const secretRef = useRef(secret);
  secretRef.current = secret;
  const [picker, setPicker] = useState<PickerState>(closedPicker);
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const [listing, setListing] = useState<ModelListResult | null>(null);
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const firstRunChecked = useRef(false);
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
  const shownListing = withPulls(listing, pulls);
  const draftRef = useRef(draft);
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
  const prefsLoaded = useRef(false);
  draftRef.current = draft;
  historyCursorRef.current = historyCursor;
  liveTitleRef.current = liveTitle;
  showTimesRef.current = showTimes;
  busyRef.current = chat.busy;
  const approvalRef = useRef(chat.approval);
  approvalRef.current = chat.approval;
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
  const banner = asking ? RETRY_QUESTION : (chat.error ?? chat.notice);
  const hintText = liveHint(hint, Date.now())?.text ?? null;
  const suggestMatches =
    chat.busy ||
    switcher.open ||
    perms.open ||
    mcpManager.open ||
    skillsManager.open ||
    picker.open ||
    keysOpen ||
    suggestDismissed ||
    historyCursor !== null ||
    secret !== null
      ? []
      : suggest(
          draft.text,
          withSkillChoices(withModelChoices(COMMANDS, modelNames(listing)), invocableSkills(skillList.skills ?? [])),
        );
  const composerText = secret === null ? draft.text : maskSecret(secret.value);
  const suggestSelected =
    suggestPick.draft === draft.text ? Math.min(suggestPick.index, Math.max(0, suggestMatches.length - 1)) : 0;
  const budget = frameBudget({
    rows,
    columns,
    draft: argsEdit !== null ? argsEdit.draft.text : composerText,
    busy: chat.busy && secret === null && argsEdit === null,
    banner: (banner !== null && banner.length > 0) || hintText !== null,
    debug: debug.open,
    suggestions: suggestMatches.length,
    approval: chat.approval === null ? 0 : argsEdit !== null ? APPROVAL_ROWS : approvalRows(chat.approval, rows),
    composerMax: argsEdit !== null ? ARGS_EDIT_ROWS : undefined,
    todos: showTodos ? todoRows(chat.todos) : 0,
    install: install === null ? 0 : installRows(install.state),
  });
  suggestRef.current = {
    items: suggestMatches,
    selected: suggestSelected,
    open: budget.suggestions > 0 && suggestMatches.length > 0,
  };
  overlayFrame.current = { columns, body: budget.body };
  const diffOffset = chat.approval !== null && diffScroll.callId === chat.approval.callId ? diffScroll.offset : 0;
  const panelLines = panel === "help" ? helpLines(COMMANDS, columns) : [];
  const helpText = !keysOpen && !switcher.open ? panelLines : [];
  const helpHeight = Math.min(helpText.length, budget.body);
  const chatHeight = budget.body - helpHeight;
  const transcriptOptions = { times: showTimes, now, toolOutput };
  const measured = layoutTranscript(chat.messages, columns, chatHeight, offset, transcriptOptions);
  const widthKey = measured.overflow ? Math.max(1, columns - 1) : columns;
  const followed = followTail(tail, measured.lineCount, widthKey, offset);
  const transcript =
    followed.offset === offset
      ? measured
      : layoutTranscript(chat.messages, columns, chatHeight, followed.offset, transcriptOptions);
  const model = preferModel(sessionModel, daemonModel);
  const chip = modelChip(model.name, model.profile);
  const cwd = shortCwd(sessionCwd ?? process.cwd(), homedir());
  const versions = versionLabel(GOLEM_VERSION, daemonVersion);
  const phase = meterPhase(chat.busy, assistantChars(chat.messages), chat.approval !== null);
  const page = Math.max(1, (keysOpen ? budget.body : Math.max(1, chatHeight)) - 1);
  const debugPage = Math.max(1, budget.debug - 2);

  const batcher = useRef<DeltaBatcher | null>(null);
  if (batcher.current === null) {
    batcher.current = createDeltaBatcher((messageId, text) => {
      setChat((current) => reduceChat(current, deltaEvent(messageId, text)));
    });
  }

  const session = useSession(client, connection.status === "connected", process.cwd(), {
    onSwitch: (next) => {
      batcher.current?.flush();
      setLiveTitle(null);
      setPanel(null);
      setKeysOpen(false);
      historyCursorRef.current = null;
      setHistoryCursor(null);
      setChat((current) => ({ ...emptyChat, notice: current.notice }));
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
  });
  const sessionRef = session.ref;
  const sessionId = session.id;
  const sessions = useSessionIndex(client, connection.status === "connected");
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
      connection: statusLabel(connection),
      title: titleLabel,
      model: chip,
      folder: cwd,
      messageCount: sessionId === null ? null : chat.messages.length,
      uptimeSeconds,
      freshLines: followed.fresh,
      alert: alertLabel(chat.down, mcpAlert(mcp.servers)),
    }),
    columns,
  );

  useEffect(() => () => batcher.current?.stop(), []);
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
      if (event.session_id !== sessionRef.current) {
        return;
      }
      if (event.type === "session.created") {
        setSessionCwd(event.data.cwd ?? null);
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
      if (
        event.type === "message.completed" ||
        event.type === "run.completed" ||
        event.type === "run.failed"
      ) {
        batcher.current?.flush();
      }
      setChat((current) => reduceChat(current, event));
      if (event.type === "run.cancelled" && event.data.reason === "user") {
        showHint(CANCELLED_NOTICE);
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
    return client.onSkillsChanged((root) => {
      if (root === null || root === skillsFolder()) {
        loadSkills();
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

  useEffect(() => {
    return client.onPull((update) => {
      if (update.kind === "progress") {
        const { ref, progress, status } = update.progress;
        setPulls((current) => ({ ...current, [ref]: { progress: progress ?? null, status } }));
        if (!pickerRef.current.open) {
          const percent = progress === null || progress === undefined ? "" : ` ${Math.floor(progress * 100)}%`;
          setChat((current) =>
            current.notice === null || current.notice.startsWith("downloading ")
              ? { ...current, notice: `downloading ${ref}${percent}` }
              : current,
          );
        }
        return;
      }
      const { ref, ok, error } = update.done;
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

  useEffect(() => {
    if (listing === null || sessionId === null || firstRunChecked.current) {
      return;
    }
    firstRunChecked.current = true;
    const choice = firstRunChoice(listing);
    if (choice === null) {
      return;
    }
    if (choice.kind === "pick") {
      setPicker(openPicker(null, true));
      return;
    }
    chooseModel(choice.model, pickerName(choice.model), true, `Using ${choice.model.ref}, the only model ready. /model to change.`);
  }, [listing, sessionId]);

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

  /** The folder whose skills this screen shows: the session's, or where the TUI started. */
  function skillsFolder(): string {
    return sessionCwdRef.current ?? process.cwd();
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

  function submit(): void {
    const outcome = applyComposer(
      debugRef.current,
      expandPastes(draftRef.current.text, pastesRef.current),
      invocableSkills(skillListRef.current.skills ?? []),
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
    setPanel(null);
    if (outcome.kind === "mcp") {
      setDraft(draftAt(""));
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      const opened = openMcpManager();
      mcpManagerRef.current = opened;
      setMcpManager(opened);
      loadMcp();
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
      applySecretStep({ prompt: openSecret(outcome.provider), submit: null });
      setChat((current) => ({ ...current, error: null, notice: secretNotice(outcome.provider) }));
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
    sendText(outcome.text, outcome.kind === "skill" ? { name: outcome.name, args: outcome.args } : undefined);
  }

  /**
   * Send `text` to this session. On an error it goes back into the composer.
   * With `skill`, the daemon runs that skill once, and `text` is the line as typed.
   */
  function sendText(text: string, skill?: SkillCall): void {
    const currentSession = sessionRef.current;
    if (currentSession === null || busyRef.current || connectionRef.current.status !== "connected") {
      setDraft(draftAt(text));
      return;
    }
    setOffset(0);
    setChat((current) => ({ ...current, notice: null }));
    const options = skill === undefined ? { cwd: process.cwd() } : { cwd: process.cwd(), skill };
    void client.sendMessage(currentSession, text, options).then(
      () => {
        sentHistory.current.remember(text);
      },
      (error: unknown) => {
        setDraft(draftAt(text));
        if (error instanceof RpcError && error.code === SESSION_NOT_FOUND) {
          setChat((current) => ({ ...current, notice: "session was not found; started a new one" }));
          session.startNew();
          return;
        }
        setChat((current) => ({ ...current, busy: false, error: messageOf(error) }));
      },
    );
  }

  function loadModels(refresh: boolean): void {
    void client.listModels(refresh).then(
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
        const label = result?.model_name ?? name;
        setChat((state) => ({
          ...state,
          error: null,
          notice: notice ?? (setDefault ? `${label} for this session and new ones` : `${label} from the next message`),
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
   * Install Ollama with Homebrew, then offer to download `ref` and use it.
   * With `resend`, download it without asking and send that message again.
   */
  function startInstall(ref: string, setDefault: boolean, resend: string | null = null): void {
    pickerRef.current = closedPicker;
    setPicker(closedPicker);
    const brew = findBrew(process.env.PATH);
    if (brew === null) {
      showInstall({ state: { phase: "no_brew" }, ref, setDefault, resend });
      return;
    }
    showInstall({ state: startedInstall, ref, setDefault, resend });
    const run = runInstall(brew, (event) => {
      const current = installRef.current;
      if (current === null) {
        return;
      }
      const state = reduceInstall(current.state, event);
      showInstall({ ...current, state });
      if (state.phase !== "running") {
        stopInstall.current = null;
      }
      if (state.phase === "done") {
        onInstalled(ref, setDefault, resend);
      }
    });
    if (installRef.current?.state.phase === "running") {
      stopInstall.current = run.stop;
    }
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
    const key = mcpManagerKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressMcpManager(mcpManagerRef.current, mcpRef.current.servers ?? [], key);
    mcpManagerRef.current = pressed.state;
    setMcpManager(pressed.state);
    const action = pressed.action;
    const session = sessionRef.current ?? undefined;
    const done = (notice: string) => () => {
      setChat((state) => ({ ...state, error: null, notice }));
      loadMcp();
    };
    const failed = (error: unknown) => {
      setChat((state) => ({ ...state, notice: messageOf(error) }));
    };
    if (action.kind === "load-tools") {
      client.mcpTools(action.name, session).then((tools) => {
        setMcpManager((state) => (state.view.kind === "tools" && state.view.name === action.name ? { ...state, tools } : state));
      }, failed);
    } else if (action.kind === "session") {
      if (session === undefined) {
        setChat((state) => ({ ...state, notice: "open a session first" }));
        return;
      }
      const toggle = action.on ? client.enableMcp(session, action.name) : client.disableMcp(session, action.name);
      toggle.then(done(`${action.name} is ${action.on ? "on" : "off"} for this session`), failed);
    } else if (action.kind === "restart") {
      client.restartMcp(action.name, session).then(done(`reconnecting ${action.name}…`), failed);
    } else if (action.kind === "set-enabled") {
      const what =
        action.enabled === false ? "disabled everywhere" : action.enabled === true ? "on for every chat" : "on demand";
      client.setMcpEnabled(action.name, action.enabled, session).then(done(`${action.name} is ${what}`), failed);
    }
  }

  function onSkillsManagerPress(press: Press): void {
    const key = skillsManagerKeyOf(press);
    if (key === null) {
      return;
    }
    const pressed = pressSkillsManager(skillsManagerRef.current, skillListRef.current.skills ?? [], key);
    skillsManagerRef.current = pressed.state;
    setSkillsManager(pressed.state);
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
    } else if (action.kind === "close") {
      setChat((current) => ({ ...current, notice: state.firstRun ? "no model chosen yet: /model to pick one" : null }));
    }
  }

  function applySecretStep(step: SecretStep): void {
    secretRef.current = step.prompt;
    setSecret(step.prompt);
    if (step.prompt !== null) {
      return;
    }
    const submitted = step.submit;
    if (submitted === null) {
      setChat((current) => ({ ...current, notice: null }));
      return;
    }
    setChat((current) => ({ ...current, notice: `saving the ${submitted.provider} key…` }));
    void client.setKey(submitted.provider, submitted.key).then(
      () => {
        setChat((current) => ({ ...current, error: null, notice: `${submitted.provider} key saved in the Keychain` }));
      },
      (error: unknown) => {
        setChat((current) => ({ ...current, notice: null, error: messageOf(error) }));
      },
    );
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
      approvalDiff: approvalRef.current !== null && approvalRef.current.diff !== null,
      approvalEdit: argsEditRef.current !== null,
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
      case "edit-args":
        if (approvalRef.current !== null) {
          setArgsEdit(startArgsEdit(approvalRef.current));
        }
        return;
      case "args":
        onArgsKey(effect.key);
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
    const prompt = secretRef.current;
    if (prompt !== null) {
      applySecretStep(pressSecret(prompt, press));
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
    const installing = installRef.current;
    if (installing !== null && press.name === "escape" && !keysOpenRef.current) {
      // Esc stops brew while it runs, and puts the band away after.
      if (installing.state.phase === "running") {
        stopInstall.current?.();
      } else {
        showInstall(null);
      }
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
    applyKeyEffect(pressKey(currentPlace(), press));
  });

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
    const prompt = secretRef.current;
    if (prompt !== null) {
      applySecretStep({ prompt: pasteSecret(prompt, text), submit: null });
      return;
    }
    if (
      busyRef.current ||
      switcherRef.current.open ||
      pickerRef.current.open ||
      permsRef.current.open ||
      mcpManagerRef.current.open ||
      skillsManagerRef.current.open ||
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
  const placeholder = placeholderFor(sessionId ?? "");
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
    shown: !keysOpen && !picker.open && !mcpManager.open && !skillsManager.open && !perms.open && !switcher.open,
  };
  const composer =
    argsEdit !== null
      ? layoutComposer(argsEdit.draft.text, argsEdit.draft.cursor, columns, budget.composer, false)
      : secret === null
        ? layoutComposer(draft.text, draft.cursor, columns, budget.composer, chat.busy, placeholder)
        : layoutComposer(composerText, composerText.length, columns, budget.composer, false);
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
          }).map((line, index) => (
            <McpManagerRow key={index} line={line} />
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
            lines={helpText.map((text) => ({ text, dim: false }))}
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
          color={chat.error !== null && !asking ? "red" : "yellow"}
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
          )}
        </Text>
      ) : null}
      {budget.install > 0 && install !== null ? (
        <InstallBand state={install.state} columns={columns} height={budget.install} />
      ) : null}
      {budget.todos > 0 ? <TodoBand todos={chat.todos} columns={columns} height={budget.todos} /> : null}
      {budget.approval > 0 && chat.approval !== null ? (
        <ApprovalBand
          approval={chat.approval}
          edit={argsEdit}
          columns={columns}
          height={budget.approval}
          offset={diffOffset}
        />
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
          color={span.dim === true ? undefined : span.code === true && !user ? "cyan" : color}
          backgroundColor={backgroundColor}
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
        <Text key={index} dimColor={line.dim} color={line.dim ? undefined : color} wrap="truncate-end">
          {line.text.length === 0 ? " " : line.text}
        </Text>
      ))}
    </Box>
  );
}

function deltaEvent(messageId: string, text: string) {
  return {
    seq: 1,
    session_id: "local",
    run_id: "local",
    ts: "",
    type: "message.delta" as const,
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
  if (segment.tone === "fresh") {
    return <Text color="yellow">{text}</Text>;
  }
  if (segment.tone === "alert") {
    return <Text color="red">{text}</Text>;
  }
  return <Text dimColor>{text}</Text>;
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
