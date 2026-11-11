/**
 * How long something took, as minutes and seconds. Pure, so the web and the terminal say the
 * same thing.
 */

/**
 * A span, a step, or a finished reply: `0m 00.004s` under a second, then one decimal, such as
 * `0m 14.9s`, `2m 30.8s` and `62m 03.0s`. There are no hours. Empty when the number is not a
 * duration (negative, `NaN` or `Infinity`).
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  if (ms < 1000) {
    return `0m 00.${String(Math.round(ms)).padStart(3, "0")}s`;
  }
  // Round to tenths first, then split, so `0m 60.0s` never shows.
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `${minutes}m ${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}s`;
}

/**
 * The time of a whole turn, for its footer: seconds with one decimal under a minute (`42.1s`),
 * then minutes and whole seconds (`1m 03s`). Empty when the number is not a duration.
 */
export function formatTurnTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "";
  }
  const tenths = Math.round(ms / 100);
  if (tenths < 600) {
    return `${Math.floor(tenths / 10)}.${tenths % 10}s`;
  }
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * A live counter that ticks once a second: whole seconds, rounded down, such as `0m 03s`,
 * `1m 04s` and `12m 00s`. `0m 00s` when the number is negative, `NaN` or `Infinity`.
 */
export function formatElapsed(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
