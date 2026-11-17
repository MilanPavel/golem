import type { RoutineInfo, RoutineRunSummary } from "@golem/client";

const EMPTY = "no routines. Add a [[routine]] to ~/.golem/config.toml with `golem routines edit`.";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function plural(count: number, unit: string): string {
  return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}

function clock(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function dayName(text: string): string | null {
  const key = text.toLowerCase();
  const index = /^[0-6]$/.test(key) ? Number(key) : SHORT_DAYS.indexOf(key.slice(0, 3));
  return index >= 0 && (key.length === 1 || key.length === 3) ? (DAYS[index] ?? null) : null;
}

/**
 * A routine's schedule as a sentence: `every 15m` is "every 15 minutes", `weekly mon 06:00` is
 * "every Monday at 06:00". A cron line that is not one of the usual shapes is shown as it was written.
 * Pure: the daemon's own parser (`golem/routines.py`) has checked the text already.
 */
export function scheduleInWords(schedule: string): string {
  const text = schedule.trim().replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const every = /^every (\d+)\s*([mh])$/.exec(lower);
  if (every !== null) return plural(Number(every[1]), every[2] === "m" ? "minute" : "hour");
  const plain = /^(daily|weekdays|weekly [a-z]{3}|[a-z]{3}) (\d{1,2}):(\d{2})$/.exec(lower);
  if (plain !== null) {
    const kind = plain[1] as string;
    const at = clock(plain[2] as string, plain[3] as string);
    if (kind === "daily") return `every day at ${at}`;
    if (kind === "weekdays") return `weekdays at ${at}`;
    const day = dayName(kind.split(" ").at(-1) as string);
    if (day !== null) return `every ${day} at ${at}`;
  }
  const cron = lower.split(" ");
  if (cron.length === 5) {
    const [minute = "", hour = "", dom = "", month = "", dow = ""] = cron;
    const step = /^\*\/(\d+)$/.exec(minute);
    if (step !== null && hour === "*" && dom === "*" && month === "*" && dow === "*") return plural(Number(step[1]), "minute");
    if (/^\d+$/.test(minute) && minute === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*") return "every hour";
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*") {
      const at = clock(hour, minute);
      if (dow === "*") return `every day at ${at}`;
      if (dow === "1-5") return `weekdays at ${at}`;
      const day = dayName(dow);
      if (day !== null) return `every ${day} at ${at}`;
    }
  }
  return text;
}

/** What starts a routine, in words: its schedule, the folder it watches, or "manual" when only `golem routines run` does. */
export function triggerInWords(info: RoutineInfo): string {
  const { schedule, on } = info.config;
  const parts: string[] = [];
  if (schedule !== undefined && schedule !== null && schedule.trim() !== "") parts.push(scheduleInWords(schedule));
  if (on !== undefined && on !== null) parts.push(`when ${on.watch}${on.glob === undefined ? "" : `/${on.glob}`} changes`);
  return parts.length > 0 ? parts.join(", ") : "manual";
}

function hhmm(time: Date): string {
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "08:30" today, "tomorrow 08:30", "Mon 08:30" within a week, else "2026-12-01 08:30". Local time. */
export function formatNext(nextAt: string, now: Date): string {
  const time = new Date(nextAt);
  if (Number.isNaN(time.getTime())) return nextAt;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(time, now)) return `today ${hhmm(time)}`;
  if (sameDay(time, tomorrow)) return `tomorrow ${hhmm(time)}`;
  const days = (time.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${(DAYS[time.getDay()] ?? "").slice(0, 3)} ${hhmm(time)}`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${hhmm(time)}`;
}

function ago(then: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

/** The last firing in a few words: "succeeded 2h ago", "skipped (the Mac was asleep) 1d ago". */
export function formatLast(run: RoutineRunSummary | null | undefined, now: Date): string {
  if (run === undefined || run === null) return "never run";
  const reason = run.status === "skipped" && run.reason !== undefined && run.reason !== null && run.reason !== "" ? ` (${run.reason})` : "";
  const when = run.ended_at ?? run.started_at ?? run.due_at;
  const at = when === undefined || when === null ? null : new Date(when);
  return `${run.status}${reason}${at === null || Number.isNaN(at.getTime()) ? "" : ` ${ago(at, now)}`}`;
}

function flags(info: RoutineInfo): string {
  const found: string[] = [];
  if (info.paused === true || info.config.enabled === false) found.push("paused");
  if (info.blocked === true) found.push("blocked: folder not trusted");
  if (info.source === "project") found.push("project");
  return found.join(", ");
}

/**
 * One row per routine: name, schedule in words, next run, last result, and flags (`paused`, `blocked`, `project`).
 * With `columns`, each row is cut to fit a terminal that wide.
 */
export function formatRoutines(routines: readonly RoutineInfo[], now: Date, columns?: number): string {
  if (routines.length === 0) return EMPTY;
  const rows = routines.map((info) => {
    const paused = info.paused === true || info.config.enabled === false;
    const next = paused || info.next_at === undefined || info.next_at === null ? "-" : formatNext(info.next_at, now);
    return [info.config.name, triggerInWords(info), next, formatLast(info.last, now), flags(info)];
  });
  const widths = [0, 1, 2, 3].map((column) => Math.max(...rows.map((row) => (row[column] as string).length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column < 4 ? cell.padEnd(widths[column] as number) : cell))
        .join("  ")
        .trimEnd(),
    )
    .map((row) => (columns === undefined || row.length <= columns ? row : `${row.slice(0, Math.max(0, columns - 1))}…`))
    .join("\n");
}
