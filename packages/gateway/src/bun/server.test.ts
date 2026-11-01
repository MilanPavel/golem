import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { randomSecret } from "../core.ts";
import { startGateway } from "./server.ts";
import type { Gateway } from "./server.ts";

interface FakeDaemon {
  socketPath: string;
  connections: number;
  lines: string[];
  sockets: net.Socket[];
  dropAll(): void;
  close(): Promise<void>;
}

/** A daemon that answers each JSON line with {"result":{"method":...}} under the same id. */
function fakeDaemon(dir: string): Promise<FakeDaemon> {
  const socketPath = path.join(dir, "d.sock");
  const daemon: FakeDaemon = {
    socketPath,
    connections: 0,
    lines: [],
    sockets: [],
    dropAll: () => daemon.sockets.forEach((s) => s.destroy()),
    close: () => new Promise((resolve) => (daemon.dropAll(), server.close(() => resolve()))),
  };
  const server = net.createServer((sock) => {
    daemon.connections += 1;
    daemon.sockets.push(sock);
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        daemon.lines.push(line);
        const req = JSON.parse(line) as { id: unknown; method: string };
        sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { method: req.method } })}\n`);
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(daemon)));
}

let dir: string;
let daemon: FakeDaemon;
let gateway: Gateway;
let token: string;
let port: number;
const opened: WebSocket[] = [];

async function start(options: { maxSockets?: number; socketPath?: string } = {}): Promise<void> {
  gateway = startGateway({ port: 0, socketPath: options.socketPath ?? daemon.socketPath, token, ...options });
  port = gateway.port;
}

const origin = () => `http://127.0.0.1:${port}`;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-gw-"));
  daemon = await fakeDaemon(dir);
  token = randomSecret();
});

afterEach(async () => {
  for (const ws of opened.splice(0)) ws.close();
  await gateway?.stop();
  await daemon.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function login(): Promise<string> {
  const res = await fetch(`${origin()}/auth/exchange`, {
    method: "POST",
    headers: { Origin: origin(), "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(res.status).toBe(204);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

interface Client {
  ws: WebSocket;
  messages: string[];
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  next(): Promise<string>;
}

function connect(headers: Record<string, string>): Client {
  // Bun's client takes headers; the standard type does not know the option.
  const BunWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
  const ws = new BunWebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  opened.push(ws);
  const messages: string[] = [];
  const waiting: ((m: string) => void)[] = [];
  ws.addEventListener("message", (e) => {
    const m = String(e.data);
    const w = waiting.shift();
    if (w) w(m);
    else messages.push(m);
  });
  return {
    ws,
    messages,
    opened: new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("socket error")));
    }),
    closed: new Promise((resolve) => ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason }))),
    next: () => {
      const m = messages.shift();
      return m !== undefined ? Promise.resolve(m) : new Promise((resolve) => waiting.push(resolve));
    },
  };
}

async function loggedIn(): Promise<Client> {
  const client = connect({ Origin: origin(), Cookie: await login() });
  await client.opened;
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("hello then session.attach round-trip through the gateway", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"jsonrpc":"2.0","id":1,"method":"hello","params":{}}');
  expect(JSON.parse(await c.next())).toEqual({ jsonrpc: "2.0", id: 1, result: { method: "hello" } });
  c.ws.send('{"jsonrpc":"2.0","id":2,"method":"session.attach","params":{"session_id":"s"}}');
  expect(JSON.parse(await c.next())).toEqual({ jsonrpc: "2.0", id: 2, result: { method: "session.attach" } });
  expect(daemon.lines).toHaveLength(2);
});

