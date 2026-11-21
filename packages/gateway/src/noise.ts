// Noise_NK_25519_AESGCM_SHA256 (Noise spec revision 34), by hand on node:crypto (X25519) and WebCrypto
// (AES-256-GCM, SHA-256, HMAC). ADR-051. The responder's static private key is never here: the
// responder takes a `dh(publicKey)` function, which the gateway backs with the daemon's `relay.dh`.
//
//   NK:  <- s
//        ...
//        -> e, es
//        <- e, ee

import { createPrivateKey, createPublicKey, diffieHellman, timingSafeEqual } from "node:crypto";

export const PROTOCOL_NAME = "Noise_NK_25519_AESGCM_SHA256";
const DH_LEN = 32;
const HASH_LEN = 32;
const TAG_LEN = 16;
/** The largest Noise message (spec section 3). */
export const MAX_NOISE_MESSAGE = 65535;
const MAX_NONCE = 2n ** 64n - 2n; // 2^64-1 is reserved by the spec.

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");

const encoder = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export class NoiseError extends Error {}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAllZero(bytes: Uint8Array): boolean {
  return same(bytes, new Uint8Array(bytes.length));
}

// ---- primitives -------------------------------------------------------------------------------

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** The X25519 key pair of a 32-byte private key. */
export function x25519KeyPair(privateKey: Uint8Array): KeyPair {
  if (privateKey.length !== DH_LEN) throw new NoiseError("an X25519 private key is 32 bytes");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_X25519, privateKey]), format: "der", type: "pkcs8" });
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  return { privateKey: new Uint8Array(privateKey), publicKey: new Uint8Array(spki.subarray(spki.length - DH_LEN)) };
}

export function generateKeyPair(): KeyPair {
  return x25519KeyPair(globalThis.crypto.getRandomValues(new Uint8Array(DH_LEN)));
}

/** X25519. Throws on a malformed key and on an all-zero result (a low-order public key). */
export function x25519(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== DH_LEN) throw new NoiseError("an X25519 public key is 32 bytes");
  let shared: Buffer;
  try {
    shared = diffieHellman({
      privateKey: createPrivateKey({ key: Buffer.concat([PKCS8_X25519, privateKey]), format: "der", type: "pkcs8" }),
      publicKey: createPublicKey({ key: Buffer.concat([SPKI_X25519, publicKey]), format: "der", type: "spki" }),
    });
  } catch {
    throw new NoiseError("the Diffie-Hellman failed");
  }
  return checkShared(new Uint8Array(shared));
}

/** Reject a Diffie-Hellman output of 32 zero bytes, and anything not 32 bytes. */
export function checkShared(shared: Uint8Array): Uint8Array {
  if (shared.length !== DH_LEN || isAllZero(shared)) throw new NoiseError("the Diffie-Hellman result is not usable");
  return shared;
}

async function hash(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", data as BufferSource));
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data as BufferSource));
}

/** HKDF of the spec (section 4.3): two outputs, with HMAC-SHA256. */
async function hkdf2(chainingKey: Uint8Array, input: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const temp = await hmac(chainingKey, input);
  const out1 = await hmac(temp, Uint8Array.of(0x01));
  const out2 = await hmac(temp, concat(out1, Uint8Array.of(0x02)));
  return [out1, out2];
}

function nonce(n: bigint): Uint8Array {
  const out = new Uint8Array(12); // 4 zero bytes, then the counter, big-endian
  new DataView(out.buffer).setBigUint64(4, n, false);
  return out;
}

// ---- CipherState ------------------------------------------------------------------------------

/** One direction of the transport, or the key of the handshake. The nonce never repeats. */
export class CipherState {
  private key: CryptoKey | null = null;
  private n = 0n;

