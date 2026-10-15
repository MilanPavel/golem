import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROTOCOL_MAJOR } from "../../protocol/gen/version.ts";
import { connectGolem, type ChatEvent, type ConnectionState, type SessionSummary } from "./connect.ts";
import { mergeSummary } from "./session-index.ts";
import { formatWireLine } from "./wire.ts";

interface FakeOptions {
  answerPing?: boolean;
  mismatch?: boolean;
  onHello?: (socket: Socket) => void;
  onStatus?: boolean;
  eventBeforeStatus?: boolean;
  eventBeforePing?: boolean;
  statusExtra?: Record<string, unknown>;
  onAttach?: (socket: Socket, params: AttachParams, id: number) => void;
  results?: Record<string, unknown>;
  onRequest?: (socket: Socket, method: string, params: Record<string, unknown>) => void;
}

interface AttachParams {
  session_id: string;
  after_seq: number;
}

function deltaEvent(seq = 1): unknown {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      seq,
      session_id: "s_test",
      run_id: "r_test",
      ts: "2026-10-07T10:00:00+00:00",
      type: "message.delta",
      data: { message_id: "m_test", text: "H" },
    },
  };
}

function attach(socket: Socket, options: FakeOptions): void {
  let buffer = "";
  socket.on("error", () => {
    // The client may close while a reply is still being written.
  });
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line) as {
        id: number;
        method: string;
        params?: { nonce?: string } & Partial<AttachParams>;
      };
      options.onRequest?.(socket, message.method, message.params ?? {});
      if (message.method === "hello" && options.mismatch === true) {
        write(socket, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32001, message: "protocol major mismatch: client 1, daemon 9" },
        });
      } else if (message.method === "hello") {
        write(socket, {
          jsonrpc: "2.0",
          id: message.id,
          result: { protocol_major: PROTOCOL_MAJOR, protocol_minor: 0, daemon_version: "0.0.0" },
        });
        options.onHello?.(socket);
      } else if (message.method === "ping" && options.answerPing === true) {
        if (options.eventBeforePing === true) {
          write(socket, deltaEvent());
        }
        write(socket, {
          jsonrpc: "2.0",
          id: message.id,
          result: { type: "system.ping", nonce: message.params?.nonce },
        });
      } else if (message.method === "session.attach" && options.onAttach !== undefined) {
        options.onAttach(
          socket,
          { session_id: message.params?.session_id ?? "", after_seq: message.params?.after_seq ?? 0 },
          message.id,
        );
      } else if (options.results?.[message.method] !== undefined) {
        write(socket, { jsonrpc: "2.0", id: message.id, result: options.results[message.method] });
      } else if (message.method === "daemon.status") {
        if (options.eventBeforeStatus === true) {
          write(socket, deltaEvent());
        }
        write(socket, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            pid: 7,
            version: "0.0.0",
            protocol_major: PROTOCOL_MAJOR,
            protocol_minor: 0,
            uptime_seconds: 3,
            state: "running",
            ...options.statusExtra,
          },
        });
      }
      newline = buffer.indexOf("\n");
    }
  });
}

function write(socket: Socket, body: unknown): void {
  socket.write(`${JSON.stringify(body)}\n`);
}

async function listen(
  handler: (socket: Socket) => void,
): Promise<{ socketPath: string; close: () => Promise<void> }> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.test-socks");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "c-"));
  const socketPath = path.join(dir, "s.sock");
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(socketPath, () => resolve());
  });
  return {
    socketPath,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function statuses(states: ConnectionState[]): string[] {
  return states.map((state) => state.status);
}

test("reconnects after the daemon drops the socket", async () => {
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    const mine = connections;
    attach(socket, {
      onHello: () => {
        if (mine === 1) {
          socket.end();
        }
      },
    });
  });
  const seen: ConnectionState[] = [];
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
  });
  client.onState((state) => seen.push(state));
  try {
    await client.ready;
    await waitFor(() => statuses(seen).includes("reconnecting") && connections >= 2);
    await waitFor(() => client.state.status === "connected");
    assert.ok(statuses(seen).includes("connected"));
    assert.ok(statuses(seen).includes("reconnecting"));
  } finally {
    client.close();
    await server.close();
  }
});

