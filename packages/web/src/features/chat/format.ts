import type { ToolBlock } from "@golem/view";

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
