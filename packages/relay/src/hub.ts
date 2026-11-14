import { randomSecret } from "../../gateway/src/secret.ts";
import { createBucket, createIpGate } from "./limits.ts";
import type { Bucket, IpGate } from "./limits.ts";
import { prefixOf, silentLogger } from "./log.ts";
import type { Logger } from "./log.ts";
import {
  CLOSE_BAD_MESSAGE,
  CLOSE_IDLE,
  CLOSE_NOT_AUTHENTICATED,
  CLOSE_RATE_LIMITED,
  CLOSE_REPLACED,
  CLOSE_REVOKED,
  CLOSE_TOO_BIG,
  CLOSE_TRY_LATER,
  MAX_CONTROL_BYTES,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  authMessage,
  deviceIdOf,
  fromBase64Url,
  parseDeviceFrame,
  parseMacFrame,
  roomIdOf,
  toBase64Url,
  toDeviceFrame,
  toMacFrame,
} from "./protocol.ts";
import type { Role } from "./protocol.ts";
import { createQueue } from "./queue.ts";
import type { FrameQueue } from "./queue.ts";

/** One WebSocket, as the hub sees it. The adapter wraps the runtime's socket in this. */
export interface Conn {
  send(data: string | Uint8Array): void;
  close(code: number, reason?: string): void;
}

/** What the adapter calls for one connection. */
export interface Handler {
  message(data: string | Uint8Array): void;
  /** Any sign of life, such as a WebSocket ping or pong. */
  touch(): void;
  close(): void;
}

export interface HubOptions {
  /** The relay's host name, as clients sign it. */
  host: string;
  now?: () => number;
  log?: Logger;
  authTimeoutMs?: number;
  idleMs?: number;
  queueTtlMs?: number;
  maxQueueFrames?: number;
  maxQueueBytes?: number;
  maxDevices?: number;
  maxSocketsPerDevice?: number;
  ipPerMinute?: number;
  ipOpen?: number;
  framesPerSecond?: number;
  frameBurst?: number;
  bytesPerSecond?: number;
  /** Most live sockets in all. */
  maxSockets?: number;
  /** How long a room with nobody in it keeps its allow list. */
  roomTtlMs?: number;
}

type Settings = Required<Omit<HubOptions, "log" | "now">>;

const DEFAULTS: Omit<Settings, "host"> = {
  authTimeoutMs: 5_000,
  idleMs: 60_000,
  queueTtlMs: 60_000,
  maxQueueFrames: 64,
  maxQueueBytes: 512 * 1024,
  maxDevices: 16,
  maxSocketsPerDevice: 2,
  ipPerMinute: 10,
  ipOpen: 20,
  framesPerSecond: 100,
  frameBurst: 200,
  bytesPerSecond: 1024 * 1024,
  maxSockets: 10_000,
  roomTtlMs: 10 * 60_000,
};

interface Session {
  conn: Conn;
  role: Role;
  ip: string;
  nonce: string;
  authed: boolean;
  closed: boolean;
  room?: Room;
  /** A device's id, base64url. */
  deviceId?: string;
  deviceIdBytes?: Uint8Array;
  frames: Bucket;
  bytes: Bucket;
  sids: Set<string>;
  lastSeen: number;
  authTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  chain: Promise<void>;
  /** The newest `allow` seq this Mac socket sent. */
  seq: number;
}

interface Room {
  id: string;
  mac?: Session;
  /** Device ids (base64url) the Mac listed. Null until the first `allow` of this relay's life. */
  allow: Set<string> | null;
  devices: Map<string, Session[]>;
  toMac: FrameQueue;
  toDevice: Map<string, FrameQueue>;
  lastActive: number;
}

export interface Hub {
  open(conn: Conn, role: Role, ip: string): Handler;
  /** Drop empty rooms and expired frames. The adapter calls it now and then. */
  sweep(): void;
  stats(): { rooms: number; sockets: number };
  /** Every frame held in a queue, for tests that look for plaintext in memory. */
  heldFrames(): Uint8Array[];
  /** Close every socket, as on shutdown. */
  shutdown(): void;
}

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

