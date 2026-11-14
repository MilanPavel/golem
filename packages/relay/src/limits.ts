/** Token buckets and per-IP counters for the rate limits of ADR-051. */

export interface Bucket {
  /** Take `cost` tokens. False when the bucket has fewer. */
  take(cost: number, now: number): boolean;
}

/** `rate` tokens per second, up to `burst`. Starts full. */
export function createBucket(rate: number, burst: number, now: number): Bucket {
  let tokens = burst;
  let last = now;
  return {
    take(cost, at) {
      tokens = Math.min(burst, tokens + ((at - last) / 1000) * rate);
      last = at;
      if (tokens < cost) return false;
      tokens -= cost;
      return true;
    },
  };
}

export interface IpGate {
  /** Admit one new unauthenticated connection from `ip`, or say no. */
  admit(ip: string, now: number): boolean;
  /** An admitted connection ended or authenticated. */
  release(ip: string): void;
  readonly tracked: number;
}

/** At most `perMinute` new connections a minute and `open` unauthenticated ones at once, per IP. */
export function createIpGate(perMinute: number, open: number): IpGate {
  const starts = new Map<string, number[]>();
  const live = new Map<string, number>();
  return {
    admit(ip, now) {
      const recent = (starts.get(ip) ?? []).filter((t) => now - t < 60_000);
      const count = live.get(ip) ?? 0;
      if (recent.length >= perMinute || count >= open) {
        starts.set(ip, recent);
        return false;
      }
      recent.push(now);
      starts.set(ip, recent);
      live.set(ip, count + 1);
      return true;
    },
    release(ip) {
      const count = (live.get(ip) ?? 0) - 1;
      if (count > 0) live.set(ip, count);
      else live.delete(ip);
    },
    get tracked() {
      return starts.size;
    },
  };
}
