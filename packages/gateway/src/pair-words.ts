// The pairing confirmation (ADR-051): three words from the 2048-word BIP-39 English list, taken
// from the first 33 bits of HKDF-SHA256(ikm = h, info = "golem-pair-sas-v1"). Both ends hold the
// handshake hash h, which depends on both ephemeral keys, so neither side can choose the words.

import { BIP39_ENGLISH } from "./bip39-english.ts";

const INFO = new TextEncoder().encode("golem-pair-sas-v1");

/** The three words for the handshake hash `h`. The salt is empty, which HKDF treats as HashLen zero bytes. */
export async function pairWords(h: Uint8Array): Promise<[string, string, string]> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey("raw", h as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO }, key, 40));
  // The first 33 bits, 11 for each word, most significant bit first.
  let acc = 0n;
  for (const b of bits) acc = (acc << 8n) | BigInt(b);
  const top = acc >> 7n; // 40 bits less the 7 that are not used
  const word = (i: number): string => BIP39_ENGLISH[Number((top >> BigInt(22 - 11 * i)) & 0x7ffn)] ?? "";
  return [word(0), word(1), word(2)];
}