  async setKey(k: Uint8Array | null): Promise<void> {
    this.n = 0n;
    this.key =
      k === null ? null : await subtle.importKey("raw", k as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  hasKey(): boolean {
    return this.key !== null;
  }

  /** The nonce of the next message. The transport ends before it passes 2^64-2. */
  get counter(): bigint {
    return this.n;
  }

  async encrypt(ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    if (this.key === null) return plaintext;
    if (this.n > MAX_NONCE) throw new NoiseError("the nonce is used up");
    const iv = nonce(this.n);
    this.n += 1n; // before the await: a second call can never take the same nonce
    const out = await subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: ad as BufferSource, tagLength: TAG_LEN * 8 },
      this.key,
      plaintext as BufferSource,
    );
    return new Uint8Array(out);
  }

  /** Throws when the tag is wrong. The nonce moves only on success, as the spec says. */
  async decrypt(ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    if (this.key === null) return ciphertext;
    if (this.n > MAX_NONCE) throw new NoiseError("the nonce is used up");
    if (ciphertext.length < TAG_LEN) throw new NoiseError("the message is too short");
    const iv = nonce(this.n);
    let out: ArrayBuffer;
    try {
      out = await subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: ad as BufferSource, tagLength: TAG_LEN * 8 },
        this.key,
        ciphertext as BufferSource,
      );
    } catch {
      throw new NoiseError("the message did not decrypt");
    }
    this.n += 1n;
    return new Uint8Array(out);
  }
}

// ---- SymmetricState ---------------------------------------------------------------------------

class SymmetricState {
  private ck: Uint8Array = new Uint8Array(HASH_LEN);
  h: Uint8Array = new Uint8Array(HASH_LEN);
  private readonly cipher = new CipherState();

  async initialize(name: string): Promise<void> {
    const bytes = encoder.encode(name);
    this.h = bytes.length <= HASH_LEN ? concat(bytes, new Uint8Array(HASH_LEN - bytes.length)) : await hash(bytes);
    this.ck = this.h;
    await this.cipher.setKey(null);
  }

  async mixKey(input: Uint8Array): Promise<void> {
    const [ck, k] = await hkdf2(this.ck, input);
    this.ck = ck;
    await this.cipher.setKey(k);
  }

  async mixHash(data: Uint8Array): Promise<void> {
    this.h = await hash(concat(this.h, data));
  }

  async encryptAndHash(plaintext: Uint8Array): Promise<Uint8Array> {
    const out = await this.cipher.encrypt(this.h, plaintext);
    await this.mixHash(out);
    return out;
  }

  async decryptAndHash(ciphertext: Uint8Array): Promise<Uint8Array> {
    const out = await this.cipher.decrypt(this.h, ciphertext);
    await this.mixHash(ciphertext);
    return out;
  }

  /** Two cipher states: initiator to responder, and responder to initiator. */
  async split(): Promise<[CipherState, CipherState]> {
    const [k1, k2] = await hkdf2(this.ck, new Uint8Array(0));
    const c1 = new CipherState();
    const c2 = new CipherState();
    await c1.setKey(k1);
    await c2.setKey(k2);
    return [c1, c2];
  }
}

// ---- the handshake ----------------------------------------------------------------------------

/** What a finished handshake leaves: a cipher for each direction and the handshake hash `h`. */
export interface Transport {
  /** Encrypts what this side sends. */
  send: CipherState;
  /** Decrypts what this side receives. */
  receive: CipherState;
  /** `h`, which contains both ephemeral keys. The device signs it. */
  handshakeHash: Uint8Array;
}

export interface ResponderOptions {
  /** Handshake prologue: `golem-noise-v1` followed by the room id's bytes (ADR-051). */
  prologue: Uint8Array;
  /** The public half of the responder's static key (`noise_key` of `device.sync`). */
  staticPublic: Uint8Array;
  /** `DH(s, publicKey)`, answered by the daemon's `relay.dh`. */
  dh(publicKey: Uint8Array): Promise<Uint8Array>;
  /** A fixed ephemeral private key, for the published vectors only. */
  ephemeralPrivate?: Uint8Array;
}

export interface Responder {
  /** `-> e, es`. Returns the payload. Throws `NoiseError` for anything wrong. */
  readMessage1(message: Uint8Array): Promise<Uint8Array>;
  /** `<- e, ee`. Returns the message and the transport. */
  writeMessage2(payload: Uint8Array): Promise<{ message: Uint8Array; transport: Transport }>;
}

