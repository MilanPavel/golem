import { spawn } from "node:child_process";

import { connectGolem, resolveSocketPath } from "@golem/client";

import { formatKeys } from "./format-keys.ts";
import { formatModels } from "./format-models.ts";
import { formatStatus } from "./format-status.ts";
import { formatCliVersion } from "./format-version.ts";
import { CLI_VERSION } from "./version.ts";
import { readSecret } from "./read-secret.ts";
import { findWorkspaceRoot } from "./workspace.ts";

// exitCode, not exit(): exit() drops output a pipe has not read yet.
process.exitCode = await run(process.argv.slice(2));

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
  if (command === "auth") {
    return runAuth(rest);
  }
  if (command === "models" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--refresh"))) {
    return runModels(rest[0] === "--refresh");
  }
  process.stderr.write(`${USAGE}\n`);
  return 1;
}

const USAGE =
  "usage: golem --version | golem status | golem daemon install|start|stop|logs\n" +
  "       golem auth set|remove <provider> | golem auth list | golem models [--refresh]";

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
