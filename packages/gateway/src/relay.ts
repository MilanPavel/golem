// The gateway's outgoing connection to the relay (ADR-051, "The relay protocol"). It runs while
// `[relay] url` is set and a device is paired or a pairing is open, as `device.sync` says. It proves
// the Mac's key with `relay.sign`, sends the `allow` message, and hands each data frame to the
// per-phone sessions. It reconnects with backoff.

import { CLOSE_REPLACED, FRAME_DATA, PROTOCOL_VERSION, authMessage, fromBase64Url, parseMacFrame, toBase64Url } from "../../relay/src/protocol.ts";
import { connectRpc } from "./daemon-rpc.ts";
import type { OpenDaemon, Opening, Rpc } from "./daemon-rpc.ts";
import { DEFAULT_LIMITS, createSessions } from "./device-session.ts";
import type { Log, SessionLimits, Sessions } from "./device-session.ts";

export type RelayState = "connected" | "connecting" | "off";

export interface Backoff {
  initialMs: number;
  maxMs: number;
}

export interface RelayLinkOptions {
  openDaemon: OpenDaemon;
  log?: Log;
  /** Default 1 s doubling to 60 s. */
  backoff?: Partial<Backoff>;
  /** 0 up to 1, for the jitter. Default `Math.random`. */
  random?: () => number;
  /** Seconds since the epoch. Default the clock. */
  now?: () => number;
  limits?: Partial<SessionLimits>;
}

export interface RelayLink {
  state(): RelayState;
  stop(): void;
}

interface Sync {
  url: string;
  room: string;
  /** The room id's 32 bytes, set once checked against `macKey`. */
  roomBytes: Uint8Array;
  macKey: Uint8Array;
  noiseKey: Uint8Array;
  seq: number;
  devices: { id: string; key: string }[];
  pairs: { slot: string; exp: number }[];
}

const DEFAULT_BACKOFF: Backoff = { initialMs: 1000, maxMs: 60_000 };
/** A link that stayed up this long starts the backoff over. */
const STABLE_MS = 10_000;
const PROLOGUE = new TextEncoder().encode("golem-noise-v1");

/** The wait before attempt `attempt` (0 is the first retry): doubling from `initialMs` to `maxMs`, cut by up to half for jitter. */
export function backoffDelay(attempt: number, backoff: Backoff, random: () => number): number {
  const base = Math.min(backoff.maxMs, backoff.initialMs * 2 ** Math.min(attempt, 30));
  return Math.round(base * (1 - 0.5 * random()));
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Read a `device.sync` result. Null for anything that is not one. */
function parseSync(value: unknown): Sync | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const url = v["url"] ?? null;
  const macKey = fromBase64Url(str(v["mac_key"]) ?? "!");
  const noiseKey = fromBase64Url(str(v["noise_key"]) ?? "!");
  const room = str(v["room"]);
  const seq = v["seq"];
  if ((url !== null && typeof url !== "string") || macKey === null || macKey.length !== 65 || noiseKey === null || noiseKey.length !== 32) return null;
  if (room === null || typeof seq !== "number" || !Number.isInteger(seq) || !Array.isArray(v["devices"]) || !Array.isArray(v["pairs"])) return null;
  const devices: Sync["devices"] = [];
  for (const d of v["devices"] as unknown[]) {
    const r = (d ?? {}) as Record<string, unknown>;
    const id = str(r["id"]);
    const key = str(r["key"]);
    if (id === null || key === null) return null;
    devices.push({ id, key });
  }
  const pairs: Sync["pairs"] = [];
  for (const p of v["pairs"] as unknown[]) {
    const r = (p ?? {}) as Record<string, unknown>;
    const slot = str(r["slot"]);
    const exp = r["exp"];
    if (slot === null || typeof exp !== "number") return null;
    pairs.push({ slot, exp });
  }
  return { url: url ?? "", room, roomBytes: new Uint8Array(0), macKey, noiseKey, seq, devices, pairs };
}

/** `wss://host/path` to its `/v1/mac` endpoint and the host name the relay's challenge is signed for. */
function endpoint(url: string): { socket: string; host: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") return null;
    return { socket: `${url.replace(/\/+$/, "")}/v1/mac`, host: parsed.hostname };
  } catch {
    return null;
  }
}

