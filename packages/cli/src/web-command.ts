import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { resolveSocketPath } from "@golem/client/node";
import { randomSecret } from "@golem/gateway";
import {
  ensureRunDir,
  readRunFile,
  readTokenFile,
  removeRunFile,
  removeTokenFile,
  resolveRunDir,
  writeRunFile,
  writeTokenFile,
} from "@golem/gateway/node";
import { startGateway, type Gateway } from "@golem/gateway/server";

import { formatWebOutput, isLiveHealth, isSafeLink, webLink, type WebArgs } from "./web.ts";

const HEALTH_TIMEOUT_MS = 1_000;

interface Health {
  golem: string;
  pid: number;
}

/** What `/healthz` on the port says, or null when nothing answers like a gateway. */
async function askHealth(port: number): Promise<Health | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    const pid = (body as { pid?: unknown } | null)?.pid;
    if (typeof pid !== "number" || !isLiveHealth(body, pid)) return null;
    return { golem: "web", pid };
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

async function show(args: WebArgs, port: number, pid: number, token: string, started: boolean): Promise<void> {
  const link = webLink(port, token);
  const opened = args.open && (await openBrowser(link));
  const lines = formatWebOutput({ json: args.json, opened, link, port, pid, started });
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Uses the gateway that already runs: its token is in `web.token`. */
async function reuse(args: WebArgs, runDir: string, health: Health, port: number): Promise<number> {
  if (args.portGiven && args.port !== 0 && args.port !== port) {
    process.stderr.write(`golem web already runs on port ${port}\n`);
  }
  await show(args, port, health.pid, await readTokenFile(runDir), false);
  return 0;
}

/** The record's gateway, when `/healthz` on its port answers with its pid. */
async function findLive(runDir: string): Promise<{ health: Health; port: number } | null> {
  const record = await readRunFile(runDir);
  if (record === null) return null;
  const health = await askHealth(record.port);
  return health !== null && health.pid === record.pid ? { health, port: record.port } : null;
}

function isAddressInUse(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown };
  return e.code === "EADDRINUSE" || (typeof e.message === "string" && e.message.includes("EADDRINUSE"));
}

/** Waits for Ctrl-C or a stop, then removes what this gateway made. */
function stayUntilStopped(gateway: Gateway, runDir: string): Promise<number> {
  return new Promise((done) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      void (async () => {
        try {
          await gateway.stop();
        } finally {
          await removeTokenFile(runDir);
          await removeRunFile(runDir, process.pid);
          done(0);
        }
      })();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

/** `golem web`: shows the link of the gateway that runs, or runs one until Ctrl-C. */
export async function runWeb(args: WebArgs): Promise<number> {
  try {
    return await runGateway(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runGateway(args: WebArgs): Promise<number> {
  const runDir = resolveRunDir();
  await ensureRunDir(runDir);
  const live = await findLive(runDir);
  if (live !== null) return reuse(args, runDir, live.health, live.port);
  await removeRunFile(runDir);

  // Start before writing the token, so a taken port leaves a running gateway's token alone.
  const token = randomSecret();
  let gateway: Gateway;
  try {
    gateway = startGateway({ port: args.port, socketPath: resolveSocketPath(), token });
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    // A `golem web` that started at the same moment may have won the port. Reuse it only when
    // web.json names it: anything else on the port could be another user's server, and must never
    // see the token.
    const winner = await findLive(runDir);
    if (winner !== null) return reuse(args, runDir, winner.health, winner.port);
    process.stderr.write(`port ${args.port} is in use. Try golem web --port <other>\n`);
    return 1;
  }
  try {
    await writeTokenFile(runDir, token);
    await writeRunFile(runDir, { pid: process.pid, port: gateway.port, started_at: new Date().toISOString() });
  } catch (error) {
    await gateway.stop();
    await removeTokenFile(runDir);
    throw error;
  }
  const stopped = stayUntilStopped(gateway, runDir);
  await show(args, gateway.port, process.pid, token, true);
  if (!existsSync(resolveSocketPath())) {
    process.stderr.write("the daemon is not running. Start it with golem daemon start\n");
  }
  return stopped;
}
