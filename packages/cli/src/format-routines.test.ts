import assert from "node:assert/strict";
import { test } from "node:test";

import type { RoutineInfo } from "@golem/client";

import { formatLast, formatNext, formatRoutines, scheduleInWords, triggerInWords } from "./format-routines.ts";

const NOW = new Date(2026, 10, 17, 9, 0, 0);
const local = (day: number, hour: number, minute: number): string => new Date(2026, 10, day, hour, minute).toISOString();

function routine(name: string, rest: Partial<RoutineInfo> & { schedule?: string; enabled?: boolean } = {}): RoutineInfo {
  const { schedule, enabled, ...info } = rest;
  const config: RoutineInfo["config"] = { name, prompt: "p" };
  if (schedule !== undefined) config.schedule = schedule;
  if (enabled !== undefined) config.enabled = enabled;
  return { config, path: "/h/config.toml", source: "user", ...info };
}

test("the plain schedule forms read as sentences", () => {
  assert.equal(scheduleInWords("every 15m"), "every 15 minutes");
  assert.equal(scheduleInWords("every 1m"), "every minute");
  assert.equal(scheduleInWords("every 1h"), "every hour");
  assert.equal(scheduleInWords("every 6h"), "every 6 hours");
  assert.equal(scheduleInWords("daily 8:30"), "every day at 08:30");
  assert.equal(scheduleInWords("weekdays 08:30"), "weekdays at 08:30");
  assert.equal(scheduleInWords("weekly mon 06:00"), "every Monday at 06:00");
  assert.equal(scheduleInWords("fri 17:05"), "every Friday at 17:05");
});

test("the usual cron lines read as sentences, and the rest stay as written", () => {
  assert.equal(scheduleInWords("*/10 * * * *"), "every 10 minutes");
  assert.equal(scheduleInWords("0 * * * *"), "every hour");
  assert.equal(scheduleInWords("30 8 * * *"), "every day at 08:30");
  assert.equal(scheduleInWords("30 8 * * 1-5"), "weekdays at 08:30");
  assert.equal(scheduleInWords("0 6 * * 1"), "every Monday at 06:00");
  assert.equal(scheduleInWords("0 6 * * 0"), "every Sunday at 06:00");
  assert.equal(scheduleInWords("0 6 1 * *"), "0 6 1 * *");
  assert.equal(scheduleInWords("5,35 * * * *"), "5,35 * * * *");
});

test("a trigger is the schedule, a watch, or manual", () => {
  assert.equal(triggerInWords(routine("a", { schedule: "daily 08:00" })), "every day at 08:00");
  assert.equal(triggerInWords(routine("a")), "manual");
  const watched = routine("a");
  watched.config.on = { watch: "/repo/inbox", glob: "*.md" };
  assert.equal(triggerInWords(watched), "when /repo/inbox/*.md changes");
});

test("the next run is today, tomorrow, a weekday, or a date", () => {
  assert.equal(formatNext(local(17, 18, 0), NOW), "today 18:00");
  assert.equal(formatNext(local(18, 8, 30), NOW), "tomorrow 08:30");
  assert.equal(formatNext(local(20, 8, 30), NOW), "Fri 08:30");
  assert.equal(formatNext(local(30, 8, 30), NOW), "2026-11-30 08:30");
});

test("the last result carries its reason and age", () => {
  assert.equal(formatLast(null, NOW), "never run");
  const base = { routine: "a", routine_run_id: "r", scope: "user", trigger: "schedule" as const };
  assert.equal(formatLast({ ...base, status: "succeeded", ended_at: local(17, 6, 0) }, NOW), "succeeded 3h ago");
  assert.equal(
    formatLast({ ...base, status: "skipped", reason: "the Mac was asleep", ended_at: local(16, 6, 0) }, NOW),
    "skipped (the Mac was asleep) 27h ago",
  );
  assert.equal(formatLast({ ...base, status: "waiting" }, NOW), "waiting");
});

test("the list has a row per routine, with paused and blocked marked", () => {
  const brief = routine("morning-brief", { schedule: "weekdays 08:30", next_at: local(18, 8, 30) });
  brief.last = { routine: "morning-brief", routine_run_id: "r", scope: "user", trigger: "schedule", status: "succeeded", ended_at: local(17, 8, 31) };
  const text = formatRoutines(
    [
      brief,
      routine("tidy", { schedule: "every 1h", enabled: false, next_at: local(17, 10, 0) }),
      routine("p", { source: "project", blocked: true, folder: "/r" }),
    ],
    NOW,
  );
  assert.equal(
    text,
    [
      "morning-brief  weekdays at 08:30  tomorrow 08:30  succeeded 29m ago",
      "tidy           every hour         -               never run          paused",
      "p              manual             -               never run          blocked: folder not trusted, project",
    ].join("\n"),
  );
  assert.match(formatRoutines([], NOW), /^no routines/);
  assert.ok(formatRoutines([brief], NOW, 20).endsWith("…"));
});