/** Start the relay link. It does nothing until the daemon answers `device.sync`. */
export function startRelayLink(options: RelayLinkOptions): RelayLink {
  const log: Log = options.log ?? (() => undefined);
  const backoff: Backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
  const random = options.random ?? Math.random;
  const nowSeconds = options.now ?? (() => Date.now() / 1000);

  let stopped = false;
  let state: RelayState = "off";
  let rpc: Rpc | null = null;
  let daemonAttempt = 0;
  let daemonTimer: ReturnType<typeof setTimeout> | null = null;
  let connectingDaemon = false;
  let opening: Opening | null = null;
  let sync: Sync | null = null;
  let syncing = false;
  let syncAgain = false;
  let ws: WebSocket | null = null;
  let authed = false;
  let connectedAt = 0;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by 4409: another instance holds the room, so stay down until the registry changes. */
  let replaced = false;
  let linkUrl = "";

  /** Who waits for the owner of a pairing, by pair id. */
  const pairWatchers = new Map<string, (params: Record<string, unknown>) => void>();
  /** How the last pairings ended, so an answer that comes before its watcher is not lost. */
  const pairEnded = new Map<string, Record<string, unknown>>();

  function pairChanged(params: Record<string, unknown>): void {
    const pair = str(params["pair"]);
    if (pair === null) return;
    const state = params["state"];
    if (state === "paired" || state === "expired" || state === "refused") {
      pairEnded.set(pair, params);
      if (pairEnded.size > 8) pairEnded.delete(pairEnded.keys().next().value as string);
    }
    pairWatchers.get(pair)?.(params);
  }

  const sessions: Sessions = createSessions(
    {
      config() {
        if (sync === null) return null;
        return { prologue: concat(PROLOGUE, sync.roomBytes), noisePublic: sync.noiseKey };
      },
      async dh(publicKey) {
        if (rpc === null) throw new Error("the daemon is not connected");
        const reply = (await rpc.call("relay.dh", { public_key: toBase64Url(publicKey) })) as { shared?: unknown };
        const shared = fromBase64Url(str(reply.shared) ?? "!");
        if (shared === null) throw new Error("bad relay.dh result");
        return shared;
      },
      send(deviceId, sid, noiseMessage) {
        if (ws === null || !authed || ws.readyState !== WebSocket.OPEN) return;
        const frame = new Uint8Array(1 + deviceId.length + sid.length + noiseMessage.length);
        frame[0] = FRAME_DATA;
        frame.set(deviceId, 1);
        frame.set(sid, 1 + deviceId.length);
        frame.set(noiseMessage, 1 + deviceId.length + sid.length);
        ws.send(frame);
      },
      buffered: () => ws?.bufferedAmount ?? 0,
      sessionEnded() {
        // A pairing keeps the link up after its code is spent. When it is the last thing, let go.
        if (ws !== null && sessions.count() === 0 && !wanted()) void apply();
      },
      call(method, params) {
        if (rpc === null) return Promise.reject(new Error("the daemon is not connected"));
        return rpc.call(method, params);
      },
      watchPair(pair, listener) {
        const last = pairEnded.get(pair);
        if (last !== undefined) queueMicrotask(() => listener(last));
        pairWatchers.set(pair, listener);
        return () => {
          if (pairWatchers.get(pair) === listener) pairWatchers.delete(pair);
        };
      },
      openDaemon: options.openDaemon,
      log,
    },
    { ...DEFAULT_LIMITS, ...options.limits },
  );

  function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  function wanted(): boolean {
    if (sync === null || sync.url === "") return false;
    if (endpoint(sync.url) === null) return false;
    const t = nowSeconds();
    return sync.devices.length > 0 || sync.pairs.some((p) => p.exp > t) || sessions.count() > 0;
  }

  function setState(next: RelayState): void {
    if (state !== next) log("relay.state", { state: next });
    state = next;
  }

  function schedule(): void {
    if (stopped || retryTimer !== null || ws !== null || !wanted() || replaced) return;
    setState("connecting");
    const wait = backoffDelay(attempt, backoff, random);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  }

  function drop(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    const old = ws;
    ws = null;
    authed = false;
    sessions.endAll();
    if (old !== null) {
      try {
        old.close(1000);
      } catch {
        // Already closed.
      }
    }
  }

  /** Bring the socket in line with what `device.sync` says. */
  async function apply(): Promise<void> {
    if (stopped) return;
    if (sync === null || !wanted()) {
      // The last device may have just been revoked: its session hears why before the link closes.
      if (sync !== null) {
        await sessions.keepOnly(new Set());
        if (authed) sendAllow(); // the relay cuts the sockets of devices that are gone
      }
      drop();
      attempt = 0;
      setState("off");
      return;
    }
    // End a revoked device's sessions, with the reason, before the new list reaches the relay.
    await sessions.keepOnly(new Set(sync.devices.map((d) => d.id)));
    if (stopped || sync === null) return;
    if (ws !== null && sync.url !== linkUrl) {
      // The relay address changed: leave the old one.
      drop();
    }
    if (ws !== null) {
      if (authed) sendAllow();
      return;
    }
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    // A change that makes the condition true connects at once, and starts the backoff over.
    attempt = 0;
    replaced = false;
    connect();
  }

  function sendAllow(): void {
    if (ws === null || sync === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "allow",
        seq: sync.seq,
        devices: sync.devices.map((d) => ({ key: d.key })),
        pairs: sync.pairs.map((p) => ({ slot: p.slot, exp: p.exp })),
      }),
    );
  }

  function connect(): void {
    if (stopped || ws !== null || sync === null) return;
    const target = endpoint(sync.url);
    if (target === null) return;
    setState("connecting");
    linkUrl = sync.url;
    let socket: WebSocket;
    try {
      socket = new WebSocket(target.socket);
    } catch {
      schedule();
      return;
    }
    socket.binaryType = "arraybuffer";
    ws = socket;
    socket.addEventListener("message", (event) => {
      if (ws !== socket) return;
      if (typeof event.data === "string") void control(socket, target.host, event.data);
      else if (authed) frame(new Uint8Array(event.data as ArrayBuffer));
    });
    socket.addEventListener("close", (event) => {
      if (ws !== socket) return;
      ws = null;
      authed = false;
      sessions.endAll(); // a dropped frame would break every Noise stream
      if (Date.now() - connectedAt >= STABLE_MS && connectedAt > 0) attempt = 0;
      connectedAt = 0;
      log("relay.closed", { code: event.code });
      if (event.code === CLOSE_REPLACED) {
        replaced = true;
        setState("off");
        return;
      }
      setState(wanted() ? "connecting" : "off");
      schedule();
    });
    socket.addEventListener("error", () => undefined); // "close" follows
  }

  async function control(socket: WebSocket, host: string, text: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message["type"] === "challenge" && !authed) {
      const nonce = str(message["nonce"]);
      if (nonce === null || sync === null || rpc === null) {
        socket.close(1000);
        return;
      }
      try {
        const signed = (await rpc.call("relay.sign", { message: toBase64Url(authMessage("mac", host, nonce)) })) as { sig?: unknown };
        const sig = str(signed.sig);
        if (sig === null || ws !== socket || sync === null) return;
        socket.send(JSON.stringify({ type: "auth", v: PROTOCOL_VERSION, key: toBase64Url(sync.macKey), sig }));
        authed = true;
        connectedAt = Date.now();
        sendAllow();
        setState("connected");
      } catch {
        // The daemon could not sign. The close that follows starts the backoff.
        if (ws === socket) socket.close(1000);
      }
    } else if (message["type"] === "error") {
      log("relay.error", { code: str(message["code"]) ?? "unknown" });
    }
  }

  function frame(data: Uint8Array): void {
    const parsed = parseMacFrame(data);
    if (parsed === null) return;
    sessions.frame(parsed.deviceId, parsed.sid, parsed.payload);
  }

  /** The room id must be the SHA-256 of the Mac's key, or the prologue would not mean what the phone expects. */
  async function checked(next: Sync | null): Promise<Sync | null> {
    if (next === null) return null;
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", next.macKey as BufferSource));
    const room = fromBase64Url(next.room);
    if (room === null || room.length !== digest.length || !room.every((b, i) => b === digest[i])) {
      log("relay.sync.bad_room");
      return null;
    }
    next.roomBytes = room;
    return next;
  }

  async function refresh(): Promise<void> {
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    try {
      do {
        syncAgain = false;
        if (rpc === null) return;
        let reply: unknown;
        try {
          reply = await rpc.call("device.sync", {});
        } catch {
          return; // keep what we have; the next device.changed or reconnect syncs again
        }
        sync = await checked(parseSync(reply));
        await apply();
      } while (syncAgain && !stopped);
    } finally {
      syncing = false;
    }
  }

  function daemonRetry(): void {
    if (stopped || daemonTimer !== null) return;
    const wait = backoffDelay(daemonAttempt, backoff, random);
    daemonAttempt += 1;
    daemonTimer = setTimeout(() => {
      daemonTimer = null;
      void startDaemon();
    }, wait);
  }

  async function startDaemon(): Promise<void> {
    if (stopped || rpc !== null || connectingDaemon) return;
    connectingDaemon = true;
    try {
      opening = connectRpc(options.openDaemon, {
        notify(method, params) {
          if (method === "device.changed") void refresh();
          else if (method === "device.pair.changed") pairChanged(params);
        },
        down() {
          rpc = null;
          sessions.endAll();
          daemonRetry();
        },
      });
      rpc = await opening.ready;
      opening = null;
      daemonAttempt = 0;
      if (stopped) {
        rpc.close();
        return;
      }
      await refresh();
    } catch {
      opening = null;
      daemonRetry();
    } finally {
      connectingDaemon = false;
    }
  }

  daemonTimer = setTimeout(() => {
    daemonTimer = null;
    void startDaemon();
  }, 0);

  return {
    state: () => state,
    stop() {
      stopped = true;
      if (daemonTimer !== null) clearTimeout(daemonTimer);
      drop();
      opening?.cancel();
      rpc?.close();
      rpc = null;
      setState("off");
    },
  };
}
