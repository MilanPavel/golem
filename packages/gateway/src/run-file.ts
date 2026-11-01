import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import { checkRunDir } from "./token-file.ts";

const RUN_NAME = "web.json";

/** What `run/web.json` says about the gateway that wrote it. */
export interface RunRecord {
  pid: number;
  port: number;
  started_at: string;
}

/** The record in the file's text, or null when it is not one. */
export function parseRunRecord(text: string): RunRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { pid, port, started_at: startedAt } = value as Record<string, unknown>;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof startedAt !== "string") return null;
  return { pid, port, started_at: startedAt };
}

/** Creates `run/` with mode 700 when it is missing, then checks it. */
export async function ensureRunDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await checkRunDir(dir);
}

/** Writes the record. An old file is from a gateway that stopped. */
export async function writeRunFile(dir: string, record: RunRecord): Promise<void> {
  await checkRunDir(dir);
  const file = path.join(dir, RUN_NAME);
  await removeRunFile(dir);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const handle = await open(file, flags, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`);
  } finally {
    await handle.close();
  }
}

/** The record, or null when the file is missing or unreadable as one. A link is an error. */
export async function readRunFile(dir: string): Promise<RunRecord | null> {
  await checkRunDir(dir);
  const file = path.join(dir, RUN_NAME);
  let st: Stats;
  try {
    st = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${file} must be a regular file, not a link`);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`${file} must be a regular file, not a link`);
    return parseRunRecord(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

/** Removes the file. With `pid`, only when the record in it has that pid. */
export async function removeRunFile(dir: string, pid?: number): Promise<void> {
  if (pid !== undefined && (await readRunFile(dir))?.pid !== pid) return;
  try {
    await unlink(path.join(dir, RUN_NAME));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
