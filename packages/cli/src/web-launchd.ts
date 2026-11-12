import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";

/**
 * The web page's launchd job, `dev.golem.web`. It runs `golem web serve` at login and keeps it
 * running. The daemon's own job is written in Python (`golem/launchd.py`); this one lives in the
 * CLI because the gateway is part of the `golem` binary.
 */

export const WEB_LABEL = "dev.golem.web";

/** Retry delay, so a job that exits 75 because a foreground gateway runs retries slowly. */
const THROTTLE_SECONDS = 10;

/** What a launchctl call said. */
export interface Launched {
  ok: boolean;
  output: string;
}

/** Everything the job code touches outside itself. Tests pass fakes: no real job is ever loaded. */
export interface LaunchDeps {
  platform: string;
  uid: number;
  /** The user's `~/Library/LaunchAgents`. */
  launchAgentsDir: string;
  /** The golem home (`~/.golem`, or `GOLEM_HOME`). */
  golemHome: string;
  /** The user's home directory: the job's working directory. */
  userHome: string;
  /** The running `golem` program. */
  execPath: string;
  launchctl(args: string[]): Launched;
  /** The gateway that already runs, if any. */
  liveGateway(): Promise<{ port: number; pid: number } | null>;
}

export function realLaunchDeps(
  golemHome: string,
  liveGateway: LaunchDeps["liveGateway"],
): LaunchDeps {
  return {
    platform: process.platform,
    uid: process.getuid?.() ?? 0,
    launchAgentsDir: join(homedir(), "Library", "LaunchAgents"),
    golemHome,
    userHome: homedir(),
    execPath: process.execPath,
    launchctl: (args) => {
      const result = spawnSync("launchctl", args, { encoding: "utf8" });
      return { ok: result.status === 0, output: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() };
    },
    liveGateway,
  };
}

export function webPlistPath(deps: Pick<LaunchDeps, "launchAgentsDir">): string {
  return join(deps.launchAgentsDir, `${WEB_LABEL}.plist`);
}

function target(deps: Pick<LaunchDeps, "uid">): string {
  return `gui/${deps.uid}/${WEB_LABEL}`;
}

/**
 * `executable` through Homebrew's `opt` link when it is in a keg: a plist that named
 * `Cellar/<formula>/<version>` would keep starting the old binary after `brew upgrade`. Any other
 * path is kept as is.
 */
export function stablePath(executable: string): string {
  let real: string;
  try {
    real = realpathSync(executable);
  } catch {
    return executable;
  }
  const parts = real.split(sep);
  for (let index = parts.length - 4; index > 0; index -= 1) {
    if (parts[index] !== "Cellar") continue;
    const formula = parts[index + 1];
    const rest = parts.slice(index + 3);
    if (formula === undefined) continue;
    const candidate = [...parts.slice(0, index), "opt", formula, ...rest].join(sep);
    try {
      if (realpathSync(candidate) === real) return candidate;
    } catch {
      // The link is missing: keep looking, then keep the path.
    }
  }
  return executable;
}

/** The command launchd runs. `--port` only when it was given at install. */
export function webProgram(executable: string, port: number | null): string[] {
  const program = [stablePath(executable), "web", "serve"];
  return port === null ? program : [...program, "--port", String(port)];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** The plist launchd reads, in XML. */
export function renderWebPlist(deps: LaunchDeps, port: number | null): string {
  const s = (value: string): string => `<string>${escapeXml(value)}</string>`;
  const logs = join(deps.golemHome, "logs");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `\t<key>Label</key>\n\t${s(WEB_LABEL)}`,
    `\t<key>ProgramArguments</key>\n\t<array>\n${webProgram(deps.execPath, port)
      .map((part) => `\t\t${s(part)}`)
      .join("\n")}\n\t</array>`,
    "\t<key>RunAtLoad</key>\n\t<true/>",
    "\t<key>KeepAlive</key>\n\t<true/>",
    `\t<key>ThrottleInterval</key>\n\t<integer>${THROTTLE_SECONDS}</integer>`,
    `\t<key>WorkingDirectory</key>\n\t${s(deps.userHome)}`,
    `\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>GOLEM_HOME</key>\n\t\t${s(deps.golemHome)}\n\t</dict>`,
    `\t<key>StandardOutPath</key>\n\t${s(join(logs, "web.stdout.log"))}`,
    `\t<key>StandardErrorPath</key>\n\t${s(join(logs, "web.stderr.log"))}`,
    "\t<key>ProcessType</key>\n\t<string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** `ProgramArguments` of a plist this module wrote, or null when it has none. */
export function plistProgram(xml: string): string[] | null {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml);
  if (array === null) return null;
  const parts = [...(array[1] ?? "").matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1] ?? ""));
  return parts.length > 0 ? parts : null;
}

