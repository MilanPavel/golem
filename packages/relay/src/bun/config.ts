import type { RelayOptions } from "./server.ts";

function number(env: Record<string, string | undefined>, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

/** Read the relay's settings from environment variables (ADR-051, "Self-hosting"). */
export function configFromEnv(env: Record<string, string | undefined>): RelayOptions {
  const bind = env["BIND"] ?? "0.0.0.0:8080";
  const cut = bind.lastIndexOf(":");
  const hostname = cut > 0 ? bind.slice(0, cut) : "0.0.0.0";
  const port = Number(cut >= 0 ? bind.slice(cut + 1) : bind);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("BIND must look like 0.0.0.0:8080");
  const host = env["RELAY_HOST"];
  if (!host) throw new Error("RELAY_HOST is required: the host name clients connect to, such as relay.example.com");
  const seconds = (name: string): number | undefined => {
    const value = number(env, name);
    return value === undefined ? undefined : value * 1000;
  };
  return {
    port,
    hostname,
    host,
    trustProxy: env["TRUST_PROXY"] === "1",
    authTimeoutMs: seconds("AUTH_TIMEOUT_S"),
    idleMs: seconds("IDLE_S"),
    queueTtlMs: seconds("QUEUE_TTL_S"),
    maxQueueFrames: number(env, "QUEUE_MAX_FRAMES"),
    maxQueueBytes: number(env, "QUEUE_MAX_BYTES"),
    maxDevices: number(env, "MAX_DEVICES"),
    maxSocketsPerDevice: number(env, "MAX_SOCKETS_PER_DEVICE"),
    ipPerMinute: number(env, "IP_PER_MINUTE"),
    ipOpen: number(env, "IP_OPEN"),
    framesPerSecond: number(env, "FRAMES_PER_SECOND"),
    frameBurst: number(env, "FRAME_BURST"),
    bytesPerSecond: number(env, "BYTES_PER_SECOND"),
    maxSockets: number(env, "MAX_SOCKETS"),
  };
}
