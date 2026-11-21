import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createHub } from "../../../relay/src/core.ts";
import type { Conn, Handler, Hub, Role } from "../../../relay/src/core.ts";
import { authMessage, roomIdOf, toBase64Url, fromBase64Url } from "../../../relay/src/protocol.ts";
import { newIdentity } from "../../../relay/src/test-client.ts";
import type { Identity } from "../../../relay/src/test-client.ts";
import { createInitiator, generateKeyPair, x25519 } from "../noise.ts";
import type { KeyPair, Transport } from "../noise.ts";
import { backoffDelay } from "../relay.ts";
import { startGateway } from "./server.ts";
import type { Gateway } from "./server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const none = new Uint8Array(0);
const enc = new TextEncoder();
const dec = new TextDecoder();

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

// ---- a daemon that keeps the keys and the registry ------------------------------------------------

interface Registered {
  key: string;
  revoked: boolean;
}

interface FakeDaemon {
  socketPath: string;
  mac: Identity;
  noise: KeyPair;
  url: string | null;
  seq: number;
  registry: Map<string, Registered>;
  /** Devices `device.sync` lists. Default: the registry's, minus the revoked. */
  listed: (() => { id: string; key: string }[]) | null;
  /** Every protocol line a connection that identified a device sent, as `device|line`. */
  lines: string[];
  identified: string[];
  syncs: number;
  changed(): void;
  close(): Promise<void>;
}

