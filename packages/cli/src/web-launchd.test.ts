import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  INSTALLED_LINE,
  installWebJob,
  jobLoaded,
  kickstart,
  type LaunchDeps,
  type Launched,
  NOT_INSTALLED_LINE,
  plistProgram,
  renderWebPlist,
  restartWebWithDaemon,
  RUNTIME_REFUSAL,
  stablePath,
  uninstallWebJob,
  webPlistPath,
  webProgram,
} from "./web-launchd.ts";

// Short temp dirs, never ~/.golem or ~/Library/LaunchAgents, and no real launchctl.

function tmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gw-")));
}

interface Fixture {
  deps: LaunchDeps;
  calls: string[][];
  root: string;
  loaded: { value: boolean };
}

function fixture(overrides: Partial<LaunchDeps> = {}, bootstrapOk = true): Fixture {
  const root = tmp();
  const calls: string[][] = [];
  const loaded = { value: false };
  const launchctl = (args: string[]): Launched => {
    calls.push(args);
    if (args[0] === "print") return { ok: loaded.value, output: "" };
    if (args[0] === "bootout") loaded.value = false;
    if (args[0] === "bootstrap") {
      loaded.value = bootstrapOk;
      return { ok: bootstrapOk, output: bootstrapOk ? "" : "Bootstrap failed: 5" };
    }
    return { ok: true, output: "" };
  };
  const deps: LaunchDeps = {
    platform: "darwin",
    uid: 501,
    launchAgentsDir: path.join(root, "LaunchAgents"),
    golemHome: path.join(root, "golem"),
    userHome: path.join(root, "home"),
    execPath: path.join(root, "bin", "golem"),
    launchctl,
    liveGateway: () => Promise.resolve(null),
    ...overrides,
  };
  return { deps, calls, root, loaded };
}

function keg(prefix: string, version: string): string {
  const exe = path.join(prefix, "Cellar", "golem", version, "bin", "golem");
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, "");
  const opt = path.join(prefix, "opt", "golem");
  fs.mkdirSync(path.dirname(opt), { recursive: true });
  fs.rmSync(opt, { force: true });
  fs.symlinkSync(path.join("..", "Cellar", "golem", version), opt);
  return exe;
}

