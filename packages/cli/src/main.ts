import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  connectGolem,
  GOLEM_VERSION,
  KEY_UNCHECKED,
  readStartError,
  resolveGolemHome,
  resolveSocketPath,
  RpcError,
} from "@golem/client/node";

import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import { entryAvailable, entryInputs, entryParams, findEntry, inputDefault, inputError } from "@golem/view";

import { awaitRestart, formatRestarted } from "./await-restart.ts";
import { type DaemonCommand, locateDaemon } from "./daemon-locator.ts";
import { explainDaemonDown, isDaemonDown } from "./daemon-down.ts";
import { doctorExitCode, formatDoctor, parseChecks, runDoctor } from "./doctor.ts";

import { formatConfig } from "./format-config.ts";
import { formatKeys } from "./format-keys.ts";
import { formatModels } from "./format-models.ts";
import { formatSkills } from "./format-skills.ts";
import { formatStatus } from "./format-status.ts";
import { formatCliVersion } from "./format-version.ts";
import { parseMcpArgs, type McpArgs } from "./mcp-command.ts";
import { exportServers } from "./mcp-export.ts";
import { readChoice } from "./read-choice.ts";
import { readSecret } from "./read-secret.ts";
import { type Gate, gateService, type SessionDaemon } from "./service-gate.ts";
import { parseWebArgs, type WebArgs } from "./web.ts";
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
  "       golem --version | golem --help | golem status | golem doctor [--mcp]\n" +
  "       golem daemon install|start|stop|restart|uninstall|logs\n" +
  "       golem auth set <provider> [--no-check] | golem auth remove <provider> | golem auth list | golem models [--refresh]\n" +
  "       golem mcp add <name> -- <command…> [--token-env VAR] | golem mcp add <name> --url <url> [--token] | golem mcp add --catalog <id> [--input <id>=<value>] | golem mcp remove <name> | golem mcp export [--format claude|vscode] [--scope user|project]\n" +
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
  if (command === "doctor" && (rest.length === 0 || (rest.length === 1 && rest[0] === "--mcp"))) {
    return runDoctorCommand(rest.length === 1);
  }
  if (command === "daemon") {
    return runDaemon(rest);
  }
  if (command === "auth") {
    return runAuth(rest);
  }
  if (command === "mcp") {
    return runMcp(rest);
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
    if (parsed !== null) return openWeb(parsed);
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
    process.stderr.write(`${explainClient(error)}\n`);
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
    process.stderr.write(`${explainClient(error)}\n`);
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
    process.stderr.write(`${explainClient(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runAuth(given: string[]): Promise<number> {
  const check = !given.includes("--no-check");
  const args = given.filter((arg) => arg !== "--no-check");
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
      const stored = await client.setKey(provider ?? "", key, { check });
      const opens =
        stored.models === undefined || stored.models === null
          ? ""
          : ` · it works, ${stored.models} ${stored.models === 1 ? "model" : "models"}`;
      process.stdout.write(`${provider} key saved in the Keychain${opens}\n`);
    } else {
      const removed = await client.removeKey(provider ?? "");
      process.stdout.write(
        removed.removed ? `${provider} key removed from the Keychain\n` : `no ${provider} key was stored\n`,
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${explainClient(error)}\n`);
    if (error instanceof RpcError && error.code === KEY_UNCHECKED) {
      process.stderr.write(`to store it anyway: golem auth set ${provider} --no-check\n`);
    }
    return 1;
  } finally {
    client.close();
  }
}

