import { spawn } from "node:child_process";

import { connectGolem, resolveSocketPath } from "@golem/client";

import { formatStatus } from "./format-status.ts";
import { formatCliVersion } from "./format-version.ts";
import { CLI_VERSION } from "./version.ts";
import { findWorkspaceRoot } from "./workspace.ts";

const code = await run(process.argv.slice(2));
process.exit(code);

async function run(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === "--version") {
    return runVersion();
  }
  if (command === "status") {
    return runStatus();
  }
  if (command === "daemon") {
    return runDaemon(rest);
  }
  process.stderr.write(
    "usage: golem --version | golem status | golem daemon install|start|stop|logs\n",
  );
  return 1;
}

async function runVersion(): Promise<number> {
  process.stdout.write(`${formatCliVersion(CLI_VERSION, await readDaemonVersion())}\n`);
  return 0;
}

async function readDaemonVersion(): Promise<string | null> {
  const client = connectOnce();
  try {
    const status = await client.status();
    return status.version;
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
  const root = findWorkspaceRoot(import.meta.dirname);
  const child = spawn(
    "uv",
    ["run", "--project", root, "python", "-m", "golem", "daemon", ...args],
    { stdio: "inherit" },
  );
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