async function verifies(rawKey: Uint8Array, sig: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    if (rawKey.length !== 65 || rawKey[0] !== 0x04 || sig.length !== 64) return false;
    const key = await globalThis.crypto.subtle.importKey("raw", rawKey as BufferSource, P256, false, ["verify"]);
    return await globalThis.crypto.subtle.verify(SIGN, key, sig as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}

function asRecord(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createHub(options: HubOptions): Hub {
  const cfg: Settings = { ...DEFAULTS, ...stripUndefined(options), host: options.host };
  const now = options.now ?? Date.now;
  const log = options.log ?? silentLogger;
  const rooms = new Map<string, Room>();
  const gate: IpGate = createIpGate(cfg.ipPerMinute, cfg.ipOpen);
  const sessions = new Set<Session>();

  function newQueue(): FrameQueue {
    return createQueue({ ttlMs: cfg.queueTtlMs, maxFrames: cfg.maxQueueFrames, maxBytes: cfg.maxQueueBytes });
  }

  function send(s: Session, data: string | Uint8Array): void {
    if (s.closed) return;
    try {
      s.conn.send(data);
    } catch {
      end(s, CLOSE_TRY_LATER);
    }
  }

  function sendJson(s: Session, value: unknown): void {
    send(s, JSON.stringify(value));
  }

  function end(s: Session, code: number): void {
    if (s.closed) return;
    log.event("close", { role: s.role, room: s.room ? prefixOf(s.room.id) : undefined, device: s.deviceId ? prefixOf(s.deviceId) : undefined, code });
    try {
      s.conn.close(code);
    } catch {
      // The socket is already gone.
    }
    detach(s);
  }

  function detach(s: Session): void {
    if (s.closed) return;
    s.closed = true;
    clearTimeout(s.authTimer);
    clearTimeout(s.idleTimer);
    sessions.delete(s);
    if (!s.authed) gate.release(s.ip);
    const room = s.room;
    if (!room || !s.authed) return;
    room.lastActive = now();
    if (s.role === "mac") {
      if (room.mac !== s) return;
      room.mac = undefined;
      for (const list of room.devices.values()) {
        for (const d of list) sendJson(d, { type: "peer", state: "offline" });
      }
    } else if (s.deviceId !== undefined) {
      const list = (room.devices.get(s.deviceId) ?? []).filter((d) => d !== s);
      if (list.length > 0) {
        room.devices.set(s.deviceId, list);
      } else {
        room.devices.delete(s.deviceId);
        if (room.mac) sendJson(room.mac, { type: "peer", device: s.deviceId, state: "offline" });
      }
    }
  }

  function armIdle(s: Session): void {
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => {
      const quiet = now() - s.lastSeen;
      if (quiet >= cfg.idleMs) end(s, CLOSE_IDLE);
      else armIdle(s);
    }, cfg.idleMs);
  }

  function touch(s: Session): void {
    s.lastSeen = now();
  }

  function roomFor(id: string): Room {
    let room = rooms.get(id);
    if (!room) {
      room = { id, allow: null, devices: new Map(), toMac: newQueue(), toDevice: new Map(), lastActive: now() };
      rooms.set(id, room);
    }
    return room;
  }

  async function authenticate(s: Session, msg: Record<string, unknown>): Promise<void> {
    if (msg["type"] !== "auth" || (msg["v"] !== undefined && msg["v"] !== PROTOCOL_VERSION)) {
      end(s, CLOSE_BAD_MESSAGE);
      return;
    }
    const key = typeof msg["key"] === "string" ? fromBase64Url(msg["key"]) : null;
    const sig = typeof msg["sig"] === "string" ? fromBase64Url(msg["sig"]) : null;
    if (!key || !sig || !(await verifies(key, sig, authMessage(s.role, cfg.host, s.nonce)))) {
      end(s, CLOSE_NOT_AUTHENTICATED);
      return;
    }
    if (s.closed) return;
    if (s.role === "mac") {
      await admitMac(s, key);
    } else {
      await admitDevice(s, key, msg["mac"]);
    }
  }

  function markAuthed(s: Session, room: Room): void {
    s.authed = true;
    s.room = room;
    clearTimeout(s.authTimer);
    gate.release(s.ip);
    room.lastActive = now();
  }

  async function admitMac(s: Session, key: Uint8Array): Promise<void> {
    const room = roomFor(await roomIdOf(key));
    if (s.closed) return;
    if (room.mac) end(room.mac, CLOSE_REPLACED);
    room.mac = s;
    markAuthed(s, room);
    log.event("connect", { role: "mac", room: prefixOf(room.id) });
    for (const list of room.devices.values()) {
      for (const d of list) sendJson(d, { type: "peer", state: "online" });
    }
    for (const id of room.devices.keys()) sendJson(s, { type: "peer", device: id, state: "online" });
    for (const frame of room.toMac.drain(now())) send(s, frame);
  }

  async function admitDevice(s: Session, key: Uint8Array, roomId: unknown): Promise<void> {
    const room = typeof roomId === "string" ? rooms.get(roomId) : undefined;
    if (!room || room.allow === null) {
      // No list yet: the relay may have just restarted. Try again, do not "pair again".
      end(s, CLOSE_TRY_LATER);
      return;
    }
    const idBytes = await deviceIdOf(key);
    const id = toBase64Url(idBytes);
    if (s.closed) return;
    if (!room.allow.has(id)) {
      end(s, CLOSE_NOT_AUTHENTICATED);
      return;
    }
    const list = room.devices.get(id) ?? [];
    while (list.length >= cfg.maxSocketsPerDevice) end(list.shift()!, CLOSE_REPLACED);
    s.deviceId = id;
    s.deviceIdBytes = idBytes;
    list.push(s);
    room.devices.set(id, list);
    markAuthed(s, room);
    log.event("connect", { role: "device", room: prefixOf(room.id), device: prefixOf(id) });
    sendJson(s, { type: "peer", state: room.mac ? "online" : "offline" });
    if (room.mac) sendJson(room.mac, { type: "peer", device: id, state: "online" });
    const queued = room.toDevice.get(id);
    if (queued) for (const frame of queued.drain(now())) send(s, frame);
  }

  async function onAllow(s: Session, room: Room, msg: Record<string, unknown>): Promise<void> {
    const seq = msg["seq"];
    const devices = msg["devices"];
    if (typeof seq !== "number" || !Number.isInteger(seq) || !Array.isArray(devices)) {
      end(s, CLOSE_BAD_MESSAGE);
      return;
    }
    if (seq < s.seq) return;
    if (devices.length > cfg.maxDevices) {
      sendJson(s, { type: "error", code: "too_many_devices" });
      return;
    }
    const ids = new Set<string>();
    for (const entry of devices) {
      const raw = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)["key"] : undefined;
      const key = typeof raw === "string" ? fromBase64Url(raw) : null;
      if (!key || key.length !== 65) {
        sendJson(s, { type: "error", code: "bad_key" });
        return;
      }
      ids.add(toBase64Url(await deviceIdOf(key)));
    }
    if (s.closed || room.mac !== s || seq < s.seq) return;
    s.seq = seq;
    room.allow = ids;
    let revoked = 0;
    for (const [id, list] of [...room.devices]) {
      if (ids.has(id)) continue;
      for (const d of list) end(d, CLOSE_REVOKED);
      revoked += list.length;
    }
    for (const id of [...room.toDevice.keys()]) if (!ids.has(id)) room.toDevice.delete(id);
    log.event("allow", { room: prefixOf(room.id), count: ids.size });
    if (revoked > 0) log.event("revoke", { room: prefixOf(room.id), count: revoked });
  }

  function fromDevice(s: Session, room: Room, data: Uint8Array): void {
    const frame = parseDeviceFrame(data);
    if (!frame || s.deviceIdBytes === undefined) {
      end(s, CLOSE_BAD_MESSAGE);
      return;
    }
    s.sids.add(toBase64Url(frame.sid));
    if (s.sids.size > 16) s.sids.delete(s.sids.values().next().value as string);
    const out = toMacFrame(s.deviceIdBytes, frame);
    if (room.mac) send(room.mac, out);
    else room.toMac.push(out, now());
  }

  function fromMac(s: Session, room: Room, data: Uint8Array): void {
    const frame = parseMacFrame(data);
    if (!frame) {
      end(s, CLOSE_BAD_MESSAGE);
      return;
    }
    const id = toBase64Url(frame.deviceId);
    if (!room.allow?.has(id)) return;
    const out = toDeviceFrame(frame);
    const sockets = room.devices.get(id) ?? [];
    const sid = toBase64Url(frame.sid);
    const target = sockets.find((d) => d.sids.has(sid)) ?? sockets[sockets.length - 1];
    if (target) {
      send(target, out);
      return;
    }
    let queue = room.toDevice.get(id);
    if (!queue) {
      queue = newQueue();
      room.toDevice.set(id, queue);
    }
    queue.push(out, now());
  }

  async function handle(s: Session, data: string | Uint8Array): Promise<void> {
    if (s.closed) return;
    if (!s.authed) {
      const msg = typeof data === "string" ? asRecord(data) : null;
      if (!msg) end(s, CLOSE_BAD_MESSAGE);
      else await authenticate(s, msg);
      return;
    }
    const room = s.room;
    if (!room) return;
    if (typeof data !== "string") {
      if (s.role === "mac") fromMac(s, room, data);
      else fromDevice(s, room, data);
      return;
    }
    const msg = asRecord(data);
    if (!msg) {
      end(s, CLOSE_BAD_MESSAGE);
    } else if (s.role === "mac" && msg["type"] === "allow") {
      await onAllow(s, room, msg);
    } else if (s.role === "mac" && msg["type"] === "push") {
      // Pushes arrive with ticket 14.2.3. Until then the relay says so plainly.
      sendJson(s, { type: "push_result", ok: false, reason: "push_not_configured" });
    } else {
      end(s, CLOSE_BAD_MESSAGE);
    }
  }

  return {
    open(conn, role, ip) {
      const t = now();
      const s: Session = {
        conn,
        role,
        ip,
        nonce: randomSecret(),
        authed: false,
        closed: false,
        frames: createBucket(cfg.framesPerSecond, cfg.frameBurst, t),
        bytes: createBucket(cfg.bytesPerSecond, cfg.bytesPerSecond, t),
        sids: new Set(),
        lastSeen: t,
        chain: Promise.resolve(),
        seq: -1,
      };
      const handler: Handler = {
        message(data) {
          if (s.closed) return;
          touch(s);
          const size = typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
          if (size > (typeof data === "string" ? MAX_CONTROL_BYTES : MAX_FRAME_BYTES)) {
            end(s, CLOSE_TOO_BIG);
            return;
          }
          if (!s.frames.take(1, now()) || !s.bytes.take(size, now())) {
            end(s, CLOSE_RATE_LIMITED);
            return;
          }
          s.chain = s.chain.then(() => handle(s, data)).catch(() => end(s, CLOSE_BAD_MESSAGE));
        },
        touch() {
          touch(s);
        },
        close() {
          detach(s);
        },
      };
      if (sessions.size >= cfg.maxSockets) {
        log.event("full", { role, count: sessions.size });
        s.closed = true;
        conn.close(CLOSE_TRY_LATER);
        return handler;
      }
      if (!gate.admit(ip, t)) {
        log.event("limit", { role, code: CLOSE_RATE_LIMITED });
        s.closed = true;
        conn.close(CLOSE_RATE_LIMITED);
        return handler;
      }
      sessions.add(s);
      s.authTimer = setTimeout(() => end(s, CLOSE_NOT_AUTHENTICATED), cfg.authTimeoutMs);
      armIdle(s);
      conn.send(JSON.stringify({ type: "challenge", v: PROTOCOL_VERSION, nonce: s.nonce }));
      return handler;
    },
    sweep() {
      const t = now();
      for (const [id, room] of rooms) {
        room.toMac.prune(t);
        for (const [dev, q] of room.toDevice) {
          q.prune(t);
          if (q.frames === 0 && !room.devices.has(dev)) room.toDevice.delete(dev);
        }
        const empty = !room.mac && room.devices.size === 0;
        if (empty && t - room.lastActive >= cfg.roomTtlMs) rooms.delete(id);
      }
    },
    stats() {
      return { rooms: rooms.size, sockets: sessions.size };
    },
    heldFrames() {
      const out: Uint8Array[] = [];
      for (const room of rooms.values()) {
        out.push(...room.toMac.peek());
        for (const q of room.toDevice.values()) out.push(...q.peek());
      }
      return out;
    },
    shutdown() {
      for (const s of [...sessions]) end(s, CLOSE_TRY_LATER);
    },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
