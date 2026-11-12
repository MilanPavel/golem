import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import type { SessionPersistence, StoredSession } from "./sessions.ts";
import { checkRunDirSync } from "./token-file.ts";

const SESSIONS_NAME = "web-sessions";
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/** SHA-256 of a cookie secret, as 64 lowercase hex characters. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** The entries in the file's text, or null when it is not a list of digests with expiry times. */
export function parseSessionFile(text: string): StoredSession[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, sessions } = value as Record<string, unknown>;
  if (version !== 1 || !Array.isArray(sessions)) return null;
  const out: StoredSession[] = [];
  for (const item of sessions as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const { sha256, expires } = item as Record<string, unknown>;
    if (typeof sha256 !== "string" || !HEX_SHA256.test(sha256)) return null;
    if (typeof expires !== "number" || !Number.isFinite(expires)) return null;
    out.push({ digest: sha256, expires });
  }
  return out;
}

function ownedByMe(uid: number): boolean {
  return uid === process.getuid?.();
}

/** The kept sign-ins, `[]` when there is no file, or null when the file is damaged or not safe to trust. */
function loadSessions(dir: string): StoredSession[] | null {
  checkRunDirSync(dir);
  const file = path.join(dir, SESSIONS_NAME);
  try {
    lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || !ownedByMe(st.uid) || (st.mode & 0o777) !== 0o600) return null;
    return parseSessionFile(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}

/** Writes the file whole: a new file next to it, then a rename, so a reader sees the old or the new. */
function saveSessions(dir: string, entries: StoredSession[]): void {
  checkRunDirSync(dir);
  const file = path.join(dir, SESSIONS_NAME);
  const temp = path.join(dir, `${SESSIONS_NAME}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  const fd = openSync(temp, flags, 0o600);
  try {
    try {
      const st = fstatSync(fd);
      if (!ownedByMe(st.uid) || (st.mode & 0o777) !== 0o600) {
        throw new Error(`${file} would be created with the wrong owner or mode`);
      }
      const body = { version: 1, sessions: entries.map((e) => ({ sha256: e.digest, expires: e.expires })) };
      writeSync(fd, `${JSON.stringify(body)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file is already gone.
    }
    throw error;
  }
}

/** Keeps sign-ins in `<dir>/web-sessions`: a SHA-256 of each secret and its expiry, never a secret. */
export function sessionFilePersistence(dir: string): SessionPersistence {
  return {
    hash: hashSecret,
    load: () => loadSessions(dir),
    save: (entries) => saveSessions(dir, entries),
  };
}

/** Signs everyone out: the file keeps no sign-in. A gateway that runs reads it on its next request. */
export function clearSessionFile(dir: string): void {
  saveSessions(dir, []);
}
