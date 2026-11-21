import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { NoiseError, checkShared, createInitiator, createResponder, generateKeyPair, x25519, x25519KeyPair } from "./noise.ts";

interface Vector {
  protocol_name: string;
  init_prologue: string;
  init_ephemeral: string;
  init_remote_static: string;
  resp_prologue: string;
  resp_static: string;
  resp_ephemeral: string;
  handshake_hash: string;
  messages: { payload: string; ciphertext: string }[];
}

const file = new URL("../../protocol/vectors/noise/noise-nk-25519-aesgcm-sha256.json", import.meta.url);
const vectors = (JSON.parse(readFileSync(file, "utf8")) as { vectors: Vector[] }).vectors;

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const none = new Uint8Array(0);

test("there are vectors, and all are for NK with AES-GCM and SHA-256", () => {
  assert.ok(vectors.length >= 1);
  for (const v of vectors) assert.equal(v.protocol_name, "Noise_NK_25519_AESGCM_SHA256");
});

for (const [index, v] of vectors.entries()) {
  test(`vector ${index}: the initiator writes and reads every message`, async () => {
    const [m1, m2, ...transport] = v.messages;
    assert.ok(m1 && m2);
    const initiator = createInitiator({
      prologue: bytes(v.init_prologue),
      remoteStatic: bytes(v.init_remote_static),
      ephemeralPrivate: bytes(v.init_ephemeral),
    });
    assert.equal(hex(await initiator.writeMessage1(bytes(m1.payload))), m1.ciphertext);
    const second = await initiator.readMessage2(bytes(m2.ciphertext));
    assert.equal(hex(second.payload), m2.payload);
    assert.equal(hex(second.transport.handshakeHash), v.handshake_hash);
    // Transport messages alternate, the initiator first.
    for (const [i, m] of transport.entries()) {
      const mine = i % 2 === 0 ? second.transport.send : second.transport.receive;
      if (i % 2 === 0) assert.equal(hex(await mine.encrypt(none, bytes(m.payload))), m.ciphertext);
      else assert.equal(hex(await mine.decrypt(none, bytes(m.ciphertext))), m.payload);
    }
  });

  test(`vector ${index}: the responder, with its key behind dh(), writes and reads every message`, async () => {
    const [m1, m2, ...transport] = v.messages;
    assert.ok(m1 && m2);
    const staticKey = x25519KeyPair(bytes(v.resp_static));
    assert.equal(hex(staticKey.publicKey), v.init_remote_static);
    let calls = 0;
    const responder = createResponder({
      prologue: bytes(v.resp_prologue),
      staticPublic: staticKey.publicKey,
      dh: async (pub) => {
        calls += 1;
        return x25519(staticKey.privateKey, pub);
      },
      ephemeralPrivate: bytes(v.resp_ephemeral),
    });
    assert.equal(hex(await responder.readMessage1(bytes(m1.ciphertext))), m1.payload);
    const out = await responder.writeMessage2(bytes(m2.payload));
    assert.equal(calls, 1);
    assert.equal(hex(out.message), m2.ciphertext);
    assert.equal(hex(out.transport.handshakeHash), v.handshake_hash);
    for (const [i, m] of transport.entries()) {
      if (i % 2 === 0) assert.equal(hex(await out.transport.receive.decrypt(none, bytes(m.ciphertext))), m.payload);
      else assert.equal(hex(await out.transport.send.encrypt(none, bytes(m.payload))), m.ciphertext);
    }
  });
}

async function pair(prologue = new TextEncoder().encode("golem-noise-v1")) {
  const staticKey = generateKeyPair();
  const initiator = createInitiator({ prologue, remoteStatic: staticKey.publicKey });
  const responder = createResponder({
    prologue,
    staticPublic: staticKey.publicKey,
    dh: async (pub) => x25519(staticKey.privateKey, pub),
  });
  return { initiator, responder, staticKey };
}

test("a fresh handshake agrees on keys and on h, and the transport works both ways", async () => {
  const { initiator, responder } = await pair();
  await responder.readMessage1(await initiator.writeMessage1(none));
  const second = await responder.writeMessage2(none);
  const first = await initiator.readMessage2(second.message);
  assert.deepEqual(first.transport.handshakeHash, second.transport.handshakeHash);
  const up = await first.transport.send.encrypt(none, new TextEncoder().encode("up"));
  assert.equal(new TextDecoder().decode(await second.transport.receive.decrypt(none, up)), "up");
  const down = await second.transport.send.encrypt(none, new TextEncoder().encode("down"));
  assert.equal(new TextDecoder().decode(await first.transport.receive.decrypt(none, down)), "down");
});

test("a different prologue (another room) fails the handshake", async () => {
  const { initiator, responder } = await pair(new TextEncoder().encode("golem-noise-v1 room A"));
  const other = createResponder({
    prologue: new TextEncoder().encode("golem-noise-v1 room B"),
    staticPublic: new Uint8Array(32),
    dh: async () => new Uint8Array(32).fill(1),
  });
  void responder;
  await assert.rejects(other.readMessage1(await initiator.writeMessage1(none)), NoiseError);
});

test("a repeated, reordered, or altered transport message is refused", async () => {
  const { initiator, responder } = await pair();
  await responder.readMessage1(await initiator.writeMessage1(none));
  const second = await responder.writeMessage2(none);
  const first = await initiator.readMessage2(second.message);
  const a = await first.transport.send.encrypt(none, Uint8Array.of(1));
  const b = await first.transport.send.encrypt(none, Uint8Array.of(2));
  await assert.rejects(second.transport.receive.decrypt(none, b), NoiseError); // out of order
  assert.deepEqual(await second.transport.receive.decrypt(none, a), Uint8Array.of(1));
  await assert.rejects(second.transport.receive.decrypt(none, a), NoiseError); // replay
  const flipped = b.slice();
  flipped[0] = (flipped[0] ?? 0) ^ 1;
  await assert.rejects(second.transport.receive.decrypt(none, flipped), NoiseError);
  assert.deepEqual(await second.transport.receive.decrypt(none, b), Uint8Array.of(2)); // a failure did not move the nonce
});

test("the nonce counts up with every message and never repeats", async () => {
  const { initiator, responder } = await pair();
  await responder.readMessage1(await initiator.writeMessage1(none));
  const first = await initiator.readMessage2((await responder.writeMessage2(none)).message);
  const seen = new Set<string>();
  const sends = await Promise.all([1, 2, 3, 4].map(() => first.transport.send.encrypt(none, none)));
  for (const s of sends) seen.add(hex(s));
  assert.equal(seen.size, 4); // same plaintext, four different ciphertexts
  assert.equal(first.transport.send.counter, 4n);
});

test("a handshake message that is too short or out of order is refused", async () => {
  const { responder } = await pair();
  await assert.rejects(responder.readMessage1(new Uint8Array(10)), NoiseError);
  await assert.rejects(responder.writeMessage2(none), NoiseError);
});

test("an all-zero Diffie-Hellman result is refused, from dh() and from a low-order key", async () => {
  assert.throws(() => checkShared(new Uint8Array(32)), NoiseError);
  const staticKey = generateKeyPair();
  const responder = createResponder({
    prologue: none,
    staticPublic: staticKey.publicKey,
    dh: async () => new Uint8Array(32),
  });
  const initiator = createInitiator({ prologue: none, remoteStatic: staticKey.publicKey });
  await assert.rejects(responder.readMessage1(await initiator.writeMessage1(none)), NoiseError);
  // The all-zero point is of low order: the shared secret is zero.
  assert.throws(() => x25519(generateKeyPair().privateKey, new Uint8Array(32)), NoiseError);
});
