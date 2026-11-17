import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PROTOCOL_MAJOR } from "../../protocol/gen/version.ts";
import { connectGolem, type ChatEvent, type ConnectionState, type SessionSummary } from "./node.ts";
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

// sockaddr_un is 104 bytes on macOS, including the NUL. The longest path built under the
// directory is "/c-XXXXXX/s.sock"; keep margin. A long repo path (a git worktree) falls
// back to a short temp dir.
function makeSocketDir(repoRoot: string): string {
  const root = path.join(repoRoot, ".test-socks");
  if (Buffer.byteLength(root) + 40 <= 103) {
    mkdirSync(root, { recursive: true });
    return mkdtempSync(path.join(root, "c-"));
  }
  return mkdtempSync("/var/tmp/gt");
}

async function listen(
  handler: (socket: Socket) => void,
): Promise<{ socketPath: string; close: () => Promise<void> }> {
  const dir = makeSocketDir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
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
    const reconnecting = seen.find((state) => state.status === "reconnecting");
    assert.ok(reconnecting && !("closeCode" in reconnecting));
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

test("checkNow pings at once when the link is open, and not before", async () => {
  let pings = 0;
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      onRequest: (_socket, method) => {
        if (method === "ping") {
          pings += 1;
        }
      },
    });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "web",
    reconnect: false,
    heartbeatMs: 60_000,
    heartbeatTimeoutMs: 60,
  });
  try {
    client.checkNow();
    await client.ready;
    assert.equal(pings, 0);
    client.checkNow();
    await waitFor(() => pings === 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(client.state.status, "connected");
  } finally {
    client.close();
    await server.close();
  }
});

