import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_WHEN,
  fileName,
  lastResultText,
  nextRunText,
  nextTimesText,
  routineHeadline,
  routineRowLine,
  routineState,
  routineToml,
  runWhenText,
  scheduleToWhen,
  scheduleWords,
  triggerWords,
  watchPreviewText,
  watchToOn,
  whenToSchedule,
  type RoutineLike,
} from "./routines.ts";

const NOW = Date.parse("2026-11-17T18:00:00+01:00");

test("each shorthand reads as words", () => {
  assert.equal(scheduleWords("every 15m"), "Every 15 minutes");
  assert.equal(scheduleWords("every 1m"), "Every minute");
  assert.equal(scheduleWords("every 1h"), "Every hour");
  assert.equal(scheduleWords("every 6h"), "Every 6 hours");
  assert.equal(scheduleWords("daily 08:30"), "Daily at 08:30");
  assert.equal(scheduleWords("weekdays 8:30"), "Weekdays at 08:30");
  assert.equal(scheduleWords("weekly mon 06:00"), "Mondays at 06:00");
  assert.equal(scheduleWords("mon 06:00"), "Mondays at 06:00");
  assert.equal(scheduleWords("weekly sun 22:15"), "Sundays at 22:15");
});

test("a cron line gets the same words when it says the same thing", () => {
  assert.equal(scheduleWords("30 8 * * 1-5"), "Weekdays at 08:30");
  assert.equal(scheduleWords("0 6 * * mon"), "Mondays at 06:00");
  assert.equal(scheduleWords("0 6 * * 0"), "Sundays at 06:00");
  assert.equal(scheduleWords("30 8 * * *"), "Daily at 08:30");
  assert.equal(scheduleWords("*/10 * * * *"), "Every 10 minutes");
  assert.equal(scheduleWords("0 * * * *"), "Every hour");
  assert.equal(scheduleWords("0 */4 * * *"), "Every 4 hours");
});

test("a cron line that says something else is shown as written", () => {
  assert.equal(scheduleWords("0 8 1 * *"), "Cron 0 8 1 * *");
  assert.equal(scheduleWords("15 9,17 * * 1-5"), "Cron 15 9,17 * * 1-5");
});

test("a watch trigger and a missing trigger", () => {
  assert.equal(triggerWords({ on: { watch: "~/Downloads", glob: "*.pdf" } }), "New *.pdf in ~/Downloads");
  assert.equal(triggerWords({ on: { watch: "~/Downloads" } }), "New files in ~/Downloads");
  assert.equal(triggerWords({ schedule: "daily 08:30" }), "Daily at 08:30");
  assert.equal(triggerWords({}), "No schedule");
});

test("the preview line of a watch routine", () => {
  assert.equal(watchPreviewText("~/Downloads", "*.pdf", "/receipt-to-csv {path}"), "Runs /receipt-to-csv for each new PDF in ~/Downloads");
  assert.equal(watchPreviewText("~/Desktop/inbox", "*", "Name this file."), "Runs the prompt for each new file in ~/Desktop/inbox");
  assert.equal(watchPreviewText("~/logs", undefined, "/summarise"), "Runs /summarise for each new file in ~/logs");
  assert.equal(watchPreviewText("~/logs", "report-*.csv", "/x"), "Runs /x for each new file matching report-*.csv in ~/logs");
  assert.equal(watchPreviewText("  ", "*.pdf", "/x"), "");
});

test("a watch routine saves a folder and a glob, and no schedule", () => {
  assert.equal(whenToSchedule({ ...DEFAULT_WHEN, kind: "watch" }), null);
  assert.deepEqual(watchToOn(" ~/Downloads ", " *.pdf "), { watch: "~/Downloads", glob: "*.pdf" });
  assert.deepEqual(watchToOn("~/Downloads", ""), { watch: "~/Downloads" });
  assert.equal(watchToOn("  ", "*.pdf"), null);
});