test("protocol mismatch does not retry", async () => {
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    attach(socket, { mismatch: true });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
  });
  try {
    await assert.rejects(client.ready, /protocol major mismatch/);
    assert.equal(client.state.status, "rejected");
    if (client.state.status === "rejected") {
      assert.match(client.state.reason, /protocol major mismatch/);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(connections, 1);
  } finally {
    client.close();
    await server.close();
  }
});

test("heartbeat timeout reconnects", async () => {
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    attach(socket, { answerPing: connections > 1 });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 30,
    heartbeatTimeoutMs: 40,
  });
  try {
    await client.ready;
    await waitFor(() => connections >= 2 && client.state.status === "connected");
  } finally {
    client.close();
    await server.close();
  }
});

test("an event line does not settle a pending ping", async () => {
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    attach(socket, { answerPing: true, eventBeforePing: true });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 30,
    heartbeatTimeoutMs: 80,
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => {
    events.push(event);
  });
  try {
    await client.ready;
    await waitFor(() => events.some((event) => event.type === "message.delta"));
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(connections, 1);
    assert.equal(client.state.status, "connected");
  } finally {
    client.close();
    await server.close();
  }
});

test("an event line does not settle a pending status call", async () => {
  const server = await listen((socket) => {
    attach(socket, { answerPing: true, eventBeforeStatus: true });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => {
    events.push(event);
  });
  try {
    const status = await client.status();
    assert.equal(status.pid, 7);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "message.delta");
    if (events[0]?.type === "message.delta") {
      assert.equal(events[0].data.text, "H");
    }
  } finally {
    client.close();
    await server.close();
  }
});

test("status accepts a model name and rejects a blank one", async () => {
  const named = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      statusExtra: {
        model_profile: "remote",
        model_provider: "openai_compat",
        model_name: "qwen3.5:4b",
      },
    });
  });
  const client = connectGolem({
    socketPath: named.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  try {
    const status = await client.status();
    assert.equal(status.model_profile, "remote");
    assert.equal(status.model_provider, "openai_compat");
    assert.equal(status.model_name, "qwen3.5:4b");
  } finally {
    client.close();
    await named.close();
  }

  const blank = await listen((socket) => {
    attach(socket, { answerPing: true, statusExtra: { model_name: "" } });
  });
  const refused = connectGolem({
    socketPath: blank.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  try {
    await assert.rejects(() => refused.status(), /invalid daemon.status result/);
  } finally {
    refused.close();
    await blank.close();
  }
});

test("the wire log records commands and token fragments", async () => {
  const server = await listen((socket) => {
    attach(socket, { answerPing: true, eventBeforeStatus: true });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  let latest: string[] = [];
  client.onWire((lines) => {
    latest = lines.map(formatWireLine);
  });
  try {
    await client.status();
    assert.ok(latest.some((line) => line.includes("hello")));
    assert.ok(latest.some((line) => line.includes("daemon.status")));
    assert.ok(latest.some((line) => line.includes("message.delta")));
  } finally {
    client.close();
    await server.close();
  }
});

test("status reads daemon.status once hello succeeds", async () => {
  const server = await listen((socket) => {
    attach(socket, { answerPing: true });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "cli",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  try {
    const status = await client.status();
    assert.equal(status.pid, 7);
    assert.equal(status.state, "running");
    assert.equal(status.protocol_major, PROTOCOL_MAJOR);
  } finally {
    client.close();
    await server.close();
  }
});

test("reattaches after a reconnect from the last seq and drops replayed events", async () => {
  const afterSeqs: number[] = [];
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    const mine = connections;
    attach(socket, {
      answerPing: true,
      onAttach: (current, params, id) => {
        afterSeqs.push(params.after_seq);
        const replay = mine === 1 ? [1, 2] : [2, 3];
        for (const seq of replay) {
          write(current, deltaEvent(seq));
        }
        write(current, { jsonrpc: "2.0", id, result: { session_id: params.session_id, last_seq: 3 } });
        if (mine === 1) {
          current.end();
        }
      },
    });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
  });
  const seqs: number[] = [];
  client.onEvent((event) => seqs.push(event.seq));
  try {
    await client.attachSession("s_test");
    await waitFor(() => connections >= 2 && client.state.status === "connected");
    assert.deepEqual(afterSeqs, [0, 2]);
    assert.deepEqual(seqs, [1, 2, 3]);
  } finally {
    client.close();
    await server.close();
  }
});

test("a session gone after a reconnect is no longer followed", async () => {
  const attaches: number[] = [];
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    const mine = connections;
    attach(socket, {
      answerPing: true,
      onAttach: (current, params, id) => {
        attaches.push(mine);
        if (mine === 1) {
          write(current, { jsonrpc: "2.0", id, result: { session_id: params.session_id, last_seq: 0 } });
        } else {
          write(current, { jsonrpc: "2.0", id, error: { code: -32003, message: "session not found" } });
        }
        current.end();
      },
    });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
  });
  try {
    await client.attachSession("s_test");
    await waitFor(() => connections >= 3 && client.state.status === "connected");
    assert.deepEqual(attaches, [1, 2]);
  } finally {
    client.close();
    await server.close();
  }
});

test("cancelRun reads the run.cancel result", async () => {
  const server = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "run.cancel": { cancelled: true } } });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  try {
    assert.deepEqual(await client.cancelRun("r_test"), { cancelled: true });
  } finally {
    client.close();
    await server.close();
  }
});

