import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { golemDir } from "./history.ts";

export type TuiPrefs = {
  /** Dimmed time beside each `you` and `golem` label. */
  times: boolean;
  /** The agent's todo list above the composer. */
  todos: boolean;
};

export const DEFAULT_PREFS: TuiPrefs = { times: false, todos: true };

export function prefsPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(golemDir(env, home), "tui.json");
}

export function parsePrefs(text: string): TuiPrefs {
  const value = parseRecord(text);
  return {
    times: value["times"] === true,
    todos: value["todos"] !== false,
  };
}

/** Other keys stay, so a later theme choice can share this file. */
export function mergePrefs<K extends keyof TuiPrefs>(text: string | null, key: K, value: TuiPrefs[K]): string {
  const base = text === null ? {} : parseRecord(text);
  base[key] = value;
  return `${JSON.stringify(base, null, 2)}\n`;
}

export async function loadPrefs(file: string): Promise<TuiPrefs> {
  try {
    return parsePrefs(await readFile(file, "utf8"));
  } catch (error: unknown) {
    if (isMissing(error)) {
      return DEFAULT_PREFS;
    }
    throw error;
  }
}

export async function savePref<K extends keyof TuiPrefs>(file: string, key: K, value: TuiPrefs[K]): Promise<void> {
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
  await writeFile(temporary, mergePrefs(current, key, value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

function parseRecord(text: string): Record<string, unknown> {
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const value = JSON.parse(text) as unknown;
    return isRecord(value) ? { ...value } : {};
  } catch {
    // A torn or foreign file keeps the defaults.
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
