import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ensureRunDir, parseRunRecord, readRunFile, removeRunFile, writeRunFile } from "./run-file.ts";

const roots: string[] = [];
after(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

async function runDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-run-"));
  roots.push(root);
  const dir = path.join(root, "run");
  await mkdir(dir);
  await chmod(dir, 0o700);
  return dir;
}

const record = { pid: 42, port: 7480, started_at: "2026-11-01T10:00:00.000Z" };

test("parseRunRecord accepts a record and rejects everything else", () => {
  assert.deepEqual(parseRunRecord(JSON.stringify(record)), record);
  for (const bad of [
    "",
    "nope",
    "null",
    "[]",
    "{}",
    JSON.stringify({ ...record, pid: 0 }),
    JSON.stringify({ ...record, pid: 1.5 }),
    JSON.stringify({ ...record, pid: "42" }),
    JSON.stringify({ ...record, port: 0 }),
    JSON.stringify({ ...record, port: 65536 }),
    JSON.stringify({ ...record, port: 1.5 }),
    JSON.stringify({ ...record, started_at: 5 }),
  ]) {
    assert.equal(parseRunRecord(bad), null, bad);
  }
});

test("ensureRunDir creates a missing run dir with mode 700", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-run-"));
  roots.push(root);
  const dir = path.join(root, "home", "run");
  await ensureRunDir(dir);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  await ensureRunDir(dir);
});

test("ensureRunDir refuses a dir others can write", async () => {
  const dir = await runDir();
  await chmod(dir, 0o777);
  await assert.rejects(ensureRunDir(dir), /can be written by others/);
});

test("write then read gives the record, with mode 0600", async () => {
  const dir = await runDir();
  await writeRunFile(dir, record);
  assert.deepEqual(await readRunFile(dir), record);
  assert.equal((await stat(path.join(dir, "web.json"))).mode & 0o777, 0o600);
  await writeRunFile(dir, { ...record, pid: 43 });
  assert.equal((await readRunFile(dir))?.pid, 43);
});

test("read: missing and unparseable give null", async () => {
  const dir = await runDir();
  assert.equal(await readRunFile(dir), null);
  await writeFile(path.join(dir, "web.json"), "{broken");
  assert.equal(await readRunFile(dir), null);
});

test("read refuses a link and a directory", async () => {
  const dir = await runDir();
  await writeFile(path.join(dir, "real.json"), JSON.stringify(record));
  await symlink(path.join(dir, "real.json"), path.join(dir, "web.json"));
  await assert.rejects(readRunFile(dir), /regular file/);
  await rm(path.join(dir, "web.json"));
  await mkdir(path.join(dir, "web.json"));
  await assert.rejects(readRunFile(dir), /regular file/);
});

test("removeRunFile with a pid removes only that pid's file", async () => {
  const dir = await runDir();
  await writeRunFile(dir, record);
  await removeRunFile(dir, 7);
  assert.deepEqual(await readRunFile(dir), record);
  await removeRunFile(dir, 42);
  assert.equal(await readRunFile(dir), null);
  await removeRunFile(dir);
  await removeRunFile(dir, 42);
});
