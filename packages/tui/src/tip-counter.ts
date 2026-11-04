import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parseTipCount } from "@golem/view";

import { golemDir } from "./history.ts";

/** `~/.golem/tip`: how many sessions have shown a tip, so the next one shows the next tip. */
export function tipCounterPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(golemDir(env, home), "tip");
}

/** The count, without moving it on. A file that can't be read counts as 0. */
export function peekTip(path: string): number {
  try {
    return parseTipCount(readFileSync(path, "utf8"));
  } catch {
    return 0;
  }
}

/** The count for a new session, and one more in the file for the session after it. */
export function takeTip(path: string): number {
  const count = peekTip(path);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${count + 1}\n`);
  } catch {
    // A read-only home still shows a tip, only the same one each time.
  }
  return count;
}
