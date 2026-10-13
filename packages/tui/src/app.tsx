import { homedir } from "node:os";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { RpcError, SESSION_NOT_FOUND, type ConnectionState, type GolemClient, type WireLine } from "@golem/client";

import {
  connectionLost,
  createDeltaBatcher,
  emptyChat,
  reduceChat,
  type ChatState,
  type DeltaBatcher,
} from "./chat-state.ts";
import { applyComposer, closedDebug, toggleDebugTab, type DebugState } from "./commands.ts";
import { bannerText, frameBudget, frameColumns, layoutComposer } from "./chrome.ts";
import { holdDebugOffset, layoutDebug, type CheckpointMessage, type DebugTone } from "./debug-view.ts";
import { Header } from "./header.tsx";
import { layoutTranscript, type LayoutLine } from "./layout-chat.ts";
import { assistantChars, elapsedSeconds, meterLine, meterPhase } from "./progress.ts";
import {
  fitStatus,
  modelChip,
  preferModel,
  shortCwd,
  statusLabel,
  type ModelInfo,
} from "./status-label.ts";
import { nextOffset, type WheelSubscribe } from "./screen.ts";
import { CLAY, QUESTION_BG, QUESTION_FG } from "./theme.ts";

export function App({ client, onWheel }: { client: GolemClient; onWheel?: WheelSubscribe }) {
  const [connection, setConnection] = useState<ConnectionState>(client.state);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<ModelInfo | null>(null);
  const [daemonModel, setDaemonModel] = useState<ModelInfo | null>(null);
  const [version, setVersion] = useState("");
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [debug, setDebug] = useState<DebugState>(closedDebug);
  const [debugOffset, setDebugOffset] = useState(0);
  const [wire, setWire] = useState<readonly WireLine[]>([]);
  const [modelMessages, setModelMessages] = useState<CheckpointMessage[]>([]);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const sessionRef = useRef<string | null>(null);
  const creating = useRef(false);
  const draftRef = useRef(draft);
  const busyRef = useRef(chat.busy);
  const connectionRef = useRef(connection);
  const debugRef = useRef(debug);
  const panelOpen = useRef(false);
  const inspectGen = useRef(0);
  const loadCheckpointRef = useRef<(sessionId: string) => void>(() => undefined);
  const debugLines = useRef(0);
  draftRef.current = draft;
  busyRef.current = chat.busy;
  connectionRef.current = connection;
  debugRef.current = debug;
  panelOpen.current = debug.open;
  const size = useWindowSize();
  const columns = frameColumns(size.columns || 80);
  const rows = size.rows || 24;
  const banner = chat.error ?? chat.notice;
  const budget = frameBudget({
    rows,
    columns,
    draft,
    busy: chat.busy,
    banner: banner !== null && banner.length > 0,
    debug: debug.open,
  });
  const transcript = layoutTranscript(chat.messages, columns, budget.body, offset);
  const model = preferModel(sessionModel, daemonModel);
  const chip = modelChip(model.name, model.profile);
  const cwd = shortCwd(process.cwd(), homedir());
  const status = fitStatus({ connection: statusLabel(connection), model: chip, cwd }, columns);
  const phase = meterPhase(chat.busy, assistantChars(chat.messages));
  const page = Math.max(1, budget.body - 1);
  const debugPage = Math.max(1, budget.debug - 2);

  const batcher = useRef<DeltaBatcher | null>(null);
  if (batcher.current === null) {
    batcher.current = createDeltaBatcher((messageId, text) => {
      setChat((current) => reduceChat(current, deltaEvent(messageId, text)));
    });
  }

  useEffect(() => () => batcher.current?.stop(), []);

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
    if (onWheel === undefined) {
      return;
    }
    return onWheel((steps) => {
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
        setChat((current) => connectionLost(current));
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
        setVersion(statusResult.version);
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
      if (event.type === "session.created") {
        setSessionModel({
          profile: event.data.model_profile,
          provider: event.data.model_provider ?? null,
          name: event.data.model_name ?? null,
        });
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
        const session = sessionRef.current;
        if (session !== null) {
          loadCheckpointRef.current(session);
        }
      }
    });
  }, [client]);

  useEffect(() => {
    if (connection.status !== "connected") {
      return;
    }
    void openSession();

    async function openSession(): Promise<void> {
      if (creating.current || sessionRef.current !== null) {
        return;
      }
      creating.current = true;
      try {
        const result = await client.createSession();
        sessionRef.current = result.session_id;
        setSessionId(result.session_id);
      } catch (error: unknown) {
        creating.current = false;
        setChat((current) => ({ ...current, error: messageOf(error) }));
      }
    }
  }, [client, connection.status]);

  function submit(): void {
    const outcome = applyComposer(debugRef.current, draftRef.current);
    if (outcome.kind === "idle") {
      return;
    }
    if (outcome.kind === "unknown") {
      setChat((current) => ({ ...current, notice: outcome.notice }));
      return;
    }
    if (outcome.kind === "local") {
      showDebug(outcome.debug);
      setDraft(outcome.restore ?? "");
      setChat((current) => ({ ...current, notice: outcome.notice }));
      if (outcome.refreshModel) {
        const session = sessionRef.current;
        if (session !== null && connectionRef.current.status === "connected") {
          loadCheckpointRef.current(session);
        }
      }
      return;
    }
    const text = outcome.text;
    const currentSession = sessionRef.current;
    if (
      busyRef.current ||
      currentSession === null ||
      connectionRef.current.status !== "connected"
    ) {
      return;
    }
    showDebug(outcome.debug);
    setDraft("");
    setOffset(0);
    setChat((current) => ({ ...current, notice: null }));
    void client.sendMessage(currentSession, text).catch((error: unknown) => {
      if (error instanceof RpcError && error.code === SESSION_NOT_FOUND) {
        sessionRef.current = null;
        creating.current = false;
        setSessionId(null);
        setDraft(text);
        setModelMessages([]);
        setModelCount(null);
        setChat((current) => ({
          ...current,
          busy: false,
          notice: "session was not found; started a new one",
        }));
        void replaceSession();
        return;
      }
      setDraft(text);
      setChat((current) => ({ ...current, busy: false, error: messageOf(error) }));
    });

    async function replaceSession(): Promise<void> {
      creating.current = true;
      try {
        const result = await client.createSession();
        sessionRef.current = result.session_id;
        setSessionId(result.session_id);
        if (panelOpen.current) {
          loadCheckpointRef.current(result.session_id);
        }
      } catch (error: unknown) {
        creating.current = false;
        setChat((current) => ({ ...current, error: messageOf(error) }));
      }
    }
  }

  function showDebug(next: DebugState): void {
    if (next.open !== debugRef.current.open || next.tab !== debugRef.current.tab) {
      debugLines.current = 0;
      setDebugOffset(0);
    }
    setDebug(next);
  }

  useInput((input, key) => {
    if (key.pageUp) {
      if (debugRef.current.open) {
        setDebugOffset((value) => value + debugPage);
      } else {
        setOffset((value) => value + page);
      }
      return;
    }
    if (key.pageDown) {
      if (debugRef.current.open) {
        setDebugOffset((value) => Math.max(0, value - debugPage));
      } else {
        setOffset((value) => Math.max(0, value - page));
      }
      return;
    }
    if (key.home) {
      if (debugRef.current.open) {
        setDebugOffset(Number.MAX_SAFE_INTEGER);
      } else {
        setOffset(Number.MAX_SAFE_INTEGER);
      }
      return;
    }
    if (key.end) {
      if (debugRef.current.open) {
        setDebugOffset(0);
      } else {
        setOffset(0);
      }
      return;
    }
    if (key.escape) {
      if (debugRef.current.open) {
        showDebug({ ...debugRef.current, open: false });
      }
      return;
    }
    if (key.tab) {
      if (debugRef.current.open) {
        const next = toggleDebugTab(debugRef.current);
        showDebug(next);
        if (
          next.tab === "model" &&
          sessionRef.current !== null &&
          connectionRef.current.status === "connected"
        ) {
          loadCheckpointRef.current(sessionRef.current);
        }
      }
      return;
    }
    if (connectionRef.current.status !== "connected" || sessionId === null) {
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (busyRef.current) {
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((value) => value.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) {
      return;
    }
    if (input.length > 0) {
      setDraft((value) => value + input);
    }
  });

  const contentWidth = transcript.gutter === null ? columns : Math.max(1, columns - 1);
  const composer = layoutComposer(draft, columns, budget.composer, chat.busy);
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
      <Header mode={budget.mode} version={version} model={chip} cwd={cwd} columns={columns} />
      <Box flexDirection="column" width={columns} height={budget.body} flexShrink={0} overflow="hidden">
        {chat.messages.length === 0 ? <Text dimColor>Type a message.</Text> : null}
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
      {budget.composer > 0 ? (
        <Box flexDirection="column" width={columns} height={budget.composer} flexShrink={0}>
          {composer.map((line, index) => {
            const used = line.prefix.length + line.text.length + (line.cursor ? 1 : 0);
            const pad = " ".repeat(Math.max(0, columns - used));
            return (
              <Box key={index} width={columns} height={1} backgroundColor={QUESTION_BG} overflow="hidden">
                <Text color={QUESTION_FG} wrap="truncate-end">
                  {line.prefix}
                  {line.text}
                  {line.cursor ? <Text inverse> </Text> : null}
                  {pad}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
      {budget.status > 0 ? (
        <Text wrap="truncate-end">
          <Text color={colorFor(connection)}>{status.connection}</Text>
          {status.model.length > 0 ? (
            <Text color={CLAY} bold>
              {`  ${status.model}`}
            </Text>
          ) : null}
          {status.cwd.length > 0 ? <Text dimColor>{`  ${status.cwd}`}</Text> : null}
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
          color={span.code === true && !user ? "cyan" : color}
          backgroundColor={backgroundColor}
          wrap="truncate-end"
        >
          {span.text}
        </Text>
      ))}
    </Text>
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

function colorFor(state: ConnectionState): "green" | "yellow" | "red" {
  if (state.status === "connected") {
    return "green";
  }
  if (state.status === "connecting" || state.status === "reconnecting") {
    return "yellow";
  }
  return "red";
}
