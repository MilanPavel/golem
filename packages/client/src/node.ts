import { connectGolem as connectCore, type ConnectOptions, type GolemClient } from "./connect.ts";
import type { Dial } from "./link.ts";
import { unixDial } from "./unix-link.ts";

export * from "./index.ts";
export { unixDial } from "./unix-link.ts";
export { resolveGolemHome, resolveSocketPath } from "./socket-path.ts";
export { readStartError, type StartError } from "./start-error.ts";

type Transport = { socketPath: string; dial?: never } | { dial: Dial; socketPath?: never };

/** The core's options, with a Unix socket path in place of `dial`. */
export type NodeConnectOptions = Omit<ConnectOptions, "dial"> & Transport;

/** Connect to the daemon over a Unix socket, or over `dial` when given. */
export function connectGolem(options: NodeConnectOptions): GolemClient {
  const { socketPath, dial, ...rest } = options;
  return connectCore({ ...rest, dial: dial ?? unixDial(socketPath) });
}
