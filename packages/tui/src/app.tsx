import { homedir } from "node:os";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { RpcError, SESSION_NOT_FOUND, type ConnectionState, type GolemClient } from "@golem/client";

import {
  connectionLost,
  createDeltaBatcher,
  emptyChat,
  reduceChat,
  type ChatState,
  type DeltaBatcher,
} from "./chat-state.ts";
import { bannerText, frameBudget, frameColumns, layoutComposer } from "./chrome.ts";
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
  const sessionRef = useRef<string | null>(null);
  const creating = useRef(false);
  const draftRef = useRef(draft);
  const busyRef = useRef(chat.busy);
  const connectionRef = useRef(connection);
  draftRef.current = draft;
  busyRef.current = chat.busy;
  connectionRef.current = connection;
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
  });
  const transcript = layoutTranscript(chat.messages, columns, budget.body, offset);
  const model = preferModel(sessionModel, daemonModel);
  const chip = modelChip(model.name, model.profile);
  const cwd = shortCwd(process.cwd(), homedir());
  const status = fitStatus({ connection: statusLabel(connection), model: chip, cwd }, columns);
  const phase = meterPhase(chat.busy, assistantChars(chat.messages));
  const page = Math.max(1, budget.body - 1);

  const batcher = useRef<DeltaBatcher | null>(null);
  if (batcher.current === null) {
    batcher.current = createDeltaBatcher((messageId, text) => {
      setChat((current) => reduceChat(current, deltaEvent(messageId, text)));
    });
  }

  useEffect(() => () => batcher.current?.stop(), []);

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
    const text = draftRef.current.trim();
    const currentSession = sessionRef.current;
    if (
      text.length === 0 ||
      busyRef.current ||
      currentSession === null ||
      connectionRef.current.status !== "connected"
    ) {
      return;
    }
    setDraft("");
    setOffset(0);
    void client.sendMessage(currentSession, text).catch((error: unknown) => {
      if (error instanceof RpcError && error.code === SESSION_NOT_FOUND) {
        sessionRef.current = null;
        creating.current = false;
        setSessionId(null);
        setDraft(text);
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
      } catch (error: unknown) {
        creating.current = false;
        setChat((current) => ({ ...current, error: messageOf(error) }));
      }
    }
  }

  useInput((input, key) => {
    if (key.pageUp) {
      setOffset((value) => value + page);
      return;
    }
    if (key.pageDown) {
      setOffset((value) => Math.max(0, value - page));
      return;
    }
    if (key.home) {
      setOffset(Number.MAX_SAFE_INTEGER);
      return;
    }
    if (key.end) {
      setOffset(0);
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
    if (key.ctrl || key.meta || key.escape || key.tab) {
      return;
    }
    if (input.length > 0) {
      setDraft((value) => value + input);
    }
  });

  const contentWidth = transcript.gutter === null ? columns : Math.max(1, columns - 1);
  const composer = layoutComposer(draft, columns, budget.composer, chat.busy);

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

function colorFor(state: ConnectionState): "green" | "yellow" | "red" {
  if (state.status === "connected") {
    return "green";
  }
  if (state.status === "connecting" || state.status === "reconnecting") {
    return "yellow";
  }
  return "red";
}