test("checkNow on a silent daemon drops the link after the timeout", async () => {
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    attach(socket, { answerPing: connections > 1 });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "web",
    reconnect: true,
    backoff: () => 0,
    heartbeatMs: 60_000,
    heartbeatTimeoutMs: 60,
  });
  try {
    await client.ready;
    client.checkNow();
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

test("a detach while the link is down forgets the seq, so the next attach replays from the start", async () => {
  const attaches: Array<{ connection: number; afterSeq: number }> = [];
  let connections = 0;
  const server = await listen((socket) => {
    connections += 1;
    const mine = connections;
    attach(socket, {
      answerPing: true,
      onAttach: (current, params, id) => {
        attaches.push({ connection: mine, afterSeq: params.after_seq });
        write(current, deltaEvent(1));
        write(current, deltaEvent(2));
        write(current, { jsonrpc: "2.0", id, result: { session_id: params.session_id, last_seq: 2 } });
        if (mine === 1) {
          current.end();
        }
      },
    });
  });
  const client = connectGolem({
    socketPath: server.socketPath,
    clientName: "web",
    reconnect: true,
    backoff: () => 300,
    heartbeatMs: 60_000,
  });
  try {
    await client.attachSession("s_test");
    await waitFor(() => client.state.status !== "connected");
    await assert.rejects(client.detachSession("s_test"));
    await waitFor(() => connections >= 2 && client.state.status === "connected");
    await client.attachSession("s_test");
    assert.deepEqual(attaches, [
      { connection: 1, afterSeq: 0 },
      { connection: 2, afterSeq: 0 },
    ]);
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

test("setKey sends the key to the daemon and never to the wire log", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "auth.set": { provider: "anthropic" },
        "auth.list": { providers: [{ provider: "anthropic", takes_key: true, needs_key: true, source: "keychain" }] },
      },
      onRequest: (_socket, method, params) => {
        if (method === "auth.set") {
          sent.push(params);
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  let shown = "";
  const stop = client.onWire((lines) => {
    shown = lines.map(formatWireLine).join("\n");
  });
  try {
    assert.deepEqual(await client.setKey("anthropic", "sk-very-secret"), { provider: "anthropic" });
    assert.deepEqual(sent, [{ provider: "anthropic", key: "sk-very-secret" }]);
    assert.ok(shown.includes("auth.set"));
    assert.ok(shown.includes("[redacted]"));
    assert.ok(!shown.includes("sk-very-secret"));
    const listed = await client.listKeys();
    assert.equal(listed.providers[0]?.source, "keychain");
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("listModels asks for a refresh or show all only when told to, and takes a listing with no default", async () => {
  const sent: Record<string, unknown>[] = [];
  const listed = {
    default: null,
    ram_gb: 36,
    models: [{ ref: "ollama/qwen3:8b", label: "Qwen3 8B", provider: "ollama", source: "installed", status: "ready" }],
    providers: [{ provider: "ollama", status: "ready" }],
    setup: { ollama_installed: true, ollama_running: true, keys: [], default_status: null },
  };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "model.list": listed },
      onRequest: (_socket, method, params) => {
        if (method === "model.list") {
          sent.push(params);
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "cli", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.equal((await client.listModels()).models[0]?.ref, "ollama/qwen3:8b");
    await client.listModels(true);
    await client.listModels(false, true);
    assert.deepEqual(sent, [{}, { refresh: true }, { show_all: true }]);
  } finally {
    client.close();
    await server.close();
  }
});

test("download progress and its end reach onPull", async () => {
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      onHello: (current) => {
        write(current, {
          jsonrpc: "2.0",
          method: "model.pull.progress",
          params: { ref: "ollama/qwen3:8b", status: "pulling aaa", completed: 5, total: 10, progress: 0.5 },
        });
        write(current, { jsonrpc: "2.0", method: "model.pull.done", params: { ref: "ollama/qwen3:8b", ok: true } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const updates: string[] = [];
  const stop = client.onPull((update) => {
    updates.push(update.kind === "progress" ? `progress ${update.progress.progress}` : `done ${update.done.ok}`);
  });
  try {
    await client.ready;
    for (let tries = 0; tries < 50 && updates.length < 2; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(updates, ["progress 0.5", "done true"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("setup.status reads the rows, and the Ollama install's output reaches onOllamaInstall", async () => {
  const row = { part: "engine", name: "ollama", state: "warn", detail: "Ollama is not installed", action: "install_ollama" };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "setup.status": { rows: [row] }, "ollama.install": { started: true } },
      onHello: (current) => {
        write(current, { jsonrpc: "2.0", method: "ollama.install.output", params: { text: "==> Pouring\n" } });
        write(current, { jsonrpc: "2.0", method: "ollama.install.done", params: { outcome: "installed" } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const updates: string[] = [];
  const stop = client.onOllamaInstall((update) => {
    updates.push(update.kind === "output" ? update.text : update.done.outcome);
  });
  try {
    assert.deepEqual(await client.setupStatus(), { rows: [row] });
    assert.deepEqual(await client.installOllama(), { started: true });
    await waitFor(() => updates.length >= 2);
    assert.deepEqual(updates, ["==> Pouring\n", "installed"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("keychain.wait reaches onKeychainWait, and a malformed one is dropped", async () => {
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "setup.status": { rows: [] } },
      onHello: (current) => {
        write(current, { jsonrpc: "2.0", method: "keychain.wait", params: { name: "provider/openai" } });
        write(current, { jsonrpc: "2.0", method: "keychain.wait", params: { name: "provider/openai", provider: "openai", waiting: true } });
        write(current, { jsonrpc: "2.0", method: "keychain.wait", params: { name: "mcp/github", provider: null, waiting: false } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const waits: string[] = [];
  const stop = client.onKeychainWait((wait) => {
    waits.push(`${wait.name}:${String(wait.waiting)}`);
  });
  try {
    await client.setupStatus();
    await waitFor(() => waits.length >= 2);
    assert.deepEqual(waits, ["provider/openai:true", "mcp/github:false"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("mcp.list reads the servers, and mcp.server.status reaches onMcpStatus", async () => {
  const git = { name: "git", state: "running", command: "uvx mcp-server-git", tools: ["mcp__git__git_status"], error: null };
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "mcp.list": { servers: [git] },
        "mcp.enable": { session_id: "s_1", mcp_servers: ["git"] },
        "mcp.tools": { name: "git", tools: [{ name: "mcp__git__git_log", description: "Shows the log." }] },
        "mcp.restart": { ...git, state: "starting" },
        "mcp.set_enabled": { ...git, state: "disabled" },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("mcp.")) {
          sent.push({ method, ...params });
        }
      },
      onHello: (current) => {
        write(current, {
          jsonrpc: "2.0",
          method: "mcp.server.status",
          params: { ...git, state: "failed", tools: [], error: "the server exited with code 1" },
        });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const seen: string[] = [];
  const stop = client.onMcpStatus((status) => {
    seen.push(`${status.name} ${status.state}`);
  });
  try {
    assert.deepEqual(await client.listMcp(), { servers: [git] });
    await client.listMcp("s_1");
    assert.deepEqual(await client.enableMcp("s_1", "git"), { session_id: "s_1", mcp_servers: ["git"] });
    assert.equal((await client.mcpTools("git")).tools[0]?.name, "mcp__git__git_log");
    assert.equal((await client.restartMcp("git", "s_1")).state, "starting");
    assert.equal((await client.setMcpEnabled("git", false)).state, "disabled");
    assert.deepEqual(sent, [
      { method: "mcp.list" },
      { method: "mcp.list", session_id: "s_1" },
      { method: "mcp.enable", session_id: "s_1", name: "git" },
      { method: "mcp.tools", name: "git" },
      { method: "mcp.restart", name: "git", session_id: "s_1" },
      { method: "mcp.set_enabled", name: "git", enabled: false },
    ]);
    for (let tries = 0; tries < 50 && seen.length < 1; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(seen, ["git failed"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("addMcpServer keeps the token off the wire log, and removeMcpServer reports the secret", async () => {
  const sent: Record<string, unknown>[] = [];
  const github = { name: "github", state: "starting", command: "https://example.com/mcp", tools: [] };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "mcp.add": github,
        "mcp.remove": { name: "github", secret: true },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("mcp.")) {
          sent.push({ method, ...params });
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  let shown = "";
  const stop = client.onWire((lines) => {
    shown = lines.map(formatWireLine).join("\n");
  });
  try {
    const params = { name: "github", url: "https://example.com/mcp", token: "ghp-very-secret" };
    assert.equal((await client.addMcpServer(params)).state, "starting");
    assert.deepEqual(await client.removeMcpServer("github"), { name: "github", secret: true });
    assert.deepEqual(sent, [{ method: "mcp.add", ...params }, { method: "mcp.remove", name: "github" }]);
    assert.ok(shown.includes("mcp.add"));
    assert.ok(shown.includes("[redacted]"));
    assert.ok(!shown.includes("ghp-very-secret"));
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("mcp.catalog lists the entries, and a catalog add keeps its secrets off the wire log", async () => {
  const sent: Record<string, unknown>[] = [];
  const entry = {
    id: "github",
    name: "github",
    title: "GitHub",
    description: "Repos.",
    category: "code",
    homepage: "https://example.com",
    runtime: "url",
    auth: "token",
    inputs: [{ id: "token", kind: "secret", label: "GitHub token" }],
    available: true,
    added: false,
  };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "mcp.catalog": { entries: [entry] },
        "mcp.add": { name: "github", state: "starting", command: "https://example.com/mcp", tools: [] },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("mcp.")) {
          sent.push({ method, ...params });
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  let shown = "";
  const stop = client.onWire((lines) => {
    shown = lines.map(formatWireLine).join("\n");
  });
  try {
    assert.deepEqual((await client.mcpCatalog()).entries.map((each) => each.id), ["github"]);
    await client.mcpCatalog("s1");
    await client.addMcpServer({ name: "github", catalog_id: "github", inputs: {}, secrets: { token: "ghp-very-secret" } });
    assert.deepEqual(sent[0], { method: "mcp.catalog" });
    assert.deepEqual(sent[1], { method: "mcp.catalog", session_id: "s1" });
    assert.deepEqual(sent[2]?.["secrets"], { token: "ghp-very-secret" });
    assert.ok(shown.includes("[redacted]"));
    assert.ok(!shown.includes("ghp-very-secret"));
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("mcp.get returns one server's config, and a malformed result is refused", async () => {
  const sent: Record<string, unknown>[] = [];
  const detail = {
    server: { name: "github", state: "running", command: "npx", tools: [] },
    config: { command: "npx", env: { TOKEN: "keychain:mcp/github" } },
    scope: "user",
    path: "/h/config.toml",
    secrets: [{ ref: "mcp/github", stored: true }],
  };
  const results: Record<string, unknown> = { "mcp.get": detail };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results,
      onRequest: (_socket, method, params) => {
        if (method === "mcp.get") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.equal((await client.mcpGet("github")).secrets[0]?.ref, "mcp/github");
    await client.mcpGet("github", "s1");
    assert.deepEqual(sent, [{ name: "github" }, { name: "github", session_id: "s1" }]);
    results["mcp.get"] = { ...detail, scope: "team" };
    await assert.rejects(client.mcpGet("github"), /invalid mcp.get result/);
  } finally {
    client.close();
    await server.close();
  }
});

test("mcpCall sends the tool and its arguments, and refuses a result that is not one", async () => {
  const sent: unknown[] = [];
  const results: Record<string, unknown> = { "mcp.call": { text: "hi", is_error: false } };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results,
      onRequest: (_socket, method, params) => {
        if (method === "mcp.call") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.equal((await client.mcpCall({ name: "gh", tool: "get", arguments: { id: 1 }, sessionId: "s1" })).text, "hi");
    await client.mcpCall({ name: "gh", tool: "list" });
    assert.deepEqual(sent, [{ name: "gh", tool: "get", arguments: { id: 1 }, session_id: "s1" }, { name: "gh", tool: "list" }]);
    results["mcp.call"] = { text: 1 };
    await assert.rejects(client.mcpCall({ name: "gh", tool: "list" }), /invalid mcp.call result/);
  } finally {
    client.close();
    await server.close();
  }
});

test("mcp.test streams its steps to the caller and ignores another test's", async () => {
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "mcp.test": { test_id: "ignored", ok: true, steps: [{ step: "resolve", state: "ok" }] } },
      onRequest: (current, method, params) => {
        if (method !== "mcp.test") return;
        const id = (params as { test_id: string }).test_id;
        write(current, { jsonrpc: "2.0", method: "mcp.test.progress", params: { test_id: "other", step: "spawn", state: "ok" } });
        write(current, { jsonrpc: "2.0", method: "mcp.test.progress", params: { test_id: id, step: "resolve", state: "ok", elapsed_ms: 4 } });
        write(current, { jsonrpc: "2.0", method: "mcp.test.progress", params: { test_id: id, step: "bogus", state: "ok" } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    const seen: string[] = [];
    const result = await client.mcpTest({ name: "github" }, (progress) => seen.push(`${progress.step}:${progress.state}`));
    assert.equal(result.ok, true);
    assert.deepEqual(seen, ["resolve:ok"]);
  } finally {
    client.close();
    await server.close();
  }
});

test("mcp.logs returns the lines, and new ones reach onMcpLog", async () => {
  const sent: Record<string, unknown>[] = [];
  const line = { ts: 1, kind: "stderr", text: "hello" };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "mcp.logs": { name: "git", lines: [line] } },
      onRequest: (current, method, params) => {
        if (method !== "mcp.logs") return;
        sent.push(params);
        write(current, { jsonrpc: "2.0", method: "mcp.server.log", params: { name: "git", lines: [{ ts: 2, kind: "event", text: "restarted" }] } });
        write(current, { jsonrpc: "2.0", method: "mcp.server.log", params: { name: "git", lines: [{ ts: 3, kind: "other", text: "x" }] } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    const live: string[] = [];
    const stop = client.onMcpLog((batch) => live.push(...batch.lines.map((each) => each.text)));
    const logs = await client.mcpLogs("git", { limit: 20 });
    assert.deepEqual(logs.lines, [line]);
    assert.deepEqual(sent, [{ name: "git", limit: 20 }]);
    assert.deepEqual(live, ["restarted"]);
    stop();
  } finally {
    client.close();
    await server.close();
  }
});

test("mcp.update sends the whole config and keeps its secrets off the wire log", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "mcp.update": { name: "git", state: "starting", command: "uvx x", tools: [] } },
      onRequest: (_socket, method, params) => {
        if (method === "mcp.update") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  let shown = "";
  client.onWire((lines) => {
    shown = lines.map(formatWireLine).join("\n");
  });
  try {
    const updated = await client.updateMcpServer({
      name: "git",
      config: { command: "uvx", tools: { exclude: ["drop_*"] } },
      secrets: { "mcp/git": "ghp-very-secret" },
    });
    assert.equal(updated.name, "git");
    assert.deepEqual((sent[0]?.["config"] as { tools: unknown }).tools, { exclude: ["drop_*"] });
    assert.ok(!shown.includes("ghp-very-secret"));
  } finally {
    client.close();
    await server.close();
  }
});

test("config.raw reads the text, and the terminal's write is the protected one", async () => {
  const methods: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "config.raw.get": { path: "/h/config.toml", text: "a = 1\n", mtime_ns: 5, exists: true },
        "config.raw.set": { ok: false, errors: [{ line: 2, message: "bad" }] },
        "config.raw.set_protected": { ok: true, restart_needed: ["web"], mtime_ns: 6 },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("config.raw")) {
          methods.push(method);
          bodies.push(params);
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    const got = await client.configRawGet({ scope: "project", sessionId: "s1" });
    assert.equal(got.mtime_ns, 5);
    assert.equal((await client.configRawSet({ text: "x", baseMtimeNs: 5 })).ok, false);
    const local = await client.configRawSet({ text: "x", baseMtimeNs: 5, dryRun: true }, { local: true });
    assert.deepEqual(local.restart_needed, ["web"]);
    assert.deepEqual(methods, ["config.raw.get", "config.raw.set", "config.raw.set_protected"]);
    assert.deepEqual(bodies[0], { scope: "project", session_id: "s1" });
    assert.deepEqual(bodies[2], { scope: "user", text: "x", base_mtime_ns: 5, dry_run: true });
  } finally {
    client.close();
    await server.close();
  }
});

test("mcp.import scans and applies, and the wire view hides the secrets it is given", async () => {
  const sent: Record<string, unknown>[] = [];
  const candidate = { key: "k", name: "github", original_name: "github", scope: "user", config: { command: "npx" } };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "mcp.import.scan": { scan_id: "abc", sources: [{ id: "paste", label: "Pasted text", candidates: [candidate] }] },
        "mcp.import.apply": { added: [{ name: "github", state: "starting", command: "npx", tools: [] }], failed: [] },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("mcp.import")) sent.push({ method, ...params });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  let shown = "";
  client.onWire((lines) => {
    shown = lines.map(formatWireLine).join("\n");
  });
  try {
    const scan = await client.scanMcpImport({ text: "{}", sessionId: "s1" });
    assert.equal(scan.sources[0]?.candidates?.[0]?.name, "github");
    const applied = await client.applyMcpImport({
      scan_id: scan.scan_id,
      picks: [{ key: "k", name: "github" }],
      secrets: { "mcp/github": "ghp-very-secret" },
    });
    assert.equal(applied.added[0]?.name, "github");
    assert.deepEqual(sent[0], { method: "mcp.import.scan", text: "{}", session_id: "s1" });
    assert.ok(!shown.includes("ghp-very-secret"));
  } finally {
    client.close();
    await server.close();
  }
});

test("mcp.test of a catalog entry sends the entry, its inputs, and its secrets", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "mcp.test": { test_id: "x", ok: true, steps: [] } },
      onRequest: (_socket, method, params) => {
        if (method === "mcp.test") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    await client.mcpTest({ catalogId: "github", inputs: { a: "b" }, secrets: { token: "t" }, name: "gh" });
    const body = { ...sent[0] };
    delete body["test_id"];
    assert.deepEqual(body, { catalog_id: "github", inputs: { a: "b" }, name: "gh", secrets: { token: "t" } });
  } finally {
    client.close();
    await server.close();
  }
});

test("runtime.install starts, and its output and end reach onRuntimeInstall", async () => {
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "runtime.install": { name: "node", started: true },
        "runtime.install_cancel": { name: "node", cancelled: false },
      },
      onHello: (current) => {
        write(current, { jsonrpc: "2.0", method: "runtime.install.output", params: { name: "node", text: "==> Pouring\n" } });
        write(current, { jsonrpc: "2.0", method: "runtime.install.output", params: { name: "docker", text: "ignored" } });
        write(current, { jsonrpc: "2.0", method: "runtime.install.done", params: { name: "node", ok: true } });
        write(current, { jsonrpc: "2.0", method: "runtime.install.done", params: { name: "node" } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const updates: string[] = [];
  const stop = client.onRuntimeInstall((update) => {
    updates.push(update.kind === "output" ? `${update.name}: ${update.text}` : `${update.done.name} ${update.done.ok}`);
  });
  try {
    assert.deepEqual(await client.installRuntime("node"), { name: "node", started: true });
    assert.deepEqual(await client.cancelRuntimeInstall("node"), { name: "node", cancelled: false });
    await waitFor(() => updates.length >= 2);
    assert.deepEqual(updates, ["node: ==> Pouring\n", "node true"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("model.server.status reaches onModelServer, and a malformed one does not", async () => {
  const base = { provider: "ollama", base_url: "http://127.0.0.1:11434" };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      onHello: (current) => {
        write(current, { jsonrpc: "2.0", method: "model.server.status", params: { ...base, state: "asleep" } });
        write(current, { jsonrpc: "2.0", method: "model.server.status", params: { ...base, state: "starting" } });
        write(current, { jsonrpc: "2.0", method: "model.server.status", params: { ...base, state: "ready" } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const seen: string[] = [];
  const stop = client.onModelServer((status) => {
    seen.push(`${status.provider} ${status.state}`);
  });
  try {
    for (let tries = 0; tries < 50 && seen.length < 2; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(seen, ["ollama starting", "ollama ready"]);
  } finally {
    stop();
    client.close();
    await server.close();
  }
});

test("skill.read, write, create and set_disabled send their params, and local clients use the protected twins", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "skill.read": { path: "/s/ship/SKILL.md", text: "x", mtime_ns: 5, source: "user" },
        "skill.write": { ok: true, written: true, mtime_ns: 6 },
        "skill.write_protected": { ok: true, written: true, mtime_ns: 7 },
        "skill.create": { path: "/s/new/SKILL.md", mtime_ns: 8 },
        "skill.create_protected": { path: "/p/new/SKILL.md", mtime_ns: 9 },
        "skill.set_disabled": { name: "ship", disabled: true },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("skill.")) {
          sent.push({ method, ...params });
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.equal((await client.readSkill("ship", "/repo")).mtime_ns, 5);
    assert.equal((await client.writeSkill({ path: "/s/ship/SKILL.md", text: "y", baseMtimeNs: 5 })).mtime_ns, 6);
    const local = await client.writeSkill(
      { path: "/s/ship/SKILL.md", text: "y", baseMtimeNs: 5, cwd: "/repo", dryRun: true },
      { local: true },
    );
    assert.equal(local.mtime_ns, 7);
    assert.equal((await client.createSkill({ name: "new", scope: "user", description: "d" })).mtime_ns, 8);
    const project = await client.createSkill(
      { name: "new", scope: "project", description: "d", cwd: "/repo", modelInvocable: false },
      { local: true },
    );
    assert.equal(project.mtime_ns, 9);
    assert.deepEqual(await client.setSkillDisabled("ship", true), { name: "ship", disabled: true });
    assert.deepEqual(sent, [
      { method: "skill.read", name: "ship", cwd: "/repo" },
      { method: "skill.write", path: "/s/ship/SKILL.md", text: "y", base_mtime_ns: 5 },
      { method: "skill.write_protected", path: "/s/ship/SKILL.md", text: "y", base_mtime_ns: 5, cwd: "/repo", dry_run: true },
      { method: "skill.create", name: "new", scope: "user", description: "d" },
      { method: "skill.create_protected", name: "new", scope: "project", description: "d", cwd: "/repo", model_invocable: false },
      { method: "skill.set_disabled", name: "ship", disabled: true },
    ]);
  } finally {
    client.close();
    await server.close();
  }
});

test("routine.list, get, run and update send their params", async () => {
  const sent: Record<string, unknown>[] = [];
  const info = { config: { name: "brief", prompt: "p" }, path: "/h/config.toml", source: "user" };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "routine.list": { routines: [info] },
        "routine.get": { routine: info, runs: [] },
        "routine.run": { routine_run_id: "r1", session_id: "s1" },
        "routine.update": { routine: info },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("routine.")) {
          sent.push({ method, ...params });
        }
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.equal((await client.listRoutines(["/repo"])).routines.length, 1);
    assert.equal((await client.getRoutine("brief")).routine.config.name, "brief");
    assert.deepEqual(await client.runRoutine("brief", "/repo"), { routine_run_id: "r1", session_id: "s1" });
    await client.updateRoutine("brief", { enabled: false });
    assert.deepEqual(sent, [
      { method: "routine.list", folders: ["/repo"] },
      { method: "routine.get", name: "brief" },
      { method: "routine.run", name: "brief", folder: "/repo" },
      { method: "routine.update", name: "brief", fields: { enabled: false } },
    ]);
  } finally {
    client.close();
    await server.close();
  }
});

test("skill.list reads the skills, and skill.registry.changed reaches onSkillsChanged", async () => {
  const ship = { name: "ship", description: "Ship it.", source: "project", path: "/repo/.agents/skills/ship", usable: true };
  const sent: Record<string, unknown>[] = [];
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "skill.list": { skills: [ship] } },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("skill.")) {
          sent.push({ method, ...params });
        }
      },
      onHello: (current) => {
        write(current, { jsonrpc: "2.0", method: "skill.registry.changed", params: { root: "/repo" } });
        write(current, { jsonrpc: "2.0", method: "skill.registry.changed", params: { root: null } });
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  const seen: (string | null)[] = [];
  const stop = client.onSkillsChanged((root) => {
    seen.push(root);
  });
  try {
    assert.deepEqual(await client.listSkills("/repo"), { skills: [ship] });
    await client.listSkills();
    assert.deepEqual(sent, [{ method: "skill.list", cwd: "/repo" }, { method: "skill.list" }]);
    for (let tries = 0; tries < 50 && seen.length < 2; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(seen, ["/repo", null]);
  } finally {
    stop();
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

test("getCost sends the session id when it has one and checks what comes back", async () => {
  const sent: Record<string, unknown>[] = [];
  const totals = { calls: 1, input: 2, output: 3, cost_usd: 0.5, saved_usd: 0 };
  const result = { today: totals, week: totals, by_model: [], by_day: [] };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "cost.get": result },
      onRequest: (_socket, method, params) => {
        if (method === "cost.get") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.getCost(), result);
    await client.getCost("s_test");
    assert.deepEqual(sent, [{}, { session_id: "s_test" }]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "cost.get": { today: totals } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.getCost(), /invalid cost.get result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("evalRouting sends days and the session id and checks what comes back", async () => {
  const sent: Record<string, unknown>[] = [];
  const row = { name: "auto", calls: 1, input: 2, output: 3, cost_usd: 0.5, cuts: 0, clears: 0, summaries: 0 };
  const result = { days: 14, sessions: 1, calls: 1, skipped: 0, scenarios: [row], actual: row, top: [] };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "eval.routing": result },
      onRequest: (_socket, method, params) => {
        if (method === "eval.routing") sent.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.evalRouting(), result);
    await client.evalRouting(7, "s_test");
    assert.deepEqual(sent, [{}, { days: 7, session_id: "s_test" }]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "eval.routing": { days: 14 } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.evalRouting(), /invalid eval.routing result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("getRouting and setRouting send their params and check what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const values = {
    routing: { mode: "auto", paid: "ask", budget_max_price: 1.5, local_only: [] },
    ladder: {},
    roles: { titles: "session", summarise: "session", explore: "session" },
    budget: { over: "local" },
    context: { window: "auto", reply_reserve: 4096, clear_at: 0.7, clear_to: 0.4, compact_at: 0.85, keep_results: 4, keep_turns: 4 },
    picked: {},
  };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "routing.get": values, "routing.set": { ok: true, errors: [], values } },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("routing.")) sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.getRouting(), values);
    const saved = await client.setRouting({ routing: { mode: "local" }, ladder: { local: null } });
    assert.equal(saved.ok, true);
    assert.deepEqual(sent, [
      ["routing.get", {}],
      ["routing.set", { routing: { mode: "local" }, ladder: { local: null } }],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "routing.get": { routing: {} }, "routing.set": { errors: [] } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.getRouting(), /invalid routing.get result/);
    await assert.rejects(() => refused.setRouting({}), /invalid routing.set result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("the notification calls send their params and check what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const values = {
    needs_you: true,
    failed: true,
    finished: false,
    open_in: "web",
    terminal_app: "Terminal",
    terminal_apps: ["Terminal", "iTerm", "Ghostty"],
  };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "notifications.get": values,
        "notifications.set": { ok: true, errors: [], values },
        "notify.test": { posted: false, mechanism: "none" },
      },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("notif") || method === "notify.test") sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.getNotifications(), values);
    assert.equal((await client.setNotifications({ finished: true })).ok, true);
    assert.deepEqual(await client.notifyTest(), { posted: false, mechanism: "none" });
    assert.deepEqual(sent, [
      ["notifications.get", {}],
      ["notifications.set", { finished: true }],
      ["notify.test", {}],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "notifications.get": {}, "notifications.set": {}, "notify.test": {} } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.getNotifications(), /invalid notifications.get result/);
    await assert.rejects(() => refused.setNotifications({}), /invalid notifications.set result/);
    await assert.rejects(() => refused.notifyTest(), /invalid notify.test result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("getTrace and getTraceSpan send their ids and check what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const span = { id: "m_1", kind: "model", name: "model 1", start: "t", status: "ok" };
  const trace = {
    session_id: "s_test",
    title: null,
    runs: [{ id: "r_1", kind: "run", name: "hi", start: "t", status: "ok", children: [span] }],
  };
  const detail = { span, messages: [], reply: null, system_prompt: null };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "trace.get": trace, "trace.span": detail },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("trace.")) sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.getTrace("s_test"), trace);
    assert.deepEqual(await client.getTraceSpan("s_test", "m_1"), detail);
    assert.deepEqual(sent, [
      ["trace.get", { session_id: "s_test" }],
      ["trace.span", { session_id: "s_test", span_id: "m_1" }],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "trace.get": { ...trace, runs: [{ ...trace.runs[0], status: "stuck" }] },
        "trace.span": { ...detail, span: { ...span, kind: "other" } },
      },
    });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.getTrace("s_test"), /invalid trace.get result/);
    await assert.rejects(() => refused.getTraceSpan("s_test", "m_1"), /invalid trace.span result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("changesList and changesDiff send their targets and check what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const list = { files: [{ path: "a.txt", status: "modified", added: 2, removed: 1, change_ids: ["c_1", "c_2"], stale: false }] };
  const diff = { diff: "--- a/a.txt\n+++ b/a.txt\n", truncated: false };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "changes.list": list, "changes.diff": diff },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("changes.")) sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.changesList("s_test"), list);
    assert.deepEqual(await client.changesDiff("s_test", { path: "a.txt" }), diff);
    assert.deepEqual(await client.changesDiff("s_test", { changeId: "c_1" }), diff);
    assert.deepEqual(sent, [
      ["changes.list", { session_id: "s_test" }],
      ["changes.diff", { session_id: "s_test", path: "a.txt" }],
      ["changes.diff", { session_id: "s_test", change_id: "c_1" }],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "changes.list": { files: [{ ...list.files[0], status: "moved" }] },
        "changes.diff": { diff: "x" },
      },
    });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.changesList("s_test"), /invalid changes.list result/);
    await assert.rejects(() => refused.changesDiff("s_test", { path: "a.txt" }), /invalid changes.diff result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("changesRevert sends each kind of target and checks what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const reply = { reverted: ["a.txt"], conflicts: [{ path: "b.txt", reason: "changed_on_disk" }] };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "changes.revert": reply },
      onRequest: (_socket, method, params) => {
        if (method === "changes.revert") sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.changesRevert("s_test", { kind: "change", changeId: "c_1" }), reply);
    await client.changesRevert("s_test", { kind: "file", path: "a.txt" }, true);
    await client.changesRevert("s_test", { kind: "hunk", path: "a.txt", hunk: 2 });
    await client.changesRevert("s_test", { kind: "run", runId: "r_1" });
    assert.deepEqual(sent, [
      ["changes.revert", { session_id: "s_test", target: { kind: "change", change_id: "c_1" }, force: false }],
      ["changes.revert", { session_id: "s_test", target: { kind: "file", path: "a.txt" }, force: true }],
      ["changes.revert", { session_id: "s_test", target: { kind: "hunk", path: "a.txt", hunk: 2 }, force: false }],
      ["changes.revert", { session_id: "s_test", target: { kind: "run", run_id: "r_1" }, force: false }],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "changes.revert": { reverted: ["a.txt"] } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(
      () => refused.changesRevert("s_test", { kind: "file", path: "a.txt" }),
      /invalid changes.revert result/,
    );
  } finally {
    refused.close();
    await bad.close();
  }
});

test("the commit calls send their targets and check what comes back", async () => {
  const sent: [string, Record<string, unknown>][] = [];
  const commit = { ok: true, sha: "abc1234", output: "[main abc1234] msg" };
  const info = { repository: true, branch: "main", paths: ["a.txt"] };
  const suggested = { message: "Update a.txt" };
  const server = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "changes.commit": commit, "changes.commit_info": info, "changes.suggest_message": suggested },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("changes.")) sent.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: server.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.changesCommit("s_test", ["a.txt"], "msg"), commit);
    assert.deepEqual(await client.changesCommitInfo("s_test"), info);
    assert.deepEqual(await client.changesSuggestMessage("s_test", ["a.txt"]), suggested);
    assert.deepEqual(sent, [
      ["changes.commit", { session_id: "s_test", paths: ["a.txt"], message: "msg" }],
      ["changes.commit_info", { session_id: "s_test" }],
      ["changes.suggest_message", { session_id: "s_test", paths: ["a.txt"] }],
    ]);
  } finally {
    client.close();
    await server.close();
  }
  const bad = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: {
        "changes.commit": { ok: "yes" },
        "changes.commit_info": { repository: true },
        "changes.suggest_message": {},
      },
    });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "web", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.changesCommit("s_test", ["a.txt"], "m"), /invalid changes.commit result/);
    await assert.rejects(() => refused.changesCommitInfo("s_test"), /invalid changes.commit_info result/);
    await assert.rejects(() => refused.changesSuggestMessage("s_test", ["a.txt"]), /invalid changes.suggest_message result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("createSession sends the folder and the model only when they are given", async () => {
  const seen: Record<string, unknown>[] = [];
  const daemon = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "session.create": { session_id: "s_new" } },
      onRequest: (_socket, method, params) => {
        if (method === "session.create") seen.push(params);
      },
    });
  });
  const client = connectGolem({
    socketPath: daemon.socketPath,
    clientName: "tui",
    reconnect: false,
    heartbeatMs: 60_000,
  });
  try {
    await client.createSession();
    await client.createSession({ cwd: "/repo" });
    await client.createSession({ modelProfile: "local" });
    await client.createSession({ cwd: "/repo", modelProfile: "ollama/qwen3:8b" });
    assert.deepEqual(seen, [
      {},
      { cwd: "/repo" },
      { model_profile: "local" },
      { cwd: "/repo", model_profile: "ollama/qwen3:8b" },
    ]);
  } finally {
    client.close();
    await daemon.close();
  }
});

test("listDirs sends the path only when given, and rejects a malformed listing", async () => {
  const seen: Record<string, unknown>[] = [];
  const listing = { path: "/home/me", home: "/home/me", parent: null, entries: [{ name: "code", path: "/home/me/code", git: true }], truncated: false };
  const daemon = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "fs.list_dirs": listing },
      onRequest: (_socket, method, params) => {
        if (method === "fs.list_dirs") seen.push(params);
      },
    });
  });
  const client = connectGolem({ socketPath: daemon.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.listDirs(), listing);
    await client.listDirs("/home/me/code");
    assert.deepEqual(seen, [{}, { path: "/home/me/code" }]);
  } finally {
    client.close();
    await daemon.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "fs.list_dirs": { ...listing, entries: [{ name: "x" }] } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.listDirs(), /invalid fs.list_dirs result/);
  } finally {
    refused.close();
    await bad.close();
  }
});

test("readFile and listFiles send their arguments and reject a malformed result", async () => {
  const seen: [string, Record<string, unknown>][] = [];
  const read = { path: "a.txt", text: "hi", truncated: false, lines: 1 };
  const daemon = await listen((socket) => {
    attach(socket, {
      answerPing: true,
      results: { "file.read": read, "file.list": { paths: ["a.txt"], more: false } },
      onRequest: (_socket, method, params) => {
        if (method.startsWith("file.")) seen.push([method, params]);
      },
    });
  });
  const client = connectGolem({ socketPath: daemon.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    assert.deepEqual(await client.readFile("s_1", "a.txt"), read);
    assert.deepEqual(await client.listFiles("s_1"), { paths: ["a.txt"], more: false });
    await client.listFiles("s_1", "a", 5, true);
    assert.deepEqual(seen, [
      ["file.read", { session_id: "s_1", path: "a.txt" }],
      ["file.list", { session_id: "s_1" }],
      ["file.list", { session_id: "s_1", query: "a", limit: 5, hidden: true }],
    ]);
  } finally {
    client.close();
    await daemon.close();
  }
  const bad = await listen((socket) => {
    attach(socket, { answerPing: true, results: { "file.read": { path: "a" }, "file.list": { paths: [1] } } });
  });
  const refused = connectGolem({ socketPath: bad.socketPath, clientName: "tui", reconnect: false, heartbeatMs: 60_000 });
  try {
    await assert.rejects(() => refused.readFile("s_1", "a"), /invalid file.read result/);
    await assert.rejects(() => refused.listFiles("s_1"), /invalid file.list result/);
  } finally {
    refused.close();
    await bad.close();
  }
});
