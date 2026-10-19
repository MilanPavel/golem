import { homedir } from "node:os";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useStdin, useWindowSize } from "ink";
import {
  RpcError,
  SESSION_NOT_FOUND,
  type ConnectionState,
  type GolemClient,
  type ListedModel,
  type ModelListResult,
  type WireLine,
} from "@golem/client";

import {
  createDeltaBatcher,
  emptyChat,
  forkPoint,
  reduceChat,
  type ChatState,
  type DeltaBatcher,
} from "./chat-state.ts";
import {
  applyComposer,
  closedDebug,
  COMMANDS,
  helpLines,
  toggleDebugTab,
  withModelChoices,
  type DebugState,
} from "./commands.ts";
import {
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
import { bannerText, frameBudget, frameColumns, layoutComposer } from "./chrome.ts";
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
  type KeyEffect,
  type KeyPlace,
  type Press,
  type OverlayLine,
} from "./keys.ts";
import { layoutTranscript, type LayoutLine } from "./layout-chat.ts";
import { loadPrefs, prefsPath, saveTimes } from "./prefs.ts";
import {
  maskSecret,
  openSecret,
  pasteSecret,
  pressSecret,
  secretNotice,
  type SecretPrompt,
  type SecretStep,
} from "./secret.ts";
import { APPROVAL_ROWS, approvalLines } from "./approval.ts";
import { assistantChars, elapsedSeconds, meterLine, meterPhase } from "./progress.ts";
import {
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
import { TUI_VERSION } from "./version.ts";
import { applyWindowTitle } from "./window-title.ts";
import { nextOffset, WHEEL_LINES, type WheelSubscribe } from "./screen.ts";
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
import { CLAY, QUESTION_BG, QUESTION_FG } from "./theme.ts";
import {
  copyAnswer,
  copyCode,
  copyToClipboard,
  exportDestination,
  followTail,
  sessionMarkdown,
  writeExport,
  type TailAnchor,
} from "./transcript.ts";
import { useSessionIndex } from "./use-session-index.ts";
import { useSession } from "./use-session.ts";

export function App({ client, onWheel }: { client: GolemClient; onWheel?: WheelSubscribe }) {
  const [connection, setConnection] = useState<ConnectionState>(client.state);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [draft, setDraft] = useState<Draft>({ text: "", cursor: 0 });
  const [sessionModel, setSessionModel] = useState<ModelInfo | null>(null);
  const [sessionCwd, setSessionCwd] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState(false);
  const sessionModelRef = useRef(sessionModel);
  sessionModelRef.current = sessionModel;
  const [daemonModel, setDaemonModel] = useState<ModelInfo | null>(null);
  const [daemonVersion, setDaemonVersion] = useState("");
  const [daemonStartedAt, setDaemonStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [liveTitle, setLiveTitle] = useState<{ sessionId: string; title: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [tail, setTail] = useState<TailAnchor | null>(null);
  const [showTimes, setShowTimes] = useState(false);
  const [tick, setTick] = useState(0);
  const [debug, setDebug] = useState<DebugState>(closedDebug);
  const [debugOffset, setDebugOffset] = useState(0);
  const [wire, setWire] = useState<readonly WireLine[]>([]);
  const [modelMessages, setModelMessages] = useState<CheckpointMessage[]>([]);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [switcher, setSwitcher] = useState<SwitcherState>(closedSwitcher);
  const [helpOpen, setHelpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keysOffset, setKeysOffset] = useState(0);
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
  const prefsLoaded = useRef(false);
  draftRef.current = draft;
  historyCursorRef.current = historyCursor;
  liveTitleRef.current = liveTitle;
  showTimesRef.current = showTimes;
  busyRef.current = chat.busy;
  const approvalRef = useRef(chat.approval);
  approvalRef.current = chat.approval;
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
  const banner = chat.error ?? chat.notice;
  const suggestMatches =
    chat.busy ||
    switcher.open ||
    picker.open ||
    keysOpen ||
    suggestDismissed ||
    historyCursor !== null ||
    secret !== null
      ? []
      : suggest(draft.text, withModelChoices(COMMANDS, modelNames(listing)));
  const composerText = secret === null ? draft.text : maskSecret(secret.value);
  const suggestSelected =
    suggestPick.draft === draft.text ? Math.min(suggestPick.index, Math.max(0, suggestMatches.length - 1)) : 0;
  const budget = frameBudget({
    rows,
    columns,
    draft: composerText,
    busy: chat.busy && secret === null,
    banner: banner !== null && banner.length > 0,
    debug: debug.open,
    suggestions: chat.approval !== null ? APPROVAL_ROWS : suggestMatches.length,
  });
  suggestRef.current = {
    items: suggestMatches,
    selected: suggestSelected,
    open: budget.suggestions > 0 && suggestMatches.length > 0,
  };
  overlayFrame.current = { columns, body: budget.body };
  const helpText = helpOpen && !keysOpen && !switcher.open ? helpLines(COMMANDS, columns) : [];
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
  const versions = versionLabel(TUI_VERSION, daemonVersion);
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
      setHelpOpen(false);
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
    }),
    columns,
  );

  useEffect(() => () => batcher.current?.stop(), []);

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
      loadModels(false);
      if (ok && after !== undefined) {
        chooseModel(null, ref, after.setDefault, `${ref} downloaded, and this session uses it now`);
      } else if (ok) {
        setChat((current) => ({ ...current, notice: `${ref} downloaded` }));
      } else if (error === "cancelled") {
        setChat((current) => ({ ...current, notice: `stopped downloading ${ref}` }));
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
    applyWindowTitle(titleLabel);
  }, [titleLabel]);

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

  function submit(): void {
    const outcome = applyComposer(debugRef.current, draftRef.current.text);
    if (outcome.kind === "idle") {
      return;
    }
    if (
      outcome.kind === "send" &&
      (busyRef.current || sessionRef.current === null || connectionRef.current.status !== "connected")
    ) {
      return;
    }
    endHistory();
    if (outcome.kind === "help") {
      setDraft(draftAt(""));
      setHelpOpen(true);
      setKeysOpen(false);
      setSwitcher(closedSwitcher);
      setChat((current) => ({ ...current, notice: null }));
      return;
    }
    setHelpOpen(false);
    if (outcome.kind === "unknown") {
      setChat((current) => ({ ...current, notice: outcome.notice }));
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
        setChat((current) => ({
          ...current,
          notice: outcome.code ? "no code block to copy" : "nothing to copy yet",
        }));
        return;
      }
      void copyToClipboard(text).then(
        () => {
          setChat((current) => ({ ...current, notice: "copied" }));
        },
        (error: unknown) => {
          setChat((current) => ({ ...current, notice: messageOf(error) }));
        },
      );
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
          setChat((current) => ({ ...current, notice: `exported to ${file}` }));
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
      setChat((current) => ({ ...current, notice: next ? "timestamps on" : "timestamps off" }));
      void saveTimes(prefsPath(), next).catch(() => undefined);
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
    const text = outcome.text;
    const currentSession = sessionRef.current;
    if (currentSession === null) {
      return;
    }
    showDebug(outcome.debug);
    setDraft(draftAt(""));
    setOffset(0);
    setChat((current) => ({ ...current, notice: null }));
    void client.sendMessage(currentSession, text, { cwd: process.cwd() }).then(
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
      setChat((current) => ({ ...current, notice: EXIT_HINT }));
      setTimeout(() => {
        setChat((current) => (current.notice === EXIT_HINT ? { ...current, notice: null } : current));
      }, EXIT_WINDOW_MS);
      return;
    }
    setChat((current) => ({ ...current, notice: "cancelling…" }));
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
        setHelpOpen(false);
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
        setDraft(edit(draftRef.current, effect.op));
        return;
      case "edit-external":
        void openEditor();
        return;
      case "approve":
        answerApproval(effect.decision);
        return;
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

  function answerApproval(decision: "allow" | "allow_session" | "deny"): void {
    const pending = approvalRef.current;
    const current = sessionRef.current;
    if (pending === null || current === null) {
      return;
    }
    void client.respondApproval(current, pending.callId, decision).catch((error: unknown) => {
      setChat((state) => ({ ...state, error: messageOf(error) }));
    });
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
      const saved = await editDraft(draftRef.current.text, suspendTerminal);
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
    const prompt = secretRef.current;
    if (prompt !== null) {
      applySecretStep(pressSecret(prompt, press));
      return;
    }
    if (pickerRef.current.open && !keysOpenRef.current && press.name !== "f1") {
      onPickerPress(press);
      return;
    }
    applyKeyEffect(pressKey(currentPlace(), press));
  });

  usePaste((text) => {
    const prompt = secretRef.current;
    if (prompt !== null) {
      applySecretStep({ prompt: pasteSecret(prompt, text), submit: null });
      return;
    }
    if (busyRef.current || switcherRef.current.open || pickerRef.current.open || keysOpenRef.current) {
      return;
    }
    if (connectionRef.current.status !== "connected" || sessionRef.current === null) {
      return;
    }
    setDraft(insertText(draftRef.current, text));
  });

  function currentModelRef(): string | null {
    const name = sessionModelRef.current?.profile ?? null;
    const found = listingRef.current?.models.find(
      (model) => name !== null && (model.ref === name || (model.profiles ?? []).includes(name)),
    );
    return found?.ref ?? null;
  }

  const contentWidth = transcript.gutter === null ? columns : Math.max(1, columns - 1);
  const composer =
    secret === null
      ? layoutComposer(draft.text, draft.cursor, columns, budget.composer, chat.busy)
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
          {transcript.lines.map((line, index) => (
            <Box key={index} width={columns} height={1} overflow="hidden">
              <Box
                width={contentWidth}
                height={1}
                backgroundColor={line.role === "user" ? QUESTION_BG : undefined}
              >
                <LineView line={line} />
              </Box>
              {transcript.gutter !== null ? (
                <Text dimColor>{transcript.gutter[index] ?? " "}</Text>
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
      {budget.banner > 0 && banner !== null ? (
        <Text color={chat.error !== null ? "red" : "yellow"} wrap="truncate-end">
          {bannerText(banner, columns)}
        </Text>
      ) : null}
      {budget.meter > 0 && phase !== null ? (
        <Text wrap="truncate-end">
          {meterLine(
            phase,
            assistantChars(chat.messages),
            elapsedSeconds(chat.runStartedAt, Date.now()),
            tick,
            columns,
          )}
        </Text>
      ) : null}
      {budget.suggestions > 0 && chat.approval !== null ? (
        <Box flexDirection="column" width={columns} height={budget.suggestions} flexShrink={0} overflow="hidden">
          {approvalLines(chat.approval, columns)
            .slice(0, budget.suggestions)
            .map((line, index) => (
              <Text key={index} bold={line.bold === true} dimColor={line.dim === true} color={index === 0 ? "yellow" : undefined} wrap="truncate-end">
                {line.text}
              </Text>
            ))}
        </Box>
      ) : budget.suggestions > 0 ? (
        <SuggestionBand
          items={suggestMatches}
          selected={suggestSelected}
          columns={columns}
          height={budget.suggestions}
        />
      ) : null}
      {budget.composer > 0 ? (
        <Box flexDirection="column" width={columns} height={budget.composer} flexShrink={0}>
          {composer.map((line, index) => {
            const at = line.cursorAt;
            const after = at !== null && at >= line.text.length;
            const point = at !== null && !after ? codePointSize(line.text, at) : 0;
            const used = line.prefix.length + line.text.length + (after ? 1 : 0);
            const pad = " ".repeat(Math.max(0, columns - used));
            return (
              <Box key={index} width={columns} height={1} backgroundColor={QUESTION_BG} overflow="hidden">
                <Text color={QUESTION_FG} wrap="truncate-end">
                  {line.prefix}
                  {at === null ? line.text : line.text.slice(0, at)}
                  {at !== null && after ? <Text inverse> </Text> : null}
                  {at !== null && !after ? <Text inverse>{line.text.slice(at, at + point)}</Text> : null}
                  {at !== null && !after ? line.text.slice(at + point) : null}
                  {pad}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
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

function LineView({ line }: { line: LayoutLine }) {
  const user = line.role === "user";
  const backgroundColor = user ? QUESTION_BG : undefined;
  const color = user ? QUESTION_FG : undefined;
  if (line.spans.every((span) => span.text.length === 0)) {
    return <Text backgroundColor={backgroundColor}> </Text>;
  }
  return (
    <Text wrap="truncate-end">
      {line.spans.map((span, index) => (
        <Text
          key={index}
          bold={span.bold}
          italic={span.italic}
          dimColor={span.dim === true}
          color={span.dim === true ? undefined : span.code === true && !user ? "cyan" : color}
          backgroundColor={backgroundColor}
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
  return <Text dimColor>{text}</Text>;
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
