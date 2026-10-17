import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { golemDir } from "./history.ts";

export type TuiPrefs = {
  /** Dimmed time beside each `you` and `golem` label. */
  times: boolean;
};

export function prefsPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(golemDir(env, home), "tui.json");
}

export function parsePrefs(text: string): TuiPrefs {
  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value) && value["times"] === true) {
      return { times: true };
    }
  } catch {
    // A torn or foreign file keeps the default.
  }
  return { times: false };
}

/** Other keys stay, so a later theme choice can share this file. */
export function mergePrefs(text: string | null, times: boolean): string {
  let base: Record<string, unknown> = {};
  if (text !== null && text.trim().length > 0) {
    try {
      const value = JSON.parse(text) as unknown;
      if (isRecord(value)) {
        base = { ...value };
      }
    } catch {
      base = {};
    }
  }
  base["times"] = times;
  return `${JSON.stringify(base, null, 2)}\n`;
}

export async function loadPrefs(file: string): Promise<TuiPrefs> {
  try {
    return parsePrefs(await readFile(file, "utf8"));
  } catch (error: unknown) {
    if (isMissing(error)) {
      return { times: false };
    }
    throw error;
  }
}

export async function saveTimes(file: string, times: boolean): Promise<void> {
  let current: string | null = null;
  try {
    current = await readFile(file, "utf8");
  } catch (error: unknown) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, mergePrefs(current, times), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