async function runMcp(given: string[]): Promise<number> {
  const parsed = parseMcpArgs(given);
  if (parsed.kind === "error") {
    process.stderr.write(`${parsed.message}\n`);
    return 1;
  }
  if (parsed.kind === "catalog") {
    return runMcpCatalogAdd(parsed);
  }
  if (parsed.kind === "export") {
    return runMcpExport(parsed);
  }
  let token = "";
  const wantsToken = parsed.kind === "add" && ("url" in parsed ? parsed.token : parsed.tokenEnv !== null);
  if (wantsToken) {
    try {
      token = await readSecret(`token for ${parsed.name}: `);
    } catch (error) {
      process.stderr.write(`${explain(error)}\n`);
      return 1;
    }
    if (token.length === 0) {
      process.stderr.write("no token given\n");
      return 1;
    }
  }
  const client = connectOnce();
  try {
    if (parsed.kind === "remove") {
      await client.removeMcpServer(parsed.name);
      process.stdout.write(`removed ${parsed.name}\n`);
    } else {
      const tokenParam = token.length > 0 ? { token } : {};
      const added = await client.addMcpServer(
        "url" in parsed
          ? { name: parsed.name, url: parsed.url, ...tokenParam }
          : {
              name: parsed.name,
              command: parsed.command,
              args: parsed.args,
              ...(parsed.tokenEnv === null ? {} : { token_env: parsed.tokenEnv }),
              ...tokenParam,
            },
      );
      process.stdout.write(`added ${parsed.name} · ${added.state}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${explainClient(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

/** `golem mcp export`: print the servers as another app's JSON. Secret values never leave the Keychain. */
async function runMcpExport(parsed: Extract<McpArgs, { kind: "export" }>): Promise<number> {
  const client = connectOnce();
  let sessionId: string | undefined;
  try {
    if (parsed.scope === "project") {
      sessionId = (await client.createSession({ cwd: process.cwd() })).session_id;
    }
    const { servers } = await client.listMcp(sessionId);
    const details = [];
    for (const server of servers) {
      const detail = await client.mcpGet(server.name, sessionId);
      if (detail.scope === parsed.scope) details.push(detail);
    }
    const made = exportServers(details, parsed.format);
    process.stdout.write(`${made.json}\n`);
    if (details.length === 0) process.stderr.write(`no ${parsed.scope} servers to export\n`);
    for (const note of made.notes) process.stderr.write(`${note}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explainClient(error)}\n`);
    return 1;
  } finally {
    if (sessionId !== undefined) await client.closeSession(sessionId).catch(() => undefined);
    client.close();
  }
}

/** `golem mcp add --catalog <id>`: the daemon fills the entry's template. Secrets are asked for, hidden. */
async function runMcpCatalogAdd(parsed: Extract<McpArgs, { kind: "catalog" }>): Promise<number> {
  const client = connectOnce();
  try {
    const { entries } = await client.mcpCatalog();
    const entry = findEntry(entries, parsed.id);
    if (entry === null) {
      process.stderr.write(`${parsed.id} is not in the catalog. It has: ${entries.map((each) => each.id).join(", ")}\n`);
      return 1;
    }
    if (!entryAvailable(entry)) {
      process.stderr.write(`${entry.title}: ${entry.reason ?? "not available"}\n`);
      return 1;
    }
    const values: Record<string, string> = {};
    for (const input of entryInputs(entry)) {
      const given = parsed.inputs[input.id];
      if (input.kind === "secret") {
        values[input.id] = await readSecret(`${input.label.toLowerCase()} for ${parsed.name ?? entry.name}: `);
      } else {
        values[input.id] = given ?? inputDefault(input, process.cwd());
      }
      const error = inputError(input, values[input.id] ?? "");
      if (error !== null) {
        process.stderr.write(`${error}${input.kind === "secret" ? "" : ` Give it with --input ${input.id}=<value>.`}\n`);
        return 1;
      }
    }
    const unknown = Object.keys(parsed.inputs).filter((key) => !entryInputs(entry).some((input) => input.id === key));
    if (unknown.length > 0) {
      process.stderr.write(`${entry.id} has no input ${unknown.join(", ")}\n`);
      return 1;
    }
    const params = entryParams(entry, values);
    const added = await client.addMcpServer(parsed.name === null ? params : { ...params, name: parsed.name });
    process.stdout.write(`added ${added.name} · ${added.state}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${explainClient(error)}\n`);
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
    process.stderr.write(`${explainClient(error)}\n`);
    return 1;
  } finally {
    client.close();
  }
}

async function runDoctorCommand(mcp: boolean): Promise<number> {
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
      parseChecks(
        await captureLocated(daemon.command, [...daemon.args, "doctor", ...(mcp ? ["--mcp"] : [])]),
      ),
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

/**
 * The chat screen. With no service it opens on the setup window, which asks
 * whether golem may start one. A daemon it starts for this terminal stops when golem quits.
 */
async function openTui(): Promise<number> {
  const owned: { session: SessionDaemon | null } = { session: null };
  const daemon = async (...args: string[]): Promise<void> => {
    const located = locate();
    await captureLocated(located.command, [...located.args, "daemon", ...args]);
  };
  try {
    const tui = await import("@golem/tui");
    await tui.runTui({
      service: {
        startError: readStartError,
        installed: () => existsSync(LAUNCH_AGENT),
        agentLoaded: launchAgentLoaded,
        restart: restartQuietly,
        install: () => daemon("install"),
        uninstall: () => daemon("uninstall"),
        serve: () => {
          owned.session?.stop();
          owned.session = serveForThisWindow(locate());
          return owned.session;
        },
        windowDaemon: () => (owned.session === null || owned.session.exited() ? null : owned.session),
        logTail: () => logTail(join(resolveGolemHome(), "logs", "launchd.stderr.log"), 8),
      },
    });
    return 0;
  } finally {
    owned.session?.stop();
  }
}

/** launchd has the job loaded, and the program its plist names is still there. */
function launchAgentLoaded(): boolean {
  if (!existsSync(LAUNCH_AGENT)) {
    return false;
  }
  const program = spawnSync("plutil", ["-extract", "ProgramArguments.0", "raw", "-o", "-", LAUNCH_AGENT], {
    encoding: "utf8",
  });
  if (program.status !== 0 || !existsSync(program.stdout.trim())) {
    return false;
  }
  const job = spawnSync("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/dev.golem.daemon`], { stdio: "ignore" });
  return job.status === 0;
}

