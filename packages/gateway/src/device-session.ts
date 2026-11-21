// One paired phone talking to the daemon through the relay (ADR-051): the Noise handshake, the
// `auth` control message checked against the registry, `connection.identify` on a new daemon
// connection, then each line through the device filter to the daemon and back, encrypted.

import { DEVICE_METHODS } from "../../protocol/gen/device-methods.ts";
import { createBridge } from "./bridge.ts";
import type { Bridge } from "./bridge.ts";
import type { DaemonSocket, OpenDaemon } from "./daemon-rpc.ts";
import { MAX_MESSAGE_BYTES, filterMessage } from "./framing.ts";
import { createLineSplitter } from "./lines.ts";
import { createResponder } from "./noise.ts";
import type { Responder, Transport } from "./noise.ts";

export type Log = (event: string, fields?: Record<string, string | number>) => void;

/** What the sessions need from the relay link and the daemon. */
export interface SessionHost {
  /** The room's prologue and the Mac's public Noise key, as of the last `device.sync`. Null before it. */
  config(): { prologue: Uint8Array; noisePublic: Uint8Array } | null;
  /** `relay.dh`: the daemon's Diffie-Hellman with the Mac's Noise key. */
  dh(publicKey: Uint8Array): Promise<Uint8Array>;
  /** Send one Noise message to a device, as a data frame on the Mac's relay socket. */
  send(deviceId: Uint8Array, sid: Uint8Array, noiseMessage: Uint8Array): void;
  /** Bytes queued on the relay socket and not yet written. */
  buffered(): number;
  openDaemon: OpenDaemon;
  log: Log;
}

export interface SessionLimits {
  /** Time from the first handshake message to `ok`. */
  authMs: number;
  /** A connection lives at most this long (ADR-051: 24 hours). */
  lifetimeMs: number;
  maxSessions: number;
  maxPerDevice: number;
}

export const DEFAULT_LIMITS: SessionLimits = {
  authMs: 10_000,
  lifetimeMs: 24 * 60 * 60 * 1000,
  maxSessions: 64,
  maxPerDevice: 4,
};

export interface Sessions {
  /** A data frame from the relay: `0x01 | device id | sid | noise message`, split. */
  frame(deviceId: Uint8Array, sid: Uint8Array, noiseMessage: Uint8Array): void;
  /** End the sessions of every device that is not in `active` (hex ids), with `revoked`. */
  keepOnly(active: ReadonlySet<string>): Promise<void>;
  endAll(): void;
  count(): number;
}

/** Control messages are type 1, protocol lines type 0. */
const TYPE_LINE = 0;
const TYPE_CONTROL = 1;
const FLAG_MORE = 1;
/** Body of one Noise message: a relay frame holds 32 KiB, less the frame head, the type and flags, and the tag. */
const MAX_BODY = 30_000;
const AUTH_CONTEXT = new TextEncoder().encode("golem-auth-v1");
const MAX_ENDED = 256;
const MAX_HANDSHAKE_BYTES = 4096;

