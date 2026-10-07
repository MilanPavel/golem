import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connectGolem, type ChatEvent, type ConnectionState } from "./connect.ts";

interface FakeOptions {
  answerPing?: boolean;
  mismatch?: boolean;
  onHello?: (socket: Socket) => void;
  onStatus?: boolean;
  eventBeforeStatus?: boolean;
  eventBeforePing?: boolean;
}

function deltaEvent(): unknown {
  return {
    jsonrpc: "2.0",
    method: "event",
    params: {
      seq: 1,
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
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const message = JSON.parse(line) as {
        id: number;
        method: string;
        params?: { nonce?: string };
      };
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
          result: { protocol_major: 1, protocol_minor: 0, daemon_version: "0.0.0" },
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
            protocol_major: 1,
            protocol_minor: 0,
            uptime_seconds: 3,
            state: "running",
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
    assert.equal(status.protocol_major, 1);
  } finally {
    client.close();
    await server.close();
  }
});
