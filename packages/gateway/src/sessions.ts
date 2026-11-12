import { randomSecret, timingSafeEqual } from "./secret.ts";

export interface SessionStore {
  mint(): string;
  valid(secret: string): boolean;
}

/** One live sign-in as it is kept: the digest of the secret (never the secret) and when it ends. */
export interface StoredSession {
  digest: string;
  expires: number;
}

/**
 * Where sign-ins are kept between runs. `hash` turns a secret into the digest that is stored and
 * compared. `load` returns null when what is kept is damaged. Both `load` and `save` are synchronous.
 */
export interface SessionPersistence {
  hash(secret: string): string;
  load(): StoredSession[] | null;
  save(entries: StoredSession[]): void;
}

export interface SessionOptions {
  persistence?: SessionPersistence;
  now?: () => number;
  maxAgeMs?: number;
  max?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Login secrets. Without `persistence` they are held only in memory: a new store knows none from an
 * older one. With it, only digests are kept, on disk, and the disk is read again on each check, so
 * a sign-out made by another process takes effect on the next request.
 */
export function createSessionStore(options: SessionOptions = {}): SessionStore {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? THIRTY_DAYS_MS;
  const max = options.max ?? 64;
  const persistence = options.persistence;
  const digest = (secret: string): string => (persistence === undefined ? secret : persistence.hash(secret));
  // Oldest first.
  let entries: StoredSession[] = [];

  function save(): void {
    if (persistence === undefined) return;
    try {
      persistence.save(entries);
    } catch {
      // Fails closed: the next check reads the file again, so a sign-in that was not written is not valid.
    }
  }

  /** Reads what is kept, drops what has ended, and writes back when anything changed. */
  function refresh(): void {
    let changed = false;
    if (persistence !== undefined) {
      let loaded: StoredSession[] | null;
      try {
        loaded = persistence.load();
      } catch {
        loaded = [];
      }
      if (loaded === null) {
        loaded = [];
        changed = true;
      }
      entries = loaded;
    }
    const t = now();
    const live = entries.filter((e) => e.expires > t);
    if (live.length !== entries.length) changed = true;
    entries = live;
    if (changed) save();
  }

  refresh();

  return {
    mint() {
      refresh();
      while (entries.length >= max) entries.shift();
      const secret = randomSecret();
      entries.push({ digest: digest(secret), expires: now() + maxAgeMs });
      save();
      return secret;
    },
    valid(secret) {
      refresh();
      const presented = digest(secret);
      // Check every entry, with no early exit, so the time does not show which one matched.
      let found = false;
      for (const e of entries) {
        if (timingSafeEqual(e.digest, presented)) found = true;
      }
      return found;
    },
  };
}
