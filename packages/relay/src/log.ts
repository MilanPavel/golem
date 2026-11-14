/**
 * The relay's log. A line holds an event name and a few numbers or short prefixes, and
 * nothing else: the field types leave no place for a frame, a key, a token, or an IP address.
 */

export interface LogFields {
  role?: "mac" | "device";
  /** The first 8 characters of a room id. */
  room?: string;
  /** The first 8 characters of a device id. */
  device?: string;
  code?: number;
  bytes?: number;
  count?: number;
}

export type LogSink = (line: string) => void;

export interface Logger {
  event(name: string, fields?: LogFields): void;
}

let counter = 0;

export function createLogger(sink: LogSink, now: () => number = Date.now): Logger {
  return {
    event(name, fields = {}) {
      counter += 1;
      const parts = [new Date(now()).toISOString(), `req=${counter}`, name];
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) parts.push(`${k}=${String(v)}`);
      }
      sink(parts.join(" "));
    },
  };
}

export const silentLogger: Logger = { event() {} };

export function prefixOf(id: string): string {
  return id.slice(0, 8);
}