test("/healthz answers with the pid", async () => {
  await start();
  const res = await fetch(`${origin()}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ golem: "web", pid: process.pid });
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("/healthz refuses a wrong Host and a wrong method", async () => {
  await start();
  const bad = await fetch(`${origin()}/healthz`, { headers: { Host: "evil.example:80" } });
  expect(bad.status).toBe(403);
  const post = await fetch(`${origin()}/healthz`, { method: "POST" });
  expect(post.status).toBe(405);
});

test("security headers are on 200, 403, and 404", async () => {
  await start();
  const responses = [
    await fetch(`${origin()}/healthz`),
    await fetch(`${origin()}/healthz`, { headers: { Host: "evil.example:80" } }),
    await fetch(`${origin()}/nothing`),
  ];
  expect(responses.map((r) => r.status)).toEqual([200, 403, 404]);
  for (const r of responses) {
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  }
});

test("a bad Origin on an upgrade is a plain 403 with no socket", async () => {
  await start();
  const cookie = await login();
  const c = connect({ Origin: "http://evil.example", Cookie: cookie });
  await expect(c.opened).rejects.toThrow();
  expect(daemon.connections).toBe(0);
});

test("no cookie: the socket opens, closes with 4401, and the daemon sees nothing", async () => {
  await start();
  const c = connect({ Origin: origin() });
  await c.opened;
  expect(await c.closed).toMatchObject({ code: 4401, reason: "login required" });
  await sleep(50);
  expect(daemon.connections).toBe(0);
});

test("a refused socket does not count toward the cap, and one over the cap gets 503", async () => {
  await start({ maxSockets: 2 });
  const cookie = await login();
  for (let i = 0; i < 3; i++) {
    const refused = connect({ Origin: origin() });
    await refused.opened;
    await refused.closed;
  }
  const a = connect({ Origin: origin(), Cookie: cookie });
  const b = connect({ Origin: origin(), Cookie: cookie });
  await a.opened;
  await b.opened;
  const res = await fetch(`${origin()}/ws`, {
    headers: { Origin: origin(), Cookie: cookie, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
  });
  expect(res.status).toBe(503);
  const c = connect({ Origin: origin(), Cookie: cookie });
  await expect(c.opened).rejects.toThrow();
  a.ws.close();
  await a.closed;
  await sleep(50);
  const d = connect({ Origin: origin(), Cookie: cookie });
  await d.opened;
});

test("/ws refuses a method other than GET", async () => {
  await start();
  expect((await fetch(`${origin()}/ws`, { method: "POST" })).status).toBe(405);
});

test("the daemon being down at the upgrade closes with 1013", async () => {
  await start({ socketPath: path.join(dir, "missing.sock") });
  const c = await loggedIn();
  expect(await c.closed).toMatchObject({ code: 1013, reason: "golem daemon is not running" });
});

test("a daemon that closes mid-stream closes the browser with 1001", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"id":1,"method":"ping"}');
  await c.next();
  daemon.dropAll();
  // Bun's client reports a 1001 close as 1000, so the reason is what identifies it.
  expect(await c.closed).toMatchObject({ reason: "daemon closed" });
});

test("a browser close ends the daemon connection", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"id":1,"method":"ping"}');
  await c.next();
  const ended = new Promise<void>((resolve) => daemon.sockets[0]?.on("close", () => resolve()));
  c.ws.close();
  await ended;
});

test("a message with two lines closes with 1008 and reaches no daemon", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"id":1,"method":"ping"}\n{"id":2,"method":"ping"}');
  expect(await c.closed).toMatchObject({ code: 1008 });
  expect(daemon.lines).toEqual([]);
});

test("auth.set gets a -32020 reply with its id and the connection stays open", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"jsonrpc":"2.0","id":7,"method":"auth.set","params":{}}');
  const reply = JSON.parse(await c.next());
  expect(reply.id).toBe(7);
  expect(reply.error.code).toBe(-32020);
  c.ws.send('{"jsonrpc":"2.0","id":8,"method":"ping"}');
  expect(JSON.parse(await c.next()).id).toBe(8);
  expect(daemon.lines).toHaveLength(1);
});

test("many large daemon lines arrive whole", async () => {
  await start();
  const c = await loggedIn();
  c.ws.send('{"id":1,"method":"ping"}');
  await c.next();
  const line = JSON.stringify({ blob: "é".repeat(100_000) });
  const count = 40;
  for (let i = 0; i < count; i++) daemon.sockets[0]?.write(`${line}\n`);
  for (let i = 0; i < count; i++) expect(await c.next()).toBe(line);
});

test("a malformed token makes startGateway throw before listening", () => {
  expect(() => startGateway({ port: 0, socketPath: "/nope", token: "short" })).toThrow();
});

test("an empty socket path makes startGateway throw before listening", () => {
  expect(() => startGateway({ port: 0, socketPath: "", token: randomSecret() })).toThrow(/socket path/);
});

test("the default cap is 16", async () => {
  await start();
  const cookie = await login();
  const clients = Array.from({ length: 16 }, () => connect({ Origin: origin(), Cookie: cookie }));
  await Promise.all(clients.map((c) => c.opened));
  const extra = connect({ Origin: origin(), Cookie: cookie });
  await expect(extra.opened).rejects.toThrow();
});