/** launchd has the job loaded. */
export function jobLoaded(deps: LaunchDeps): boolean {
  return deps.launchctl(["print", target(deps)]).ok;
}

/** `launchctl kickstart -k`: swaps the running gateway for a new one. False when the job is not loaded. */
export function kickstart(deps: LaunchDeps): boolean {
  if (!jobLoaded(deps)) return false;
  return deps.launchctl(["kickstart", "-k", target(deps)]).ok;
}

export interface JobResult {
  ok: boolean;
  /** What to print on stdout. */
  out: string[];
  /** What to print on stderr. */
  err: string[];
}

export const RUNTIME_REFUSAL =
  "golem web install needs the installed golem binary; this one runs through bun or node from a checkout";

/** True when the program is a JS runtime (a checkout run through bun or node), not the compiled `golem`. */
export function runsOnRuntime(execPath: string): boolean {
  return /^(bun|node|nodejs|deno)(\.exe)?$/i.test(basename(execPath));
}

export const INSTALLED_LINE = "golem web: the page now starts at login · golem web opens it";
export const NOT_INSTALLED_LINE = "the web service is not installed";

/** Writes the plist and bootstraps the job. Reloads it when it is already loaded. */
export async function installWebJob(deps: LaunchDeps, port: number | null): Promise<JobResult> {
  if (deps.platform !== "darwin") return { ok: false, out: [], err: ["golem web install is macOS-only"] };
  if (runsOnRuntime(deps.execPath)) {
    return { ok: false, out: [], err: [RUNTIME_REFUSAL] };
  }
  const plist = webPlistPath(deps);
  try {
    mkdirSync(join(deps.golemHome, "logs"), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(plist), { recursive: true });
    writeFileSync(plist, renderWebPlist(deps, port), { mode: 0o600 });
    chmodSync(plist, 0o600);
  } catch (error) {
    return { ok: false, out: [], err: [`golem web install: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (jobLoaded(deps)) deps.launchctl(["bootout", target(deps)]);
  const booted = deps.launchctl(["bootstrap", `gui/${deps.uid}`, plist]);
  if (!booted.ok) {
    const detail = booted.output.length > 0 ? `: ${booted.output}` : "";
    return { ok: false, out: [], err: [`launchctl bootstrap failed${detail}`] };
  }
  const live = await deps.liveGateway();
  const out = [INSTALLED_LINE];
  if (live !== null) {
    out.unshift(`a gateway already runs on port ${live.port} (pid ${live.pid}); the job starts when it stops`);
  }
  return { ok: true, out, err: [] };
}

/** Unloads the job and deletes the plist. `run/` and the logs stay. */
export function uninstallWebJob(deps: LaunchDeps): JobResult {
  if (deps.platform !== "darwin") return { ok: false, out: [], err: ["golem web uninstall is macOS-only"] };
  if (jobLoaded(deps)) {
    const gone = deps.launchctl(["bootout", target(deps)]);
    if (!gone.ok) {
      const detail = gone.output.length > 0 ? `: ${gone.output}` : "";
      return { ok: false, out: [], err: [`launchctl bootout failed${detail}`] };
    }
  }
  const plist = webPlistPath(deps);
  if (!existsSync(plist)) return { ok: true, out: [], err: [NOT_INSTALLED_LINE] };
  unlinkSync(plist);
  return { ok: true, out: [], err: [] };
}

/**
 * After the daemon restarted: restarts the web job when its plist exists, so an installed app
 * never shows an old page. Says nothing without the plist. A failure is one warning line, never
 * an error.
 */
export function restartWebWithDaemon(
  restartWebJob: () => Promise<boolean>,
  hasPlist: () => boolean,
  warn: (line: string) => void,
): Promise<void> {
  if (!hasPlist()) return Promise.resolve();
  return restartWebJob().then(
    (restarted) => {
      if (!restarted) warn("golem web: the web service did not restart; run golem web install");
    },
    (error: unknown) => {
      warn(`golem web: the web service did not restart: ${error instanceof Error ? error.message : String(error)}`);
    },
  );
}
