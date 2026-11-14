import { type ChildProcess, spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { GOLEM_VERSION } from "@golem/client/node";
import { randomSecret } from "@golem/gateway";
import { writeRunFile, writeTokenFile } from "@golem/gateway/node";

import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { parseWebArgs } from "./web.ts";
import { findLive, useLive, type WebDeps } from "./web-live.ts";

const MAIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
const runDir = path.join(home, "run");
const children = new Set<ChildProcess>();

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gw-none-"));

/** Answers `hello` and `daemon.status` on the home's socket, so `golem web` finds a daemon. */
function fakeDaemon(): net.Server {
  const answers: Record<string, unknown> = {
    hello: { daemon_version: "0.0.0-dev", protocol_major: PROTOCOL_MAJOR, protocol_minor: PROTOCOL_MINOR },
    "daemon.status": {
      pid: process.pid,
      version: "0.0.0-dev",
      protocol_major: PROTOCOL_MAJOR,
      protocol_minor: PROTOCOL_MINOR,
      uptime_seconds: 1,
      state: "running",
    },
  };
  return net.createServer((socket) => {
    socket.on("error", () => {});
    let buffered = "";
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      let end = buffered.indexOf("\n");
      while (end >= 0) {
        const request = JSON.parse(buffered.slice(0, end)) as { id: number; method: string };
        buffered = buffered.slice(end + 1);
        const result = answers[request.method] ?? {};
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
        end = buffered.indexOf("\n");
      }
    });
  });
}

let daemon: net.Server;

before(async () => {
  fs.mkdirSync(runDir, { recursive: true });
  daemon = fakeDaemon();
  await new Promise<void>((done) => daemon.listen(path.join(runDir, "golem.sock"), done));
});

