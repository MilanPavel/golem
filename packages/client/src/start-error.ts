import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveGolemHome } from "./socket-path.ts";

/** Why the daemon could not start, as it wrote to `run/last-error`. */
export type StartError = { reason: string; next: string };

/** `run/last-error` under the golem home, or null when it is missing or empty. */
export function readStartError(home?: string): StartError | null {
  let text: string;
  try {
    text = readFileSync(path.join(resolveGolemHome(home), "run", "last-error"), "utf8");
  } catch {
    return null;
  }
  const [reason = "", next = ""] = text.split("\n").map((line) => line.trim());
  return reason.length === 0 ? null : { reason, next };
}
