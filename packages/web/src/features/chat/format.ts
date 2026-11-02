import type { ToolBlock } from "@golem/view";

/** `4.2s` under a minute, then `1m 03s`. Empty when the number is not a duration. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 59.95) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** `14:02` in the viewer's time zone. Empty when the time is missing or not a date. */
export function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const ARGS_LIMIT = 2000;

/** A tool call's arguments on one line: a lone string argument as it is, anything else as JSON. */
export function squeezeArgs(args: ToolBlock["args"]): string {
  const values = Object.values(args);
  const raw = values.length === 1 && typeof values[0] === "string" ? values[0] : JSON.stringify(args);
  const line = raw === "{}" ? "" : raw.replace(/\s+/g, " ").trim();
  return line.length > ARGS_LIMIT ? `${line.slice(0, ARGS_LIMIT)}…` : line;
}

/** How near the bottom still counts as at the bottom, in pixels. */
export const STICK_SLACK = 24;

/** True when the column shows the end of the transcript, so new text should keep it in view. */
export function shouldStick(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= STICK_SLACK;
}
