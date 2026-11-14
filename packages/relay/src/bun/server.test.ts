import { afterEach, expect, test } from "bun:test";

import { authMessage, toBase64Url } from "../core.ts";
import { newIdentity } from "../test-client.ts";
import { configFromEnv } from "./config.ts";
import { startRelay } from "./server.ts";
import type { Relay } from "./server.ts";

let relay: Relay | undefined;
afterEach(() => {
  relay?.stop();
  relay = undefined;
});

function open(path: string): Promise<{ ws: WebSocket; inbox: (string | Uint8Array)[]; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay!.port}${path}`);
    ws.binaryType = "arraybuffer";
    const inbox: (string | Uint8Array)[] = [];
    const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
    ws.addEventListener("message", (e) => inbox.push(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer)));
    ws.addEventListener("open", () => resolve({ ws, inbox, closed }));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}

async function next(inbox: (string | Uint8Array)[], n: number): Promise<void> {
  for (let i = 0; i < 500 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 4));
  expect(inbox.length).toBeGreaterThanOrEqual(n);
}

async function login(ws: WebSocket, inbox: (string | Uint8Array)[], role: "mac" | "device", extra: object = {}) {
  const id = await newIdentity();
  await next(inbox, 1);
  const nonce = (JSON.parse(inbox[0] as string) as { nonce: string }).nonce;
  const sig = await id.sign(authMessage(role, "relay.test", nonce));
  ws.send(JSON.stringify({ type: "auth", v: 1, key: id.publicKey, sig: toBase64Url(sig), ...extra }));
  return id;
}

test("healthz answers, other paths do not", async () => {
  relay = startRelay({ port: 0, host: "relay.test" });
  const ok = await fetch(`http://127.0.0.1:${relay.port}/healthz`);
  expect(await ok.json()).toEqual({ ok: true, rooms: 0, sockets: 0 });
  expect((await fetch(`http://127.0.0.1:${relay.port}/nope`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${relay.port}/v1/mac`)).status).toBe(426);
});

test("a Mac and a device exchange a frame over real sockets", async () => {
  relay = startRelay({ port: 0, host: "relay.test" });
  const mac = await open("/v1/mac");
  const macId = await login(mac.ws, mac.inbox, "mac");
  const phone = await newIdentity();
  mac.ws.send(JSON.stringify({ type: "allow", seq: 1, devices: [{ key: phone.publicKey }], pairs: [] }));
  await new Promise((r) => setTimeout(r, 30));

  const dev = await open("/v1/device");
  await next(dev.inbox, 1);
  const nonce = (JSON.parse(dev.inbox[0] as string) as { nonce: string }).nonce;
  const sig = await phone.sign(authMessage("device", "relay.test", nonce));
  dev.ws.send(JSON.stringify({ type: "auth", v: 1, key: phone.publicKey, sig: toBase64Url(sig), mac: await macId.roomId() }));
  await next(dev.inbox, 2);

  dev.ws.send(new Uint8Array([1, 0, 0, 0, 7, 42, 43]));
  await next(mac.inbox, 3);
  const frame = mac.inbox.find((m): m is Uint8Array => typeof m !== "string")!;
  expect(frame.length).toBe(1 + 16 + 4 + 2);
  expect([...frame.slice(-2)]).toEqual([42, 43]);
});

test("a stranger gets 4401 over the wire", async () => {
  relay = startRelay({ port: 0, host: "relay.test" });
  const dev = await open("/v1/device");
  await login(dev.ws, dev.inbox, "device", { mac: "none" });
  expect(await dev.closed).toBe(1013);
});

test("configFromEnv reads BIND and requires RELAY_HOST", () => {
  expect(() => configFromEnv({})).toThrow("RELAY_HOST");
  const cfg = configFromEnv({ RELAY_HOST: "r.example", BIND: "127.0.0.1:9000", QUEUE_TTL_S: "30" });
  expect(cfg).toMatchObject({ port: 9000, hostname: "127.0.0.1", host: "r.example", queueTtlMs: 30_000 });
  expect(() => configFromEnv({ RELAY_HOST: "x", BIND: "nope" })).toThrow("BIND");
});