async function fakeDaemon(dir: string): Promise<FakeDaemon> {
  const mac = await newIdentity();
  const noise = generateKeyPair();
  const controls = new Set<net.Socket>();
  const sockets = new Set<net.Socket>();
  const daemon: FakeDaemon = {
    socketPath: path.join(dir, "d.sock"),
    mac,
    noise,
    url: null,
    seq: 1,
    registry: new Map(),
    listed: null,
    lines: [],
    identified: [],
    syncs: 0,
    changed() {
      daemon.seq += 1;
      for (const s of controls) s.write(`${JSON.stringify({ jsonrpc: "2.0", method: "device.changed", params: {} })}\n`);
    },
    close: () => new Promise((resolve) => (sockets.forEach((s) => s.destroy()), server.close(() => resolve()))),
  };

  async function answer(sock: net.Socket, state: { device: string | null }, req: { id: unknown; method: string; params?: Record<string, unknown> }): Promise<unknown> {
    const p = req.params ?? {};
    switch (req.method) {
      case "hello":
        controls.add(sock);
        return { result: { protocol_major: 2, protocol_minor: 0, daemon_version: "test" } };
      case "relay.sign": {
        const message = fromBase64Url(String(p["message"])) ?? none;
        if (!dec.decode(message).startsWith("golem-relay-v1\0")) return { error: { code: -32602, message: "invalid params" } };
        return { result: { sig: toBase64Url(await mac.sign(message)) } };
      }
      case "relay.dh": {
        const pub = fromBase64Url(String(p["public_key"])) ?? none;
        return { result: { shared: toBase64Url(x25519(noise.privateKey, pub)) } };
      }
      case "device.sync": {
        daemon.syncs += 1;
        const devices = daemon.listed
          ? daemon.listed()
          : [...daemon.registry].filter(([, d]) => !d.revoked).map(([id, d]) => ({ id, key: d.key }));
        return {
          result: {
            url: daemon.url,
            room: await mac.roomId(),
            mac_key: mac.publicKey,
            noise_key: toBase64Url(noise.publicKey),
            seq: daemon.seq,
            devices,
            pairs: [],
          },
        };
      }
      case "connection.identify": {
        const id = String(p["device"]);
        const row = daemon.registry.get(id);
        if (!row) return { error: { code: -32021, message: "unknown device", data: { reason: "unknown_device" } } };
        if (row.revoked) return { error: { code: -32021, message: "device revoked", data: { reason: "revoked" } } };
        state.device = id;
        daemon.identified.push(id);
        return { result: {} };
      }
      case "model.list":
        return { result: { text: "m".repeat(100_000) } };
      default:
        return { result: { method: req.method, sessions: [] } };
    }
  }

  const server = net.createServer((sock) => {
    sockets.add(sock);
    const state = { device: null as string | null };
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        const req = JSON.parse(line) as { id: unknown; method: string; params?: Record<string, unknown> };
        if (state.device !== null) daemon.lines.push(`${state.device}|${line}`);
        void answer(sock, state, req).then((reply) => sock.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, ...(reply as object) })}\n`));
      }
    });
    sock.on("error", () => undefined);
    sock.on("close", () => {
      sockets.delete(sock);
      controls.delete(sock);
    });
  });
  await new Promise<void>((resolve) => server.listen(daemon.socketPath, () => resolve()));
  return daemon;
}

// ---- a relay that writes down every frame ----------------------------------------------------------

interface RecordingRelay {
  port: number;
  /** Everything that crossed it, both ways: text as a string, frames as bytes. */
  seen: (string | Uint8Array)[];
  /** Forget the room and every socket, as a restart does. The clients are told 1013. */
  restart(): void;
  stop(): void;
}

function recordingRelay(): RecordingRelay {
  const seen: (string | Uint8Array)[] = [];
  let hub: Hub = createHub({ host: "127.0.0.1" });
  interface Data {
    role: Role;
    handler?: Handler;
  }
  const server = Bun.serve<Data>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const p = new URL(req.url).pathname;
      const role: Role | null = p === "/v1/mac" ? "mac" : p === "/v1/device" ? "device" : null;
      if (role === null) return new Response("no", { status: 404 });
      return srv.upgrade(req, { data: { role } }) ? undefined : new Response("no", { status: 426 });
    },
    websocket: {
      open(ws) {
        const conn: Conn = {
          send(data) {
            seen.push(data);
            ws.send(data);
          },
          close(code, reason) {
            ws.close(code, reason);
          },
        };
        ws.data.handler = hub.open(conn, ws.data.role, "127.0.0.1");
      },
      message(ws, message) {
        const data = typeof message === "string" ? message : new Uint8Array(message);
        seen.push(data);
        ws.data.handler?.message(data);
      },
      close(ws) {
        ws.data.handler?.close();
      },
    },
  });
  return {
    port: server.port ?? 0,
    seen,
    restart() {
      const old = hub;
      hub = createHub({ host: "127.0.0.1" });
      old.shutdown();
    },
    stop() {
      hub.shutdown();
      void server.stop(true);
    },
  };
}

// ---- a phone: a P-256 key and a Noise initiator -----------------------------------------------------

class Phone {
  readonly frames: Uint8Array[] = [];
  readonly texts: Record<string, unknown>[] = [];
  closed: number | null = null;
  private waiting: ((frame: Uint8Array) => void)[] = [];
  private sid = globalThis.crypto.getRandomValues(new Uint8Array(4));
  private transport: Transport | null = null;
  h: Uint8Array = none;

  private constructor(
    readonly ws: WebSocket,
    readonly id: Identity,
  ) {}

  static async open(port: number, id: Identity, mac: Identity): Promise<Phone> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/device`);
    ws.binaryType = "arraybuffer";
    const phone = new Phone(ws, id);
    const challenge = new Promise<string>((resolve) => {
      ws.addEventListener("message", (e) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data) as Record<string, unknown>;
          phone.texts.push(msg);
          if (msg["type"] === "challenge") resolve(String(msg["nonce"]));
        } else {
          const frame = new Uint8Array(e.data as ArrayBuffer).slice(5); // 0x01 and the sid
          const waiter = phone.waiting.shift();
          if (waiter) waiter(frame);
          else phone.frames.push(frame);
        }
      });
      ws.addEventListener("close", (e) => {
        phone.closed = e.code;
      });
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("could not connect")));
    });
    const nonce = await challenge;
    const sig = await id.sign(authMessage("device", "127.0.0.1", nonce));
    ws.send(JSON.stringify({ type: "auth", v: 1, key: id.publicKey, sig: toBase64Url(sig), mac: await mac.roomId() }));
    return phone;
  }

  private frame(noise: Uint8Array): void {
    this.ws.send(new Uint8Array([0x01, ...this.sid, ...noise]));
  }

  next(ms = 2000): Promise<Uint8Array> {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no frame arrived")), ms);
      this.waiting.push((f) => {
        clearTimeout(timer);
        resolve(f);
      });
    });
  }

  async handshake(mac: Identity, noisePublic: Uint8Array): Promise<void> {
    const room = fromBase64Url(await roomIdOf(mac.raw)) ?? none;
    const initiator = createInitiator({ prologue: new Uint8Array([...enc.encode("golem-noise-v1"), ...room]), remoteStatic: noisePublic });
    this.frame(await initiator.writeMessage1(none));
    const second = await initiator.readMessage2(await this.next());
    this.transport = second.transport;
    this.h = second.transport.handshakeHash;
  }

  async send(type: number, body: Uint8Array | string, flags = 0): Promise<void> {
    const bytes = typeof body === "string" ? enc.encode(body) : body;
    this.frame(await this.transport!.send.encrypt(none, new Uint8Array([type, flags, ...bytes])));
  }

  async auth(sign?: Uint8Array): Promise<void> {
    const message = new Uint8Array([...enc.encode("golem-auth-v1"), ...this.h]);
    const sig = sign ?? (await this.id.sign(message));
    await this.send(1, JSON.stringify({ type: "auth", v: 1, key: toBase64Url(this.id.raw), sig: toBase64Url(sig) }));
  }

  async receive(): Promise<{ type: number; flags: number; body: string }> {
    const plain = await this.transport!.receive.decrypt(none, await this.next());
    return { type: plain[0] ?? 0, flags: plain[1] ?? 0, body: dec.decode(plain.subarray(2)) };
  }

  /** The next control message. */
  async control(): Promise<Record<string, unknown>> {
    const m = await this.receive();
    expect(m.type).toBe(1);
    return JSON.parse(m.body) as Record<string, unknown>;
  }

  /** The next protocol line, joined from its pieces. */
  async line(): Promise<string> {
    let out = "";
    for (;;) {
      const m = await this.receive();
      expect(m.type).toBe(0);
      out += m.body;
      if ((m.flags & 1) === 0) return out;
    }
  }

  close(): void {
    this.ws.close();
  }
}