/** The last `count` lines of a log file, or none when it can't be read. */
function logTail(file: string, count: number): string[] {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-count);
  } catch {
    return [];
  }
}

/**
 * `golem web` checks the daemon first, so the page does not open on "daemon down".
 * In a terminal it asks the question `golem` asks. With `--no-open` or `--json`
 * it never asks: with no daemon it says why or what to run, and exits 1.
 */
async function openWeb(args: WebArgs): Promise<number> {
  if (!args.open) {
    const down = await daemonDown();
    if (down !== null) {
      process.stderr.write(`${down}\n`);
      return 1;
    }
    return runWeb(args);
  }
  const gate = await gateService(serviceGate());
  if (gate.kind === "exit") {
    return gate.code;
  }
  try {
    return await runWeb(args);
  } finally {
    gate.session?.stop();
  }
}

/** Null when a daemon answers. Otherwise what a command that needs one prints. */
async function daemonDown(): Promise<string | null> {
  const client = connectOnce();
  try {
    await client.status();
    return null;
  } catch (error) {
    return explainClient(error);
  } finally {
    client.close();
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
  // Closing the terminal sends SIGHUP, and nothing runs on "exit" after a signal: stop it here too.
  const onSignal = (signal: NodeJS.Signals): void => {
    stop();
    process.exit(signal === "SIGHUP" ? 129 : 143);
  };
  process.on("exit", stop);
  process.once("SIGHUP", onSignal);
  process.once("SIGTERM", onSignal);
  return {
    stop: () => {
      process.off("exit", stop);
      process.off("SIGHUP", onSignal);
      process.off("SIGTERM", onSignal);
      stop();
    },
    output: () => stderr,
    exited: () => child.exitCode !== null || child.signalCode !== null || failed,
  };
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isDaemonDown(message) ? `daemon is not running (${message})` : message;
}

/** For a command that talks to the daemon: when none answers, why, or the one command that starts it. */
function explainClient(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isDaemonDown(message)
    ? explainDaemonDown(message, readStartError(), existsSync(LAUNCH_AGENT))
    : message;
}