test("the name of a file from its path", () => {
  assert.equal(fileName("/Users/me/Downloads/invoice 2026.pdf"), "invoice 2026.pdf");
  assert.equal(fileName("receipt.pdf"), "receipt.pdf");
});

test("next-run text counts in minutes, hours and days", () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  assert.equal(nextRunText(at(20_000), NOW), "next in under a minute");
  assert.equal(nextRunText(at(-5_000), NOW), "next in under a minute");
  assert.equal(nextRunText(at(5 * 60_000), NOW), "next in 5 min");
  assert.equal(nextRunText(at(14 * 3_600_000), NOW), "next in 14 h");
  assert.equal(nextRunText(at(47 * 3_600_000), NOW), "next in 47 h");
  assert.equal(nextRunText(at(3 * 86_400_000), NOW), "next in 3 d");
  assert.equal(nextRunText(null, NOW), "");
  assert.equal(nextRunText("not a time", NOW), "");
});

const routine = (extra: Partial<RoutineLike> = {}): RoutineLike => ({
  config: { name: "morning-brief", prompt: "/brief", schedule: "weekdays 08:30" },
  next_at: new Date(NOW + 14 * 3_600_000).toISOString(),
  ...extra,
});

test("the headline joins the trigger and the next run", () => {
  assert.equal(routineHeadline(routine(), NOW), "Weekdays at 08:30 · next in 14 h");
  assert.equal(routineHeadline(routine({ next_at: null }), NOW), "Weekdays at 08:30");
});

test("a last result is the reply, the reason, or the status", () => {
  assert.equal(lastResultText({ status: "succeeded", summary: "12 PRs\nand more" }), "12 PRs");
  assert.equal(lastResultText({ status: "succeeded" }), "finished");
  assert.equal(lastResultText({ status: "failed", reason: "Linear: needs sign-in" }), "Linear: needs sign-in");
  assert.equal(lastResultText({ status: "failed" }), "failed");
  assert.equal(lastResultText({ status: "skipped", reason: "paused" }), "skipped: paused");
  assert.equal(lastResultText({ status: "waiting" }), "waiting for you");
  assert.equal(lastResultText({ status: "cancelled" }), "stopped");
});

test("the dot and the row line follow the routine's state", () => {
  assert.equal(routineState(routine()), "idle");
  assert.equal(routineState(routine({ last: { status: "failed" } })), "failed");
  assert.equal(routineState(routine({ last: { status: "waiting" } })), "waiting");
  assert.equal(routineState(routine({ last: { status: "running" } })), "running");
  assert.equal(routineState(routine({ blocked: true })), "off");
  assert.equal(routineRowLine(routine(), NOW), "Weekdays at 08:30 · next in 14 h");
  assert.equal(routineRowLine(routine({ last: { status: "waiting" } }), NOW), "Weekdays at 08:30 · needs you");
  assert.equal(routineRowLine(routine({ blocked: true }), NOW), "Weekdays at 08:30 · untrusted folder");
  const watching: RoutineLike = { config: { name: "r", prompt: "p", on: { watch: "~/Downloads", glob: "*.pdf" } } };
  assert.equal(routineRowLine(watching, NOW), "New *.pdf in ~/Downloads · watching");
  assert.equal(routineRowLine({ ...watching, last: { status: "succeeded", summary: "filed 2" } }, NOW), "New *.pdf in ~/Downloads · filed 2");
});

test("a run's start reads as today, yesterday, or a date", () => {
  process.env.TZ = "Europe/Prague";
  const now = new Date(2026, 10, 17, 18, 0).getTime();
  assert.equal(runWhenText(new Date(2026, 10, 17, 8, 30).toISOString(), now), "Today 08:30");
  assert.equal(runWhenText(new Date(2026, 10, 16, 23, 5).toISOString(), now), "Yesterday 23:05");
  assert.equal(runWhenText(new Date(2026, 10, 10, 8, 30).toISOString(), now), "Tue 10 Nov");
  assert.equal(runWhenText(null, now), "");
  assert.equal(runWhenText("nope", now), "");
});

