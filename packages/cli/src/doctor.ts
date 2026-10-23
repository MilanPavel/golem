import type { DaemonStatus } from "../../protocol/gen/daemon-status.ts";

import type { DaemonCommand } from "./daemon-locator.ts";

/**
 * `golem doctor`. The daemon executable checks the service, socket, config,
 * models, and disk (`golem-daemon doctor` prints them as JSON). The CLI adds
 * what only it knows: where it found that executable, and whether the running
 * daemon has its version.
 */

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string | null;
}

export interface DoctorInput {
  cliVersion: string;
  /** The daemon executable `golem` would run, or why it found none. */
  located: DaemonCommand | { error: string };
  /** What `golem-daemon doctor` printed. Not called when no daemon was found. */
  daemonChecks: (daemon: DaemonCommand) => Promise<Check[]>;
  readStatus: () => Promise<DaemonStatus | null>;
}

export async function runDoctor(input: DoctorInput): Promise<Check[]> {
  const running = runningCheck(input.cliVersion, await input.readStatus());
  const { located } = input;
  if ("error" in located) {
    const fix = "brew reinstall golem, or set GOLEM_DAEMON to the daemon's path";
    return [{ name: "daemon", status: "fail", detail: located.error, fix }, running];
  }
  const found: Check = { name: "daemon", status: "ok", detail: [located.command, ...located.args].join(" ") };
  let checks: Check[];
  try {
    checks = await input.daemonChecks(located);
  } catch (error) {
    const detail = `its checks did not run: ${error instanceof Error ? error.message : String(error)}`;
    return [found, running, { name: "checks", status: "fail", detail, fix: "golem daemon logs" }];
  }
  // The running daemon reads best right after the service that starts it.
  const service = checks.findIndex((check) => check.name === "service");
  checks.splice(service + 1, 0, running);
  return [found, ...checks];
}

export function runningCheck(cliVersion: string, status: DaemonStatus | null): Check {
  if (status === null) {
    return { name: "running", status: "fail", detail: "the daemon does not answer", fix: "golem daemon start" };
  }
  if (status.version !== cliVersion) {
    return {
      name: "running",
      status: "fail",
      detail: `the daemon is ${status.version}, this golem is ${cliVersion}`,
      fix: "golem daemon restart",
    };
  }
  return { name: "running", status: "ok", detail: `version ${status.version}, pid ${status.pid}` };
}

/** The JSON `golem-daemon doctor` prints. Throws when it is not a list of checks. */
export function parseChecks(text: string): Check[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isCheck)) {
    throw new Error("the daemon printed something other than a list of checks");
  }
  return parsed;
}

function isCheck(value: unknown): value is Check {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const check = value as Record<string, unknown>;
  return (
    typeof check["name"] === "string" &&
    (check["status"] === "ok" || check["status"] === "warn" || check["status"] === "fail") &&
    typeof check["detail"] === "string" &&
    (check["fix"] === undefined || check["fix"] === null || typeof check["fix"] === "string")
  );
}

const MARKS: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✗" };

export function formatDoctor(checks: Check[]): string {
  const width = Math.max(...checks.map((check) => check.name.length));
  const indent = " ".repeat(width + 4);
  const lines = checks.flatMap((check) => {
    const [first, ...more] = check.detail.split("\n");
    const line = `${MARKS[check.status]} ${check.name.padEnd(width)}  ${first ?? ""}`;
    const fix = check.status !== "ok" && check.fix ? [`fix: ${check.fix}`] : [];
    return [line, ...[...more, ...fix].map((rest) => `${indent}${rest}`)];
  });
  return [...lines, "", summary(checks)].join("\n");
}

export function doctorExitCode(checks: Check[]): number {
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

function summary(checks: Check[]): string {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  if (failed === 0 && warned === 0) {
    return "Everything looks good.";
  }
  const parts = [
    ...(failed > 0 ? [`${failed} ${failed === 1 ? "problem" : "problems"}`] : []),
    ...(warned > 0 ? [`${warned} ${warned === 1 ? "warning" : "warnings"}`] : []),
  ];
  return `${parts.join(", ")}.`;
}
