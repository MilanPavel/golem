import { randomSecret, timingSafeEqual } from "./secret.ts";

export interface SessionStore {
  mint(): string;
  valid(secret: string): boolean;
}

export interface SessionOptions {
  now?: () => number;
  maxAgeMs?: number;
  max?: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Login secrets, held only in memory: a new store knows none from an older one. */
export function createSessionStore(options: SessionOptions = {}): SessionStore {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? THIRTY_DAYS_MS;
  const max = options.max ?? 64;
  // Oldest first.
  let entries: { secret: string; expires: number }[] = [];

  function prune(): void {
    const t = now();
    entries = entries.filter((e) => e.expires > t);
  }

  return {
    mint() {
      prune();
      while (entries.length >= max) entries.shift();
      const secret = randomSecret();
      entries.push({ secret, expires: now() + maxAgeMs });
      return secret;
    },
    valid(secret) {
      prune();
      // Check every entry, with no early exit, so the time does not show which one matched.
      let found = false;
      for (const e of entries) {
        if (timingSafeEqual(e.secret, secret)) found = true;
      }
      return found;
    },
  };
}
