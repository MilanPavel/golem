import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createSessionStore } from "./core.ts";
import { clearSessionFile, hashSecret, parseSessionFile, sessionFilePersistence } from "./session-file.ts";

function runDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gw-"));
  chmodSync(dir, 0o700);
  return dir;
}

const file = (dir: string): string => path.join(dir, "web-sessions");

test("a store made after a restart accepts a cookie issued before it", () => {
  const dir = runDir();
  try {
    const secret = createSessionStore({ persistence: sessionFilePersistence(dir) }).mint();
    const after = createSessionStore({ persistence: sessionFilePersistence(dir) });
    assert.equal(after.valid(secret), true);
    assert.equal(after.valid("nope"), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a cookie that expired before the restart is refused and dropped from the file", () => {
  const dir = runDir();
  try {
    let t = 1000;
    const secret = createSessionStore({ persistence: sessionFilePersistence(dir), now: () => t, maxAgeMs: 100 }).mint();
    t = 1100;
    const after = createSessionStore({ persistence: sessionFilePersistence(dir), now: () => t, maxAgeMs: 100 });
    assert.equal(after.valid(secret), false);
    assert.deepEqual(parseSessionFile(readFileSync(file(dir), "utf8")), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the file holds the hash and the expiry, never the secret, with mode 0600", () => {
  const dir = runDir();
  try {
    const secret = createSessionStore({ persistence: sessionFilePersistence(dir) }).mint();
    const text = readFileSync(file(dir), "utf8");
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(hashSecret(secret)), true);
    assert.equal(statSync(file(dir)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ["web-sessions"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a hash is not a cookie", () => {
  const dir = runDir();
  try {
    const store = createSessionStore({ persistence: sessionFilePersistence(dir) });
    const secret = store.mint();
    assert.equal(store.valid(hashSecret(secret)), false);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a corrupt file is replaced and everyone signs in again", () => {
  const dir = runDir();
  try {
    const secret = createSessionStore({ persistence: sessionFilePersistence(dir) }).mint();
    writeFileSync(file(dir), "{not json", { mode: 0o600 });
    const store = createSessionStore({ persistence: sessionFilePersistence(dir) });
    assert.equal(store.valid(secret), false);
    assert.deepEqual(parseSessionFile(readFileSync(file(dir), "utf8")), []);
    const again = store.mint();
    assert.equal(createSessionStore({ persistence: sessionFilePersistence(dir) }).valid(again), true);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a file with the wrong mode is not trusted and is replaced", () => {
  const dir = runDir();
  try {
    const secret = createSessionStore({ persistence: sessionFilePersistence(dir) }).mint();
    chmodSync(file(dir), 0o644);
    assert.equal(createSessionStore({ persistence: sessionFilePersistence(dir) }).valid(secret), false);
    assert.equal(statSync(file(dir)).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a link in place of the file is replaced, and its target is left alone", () => {
  const dir = runDir();
  try {
    const target = path.join(dir, "elsewhere");
    writeFileSync(target, "keep", { mode: 0o600 });
    symlinkSync(target, file(dir));
    const store = createSessionStore({ persistence: sessionFilePersistence(dir) });
    const secret = store.mint();
    assert.equal(readFileSync(target, "utf8"), "keep");
    assert.equal(store.valid(secret), true);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("an entry that is not a SHA-256 makes the file corrupt", () => {
  assert.equal(parseSessionFile(JSON.stringify({ version: 1, sessions: [{ sha256: "abc", expires: 1 }] })), null);
  assert.equal(parseSessionFile(JSON.stringify({ version: 2, sessions: [] })), null);
  assert.equal(parseSessionFile("[]"), null);
});

test("clearing the file signs a running gateway's browsers out on the next check", () => {
  const dir = runDir();
  try {
    const store = createSessionStore({ persistence: sessionFilePersistence(dir) });
    const secret = store.mint();
    assert.equal(store.valid(secret), true);
    clearSessionFile(dir);
    assert.equal(store.valid(secret), false);
    assert.deepEqual(parseSessionFile(readFileSync(file(dir), "utf8")), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a run dir others can write to is refused: nothing is written and no one is signed in", () => {
  const dir = runDir();
  try {
    chmodSync(dir, 0o777);
    const store = createSessionStore({ persistence: sessionFilePersistence(dir) });
    const secret = store.mint();
    assert.equal(store.valid(secret), false);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true });
  }
});
