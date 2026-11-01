import { type ChildProcess, spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
const runDir = path.join(home, "run");
const children = new Set<ChildProcess>();

after(() => {
  for (const c of children) c.kill("SIGKILL");
  fs.rmSync(home, { recursive: true, force: true });
});

interface Run {
  child: ChildProcess;
  stdout: Promise<string>;
  stderr: () => string;
  exit: Promise<number | null>;
}

function golemWeb(...args: string[]): Run {
  const child = spawn("bun", [MAIN, "web", ...args], {
    env: { ...process.env, GOLEM_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let err = "";
  child.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const exit = new Promise<number | null>((done) => child.on("close", (code) => done(code)));
  const stdout = new Promise<string>((done) => {
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      if (out.includes("\n")) done(out);
    });
    child.on("close", () => done(out));
  });
  return { child, stdout, stderr: () => err, exit };
}

interface Printed {
  url: string;
  port: number;
  pid: number;
}

async function firstLine(run: Run): Promise<Printed> {
  const out = await run.stdout;
  assert.equal(out.trim().split("\n").length, 1, out + run.stderr());
  return JSON.parse(out) as Printed;
}

async function health(port: number): Promise<{ golem: string; pid: number }> {
  return (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as { golem: string; pid: number };
}

const mode = (file: string): number => fs.statSync(path.join(runDir, file)).mode & 0o777;
const record = (): { pid: number; port: number } =>
  JSON.parse(fs.readFileSync(path.join(runDir, "web.json"), "utf8")) as { pid: number; port: number };
const exists = (file: string): boolean => fs.existsSync(path.join(runDir, file));

async function waitUntil(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.ok(check());
}

test("golem web starts, is reused, replaces a dead one, and cleans up on SIGTERM", async () => {
  const first = golemWeb("--json", "--port", "0");
  const a = await firstLine(first);
  assert.equal(a.pid, first.child.pid);
  assert.match(a.url, new RegExp(`^http://127\\.0\\.0\\.1:${a.port}/#t=[A-Za-z0-9_-]{43}$`));
  assert.equal(mode("web.json"), 0o600);
  assert.equal(mode("web.token"), 0o600);
  assert.deepEqual(await health(a.port), { golem: "web", pid: a.pid });

  const second = golemWeb("--json");
  const b = await firstLine(second);
  assert.equal(await second.exit, 0);
  assert.deepEqual(b, a);

  first.child.kill("SIGKILL");
  await first.exit;
  const third = golemWeb("--json", "--port", "0");
  const c = await firstLine(third);
  assert.notEqual(c.pid, a.pid);
  assert.equal(c.pid, third.child.pid);
  assert.deepEqual(await health(c.port), { golem: "web", pid: c.pid });
  assert.equal(record().pid, c.pid);
  assert.notEqual(c.url, a.url);

  third.child.kill("SIGTERM");
  assert.equal(await third.exit, 0);
  await waitUntil(() => !exists("web.json") && !exists("web.token"));
});

test("a reused gateway on another port is reported on stderr", async () => {
  const first = golemWeb("--json", "--port", "0");
  const a = await firstLine(first);
  const other = a.port === 65000 ? 65001 : 65000;
  const second = golemWeb("--json", "--port", String(other));
  const b = await firstLine(second);
  assert.equal(await second.exit, 0);
  assert.equal(b.port, a.port);
  assert.match(second.stderr(), new RegExp(`golem web already runs on port ${a.port}`));
  first.child.kill("SIGTERM");
  await first.exit;
});

test("a port that is taken by something else fails and leaves no token", async () => {
  const blocker = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.destroy();
  });
  await new Promise<void>((done) => blocker.listen(0, "127.0.0.1", done));
  const port = (blocker.address() as net.AddressInfo).port;
  try {
    const run = golemWeb("--json", "--port", String(port));
    assert.equal(await run.exit, 1);
    assert.match(run.stderr(), new RegExp(`port ${port} is in use\\. Try golem web --port <other>`));
    assert.equal(exists("web.token"), false);
    assert.equal(exists("web.json"), false);
  } finally {
    blocker.close();
  }
});

test("a server that only claims to be a gateway never gets the token", async () => {
  const impostor = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ golem: "web", pid: 1 }));
  });
  await new Promise<void>((done) => impostor.listen(0, "127.0.0.1", done));
  const port = (impostor.address() as net.AddressInfo).port;
  try {
    const run = golemWeb("--json", "--port", String(port));
    assert.equal(await run.exit, 1);
    assert.equal(await run.stdout, "");
    assert.match(run.stderr(), new RegExp(`port ${port} is in use`));
  } finally {
    impostor.close();
  }
});

test("bad options print the usage and exit 1", async () => {
  const run = golemWeb("--port", "70000");
  assert.equal(await run.exit, 1);
  assert.match(run.stderr(), /golem web \[--port N\]/);
});
