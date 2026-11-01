import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { connectGolem, GOLEM_VERSION, readStartError, resolveSocketPath } from "@golem/client/node";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import { awaitRestart, formatRestarted } from "./await-restart.ts";
import { type DaemonCommand, locateDaemon } from "./daemon-locator.ts";
import { doctorExitCode, formatDoctor, parseChecks, runDoctor } from "./doctor.ts";

import { formatConfig } from "./format-config.ts";
import { formatKeys } from "./format-keys.ts";
import { formatModels } from "./format-models.ts";
import { formatSkills } from "./format-skills.ts";
import { formatStatus } from "./format-status.ts";
import { formatCliVersion } from "./format-version.ts";
import { readChoice } from "./read-choice.ts";
import { readSecret } from "./read-secret.ts";
import { type Gate, gateService, type SessionDaemon } from "./service-gate.ts";
import { parseWebArgs } from "./web.ts";
import { runWeb } from "./web-command.ts";
import { findWorkspaceRoot } from "./workspace.ts";

// The first start of a fresh build takes a few seconds while macOS checks its libraries.
const RESTART_TIMEOUT_MS = 15_000;
// The very first start after `brew install` also checks every library once.
const FIRST_START_TIMEOUT_MS = 30_000;
// launchd's job, as golem/launchd.py names it.
const LAUNCH_AGENT = join(homedir(), "Library", "LaunchAgents", "dev.golem.daemon.plist");

const USAGE =
  "usage: golem\n" +
  "       golem --version | golem --help | golem status | golem doctor\n" +
  "       golem daemon install|start|stop|restart|uninstall|logs\n" +
  "       golem auth set|remove <provider> | golem auth list | golem models [--refresh]\n" +
  "       golem config show [--resolved] | golem skills [list] | golem skills check <path>\n" +
  "       golem web [--port N] [--no-open] [--json]";

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
  if (command === "doctor" && rest.length === 0) {
    return runDoctorCommand();
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
  if (command === "skills" && (rest.length === 0 || (rest.length === 1 && rest[0] === "list"))) {
    return runSkillsList();
  }
  if (command === "skills" && rest[0] === "check" && rest.length === 2 && rest[1] !== undefined) {
    return runSkillsCheck(rest[1]);
  }
  if (command === "web") {
    const parsed = parseWebArgs(rest);
    if (parsed !== null) return runWeb(parsed);
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

async function runSkillsList(): Promise<number> {
  const client = connectOnce();
  try {
    const listed = await client.listSkills(process.cwd());
    const columns = process.stdout.isTTY ? process.stdout.columns : undefined;
    process.stdout.write(`${formatSkills(listed.skills, homedir(), columns)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

/** Run by the daemon executable, so it works with no daemon running. */
async function runSkillsCheck(path: string): Promise<number> {
  let located;
  try {
    located = locate();
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return 1;
  }
  return runLocated(located.command, [...located.args, "skills", "check", resolve(path)]);
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
    const startError = readStartError();
    process.stderr.write(startError === null ? `${explain(error)}\n` : formatStartError(startError));
    return 1;
  } finally {
    client.close();
  }
}

async function runDoctorCommand(): Promise<number> {
  let located: DaemonCommand | { error: string };
  try {
    located = locate();
  } catch (error) {
    located = { error: explain(error) };
  }
  const checks = await runDoctor({
    cliVersion: GOLEM_VERSION,
    located,
    daemonChecks: async (daemon) =>
      parseChecks(await captureLocated(daemon.command, [...daemon.args, "doctor"])),
    readStatus: readDaemonStatus,
  });
  process.stdout.write(`${formatDoctor(checks)}\n`);
  return doctorExitCode(checks);
}

function locate(): DaemonCommand {
  return locateDaemon({
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
}

async function runDaemon(args: string[]): Promise<number> {
  let located;
  try {
    located = locate();
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

function formatStartError(error: { reason: string; next: string }): string {
  const next = error.next.length > 0 ? `next: ${error.next}\n` : "";
  return `golem can't start: ${error.reason}\n${next}`;
}

/** `golem daemon restart` for the chat screen: no output, and an error when it does not come back. */
async function restartQuietly(): Promise<void> {
  const located = locate();
  const previous = await readDaemonStatus();
  await captureLocated(located.command, [...located.args, "daemon", "restart"]);
  const restarted = await awaitRestart(previous?.pid ?? null, {
    readStatus: readDaemonStatus,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    timeoutMs: RESTART_TIMEOUT_MS,
    pollMs: 200,
  });
  if (restarted === null) {
    throw new Error(formatRestarted(null, RESTART_TIMEOUT_MS));
  }
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

/** Run the daemon executable and return what it printed. Throws when it fails. */
async function captureLocated(command: string, args: string[]): Promise<string> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    const detail = Buffer.concat(err).toString("utf8").trim().split("\n").at(-1) ?? "";
    throw new Error(detail.length > 0 ? detail : `exit code ${exitCode}`);
  }
  return Buffer.concat(out).toString("utf8");
}

async function openTui(): Promise<number> {
  const gate = await gateService(serviceGate());
  if (gate.kind === "exit") {
    return gate.code;
  }
  try {
    const tui = await import("@golem/tui");
    await tui.runTui({
      service: { startError: readStartError, installed: () => existsSync(LAUNCH_AGENT), restart: restartQuietly },
    });
    return 0;
  } finally {
    gate.session?.stop();
  }
}

function serviceGate(): Gate {
  return {
    answers: async () => (await readDaemonStatus()) !== null,
    installed: () => existsSync(LAUNCH_AGENT),
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    ask: readChoice,
    install: async () => {
      const located = locateOrSay();
      return located !== null && (await runLocated(located.command, [...located.args, "daemon", "install"])) === 0;
    },
    serve: () => {
      const located = locateOrSay();
      return located === null ? null : serveForThisWindow(located);
    },
    waitUntilAnswers: async (giveUp) =>
      (await awaitRestart(null, {
        readStatus: readDaemonStatus,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        timeoutMs: FIRST_START_TIMEOUT_MS,
        pollMs: 200,
        giveUp,
      })) !== null,
    write: (text) => process.stdout.write(text),
  };
}

function locateOrSay(): DaemonCommand | null {
  try {
    return locate();
  } catch (error) {
    process.stderr.write(`${explain(error)}\n`);
    return null;
  }
}

/**
 * The daemon as a child of this process. It logs to ~/.golem/logs itself; stderr
 * is kept only for a crash before it answers, and read all along so it never blocks.
 */
function serveForThisWindow(located: DaemonCommand): SessionDaemon {
  const child = spawn(located.command, [...located.args, "serve"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  let failed = false;
  child.on("error", (error) => {
    failed = true;
    stderr += `${error.message}\n`;
  });
  // SIGTERM lets the daemon cancel running answers, keep what they said, and release its lock.
  const stop = (): void => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  };
  process.on("exit", stop);
  return {
    stop: () => {
      process.off("exit", stop);
      stop();
    },
    output: () => stderr,
    exited: () => child.exitCode !== null || child.signalCode !== null || failed,
  };
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
