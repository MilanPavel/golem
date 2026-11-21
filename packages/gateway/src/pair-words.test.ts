import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BIP39_ENGLISH } from "./bip39-english.ts";
import { pairWords } from "./pair-words.ts";

const LIST = new URL("../../protocol/vectors/bip39/english.txt", import.meta.url);

test("the word list is the BIP-39 English list, the same as the file next to the vectors", () => {
  const text = readFileSync(LIST, "utf8");
  assert.equal(createHash("sha256").update(text).digest("hex"), "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
  assert.deepEqual([...BIP39_ENGLISH], text.split("\n").filter((w) => w !== ""));
  assert.equal(BIP39_ENGLISH.length, 2048);
  assert.equal(BIP39_ENGLISH[0], "abandon");
  assert.equal(BIP39_ENGLISH[2047], "zoo");
});

// Expected values: python's `cryptography` HKDF(SHA256, length=5, salt=None, info=b"golem-pair-sas-v1"),
// the first 33 bits read most significant bit first, three groups of 11, indexed into english.txt.
test("the words of h = 00 01 .. 1f", async () => {
  const h = Uint8Array.from({ length: 32 }, (_, i) => i);
  assert.deepEqual(await pairWords(h), ["horror", "quiz", "identify"]); // HKDF bytes 6db5fdc21a: indexes 877, 1407, 900
});

test("the words of h = ab repeated", async () => {
  assert.deepEqual(await pairWords(new Uint8Array(32).fill(0xab)), ["taxi", "rescue", "half"]); // de76e5a1ad: 1779, 1465, 835
});