test("the TOML shows what is set and the prompt last", () => {
  assert.equal(
    routineToml({ name: "morning-brief", prompt: "/brief", schedule: "weekdays 08:30", folder: "~/repos/golem", mcp: ["linear"], missed: "skip", enabled: true }),
    ["[[routine]]", 'name = "morning-brief"', 'schedule = "weekdays 08:30"', 'folder = "~/repos/golem"', 'mcp = ["linear"]', 'missed = "skip"', 'prompt = "/brief"'].join("\n"),
  );
  const text = routineToml({ name: "r", prompt: "a\nb", on: { watch: "~/d", glob: "*.pdf" }, enabled: false, notify_failed: true });
  assert.ok(text.includes('on = { watch = "~/d", glob = "*.pdf" }'));
  assert.ok(text.includes("enabled = false"));
  assert.ok(text.includes("notify_failed = true"));
  assert.ok(text.endsWith('prompt = """\na\nb\n"""'));
});

test("each schedule option writes its schedule", () => {
  const base = { kind: "daily", time: "08:30", day: 1, hours: "2", cron: "" } as const;
  assert.equal(whenToSchedule({ ...base, kind: "daily" }), "30 8 * * *");
  assert.equal(whenToSchedule({ ...base, kind: "weekdays" }), "30 8 * * 1-5");
  assert.equal(whenToSchedule({ ...base, kind: "weekly", day: 0, time: "06:00" }), "0 6 * * 0");
  assert.equal(whenToSchedule({ ...base, kind: "hours" }), "every 2h");
  assert.equal(whenToSchedule({ ...base, kind: "cron", cron: "  0 17  * * 5 " }), "0 17 * * 5");
  assert.equal(whenToSchedule({ ...base, kind: "cron" }), null);
  assert.equal(whenToSchedule({ ...base, kind: "hours", hours: "" }), null);
  assert.equal(whenToSchedule({ ...base, kind: "weekdays", time: "" }), null);
  assert.equal(whenToSchedule({ ...base, kind: "weekdays", time: "25:00" }), null);
});

test("a written schedule fills the builder, plain or cron, and a strange one is Cron", () => {
  assert.deepEqual(scheduleToWhen("30 8 * * 1-5"), { kind: "weekdays", time: "08:30", day: 1, hours: "1", cron: "" });
  assert.equal(scheduleToWhen("weekdays 08:30").kind, "weekdays");
  assert.equal(scheduleToWhen("daily 7:05").time, "07:05");
  assert.deepEqual([scheduleToWhen("weekly mon 06:00").kind, scheduleToWhen("weekly mon 06:00").day], ["weekly", 1]);
  assert.equal(scheduleToWhen("0 6 * * sun").day, 0);
  assert.equal(scheduleToWhen("every 6h").hours, "6");
  assert.equal(scheduleToWhen("45 9 * * *").kind, "daily");
  for (const text of ["0 17 * * 1,3", "*/5 * * * *", "every 15m", "0 0 1 * *", "99 99 * * *"]) {
    assert.deepEqual(scheduleToWhen(text).kind, "cron", text);
    assert.equal(scheduleToWhen(text).cron, text);
  }
  assert.equal(scheduleToWhen(null).kind, "weekdays");
});

test("the next times read as one line, with the date once a week away", () => {
  const now = Date.parse("2026-11-17T18:00:00");
  const local = (day: number, time: string): string => new Date(`2026-11-${day}T${time}:00`).toISOString();
  assert.equal(nextTimesText([local(18, "08:30"), local(19, "08:30"), local(20, "08:30")], now), "Next: Wed 08:30 · Thu 08:30 · Fri 08:30");
  assert.equal(nextTimesText([local(24, "08:30")], now), "Next: Tue 24 Nov 08:30");
  assert.equal(nextTimesText(["soon"], now), "");
  assert.equal(nextTimesText([], now), "");
});
