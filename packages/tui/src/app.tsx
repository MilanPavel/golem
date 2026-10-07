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
import { layoutChat } from "./layout-chat.ts";
import { statusLabel } from "./status-label.ts";

export function App({ client }: { client: GolemClient }) {
  const [connection, setConnection] = useState<ConnectionState>(client.state);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const creating = useRef(false);
  const draftRef = useRef(draft);
  const busyRef = useRef(chat.busy);
  const connectionRef = useRef(connection);
  draftRef.current = draft;
  busyRef.current = chat.busy;
  connectionRef.current = connection;
  const size = useWindowSize();
  const columns = size.columns || 80;
  const rows = size.rows || 24;

  const batcher = useRef<DeltaBatcher | null>(null);
  if (batcher.current === null) {
    batcher.current = createDeltaBatcher((messageId, text) => {
      setChat((current) => reduceChat(current, deltaEvent(messageId, text)));
    });
  }

  useEffect(() => () => batcher.current?.stop(), []);

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
    return client.onEvent((event) => {
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

  const lines = layoutChat(chat.messages, columns, rows);
  const status = [
    statusLabel(connection),
    chat.notice ?? "",
    chat.error ?? "",
  ]
    .filter((part) => part.length > 0)
    .join("  ");

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexDirection="column" flexGrow={1}>
        {lines.map((line, index) => (
          <Text key={index}>
            {line.length === 0
              ? " "
              : line.map((span, spanIndex) => (
                  <Text
                    key={spanIndex}
                    bold={span.bold}
                    italic={span.italic}
                    color={span.code ? "cyan" : undefined}
                  >
                    {span.text.length > 0 ? span.text : " "}
                  </Text>
                ))}
          </Text>
        ))}
      </Box>
      <Text color={colorFor(connection)}>{status}</Text>
      <Text>
        {chat.busy ? "… " : "> "}
        {draft}
      </Text>
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

function colorFor(state: ConnectionState): "green" | "yellow" | "red" {
  if (state.status === "connected") {
    return "green";
  }
  if (state.status === "connecting" || state.status === "reconnecting") {
    return "yellow";
  }
  return "red";
}
