import { authMessage, deviceIdOf, roomIdOf, toBase64Url } from "./protocol.ts";
import type { Conn, Handler, Hub } from "./hub.ts";
import type { Role } from "./protocol.ts";

/** A client identity for tests: a real P-256 key pair. */
export interface Identity {
  raw: Uint8Array;
  publicKey: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
  /** The room id of a Mac, or the device id of a phone (base64url). */
  roomId(): Promise<string>;
  deviceId(): Promise<Uint8Array>;
}

export async function newIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    raw,
    publicKey: toBase64Url(raw),
    async sign(message) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message as BufferSource));
    },
    roomId: () => roomIdOf(raw),
    deviceId: () => deviceIdOf(raw),
  };
}

/** What a test sees of one connection to the hub. */
export interface TestSocket {
  handler: Handler;
  sent: (string | Uint8Array)[];
  closed: number | null;
  json(): Record<string, unknown>[];
  binary(): Uint8Array[];
  challenge(): string;
  send(data: string | Uint8Array): void;
  /** Answer the relay's challenge. Extra fields (such as `mac`) go in `extra`. */
  auth(id: Identity, extra?: Record<string, unknown>, role?: Role): Promise<void>;
}

export function connect(hub: Hub, role: Role, host: string, ip = "10.0.0.1"): TestSocket {
  const sent: (string | Uint8Array)[] = [];
  const socket = { closed: null as number | null };
  const conn: Conn = {
    send(data) {
      sent.push(data);
    },
    close(code) {
      if (socket.closed === null) socket.closed = code;
    },
  };
  const handler = hub.open(conn, role, ip);
  const out: TestSocket = {
    handler,
    sent,
    get closed() {
      return socket.closed;
    },
    json() {
      return sent.filter((m): m is string => typeof m === "string").map((m) => JSON.parse(m) as Record<string, unknown>);
    },
    binary() {
      return sent.filter((m): m is Uint8Array => typeof m !== "string");
    },
    challenge() {
      const first = out.json()[0];
      return String(first?.["nonce"]);
    },
    send(data) {
      handler.message(data);
    },
    async auth(id, extra = {}, as = role) {
      const sig = await id.sign(authMessage(as, host, out.challenge()));
      out.send(JSON.stringify({ type: "auth", v: 1, key: id.publicKey, sig: toBase64Url(sig), ...extra }));
    },
  };
  return out;
}

/** Wait until `check` holds, or fail after a second. */
export async function until(check: () => boolean, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 1000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2));
  }
}

export function deviceFrame(sid: number[], payload: Uint8Array): Uint8Array {
  return new Uint8Array([0x01, ...sid, ...payload]);
}

export function macFrame(deviceId: Uint8Array, sid: number[], payload: Uint8Array): Uint8Array {
  return new Uint8Array([0x01, ...deviceId, ...sid, ...payload]);
}
