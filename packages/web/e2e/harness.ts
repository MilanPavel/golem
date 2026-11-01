import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../..");

const DAEMON_START_MS = 20_000;
const STOP_GRACE_MS = 5_000;

/** Everything started in a test, stopped in reverse order by `cleanup`. */
export class Rig {
  private readonly stops: Array<() => Promise<void>> = [];
  private readonly dirs: string[] = [];

  /** A short temp GOLEM_HOME: Unix socket paths over about 100 bytes fail on macOS. */
  home(): string {
    const dir = mkdtempSync("/tmp/ge.");
    this.dirs.push(dir);
    return dir;
  }

  own<T extends { stop(): Promise<void> }>(thing: T): T {
    this.stops.push(() => thing.stop());
    return thing;
  }

  async cleanup(): Promise<void> {
    for (const stop of this.stops.reverse()) {
      try {
        await stop();
      } catch {
        // Keep stopping the rest.
      }
    }
    for (const dir of this.dirs) rmSync(dir, { recursive: true, force: true });
  }
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) done();
    else child.once("exit", () => done());
  });
}

/** SIGTERM, then SIGKILL after the grace period. */
async function terminate(child: ChildProcess, graceMs = STOP_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
  await exited(child);
  clearTimeout(timer);
}

function envFor(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GOLEM_HOME: home };
  delete env["VIRTUAL_ENV"];
  return env;
}

export function socketPath(home: string): string {
  return path.join(home, "run", "golem.sock");
}

async function waitFor(what: string, ms: number, ready: () => boolean, child?: ChildProcess): Promise<void> {
  const end = Date.now() + ms;
  while (!ready()) {
    if (child !== undefined && child.exitCode !== null) throw new Error(`${what}: process exited with ${child.exitCode}`);
    if (Date.now() > end) throw new Error(`${what}: not ready after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface Daemon {
  pid: number;
  stop(): Promise<void>;
}

export async function startDaemon(home: string): Promise<Daemon> {
  const child = spawn("uv", ["run", "--project", REPO, "golem-daemon", "serve"], {
    env: envFor(home),
    stdio: "ignore",
    cwd: REPO,
  });
  const stop = (): Promise<void> => terminate(child);
  try {
    await waitFor("daemon socket", DAEMON_START_MS, () => existsSync(socketPath(home)), child);
  } catch (error) {
    await stop();
    throw error;
  }
  const pidFile = path.join(home, "run", "golem.pid");
  const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : (child.pid ?? 0);
  return { pid, stop };
}

export interface Gateway {
  url: string;
  port: number;
  pid: number;
  stop(): Promise<void>;
}

/** `golem web --json`: the first stdout line is `{url, port, pid}`. */
export async function startGateway(home: string, port = 0): Promise<Gateway> {
  const child = spawn("bun", [path.join(REPO, "packages/cli/src/main.ts"), "web", "--json", "--port", String(port)], {
    env: envFor(home),
    stdio: ["ignore", "pipe", "pipe"],
    cwd: REPO,
  });
  const stop = (): Promise<void> => terminate(child);
  let errText = "";
  child.stderr?.on("data", (d: Buffer) => (errText += d.toString()));
  try {
    const line = await new Promise<string>((resolve, reject) => {
      let buf = "";
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString();
        const nl = buf.indexOf("\n");
        if (nl >= 0) resolve(buf.slice(0, nl));
      });
      child.once("exit", (code) => reject(new Error(`golem web exited with ${code}: ${errText}`)));
      setTimeout(() => reject(new Error(`golem web printed nothing: ${errText}`)), 20_000);
    });
    const info = JSON.parse(line) as { url: string; port: number; pid: number };
    return { ...info, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export interface FakeDaemon {
  stop(): Promise<void>;
}

/** A daemon that only says hello, with the given protocol major. */
export async function startFakeDaemon(home: string, protocolMajor: number): Promise<FakeDaemon> {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(home, "run"), { recursive: true, mode: 0o700 });
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let buf = "";
    socket.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
        if (line.trim() === "") continue;
        let req: { id?: unknown; method?: unknown };
        try {
          req = JSON.parse(line) as { id?: unknown; method?: unknown };
        } catch {
          continue;
        }
        const result =
          req.method === "hello"
            ? { protocol_major: protocolMajor, protocol_minor: 0, daemon_version: "fake" }
            : {};
        socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, result })}\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath(home), resolve);
  });
  return {
    stop: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}

export interface DevServer {
  /** The page link with the login token, as the plugin prints it. */
  link: string;
  stop(): Promise<void>;
}

/** `vite` for packages/web on a free port, with the proxy and link plugin reading `home`. */
export async function startDevServer(home: string): Promise<DevServer> {
  const port = await freePort();
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    env: envFor(home),
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.join(REPO, "packages/web"),
    detached: true,
  });
  // `pnpm exec` runs vite as a child, so stop the whole group.
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const group = child.pid;
    if (group === undefined) return;
    try {
      process.kill(-group, "SIGTERM");
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-group, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, STOP_GRACE_MS);
    await exited(child);
    clearTimeout(timer);
  };
  try {
    const link = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const onData = (d: Buffer): void => {
        buf += d.toString();
        const m = /golem web dev: (http:\/\/\S+#t=\S+)/.exec(buf.replace(/\x1b\[[0-9;]*m/g, ""));
        if (m?.[1] !== undefined) resolve(m[1]);
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("exit", (code) => reject(new Error(`vite exited with ${code}: ${buf}`)));
      setTimeout(() => reject(new Error(`vite printed no login link: ${buf}`)), 30_000);
    });
    return { link, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
