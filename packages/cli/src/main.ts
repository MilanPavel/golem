import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { connectGolem, GOLEM_VERSION, resolveSocketPath } from "@golem/client";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import { awaitRestart, formatRestarted } from "./await-restart.ts";
import { locateDaemon } from "./daemon-locator.ts";

import { formatConfig } from "./format-config.ts";
import { formatKeys } from "./format-keys.ts";
import { formatModels } from "./format-models.ts";
import { formatStatus } from "./format-status.ts";
import { formatCliVersion } from "./format-version.ts";
import { readSecret } from "./read-secret.ts";
import { findWorkspaceRoot } from "./workspace.ts";

// The first start of a fresh build takes a few seconds while macOS checks its libraries.
const RESTART_TIMEOUT_MS = 15_000;

const USAGE =
  "usage: golem\n" +
  "       golem --version | golem --help | golem status\n" +
  "       golem daemon install|start|stop|restart|uninstall|logs\n" +
  "       golem auth set|remove <provider> | golem auth list | golem models [--refresh]\n" +
  "       golem config show [--resolved]";

// exitCode, not exit(): exit() drops output a pipe has not read yet.
process.exitCode = await run(process.argv.slice(2));

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined) {
    return openTui();
  }
  if (command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (command === "--version") {
    return runVersion();
  }
  if (command === "status") {
    return runStatus();
  }
  if (command === "daemon") {
    return runDaemon(rest);
  }
  if (command === "auth") {
    return runAuth(rest);
  }
  if (command === "models" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--refresh"))) {
    return runModels(rest[0] === "--refresh");
  }
  if (command === "config" && rest[0] === "show" && (rest.length === 1 || (rest.length === 2 && rest[1] === "--resolved"))) {
    return runConfigShow();
  }
  process.stderr.write(`${USAGE}\n`);
  return 1;
}

async function runConfigShow(): Promise<number> {
  const client = connectOnce();
  try {
    process.stdout.write(`${formatConfig(await client.getConfig(process.cwd()))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runModels(refresh: boolean): Promise<number> {
  const client = connectOnce();
  try {
    process.stdout.write(`${formatModels(await client.listModels(refresh))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runAuth(args: string[]): Promise<number> {
  const [action, provider, ...extra] = args;
  const named = provider !== undefined && provider.length > 0 && extra.length === 0;
  if (!(action === "list" && provider === undefined) && !((action === "set" || action === "remove") && named)) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  let key = "";
  if (action === "set") {
    try {
      key = await readSecret(`${provider} API key: `);
    } catch (error) {
      process.stderr.write(`${explain(error)}\n`);
      return 1;
    }
    if (key.length === 0) {
      process.stderr.write("no key given\n");
      return 1;
    }
  }
  const client = connectOnce();
  try {
    if (action === "list") {
      const listed = await client.listKeys();
      process.stdout.write(`${formatKeys(listed.providers)}\n`);
    } else if (action === "set") {
      await client.setKey(provider ?? "", key);
      process.stdout.write(`${provider} key saved in the Keychain\n`);
    } else {
      const removed = await client.removeKey(provider ?? "");
      process.stdout.write(
        removed.removed ? `${provider} key removed from the Keychain\n` : `no ${provider} key was stored\n`,
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runVersion(): Promise<number> {
  process.stdout.write(`${formatCliVersion(GOLEM_VERSION, await readDaemonVersion())}\n`);
  return 0;
}

async function readDaemonVersion(): Promise<string | null> {
  return (await readDaemonStatus())?.version ?? null;
}

async function readDaemonStatus(): Promise<DaemonStatus | null> {
  const client = connectOnce();
  try {
    return await client.status();
  } catch {
    return null;
  } finally {
    client.close();
  }
}

function connectOnce() {
  return connectGolem({
    socketPath: resolveSocketPath(),
    clientName: "cli",
    reconnect: false,
    connectTimeoutMs: 2_000,
    heartbeatMs: 60_000,
  });
}

async function runStatus(): Promise<number> {
  const client = connectOnce();
  try {
    const status = await client.status();
    process.stdout.write(`${formatStatus(status)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runDaemon(args: string[]): Promise<number> {
  let located;
  try {
    located = locateDaemon({
      golemDaemon: process.env["GOLEM_DAEMON"],
      // Homebrew's bin/golem is a link into the keg, where libexec/ sits.
      execPath: realpathSync(process.execPath),
      startDir: import.meta.dirname,
      exists: existsSync,
      workspaceRoot: (start) => {
        try {
          return findWorkspaceRoot(start);
        } catch {
          return null;
        }
      },
    });
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  }
  const restarting = args.length === 1 && args[0] === "restart";
  const previous = restarting ? await readDaemonStatus() : null;
  const exitCode = await runLocated(located.command, [...located.args, "daemon", ...args]);
  if (!restarting || exitCode !== 0) {
    return exitCode;
  }
  const restarted = await awaitRestart(previous?.pid ?? null, {
    readStatus: readDaemonStatus,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    timeoutMs: RESTART_TIMEOUT_MS,
    pollMs: 200,
  });
  const report = formatRestarted(restarted, RESTART_TIMEOUT_MS);
  if (restarted === null) {
    process.stderr.write(`${report}\n`);
    return 1;
  }
  process.stdout.write(`${report}\n`);
  return 0;
}

async function runLocated(command: string, args: string[]): Promise<number> {
  const child = spawn(command, args, { stdio: "inherit" });
  return await new Promise((resolve) => {
    child.on("error", (error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });
}

async function openTui(): Promise<number> {
  const tui = await import("@golem/tui");
  await tui.runTui();
  return 0;
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("ENOENT") ||
    message.includes("timed out")
  ) {
    return `daemon is not running (${message})`;
  }
  return message;
}