test("the plist holds the job from the ticket's table, without --port", () => {
  const { deps } = fixture();
  const xml = renderWebPlist(deps, null);
  assert.deepEqual(plistProgram(xml), [deps.execPath, "web", "serve"]);
  assert.match(xml, /<key>Label<\/key>\s*<string>dev\.golem\.web<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  assert.match(xml, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${deps.userHome}</string>`));
  assert.match(xml, new RegExp(`<key>GOLEM_HOME</key>\\s*<string>${deps.golemHome}</string>`));
  assert.match(xml, new RegExp(`<key>StandardOutPath</key>\\s*<string>${deps.golemHome}/logs/web.stdout.log</string>`));
  assert.match(xml, new RegExp(`<key>StandardErrorPath</key>\\s*<string>${deps.golemHome}/logs/web.stderr.log</string>`));
  assert.match(xml, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
});

test("the plist adds --port only when it was given", () => {
  const { deps } = fixture();
  assert.deepEqual(plistProgram(renderWebPlist(deps, 7500)), [deps.execPath, "web", "serve", "--port", "7500"]);
  assert.deepEqual(webProgram(deps.execPath, null), [deps.execPath, "web", "serve"]);
});

test("values with XML characters are escaped, and read back as they were", () => {
  const { deps } = fixture({ golemHome: "/Users/a&b/<x>/.golem", userHome: "/Users/a&b" });
  const xml = renderWebPlist(deps, null);
  assert.ok(xml.includes("/Users/a&amp;b/&lt;x&gt;/.golem/logs/web.stdout.log"));
  assert.ok(!xml.includes("a&b"));
});

test("stablePath maps a Cellar path to the opt link", () => {
  const prefix = path.join(tmp(), "homebrew");
  const exe = keg(prefix, "0.1.0");
  const opt = path.join(prefix, "opt", "golem", "bin", "golem");
  assert.equal(stablePath(exe), opt);
  assert.equal(stablePath(opt), opt);
});

test("stablePath keeps a keg path that opt no longer points at", () => {
  const prefix = path.join(tmp(), "homebrew");
  const old = keg(prefix, "0.1.0");
  keg(prefix, "0.2.0");
  assert.equal(stablePath(old), old);
});

test("stablePath keeps a path that is not in a keg", () => {
  const root = tmp();
  const unlinked = path.join(root, "homebrew", "Cellar", "golem", "0.1.0", "bin", "golem");
  fs.mkdirSync(path.dirname(unlinked), { recursive: true });
  fs.writeFileSync(unlinked, "");
  const elsewhere = path.join(root, "Applications", "golem", "bin", "golem");
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.writeFileSync(elsewhere, "");
  assert.equal(stablePath(unlinked), unlinked);
  assert.equal(stablePath(elsewhere), elsewhere);
  assert.equal(stablePath(path.join(root, "missing")), path.join(root, "missing"));
});

test("install writes a 0600 plist, makes logs, and bootstraps", async () => {
  const f = fixture();
  const got = await installWebJob(f.deps, null);
  assert.equal(got.ok, true);
  assert.deepEqual(got.out, [INSTALLED_LINE]);
  const plist = webPlistPath(f.deps);
  assert.equal(fs.statSync(plist).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(f.deps.golemHome, "logs")).mode & 0o777, 0o700);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["print", "bootstrap"],
  );
  assert.deepEqual(f.calls[1], ["bootstrap", "gui/501", plist]);
});

test("install boots out a loaded job first", async () => {
  const f = fixture();
  f.loaded.value = true;
  await installWebJob(f.deps, 7500);
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["print", "bootout", "bootstrap"],
  );
  assert.deepEqual(f.calls[1], ["bootout", "gui/501/dev.golem.web"]);
});

test("install refuses on Linux and writes nothing", async () => {
  const f = fixture({ platform: "linux" });
  const got = await installWebJob(f.deps, null);
  assert.deepEqual(got, { ok: false, out: [], err: ["golem web install is macOS-only"] });
  assert.equal(fs.existsSync(f.deps.launchAgentsDir), false);
  assert.deepEqual(f.calls, []);
});

test("install refuses when golem runs through bun or node, and writes nothing", async () => {
  for (const exe of ["/Users/x/.bun/bin/bun", "/usr/local/bin/node"]) {
    const f = fixture({ execPath: exe });
    const got = await installWebJob(f.deps, null);
    assert.deepEqual(got, { ok: false, out: [], err: [RUNTIME_REFUSAL] });
    assert.equal(fs.existsSync(f.deps.launchAgentsDir), false);
    assert.deepEqual(f.calls, []);
  }
});

test("install says so when a gateway already holds the port, and still succeeds", async () => {
  const f = fixture({ liveGateway: () => Promise.resolve({ port: 7480, pid: 99 }) });
  const got = await installWebJob(f.deps, null);
  assert.equal(got.ok, true);
  assert.deepEqual(got.out, ["a gateway already runs on port 7480 (pid 99); the job starts when it stops", INSTALLED_LINE]);
});

test("a failed bootstrap is an error with launchctl's words", async () => {
  const f = fixture({}, false);
  const got = await installWebJob(f.deps, null);
  assert.equal(got.ok, false);
  assert.deepEqual(got.err, ["launchctl bootstrap failed: Bootstrap failed: 5"]);
});

test("uninstall boots out, deletes the plist, and leaves run and the logs", async () => {
  const f = fixture();
  await installWebJob(f.deps, null);
  fs.mkdirSync(path.join(f.deps.golemHome, "run"), { recursive: true });
  f.calls.length = 0;
  const got = uninstallWebJob(f.deps);
  assert.deepEqual(got, { ok: true, out: [], err: [] });
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["print", "bootout"],
  );
  assert.equal(fs.existsSync(webPlistPath(f.deps)), false);
  assert.equal(fs.existsSync(path.join(f.deps.golemHome, "run")), true);
  assert.equal(fs.existsSync(path.join(f.deps.golemHome, "logs")), true);
});

test("uninstall with nothing installed says so on stderr and succeeds", () => {
  const f = fixture();
  assert.deepEqual(uninstallWebJob(f.deps), { ok: true, out: [], err: [NOT_INSTALLED_LINE] });
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["print"],
  );
});

test("kickstart restarts a loaded job and is false when it is not loaded", () => {
  const f = fixture();
  assert.equal(kickstart(f.deps), false);
  assert.deepEqual(f.calls, [["print", "gui/501/dev.golem.web"]]);
  f.loaded.value = true;
  f.calls.length = 0;
  assert.equal(jobLoaded(f.deps), true);
  assert.equal(kickstart(f.deps), true);
  assert.deepEqual(f.calls.at(-1), ["kickstart", "-k", "gui/501/dev.golem.web"]);
});

test("a daemon restart restarts the web job when its plist exists", async () => {
  let kicks = 0;
  const warnings: string[] = [];
  await restartWebWithDaemon(
    () => ((kicks += 1), Promise.resolve(true)),
    () => true,
    (line) => warnings.push(line),
  );
  assert.equal(kicks, 1);
  assert.deepEqual(warnings, []);
});

test("without the plist a daemon restart does nothing and prints nothing", async () => {
  let kicks = 0;
  const warnings: string[] = [];
  await restartWebWithDaemon(
    () => ((kicks += 1), Promise.resolve(true)),
    () => false,
    (line) => warnings.push(line),
  );
  assert.equal(kicks, 0);
  assert.deepEqual(warnings, []);
});

test("a web job that fails to restart is one warning, never an error", async () => {
  const warnings: string[] = [];
  await restartWebWithDaemon(
    () => Promise.resolve(false),
    () => true,
    (line) => warnings.push(line),
  );
  await restartWebWithDaemon(
    () => Promise.reject(new Error("boom")),
    () => true,
    (line) => warnings.push(line),
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[1] ?? "", /boom/);
});
