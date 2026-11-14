import { dirname } from "node:path";

import { GOLEM_VERSION, resolveSocketPath } from "@golem/client/node";
import { createSessionStore, randomSecret } from "@golem/gateway";
import {
  checkRunDirSync,
  clearSessionFile,
  ensureRunDir,
  removeRunFile,
  removeTokenFile,
  resolveRunDir,
  sessionFilePersistence,
  writeRunFile,
  writeTokenFile,
} from "@golem/gateway/node";
import { loadAssets } from "@golem/gateway/assets";
import { startGateway, type Gateway } from "@golem/gateway/server";

import type { WebArgs } from "./web.ts";
import { kickstart, realLaunchDeps, type LaunchDeps } from "./web-launchd.ts";
import { busy, findLive, findLiveQuietly, show, useLive, type WebDeps } from "./web-live.ts";

/** The web job's launchd calls, against the real `launchctl`. */
export function launchDeps(): LaunchDeps {
  const runDir = resolveRunDir();
  return realLaunchDeps(dirname(runDir), async () => {
    const live = await findLiveQuietly(runDir);
    return live === null ? null : { port: live.port, pid: live.health.pid };
  });
}

export const DEFAULT_WEB_DEPS: WebDeps = {
  version: GOLEM_VERSION,
  restartWebJob: () => Promise.resolve(kickstart(launchDeps())),
  pollMs: 200,
  timeoutMs: 10_000,
};

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
export async function runWeb(args: WebArgs, deps: WebDeps = DEFAULT_WEB_DEPS): Promise<number> {
  try {
    return await runGateway(args, deps);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runGateway(args: WebArgs, deps: WebDeps): Promise<number> {
  const runDir = resolveRunDir();
  await ensureRunDir(runDir);
  const live = await findLive(runDir);
  if (live !== null) return args.serve ? busy(live) : useLive(args, runDir, live, deps);
  await removeRunFile(runDir);

  // Start before writing the token, so a taken port leaves a running gateway's token alone.
  const token = randomSecret();
  let gateway: Gateway;
  try {
    gateway = startGateway({
      port: args.port,
      socketPath: resolveSocketPath(),
      token,
      assets: loadAssets(),
      sessions: createSessionStore({ persistence: sessionFilePersistence(runDir) }),
      version: deps.version,
      kept: args.serve,
    });
  } catch (error) {
    if (!isAddressInUse(error)) throw error;
    // A `golem web` that started at the same moment may have won the port. Reuse it only when
    // web.json names it: anything else on the port could be another user's server, and must never
    // see the token.
    const winner = await findLive(runDir);
    if (winner !== null) return args.serve ? busy(winner) : useLive(args, runDir, winner, deps);
    process.stderr.write(`port ${args.port} is in use. Try golem --port <other>\n`);
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
  return stopped;
}

/** `golem web logout`: forgets every sign-in. A gateway that runs refuses their cookies from the next request. */
export function runWebLogout(): number {
  try {
    const runDir = resolveRunDir();
    try {
      checkRunDirSync(runDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        process.stdout.write("golem web: no one is signed in\n");
        return 0;
      }
      throw error;
    }
    clearSessionFile(runDir);
    process.stdout.write("golem web: signed out every browser. Run golem for a new link\n");
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
