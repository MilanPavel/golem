import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";

import { isSecretShape, randomSecret } from "./secret.ts";

const TOKEN_NAME = "web.token";

/** Same precedence as the client's socket path: argument, then `GOLEM_HOME`, then `~/.golem`. */
export function resolveRunDir(home?: string): string {
  const fromEnv = process.env["GOLEM_HOME"]?.trim() ?? "";
  const selected = home ?? (fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), ".golem"));
  let expanded = selected;
  if (expanded === "~") expanded = os.homedir();
  else if (expanded.startsWith("~/")) expanded = path.join(os.homedir(), expanded.slice(2));
  return path.join(path.resolve(expanded), "run");
}

function ownedByMe(st: Stats): boolean {
  return st.uid === process.getuid?.();
}

/** `run/` must be a real directory owned by the user that nobody else can write to. */
export async function checkRunDir(dir: string): Promise<void> {
  const fix = `Fix: chmod 700 ${dir}`;
  const st = await lstat(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`${dir} must be a real directory, not a link or a file. ${fix}`);
  }
  if (!ownedByMe(st)) throw new Error(`${dir} is not owned by this user. ${fix}`);
  if ((st.mode & 0o022) !== 0) throw new Error(`${dir} can be written by others. ${fix}`);
}

/** Writes a new token. An old file is from a gateway that stopped. */
export async function writeTokenFile(dir: string): Promise<string> {
  await checkRunDir(dir);
  const file = path.join(dir, TOKEN_NAME);
  await removeTokenFile(dir);
  const token = randomSecret();
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const handle = await open(file, flags, 0o600);
  try {
    await handle.writeFile(token);
    const st = await handle.stat();
    if (!ownedByMe(st) || (st.mode & 0o777) !== 0o600) {
      throw new Error(`${file} was created with the wrong owner or mode`);
    }
  } finally {
    await handle.close();
  }
  return token;
}

/** Reads the token of a running gateway, after the same checks on the directory and the file. */
export async function readTokenFile(dir: string): Promise<string> {
  await checkRunDir(dir);
  const file = path.join(dir, TOKEN_NAME);
  const st = await lstat(file);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${file} must be a regular file, not a link`);
  // Open without following links and check the opened file, so a swap after lstat is caught.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) throw new Error(`${file} must be a regular file, not a link`);
    if (!ownedByMe(opened)) throw new Error(`${file} is not owned by this user`);
    if ((opened.mode & 0o777) !== 0o600) throw new Error(`${file} must have mode 600. Fix: chmod 600 ${file}`);
    const token = (await handle.readFile("utf8")).trim();
    if (!isSecretShape(token)) throw new Error(`${file} does not hold a valid token. Run golem web again`);
    return token;
  } finally {
    await handle.close();
  }
}

export async function removeTokenFile(dir: string): Promise<void> {
  try {
    await unlink(path.join(dir, TOKEN_NAME));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
