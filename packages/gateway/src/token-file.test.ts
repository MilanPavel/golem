import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { readTokenFile, removeTokenFile, resolveRunDir, writeTokenFile } from "./token-file.ts";

const roots: string[] = [];
after(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

async function runDir(mode = 0o700): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "golem-token-"));
  roots.push(root);
  const dir = path.join(root, "run");
  await mkdir(dir);
  await chmod(dir, mode);
  return dir;
}

test("resolveRunDir: argument, then GOLEM_HOME, then ~/.golem", () => {
  const saved = process.env["GOLEM_HOME"];
  try {
    process.env["GOLEM_HOME"] = "/tmp/from-env";
    assert.equal(resolveRunDir("/tmp/arg"), "/tmp/arg/run");
    assert.equal(resolveRunDir(), "/tmp/from-env/run");
    delete process.env["GOLEM_HOME"];
    assert.equal(resolveRunDir(), path.join(os.homedir(), ".golem", "run"));
  } finally {
    if (saved === undefined) delete process.env["GOLEM_HOME"];
    else process.env["GOLEM_HOME"] = saved;
  }
});

test("write then read gives the token, with mode 0600", async () => {
  const dir = await runDir();
  const token = await writeTokenFile(dir);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await stat(path.join(dir, "web.token"))).mode & 0o777, 0o600);
  assert.equal(await readTokenFile(dir), token);
});

test("an old token file is replaced by a new value", async () => {
  const dir = await runDir();
  const first = await writeTokenFile(dir);
  const second = await writeTokenFile(dir);
  assert.notEqual(first, second);
  assert.equal(await readTokenFile(dir), second);
});

test("a token file with mode 0644 is refused on read", async () => {
  const dir = await runDir();
  await writeTokenFile(dir);
  await chmod(path.join(dir, "web.token"), 0o644);
  await assert.rejects(readTokenFile(dir), /mode 600/);
});

test("a symlinked token file is refused on read", async () => {
  const dir = await runDir();
  const real = path.join(path.dirname(dir), "real.token");
  await writeFile(real, "secret", { mode: 0o600 });
  await symlink(real, path.join(dir, "web.token"));
  await assert.rejects(readTokenFile(dir), /link/);
});

test("a symlink in the token's place is not followed on write", async () => {
  const dir = await runDir();
  const real = path.join(path.dirname(dir), "victim");
  await writeFile(real, "keep", { mode: 0o600 });
  await symlink(real, path.join(dir, "web.token"));
  await writeTokenFile(dir);
  assert.equal((await stat(real)).size, 4);
});

test("run/ writable by the group is refused", async () => {
  const dir = await runDir(0o770);
  await assert.rejects(writeTokenFile(dir), (e: Error) => e.message.includes(dir) && e.message.includes(`chmod 700 ${dir}`));
  await assert.rejects(readTokenFile(dir), /chmod 700/);
});

test("run/ writable by others is refused", async () => {
  const dir = await runDir(0o707);
  await assert.rejects(writeTokenFile(dir), /chmod 700/);
});

test("run/ as a symlink is refused", async () => {
  const dir = await runDir();
  const link = path.join(path.dirname(dir), "run-link");
  await symlink(dir, link);
  await assert.rejects(writeTokenFile(link), /real directory/);
  await assert.rejects(readTokenFile(link), /real directory/);
});

test("removeTokenFile on a missing file is fine", async () => {
  const dir = await runDir();
  await removeTokenFile(dir);
  await writeTokenFile(dir);
  await removeTokenFile(dir);
  await assert.rejects(readTokenFile(dir), { code: "ENOENT" });
});

test("an empty or damaged token file is refused", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golem-token-"));
  await chmod(dir, 0o700);
  try {
    for (const content of ["", "short", "x".repeat(42) + "!"]) {
      await writeFile(path.join(dir, "web.token"), content, { mode: 0o600 });
      await chmod(path.join(dir, "web.token"), 0o600);
      await assert.rejects(readTokenFile(dir), /valid token/);
      await removeTokenFile(dir);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