export function createResponder(options: ResponderOptions): Responder {
  const symmetric = new SymmetricState();
  let re: Uint8Array | null = null;
  let stage: "start" | "read" | "done" = "start";

  return {
    async readMessage1(message) {
      if (stage !== "start") throw new NoiseError("out of order");
      stage = "done"; // a failed read ends the handshake, so a replay cannot try again
      if (message.length < DH_LEN + TAG_LEN || message.length > MAX_NOISE_MESSAGE) throw new NoiseError("bad handshake message");
      await symmetric.initialize(PROTOCOL_NAME);
      await symmetric.mixHash(options.prologue);
      await symmetric.mixHash(options.staticPublic); // <- s
      const remoteEphemeral = message.slice(0, DH_LEN);
      await symmetric.mixHash(remoteEphemeral); // e
      await symmetric.mixKey(checkShared(await options.dh(remoteEphemeral))); // es
      const payload = await symmetric.decryptAndHash(message.slice(DH_LEN));
      re = remoteEphemeral;
      stage = "read";
      return payload;
    },
    async writeMessage2(payload) {
      if (stage !== "read" || re === null) throw new NoiseError("out of order");
      stage = "done";
      const e = options.ephemeralPrivate ? x25519KeyPair(options.ephemeralPrivate) : generateKeyPair();
      await symmetric.mixHash(e.publicKey); // e
      await symmetric.mixKey(x25519(e.privateKey, re)); // ee
      const body = await symmetric.encryptAndHash(payload);
      const [initiatorToResponder, responderToInitiator] = await symmetric.split();
      return {
        message: concat(e.publicKey, body),
        transport: { send: responderToInitiator, receive: initiatorToResponder, handshakeHash: symmetric.h },
      };
    },
  };
}

export interface InitiatorOptions {
  prologue: Uint8Array;
  /** The responder's static public key, from the QR code. */
  remoteStatic: Uint8Array;
  ephemeralPrivate?: Uint8Array;
}

export interface Initiator {
  writeMessage1(payload: Uint8Array): Promise<Uint8Array>;
  readMessage2(message: Uint8Array): Promise<{ payload: Uint8Array; transport: Transport }>;
}

/** The phone's side. The gateway never initiates; this is for tests and for the vectors. */
export function createInitiator(options: InitiatorOptions): Initiator {
  const symmetric = new SymmetricState();
  let e: KeyPair | null = null;
  let stage: "start" | "sent" | "done" = "start";

  return {
    async writeMessage1(payload) {
      if (stage !== "start") throw new NoiseError("out of order");
      stage = "sent";
      await symmetric.initialize(PROTOCOL_NAME);
      await symmetric.mixHash(options.prologue);
      await symmetric.mixHash(options.remoteStatic); // <- s
      e = options.ephemeralPrivate ? x25519KeyPair(options.ephemeralPrivate) : generateKeyPair();
      await symmetric.mixHash(e.publicKey); // e
      await symmetric.mixKey(x25519(e.privateKey, options.remoteStatic)); // es
      return concat(e.publicKey, await symmetric.encryptAndHash(payload));
    },
    async readMessage2(message) {
      if (stage !== "sent" || e === null) throw new NoiseError("out of order");
      stage = "done";
      if (message.length < DH_LEN + TAG_LEN || message.length > MAX_NOISE_MESSAGE) throw new NoiseError("bad handshake message");
      const re = message.slice(0, DH_LEN);
      await symmetric.mixHash(re); // e
      await symmetric.mixKey(x25519(e.privateKey, re)); // ee
      const payload = await symmetric.decryptAndHash(message.slice(DH_LEN));
      const [initiatorToResponder, responderToInitiator] = await symmetric.split();
      return {
        payload,
        transport: { send: initiatorToResponder, receive: responderToInitiator, handshakeHash: symmetric.h },
      };
    },
  };
}