// ---- the setup -------------------------------------------------------------------------------------

let dir: string;
let daemon: FakeDaemon;
let relay: RecordingRelay;
let gateway: Gateway;
let phone: Identity;
let phoneId: string;
const phones: Phone[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "golem-rl-"));
  daemon = await fakeDaemon(dir);
  relay = recordingRelay();
  phone = await newIdentity();
  phoneId = hex(await phone.deviceId());
  daemon.url = `ws://127.0.0.1:${relay.port}`;
  daemon.registry.set(phoneId, { key: phone.publicKey, revoked: false });
});

afterEach(async () => {
  for (const p of phones.splice(0)) p.close();
  await gateway?.stop();
  relay.stop();
  await daemon.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function start(): void {
  gateway = startGateway({
    port: 0,
    socketPath: daemon.socketPath,
    token: "x".repeat(43),
    relayOptions: { backoff: { initialMs: 20, maxMs: 80 } },
  });
}

async function connected(): Promise<void> {
  await until(() => gateway.relayState() === "connected", "the relay link");
  // The relay has the allow list once its socket carries the message.
  await until(() => relay.seen.some((m) => typeof m === "string" && m.includes('"allow"')), "the allow message");
  await sleep(20);
}

async function ready(): Promise<Phone> {
  const p = await Phone.open(relay.port, phone, daemon.mac);
  phones.push(p);
  await p.handshake(daemon.mac, daemon.noise.publicKey);
  await p.auth();
  expect(await p.control()).toEqual({ type: "ok", device: phoneId });
  return p;
}

const rpc = (id: number | string, method: string, params: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

// ---- tests -----------------------------------------------------------------------------------------

test("a scripted device sends session.list through the relay and gets the daemon's answer", async () => {
  start();
  await connected();
  const p = await ready();
  await p.send(0, rpc(1, "session.list"));
  const reply = JSON.parse(await p.line()) as { id: number; result: { method: string } };
  expect(reply.id).toBe(1);
  expect(reply.result.method).toBe("session.list");
  // The daemon connection was named for the device before the line arrived, and the line is the phone's own text.
  expect(daemon.identified).toEqual([phoneId]);
  expect(daemon.lines).toEqual([`${phoneId}|${rpc(1, "session.list")}`]);
});

test("a method of the browser list that a device may not call gets the refusal, and the daemon never sees it", async () => {
  start();
  await connected();
  const p = await ready();
  await p.send(0, rpc(7, "auth.set", { token: "x" }));
  const reply = JSON.parse(await p.line()) as { id: number; error: { code: number } };
  expect(reply.id).toBe(7);
  expect(reply.error.code).toBe(-32020);
  // The gateway's own methods and its reserved id prefix are not for a phone either.
  await p.send(0, rpc(8, "connection.identify", { device: "00".repeat(16) }));
  expect((JSON.parse(await p.line()) as { error: { code: number } }).error.code).toBe(-32020);
  await p.send(0, rpc("gw:identify", "ping"));
  expect((JSON.parse(await p.line()) as { error: { code: number } }).error.code).toBe(-32020);
  await p.send(0, rpc(9, "ping"));
  expect((JSON.parse(await p.line()) as { id: number }).id).toBe(9);
  expect(daemon.lines.map((l) => (JSON.parse(l.split("|")[1] ?? "{}") as { method: string }).method)).toEqual(["ping"]);
});

test("a revoked device gets `revoked` and its frames are dropped", async () => {
  // The registry knows the revocation, but the list the relay holds still has the device.
  daemon.registry.get(phoneId)!.revoked = true;
  daemon.listed = () => [{ id: phoneId, key: phone.publicKey }];
  start();
  await connected();
  const p = await Phone.open(relay.port, phone, daemon.mac);
  phones.push(p);
  await p.handshake(daemon.mac, daemon.noise.publicKey);
  await p.auth();
  expect((await p.control())["code"]).toBe("revoked");
  await p.send(0, rpc(1, "session.list"));
  await sleep(100);
  expect(p.frames).toHaveLength(0);
  expect(daemon.lines).toEqual([]);
  expect(daemon.identified).toEqual([]);
});

test("revoking a device with a live session ends it with `revoked` before the relay closes its socket", async () => {
  start();
  await connected();
  const p = await ready();
  daemon.registry.get(phoneId)!.revoked = true;
  daemon.changed();
  expect((await p.control())["code"]).toBe("revoked");
  await until(() => p.closed === 4403, "the relay to cut the device off");
  await p.send(0, rpc(2, "session.list")).catch(() => undefined);
  await sleep(50);
  expect(daemon.lines).toEqual([]);
});

test("a wrong signature gets bad_signature and an unknown device unknown_device", async () => {
  start();
  await connected();
  const p = await Phone.open(relay.port, phone, daemon.mac);
  phones.push(p);
  await p.handshake(daemon.mac, daemon.noise.publicKey);
  await p.auth(new Uint8Array(64).fill(7));
  expect((await p.control())["code"]).toBe("bad_signature");
  expect(daemon.identified).toEqual([]);

  daemon.registry.delete(phoneId);
  const q = await Phone.open(relay.port, phone, daemon.mac);
  phones.push(q);
  await q.handshake(daemon.mac, daemon.noise.publicKey);
  await q.auth();
  expect((await q.control())["code"]).toBe("unknown_device");
});

test("anything before auth ends the session", async () => {
  start();
  await connected();
  const p = await Phone.open(relay.port, phone, daemon.mac);
  phones.push(p);
  await p.handshake(daemon.mac, daemon.noise.publicKey);
  await p.send(0, rpc(1, "session.list"));
  expect((await p.control())["code"]).toBe("bad_message");
  expect(daemon.identified).toEqual([]);
});

test("a relay restart (1013) is followed by a reconnect, a new allow list, and working sessions", async () => {
  start();
  await connected();
  const old = await ready();
  relay.restart();
  await until(() => gateway.relayState() !== "connected", "the link to notice");
  await until(() => gateway.relayState() === "connected", "the link to come back");
  await until(() => relay.seen.filter((m) => typeof m === "string" && m.includes('"allow"')).length >= 2, "the allow message again");
  await sleep(20);
  void old;
  const again = await ready();
  await again.send(0, rpc(3, "session.list"));
  expect((JSON.parse(await again.line()) as { id: number }).id).toBe(3);
});

test("lines larger than a relay frame are cut into pieces and joined, both ways", async () => {
  start();
  await connected();
  const p = await ready();
  const big = rpc(5, "session.rename", { name: "n".repeat(90_000) });
  for (let at = 0; at < big.length; at += 30_000) await p.send(0, big.slice(at, at + 30_000), at + 30_000 < big.length ? 1 : 0);
  await p.send(0, rpc(6, "model.list"));
  expect((JSON.parse(await p.line()) as { id: number }).id).toBe(5);
  const reply = JSON.parse(await p.line()) as { id: number; result: { text: string } };
  expect(reply.result.text.length).toBe(100_000);
  expect(daemon.lines[0]).toBe(`${phoneId}|${big}`);
});

test("the relay never sees a plaintext message", async () => {
  start();
  await connected();
  const p = await ready();
  await p.send(0, rpc(1, "session.list"));
  await p.line();
  await p.send(0, rpc(2, "model.list"));
  await p.line();
  const binary = relay.seen.filter((m): m is Uint8Array => typeof m !== "string");
  const text = relay.seen.filter((m): m is string => typeof m === "string");
  expect(binary.length).toBeGreaterThan(5);
  for (const frame of binary) {
    const asText = dec.decode(frame);
    for (const secret of ["jsonrpc", "session.list", "model.list", "golem-auth", "revoked"]) {
      expect(asText).not.toContain(secret);
    }
    expect(Buffer.from(frame).includes(Buffer.from(daemon.noise.privateKey))).toBe(false);
  }
  // Text is the relay's own protocol: challenges, auth, allow, and peer notices. No message text, no Noise key.
  for (const t of text) {
    const type = (JSON.parse(t) as { type: string }).type;
    expect(["challenge", "auth", "allow", "peer"]).toContain(type);
    expect(t).not.toContain(toBase64Url(daemon.noise.privateKey));
  }
});

test("/healthz reports off with no device, connecting when the relay is down, connected when it is up", async () => {
  daemon.registry.clear();
  start();
  const health = async () => ((await (await fetch(`http://127.0.0.1:${gateway.port}/healthz`)).json()) as { relay: string }).relay;
  await until(() => daemon.syncs > 0, "the first sync");
  await sleep(30);
  expect(await health()).toBe("off");
  daemon.url = null;
  daemon.registry.set(phoneId, { key: phone.publicKey, revoked: false });
  daemon.changed();
  await until(() => daemon.syncs > 1, "the second sync");
  await sleep(30);
  expect(await health()).toBe("off"); // a device, but no [relay] url
  daemon.url = "ws://127.0.0.1:1"; // nobody listens
  daemon.changed();
  await until(async () => (await health()) === "connecting", "connecting");
  daemon.url = `ws://127.0.0.1:${relay.port}`;
  daemon.changed();
  await until(async () => (await health()) === "connected", "connected");
  daemon.registry.clear();
  daemon.changed();
  await until(async () => (await health()) === "off", "off again");
});

test("the backoff doubles from 1 s to 60 s with jitter below the cap", () => {
  const backoff = { initialMs: 1000, maxMs: 60_000 };
  expect([0, 1, 2, 3, 6, 7, 20].map((n) => backoffDelay(n, backoff, () => 0))).toEqual([1000, 2000, 4000, 8000, 60_000, 60_000, 60_000]);
  expect(backoffDelay(0, backoff, () => 1)).toBe(500);
  expect(backoffDelay(10, backoff, () => 1)).toBe(30_000);
});
