import { spawn } from "node:child_process";

import { readRunFile, readTokenFile } from "@golem/gateway/node";

import { formatWebOutput, isLiveHealth, isSafeLink, webLink, type WebArgs } from "./web.ts";

// What `golem web` does with a gateway that already runs. Kept apart from web-command.ts, which
// imports the server, so these steps run under node in the tests.

const HEALTH_TIMEOUT_MS = 1_000;

/** Exit code of `golem web serve` when a foreground gateway owns the port: the job retries later. */
export const EXIT_BUSY = 75;

export interface Health {
  golem: string;
  pid: number;
  /** Missing on a gateway from before `/healthz` reported it. */
  version?: string;
  /** True when a job keeps the gateway running. */
  kept?: boolean;
}

export interface Live {
  health: Health;
  port: number;
}

/** What `golem web` needs from outside: tests pass fakes, so no real job is touched. */
export interface WebDeps {
  /** This golem's version. */
  version: string;
  /** Restarts the web job. False when there is none to restart. */
  restartWebJob(): Promise<boolean>;
  /** True when no default model is chosen yet, so setup continues in the browser. */
  firstRun?(): Promise<boolean>;
  pollMs: number;
  timeoutMs: number;
}

/** What `/healthz` on the port says, or null when nothing answers like a gateway. */
async function askHealth(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    const pid = (body as { pid?: unknown } | null)?.pid;
    if (typeof pid !== "number" || !isLiveHealth(body, pid)) return null;
    const { version, kept } = body as { version?: unknown; kept?: unknown };
    const health: Health = { golem: "web", pid };
    if (typeof version === "string") health.version = version;
    if (typeof kept === "boolean") health.kept = kept;
    return health;
  } catch {
    return null;
  }
}

/** Opens the link. The link goes in on stdin, because process arguments are visible to other users. */
function openBrowser(link: string): Promise<boolean> {
  if (!isSafeLink(link)) return Promise.resolve(false);
  return new Promise((done) => {
    const child = spawn("osascript", [], { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    child.stdin.on("error", () => done(false));
    child.stdin.end(`open location "${link}"\n`);
  });
}

/** Prints what `golem web` shows, and opens the browser when asked. `serve` prints no link. */
export async function show(
  args: WebArgs,
  port: number,
  pid: number,
  token: string,
  started: boolean,
  firstRun = false,
): Promise<void> {
  if (args.serve) {
    const lines = formatWebOutput({ json: false, opened: false, link: "", port, pid, started, serve: true });
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }
  const link = webLink(port, token);
  const opened = args.open && (await openBrowser(link));
  const lines = formatWebOutput({ json: args.json, opened, link, port, pid, started, firstRun });
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Uses the gateway that already runs: its token is in `web.token`. */
async function reuse(args: WebArgs, runDir: string, health: Health, port: number, deps: WebDeps): Promise<number> {
  if (args.portGiven && args.port !== 0 && args.port !== port) {
    process.stderr.write(`golem web already runs on port ${port}\n`);
  }
  // Only a gateway a job keeps outlives this window, so only then may the person close it.
  const firstRun = health.kept === true && deps.firstRun !== undefined && (await deps.firstRun().catch(() => false));
  await show(args, port, health.pid, await readTokenFile(runDir), false, firstRun);
  return 0;
}

/** Reuses the live gateway, after a look at its version. */
export async function useLive(args: WebArgs, runDir: string, live: Live, deps: WebDeps): Promise<number> {
  const { health } = live;
  if (health.version === deps.version) return reuse(args, runDir, health, live.port, deps);
  if (health.kept !== true) {
    // A foreground or older gateway is not ours to stop.
    const served = health.version === undefined ? "an older golem" : `golem ${health.version}`;
    process.stderr.write(`the page is served by ${served}; Ctrl-C it and run golem again for ${deps.version}\n`);
    return reuse(args, runDir, health, live.port, deps);
  }
  if (!(await deps.restartWebJob())) return reuse(args, runDir, health, live.port, deps);
  const fresh = await waitForNewer(runDir, health.pid, deps);
  if (fresh === null) {
    process.stderr.write("the web service did not come back; golem web uninstall, then golem web install\n");
    return 1;
  }
  return reuse(args, runDir, fresh.health, fresh.port, deps);
}

/** Polls until `web.json` names another pid whose `/healthz` reports this golem's version. */
async function waitForNewer(runDir: string, oldPid: number, deps: WebDeps): Promise<Live | null> {
  const deadline = Date.now() + deps.timeoutMs;
  for (;;) {
    const live = await findLive(runDir);
    if (live !== null && live.health.pid !== oldPid && live.health.version === deps.version) return live;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, deps.pollMs));
  }
}

/** Says a foreground gateway owns the port, for `golem web serve`. */
export function busy(live: Live): number {
  process.stderr.write(`golem web: another gateway runs on port ${live.port} (pid ${live.health.pid})\n`);
  return EXIT_BUSY;
}

/** `findLive`, or null when the run directory cannot be read (it does not exist before the first run). */
export async function findLiveQuietly(runDir: string): Promise<Live | null> {
  try {
    return await findLive(runDir);
  } catch {
    return null;
  }
}

/** The record's gateway, when `/healthz` on its port answers with its pid. */
export async function findLive(runDir: string): Promise<Live | null> {
  const record = await readRunFile(runDir);
  if (record === null) return null;
  const health = await askHealth(record.port);
  return health !== null && health.pid === record.pid ? { health, port: record.port } : null;
}