function summary(lastSeq: number, title: string | null = null): SessionSummary {
  return {
    session_id: "s_test",
    model_profile: "remote",
    title,
    status: "idle",
    created_at: "2026-10-07T10:00:00+00:00",
    updated_at: "2026-10-07T10:00:00+00:00",
    last_seq: lastSeq,
  };
}

test("watchSessions reports the list, each change, and watches again after a reconnect", async () => {
  const watches: unknown[] = [];
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    const mine = connections;
    attach(socket, {
      answerPing: true,
      results: { "session.list": { sessions: [summary(mine === 1 ? 2 : 4)] } },
      onRequest: (current, method, params) => {
        if (method !== "session.list") {
          return;
        }
        watches.push(params["watch"]);
        if (mine === 1) {
          setImmediate(() => {
            write(current, { jsonrpc: "2.0", method: "session.summary", params: summary(3, "Named") });
            current.end();
          });
        }
      },
    });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "tui",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
  });
  const seen: [number, string | null | undefined][] = [];
  let merged: readonly SessionSummary[] = [];
  client.onSessionSummary((next) => {
    seen.push([next.last_seq, next.title]);
    merged = mergeSummary(merged, next);
  });
  const events: ChatEvent[] = [];
  client.onEvent((event) => events.push(event));
  try {
    await client.watchSessions();
    await waitFor(() => seen.length >= 3);
    assert.deepEqual(watches, [true, true]);
    assert.deepEqual(
      [...seen].sort((a, b) => a[0] - b[0]),
      [
        [2, null],
        [3, "Named"],
        [4, null],
      ],
    );
    assert.deepEqual(
      merged.map((item) => item.last_seq),
      [4],
    );
    assert.deepEqual(events, []);
  } finally {
    client.close();
    await server.close();
  }
});

test("renameSession sends the title and reads the stored one", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "session.rename": { title: "Plans" } },
      onRequest: (_socket, method, params) => {
        if (method === "session.rename") {
          sent.push(params);
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.renameSession("s_test", "Plans."), { title: "Plans" });
    assert.deepEqual(sent, [{ session_id: "s_test", title: "Plans." }]);
  } finally {
    client.close();
    await server.close();
  }
});

test("forkSession sends the message id and reads the new session", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "session.fork": { session_id: "s_fork" } },
      onRequest: (_socket, method, params) => {
        if (method === "session.fork") {
          sent.push(params);
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.forkSession("s_test", "m_a"), { session_id: "s_fork" });
    assert.deepEqual(sent, [{ session_id: "s_test", at_message_id: "m_a" }]);
  } finally {
    client.close();
    await server.close();
  }
});