after(() => {
  for (const c of children) c.kill("SIGKILL");
  daemon.close();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

interface Run {
  child: ChildProcess;
  stdout: Promise<string>;
  stderr: () => string;
  exit: Promise<number | null>;
}

function golemWeb(...args: string[]): Run {
  return golemWebIn(home, ...args);
}

function golemWebIn(golemHome: string, ...args: string[]): Run {
  const child = spawn("bun", [MAIN, "web", ...args], {
    env: { ...process.env, GOLEM_HOME: golemHome },
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

interface Healthz {
  golem: string;
  pid: number;
  version: string;
  kept: boolean;
}

async function health(port: number): Promise<Healthz> {
  return (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as Healthz;
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
  assert.deepEqual(await health(a.port), { golem: "web", pid: a.pid, version: GOLEM_VERSION, kept: false });

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
  assert.deepEqual(await health(c.port), { golem: "web", pid: c.pid, version: GOLEM_VERSION, kept: false });
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

test("with --json or --no-open and no daemon, it says what to run and starts nothing", async () => {
  for (const flag of ["--json", "--no-open"]) {
    const run = golemWebIn(empty, flag, "--port", "0");
    assert.equal(await run.exit, 1);
    assert.equal(await run.stdout, "");
    assert.match(run.stderr(), /^daemon is not running \(.*\)\nrun: golem daemon (install|start)\n$/);
    assert.equal(fs.existsSync(path.join(empty, "run", "web.json")), false);
  }
});

test("bad options print the usage and exit 1", async () => {
  const run = golemWeb("--port", "70000");
  assert.equal(await run.exit, 1);
  assert.match(run.stderr(), /usage: golem \[--port N\] \[--no-open\] \[--json\] \| golem tui\n/);
  assert.match(run.stderr(), /golem web \[--port N\]/);
});

test("golem web serve prints no token, reports kept, and cleans up on SIGTERM", async () => {
  const run = golemWeb("serve", "--port", "0");
  const out = await run.stdout;
  assert.match(out, /^golem web: serving http:\/\/127\.0\.0\.1:\d+\n$/);
  assert.equal(out.includes(fs.readFileSync(path.join(runDir, "web.token"), "utf8").trim()), false);
  const { port, pid } = record();
  assert.deepEqual(await health(port), { golem: "web", pid, version: GOLEM_VERSION, kept: true });
  assert.equal(pid, run.child.pid);
  run.child.kill("SIGTERM");
  assert.equal(await run.exit, 0);
  assert.equal(run.stderr().includes("#t="), false);
  await waitUntil(() => !exists("web.json") && !exists("web.token"));
});

test("golem web serve beside a live foreground gateway exits 75 and leaves its files alone", async () => {
  const first = golemWeb("--json", "--port", "0");
  const a = await firstLine(first);
  const token = fs.readFileSync(path.join(runDir, "web.token"), "utf8");
  const serve = golemWeb("serve", "--port", "0");
  assert.equal(await serve.exit, 75);
  assert.equal(await serve.stdout, "");
  assert.match(serve.stderr(), new RegExp(`golem web: another gateway runs on port ${a.port} \\(pid ${a.pid}\\)`));
  assert.equal(record().pid, a.pid);
  assert.equal(fs.readFileSync(path.join(runDir, "web.token"), "utf8"), token);
  assert.equal((await health(a.port)).pid, a.pid);
  first.child.kill("SIGTERM");
  await first.exit;
});

const OURS = "9.9.9";

interface Fake {
  port: number;
  pid: number;
  server: http.Server;
}

/** A server that answers `/healthz` like a gateway with this pid, version, and `kept`. */
async function fakeGateway(pid: number, version: string | undefined, kept: boolean | undefined): Promise<Fake> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ golem: "web", pid, ...(version === undefined ? {} : { version }), ...(kept === undefined ? {} : { kept }) }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { port: (server.address() as net.AddressInfo).port, pid, server };
}

async function announce(fake: Fake): Promise<void> {
  await writeTokenFile(runDir, randomSecret());
  await writeRunFile(runDir, { pid: fake.pid, port: fake.port, started_at: new Date().toISOString() });
}

interface Captured {
  code: number;
  out: string;
  err: string;
}

/** Runs `golem web --json` against a fake gateway, with the run files in the temp home. */
async function webWith(deps: Partial<WebDeps>, argv: string[] = ["--json"]): Promise<Captured> {
  const args = parseWebArgs(argv);
  assert.ok(args !== null);
  let out = "";
  let err = "";
  const writeOut = process.stdout.write;
  const writeErr = process.stderr.write;
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => ((err += chunk), true)) as typeof process.stderr.write;
  try {
    const live = await findLive(runDir);
    assert.ok(live !== null);
    const code = await useLive(args, runDir, live, {
      version: OURS,
      restartWebJob: () => Promise.resolve(false),
      pollMs: 10,
      timeoutMs: 400,
      ...deps,
    });
    return { code, out, err };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
}

function forget(...fakes: Fake[]): void {
  for (const f of fakes) f.server.close();
  fs.rmSync(path.join(runDir, "web.json"), { force: true });
  fs.rmSync(path.join(runDir, "web.token"), { force: true });
}

test("golem web reuses a job of the same version without a restart", async () => {
  const job = await fakeGateway(4001, OURS, true);
  await announce(job);
  let restarts = 0;
  try {
    const got = await webWith({ restartWebJob: () => ((restarts += 1), Promise.resolve(true)) });
    assert.equal(got.code, 0, got.err);
    assert.equal(JSON.parse(got.out).pid, 4001);
    assert.equal(restarts, 0);
    assert.equal(got.err, "");
  } finally {
    forget(job);
  }
});

test("golem web restarts a job of another version, then reuses the new pid", async () => {
  const old = await fakeGateway(4002, "1.0.0", true);
  await announce(old);
  let fresh: Fake | undefined;
  try {
    const got = await webWith({
      restartWebJob: async () => {
        old.server.close();
        fresh = await fakeGateway(4003, OURS, true);
        await announce(fresh);
        return true;
      },
    });
    assert.equal(got.code, 0, got.err);
    const shown = JSON.parse(got.out) as { pid: number; port: number };
    assert.equal(shown.pid, 4003);
    assert.equal(shown.port, fresh?.port);
  } finally {
    forget(old, ...(fresh === undefined ? [] : [fresh]));
  }
});

test("golem web exits 1 with a hint when the restarted job does not come back", async () => {
  const old = await fakeGateway(4004, undefined, true);
  await announce(old);
  try {
    const got = await webWith({ restartWebJob: () => Promise.resolve(true) });
    assert.equal(got.code, 1);
    assert.equal(got.out, "");
    assert.match(got.err, /the web service did not come back; golem web uninstall, then golem web install/);
  } finally {
    forget(old);
  }
});

test("golem web reuses a foreground gateway of another version, says so, and never restarts it", async () => {
  for (const kept of [false, undefined]) {
    const other = await fakeGateway(4005, "1.0.0", kept);
    await announce(other);
    let restarts = 0;
    try {
      const got = await webWith({ restartWebJob: () => ((restarts += 1), Promise.resolve(true)) });
      assert.equal(got.code, 0, got.err);
      assert.equal(JSON.parse(got.out).pid, 4005);
      assert.equal(restarts, 0);
      assert.equal(got.err, `the page is served by golem 1.0.0; Ctrl-C it and run golem web again for ${OURS}\n`);
    } finally {
      forget(other);
    }
  }
});

test("golem web with a kept job adds the first-run line only on a first run", async () => {
  const job = await fakeGateway(4010, OURS, true);
  await announce(job);
  try {
    const first = await webWith({ firstRun: () => Promise.resolve(true) }, ["--no-open"]);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /Setup continues in your browser\. You can close this window\.\n$/);
    assert.ok(!first.out.includes("Press Ctrl-C"));
    const later = await webWith({ firstRun: () => Promise.resolve(false) }, ["--no-open"]);
    assert.ok(!later.out.includes("Setup continues"));
    const failing = await webWith({ firstRun: () => Promise.reject(new Error("no daemon")) }, ["--no-open"]);
    assert.equal(failing.code, 0);
    assert.ok(!failing.out.includes("Setup continues"));
  } finally {
    forget(job);
  }
});

test("a foreground gateway never gets the first-run line, since closing the window would stop it", async () => {
  const fg = await fakeGateway(4011, OURS, false);
  await announce(fg);
  try {
    const got = await webWith({ firstRun: () => Promise.resolve(true) }, ["--no-open"]);
    assert.ok(!got.out.includes("Setup continues"));
  } finally {
    forget(fg);
  }
});
