// The relay protocol of ADR-051: close codes, limits, the data-frame layout, and the key encodings.

export const PROTOCOL_VERSION = 1;

export const CLOSE_BAD_MESSAGE = 4400;
export const CLOSE_NOT_AUTHENTICATED = 4401;
export const CLOSE_REVOKED = 4403;
export const CLOSE_IDLE = 4408;
export const CLOSE_REPLACED = 4409;
export const CLOSE_TOO_BIG = 4413;
export const CLOSE_RATE_LIMITED = 4429;
export const CLOSE_TRY_LATER = 1013;

/** The largest data frame, in bytes, as the relay receives it. */
export const MAX_FRAME_BYTES = 32 * 1024;
/** The largest control message (text), in bytes. */
export const MAX_CONTROL_BYTES = 16 * 1024;

export const FRAME_DATA = 0x01;
export const DEVICE_ID_BYTES = 16;
export const SID_BYTES = 4;

export type Role = "mac" | "device";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Decode base64url without padding. Null for anything else. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The message a client signs: "golem-relay-v1\0" + role + relay host + nonce, as UTF-8. */
export function authMessage(role: Role, host: string, nonce: string): Uint8Array {
  return encoder.encode(`golem-relay-v1\0${role}${host}${nonce}`);
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** SHA-256 of a public key, which is a Mac's room id (all 32 bytes) and a device's id (the first 16). */
export async function keyHash(rawKey: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", rawKey as BufferSource));
}

export async function roomIdOf(rawKey: Uint8Array): Promise<string> {
  return toBase64Url(await keyHash(rawKey));
}

export async function deviceIdOf(rawKey: Uint8Array): Promise<Uint8Array> {
  return (await keyHash(rawKey)).slice(0, DEVICE_ID_BYTES);
}

export interface DeviceFrame {
  sid: Uint8Array;
  payload: Uint8Array;
}

/** device to relay: 0x01 | sid | noise message. Null when the layout is wrong. */
export function parseDeviceFrame(data: Uint8Array): DeviceFrame | null {
  if (data.length <= 1 + SID_BYTES || data[0] !== FRAME_DATA) return null;
  return { sid: data.slice(1, 1 + SID_BYTES), payload: data.slice(1 + SID_BYTES) };
}

export interface MacFrame {
  deviceId: Uint8Array;
  sid: Uint8Array;
  payload: Uint8Array;
}

/** Mac to relay: 0x01 | device id | sid | noise message. Null when the layout is wrong. */
export function parseMacFrame(data: Uint8Array): MacFrame | null {
  const head = 1 + DEVICE_ID_BYTES + SID_BYTES;
  if (data.length <= head || data[0] !== FRAME_DATA) return null;
  return {
    deviceId: data.slice(1, 1 + DEVICE_ID_BYTES),
    sid: data.slice(1 + DEVICE_ID_BYTES, head),
    payload: data.slice(head),
  };
}

/** relay to Mac: 0x01 | device id | sid | noise message. */
export function toMacFrame(deviceId: Uint8Array, frame: DeviceFrame): Uint8Array {
  const out = new Uint8Array(1 + DEVICE_ID_BYTES + SID_BYTES + frame.payload.length);
  out[0] = FRAME_DATA;
  out.set(deviceId, 1);
  out.set(frame.sid, 1 + DEVICE_ID_BYTES);
  out.set(frame.payload, 1 + DEVICE_ID_BYTES + SID_BYTES);
  return out;
}

/** relay to device: 0x01 | sid | noise message. */
export function toDeviceFrame(frame: MacFrame): Uint8Array {
  const out = new Uint8Array(1 + SID_BYTES + frame.payload.length);
  out[0] = FRAME_DATA;
  out.set(frame.sid, 1);
  out.set(frame.payload, 1 + SID_BYTES);
  return out;
}