const encoder = new TextEncoder();
const none = new Uint8Array(0);

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function fromBase64Url(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function deviceIdOf(key: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", key as BufferSource)).slice(0, 16);
}

async function verifiesAuth(key: Uint8Array, sig: Uint8Array, h: Uint8Array): Promise<boolean> {
  try {
    if (key.length !== 65 || key[0] !== 0x04 || sig.length !== 64) return false;
    const imported = await globalThis.crypto.subtle.importKey(
      "raw",
      key as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const message = new Uint8Array(AUTH_CONTEXT.length + h.length);
    message.set(AUTH_CONTEXT);
    message.set(h, AUTH_CONTEXT.length);
    return await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, imported, sig as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

function deviceFilter(data: string | ArrayBuffer | Uint8Array) {
  return filterMessage(data, { methods: DEVICE_METHODS, reservedIdPrefix: "gw:" });
}

type Phase = "handshake" | "auth" | "identify" | "ready" | "ended";

class Session {
  private phase: Phase = "handshake";
  private responder: Responder | null = null;
  private transport: Transport | null = null;
  private deviceHex: string | null = null;
  private inChain: Promise<void> = Promise.resolve();
  private outChain: Promise<void> = Promise.resolve();
  private pieces: Uint8Array[] = [];
  private pieceBytes = 0;
  private daemon: DaemonSocket | null = null;
  private bridge: Bridge | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private readonly host: SessionHost,
    private readonly deviceId: Uint8Array,
    private readonly sid: Uint8Array,
    private readonly limits: SessionLimits,
    private readonly done: (session: Session) => void,
  ) {
    this.timers.push(setTimeout(() => this.timeout(), limits.authMs));
    this.timers.push(setTimeout(() => this.end(), limits.lifetimeMs));
  }

  get device(): string {
    return hex(this.deviceId);
  }

  get active(): boolean {
    return this.phase !== "ended";
  }

  /** Queue a Noise message. They are handled one at a time, in the order they arrived. */
  push(message: Uint8Array): void {
    this.inChain = this.inChain.then(() => this.receive(message)).catch(() => this.end());
  }

  private timeout(): void {
    if (this.phase !== "ready") this.end();
  }

  private async receive(message: Uint8Array): Promise<void> {
    switch (this.phase) {
      case "handshake":
        return this.handshake(message);
      case "auth":
        return this.authMessage(await this.open(message));
      case "ready":
        return this.readyMessage(await this.open(message));
      case "identify":
        return this.fail("bad_message", "wait for ok");
      case "ended":
        return;
    }
  }

  private async handshake(message: Uint8Array): Promise<void> {
    const config = this.host.config();
    if (config === null || message.length < 48 || message.length > MAX_HANDSHAKE_BYTES) {
      this.end();
      return;
    }
    const responder = createResponder({
      prologue: config.prologue,
      staticPublic: config.noisePublic,
      dh: (pub) => this.host.dh(pub),
    });
    this.responder = responder;
    await responder.readMessage1(message);
    const reply = await responder.writeMessage2(none);
    this.responder = null;
    this.transport = reply.transport;
    this.phase = "auth";
    this.host.send(this.deviceId, this.sid, reply.message);
  }

  /** Decrypt one transport message into its type, flags, and body. Ends the session when it fails. */
  private async open(message: Uint8Array): Promise<{ type: number; flags: number; body: Uint8Array }> {
    if (this.transport === null) throw new Error("no transport");
    const plain = await this.transport.receive.decrypt(none, message);
    if (plain.length < 2) throw new Error("short message");
    return { type: plain[0] ?? 0, flags: plain[1] ?? 0, body: plain.subarray(2) };
  }

  private control(body: Uint8Array): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private async authMessage(m: { type: number; flags: number; body: Uint8Array }): Promise<void> {
    const msg = m.type === TYPE_CONTROL && m.flags === 0 ? this.control(m.body) : null;
    if (msg === null || msg["type"] !== "auth" || msg["v"] !== 1) {
      await this.fail("bad_message", "expected auth");
      return;
    }
    const key = fromBase64Url(msg["key"]);
    const sig = fromBase64Url(msg["sig"]);
    const h = this.transport?.handshakeHash;
    if (key === null || sig === null || h === undefined || !(await verifiesAuth(key, sig, h))) {
      await this.fail("bad_signature", "the signature does not fit");
      return;
    }
    if (!sameBytes(await deviceIdOf(key), this.deviceId)) {
      await this.fail("unknown_device", "the key is not the device the relay named");
      return;
    }
    this.deviceHex = hex(this.deviceId);
    this.phase = "identify";
    this.identify(this.deviceHex);
  }

  /** Open a daemon connection and name the device on it. Its reply is not passed on. */
  private identify(device: string): void {
    const splitter = createLineSplitter();
    let identified = false;
    const socket = this.host.openDaemon({
      open: () => {
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: "gw:identify", method: "connection.identify", params: { device } })}\n`);
      },
      data: (chunk) => {
        if (identified) {
          this.bridge?.daemonData(chunk);
          return;
        }
        const lines = splitter.push(chunk);
        const first = lines.shift();
        if (first === undefined) return;
        identified = true;
        void this.identified(first, lines);
      },
      close: () => {
        if (!identified) void this.fail("daemon_unavailable", "the daemon closed the connection");
        else this.bridge?.daemonClosed();
      },
      error: () => {
        if (!identified) void this.fail("daemon_unavailable", "the daemon is not running");
        else this.bridge?.daemonFailed();
      },
    });
    this.daemon = socket;
    if (this.phase === "ended") socket.destroy();
  }

  private async identified(first: string, rest: string[]): Promise<void> {
    let reply: Record<string, unknown> = {};
    try {
      reply = JSON.parse(first) as Record<string, unknown>;
    } catch {
      // handled as a failure below
    }
    if (this.phase !== "identify") return;
    if (reply["id"] !== "gw:identify" || reply["result"] === undefined) {
      const error = (reply["error"] ?? {}) as { data?: { reason?: unknown } };
      const reason = error.data?.reason;
      if (reason === "revoked") await this.fail("revoked", "this device was revoked");
      else if (reason === "unknown_device") await this.fail("unknown_device", "this device is not paired");
      else await this.fail("daemon_unavailable", "the daemon refused the device");
      return;
    }
    const socket = this.daemon;
    if (socket === null) return;
    const bridge = createBridge(
      {
        toBrowser: (line) => void this.sendLine(line),
        browserBuffered: () => this.host.buffered(),
        closeBrowser: (code) => void this.bridgeClosed(code),
        toDaemon: (line) => void socket.write(line),
        daemonBacklog: () => socket.backlog(),
        closeDaemon: () => socket.destroy(),
        pauseDaemon: () => {
          socket.pause();
          this.poll ??= setInterval(() => this.bridge?.browserDrain(), 100);
        },
        resumeDaemon: () => {
          socket.resume();
          if (this.poll !== null) clearInterval(this.poll);
          this.poll = null;
        },
      },
      { filter: deviceFilter },
    );
    this.bridge = bridge;
    this.phase = "ready";
    await this.sendControl({ type: "ok", device: this.deviceHex });
    bridge.daemonOpen();
    for (const line of rest) bridge.daemonData(encoder.encode(`${line}\n`));
    this.host.log("session.ready", { device: this.device.slice(0, 8) });
  }

  private async bridgeClosed(code: number): Promise<void> {
    if (code === 1013) await this.fail("daemon_unavailable", "the daemon is not running");
    else if (code === 1008) await this.fail("bad_message", "the message was refused");
    else this.end();
  }

  private async readyMessage(m: { type: number; flags: number; body: Uint8Array }): Promise<void> {
    if (m.type !== TYPE_LINE) {
      await this.fail("bad_message", "unexpected control message");
      return;
    }
    this.pieces.push(m.body.slice());
    this.pieceBytes += m.body.length;
    if (this.pieceBytes > MAX_MESSAGE_BYTES) {
      await this.fail("bad_message", "the line is too long");
      return;
    }
    if ((m.flags & FLAG_MORE) !== 0) return;
    const whole = new Uint8Array(this.pieceBytes);
    let at = 0;
    for (const piece of this.pieces) {
      whole.set(piece, at);
      at += piece.length;
    }
    this.pieces = [];
    this.pieceBytes = 0;
    let line: string;
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(whole);
    } catch {
      await this.fail("bad_message", "the line is not UTF-8");
      return;
    }
    this.bridge?.browserMessage(line);
  }

  // ---- sending ----

  private async sendLine(line: string): Promise<void> {
    const bytes = encoder.encode(line);
    // Every piece is queued before anything awaits, so the pieces of two lines never interleave.
    const queued: Promise<void>[] = [];
    for (let at = 0; at === 0 || at < bytes.length; at += MAX_BODY) {
      const part = bytes.subarray(at, at + MAX_BODY);
      const more = at + MAX_BODY < bytes.length;
      queued.push(this.sendMessage(TYPE_LINE, more ? FLAG_MORE : 0, part));
    }
    await Promise.all(queued);
  }

  private sendControl(value: Record<string, unknown>): Promise<void> {
    return this.sendMessage(TYPE_CONTROL, 0, encoder.encode(JSON.stringify(value)));
  }

  /** Encrypt and send in order, one message at a time, so the nonces and the frames keep the same order. */
  private sendMessage(type: number, flags: number, body: Uint8Array): Promise<void> {
    const transport = this.transport;
    if (transport === null || this.phase === "ended") return Promise.resolve();
    const plain = new Uint8Array(2 + body.length);
    plain[0] = type;
    plain[1] = flags;
    plain.set(body, 2);
    const run = this.outChain.then(async () => {
      if (this.phase === "ended") return;
      this.host.send(this.deviceId, this.sid, await transport.send.encrypt(none, plain));
    });
    this.outChain = run.catch(() => this.end());
    return this.outChain;
  }

  /** The registry no longer lists this device. A session that has not named its device yet is checked by `identify`. */
  async revoke(): Promise<void> {
    if (this.phase === "identify" || this.phase === "ready") await this.fail("revoked", "this device was revoked");
  }

  /** Tell the phone why, then forget the keys. */
  private async fail(code: string, message: string): Promise<void> {
    if (this.phase === "ended") return;
    if (this.transport !== null) {
      // Send before the phase changes: sendMessage skips an ended session.
      const sent = this.sendControl({ type: "error", code, message });
      await sent.catch(() => undefined);
    }
    this.host.log("session.fail", { device: this.device.slice(0, 8), code });
    this.end();
  }

  end(): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    for (const t of this.timers) clearTimeout(t);
    if (this.poll !== null) clearInterval(this.poll);
    this.bridge?.browserClosed();
    this.daemon?.destroy();
    this.responder = null;
    this.transport = null; // the keys are forgotten
    this.pieces = [];
    this.done(this);
  }
}

/** The table of live sessions, keyed by device id and sid. */
export function createSessions(host: SessionHost, limits: SessionLimits = DEFAULT_LIMITS): Sessions {
  const live = new Map<string, Session>();
  const ended = new Set<string>();

  function remember(key: string): void {
    ended.add(key);
    if (ended.size > MAX_ENDED) ended.delete(ended.values().next().value as string);
  }

  return {
    frame(deviceId, sid, message) {
      const key = `${hex(deviceId)}:${hex(sid)}`;
      let session = live.get(key);
      if (session === undefined) {
        // A session that ended stays ended: its frames are dropped, and the phone starts again with a new sid.
        if (ended.has(key) || live.size >= limits.maxSessions) return;
        const own = [...live.values()].filter((s) => s.device === hex(deviceId)).length;
        if (own >= limits.maxPerDevice) return;
        session = new Session(host, deviceId, sid, limits, () => {
          live.delete(key);
          remember(key);
        });
        live.set(key, session);
      }
      session.push(message);
    },
    async keepOnly(active) {
      await Promise.all([...live.values()].filter((s) => !active.has(s.device)).map((s) => s.revoke()));
    },
    endAll() {
      for (const s of [...live.values()]) s.end();
    },
    count() {
      return live.size;
    },
  };
}
