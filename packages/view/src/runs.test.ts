import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approvalsWords,
  needsYouCount,
  needsYouElsewhere,
  runBannerText,
  runDuration,
  runGroupHeading,
  runGroups,
  runKey,
  runName,
  runResultLine,
  runRowLine,
  runStartedText,
  runTriggerWords,
  type RunLike,
} from "./runs.ts";
import { runWhenText } from "./routines.ts";

// Built from local calendar parts, so "08:30" is 08:30 in every time zone the suite runs in.
const at = (day: number, hour: number, minute: number, second = 0): string => new Date(2026, 10, day, hour, minute, second).toISOString();
const NOW = new Date(2026, 10, 17, 18, 0).getTime();

const run = (id: string, extra: Partial<RunLike>): RunLike => ({ session_id: id, kind: "routine", routine: "morning-brief", trigger: "schedule", status: "succeeded", ...extra });

const WAITING = run("s_wait", { routine: "sentry-triage", status: "waiting", started_at: at(17, 10, 0), approvals: 1, summary: "Allow mcp__linear__create_issue: TypeError in router" });
const RUNNING = run("s_run", { routine: "upgrade", status: "running", trigger: "manual", started_at: at(17, 17, 0) });
const TODAY = run("s_today", { started_at: at(17, 8, 30), ended_at: at(17, 8, 30, 48), summary: "12 PRs, 3 failing" });
const TODAY_LATER = run("s_today2", { routine: "receipts", trigger: "watch", watch_path: "/Users/me/Downloads/receipt-0412.pdf", started_at: at(17, 9, 40), ended_at: at(17, 9, 40, 6) });
const YESTERDAY = run("s_yday", { status: "failed", started_at: at(16, 17, 0), ended_at: at(16, 17, 2), reason: "provider timeout" });
const OLD = run("s_old", { started_at: at(2, 8, 30), ended_at: at(2, 8, 31) });
const ASK = { session_id: "s_ask", kind: "ask", routine: null, trigger: null, status: "cancelled", started_at: at(17, 12, 0), ended_at: at(17, 12, 1) } satisfies RunLike;

test("runs group as Needs you, Running, Today and Earlier, in that order", () => {
  const groups = runGroups([OLD, TODAY, YESTERDAY, RUNNING, WAITING, TODAY_LATER], NOW);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((r) => r.session_id)]),
    [
      ["Needs you", ["s_wait"]],
      ["Running", ["s_run"]],
      ["Today", ["s_today2", "s_today"]],
      ["Earlier", ["s_yday", "s_old"]],
    ],
  );
});

test("a waiting run is under Needs you even when it started days ago, and a queued one is Running", () => {
  const stale = run("s_stale", { status: "waiting", started_at: at(2, 8, 30) });
  const queued = run("s_q", { status: "queued", started_at: null });
  const groups = runGroups([stale, queued, OLD], NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((r) => r.session_id)]), [["Needs you", ["s_stale"]], ["Running", ["s_q"]], ["Earlier", ["s_old"]]]);
});

test("empty groups are left out, the day is the local date, and a bad or future start is placed sensibly", () => {
  assert.deepEqual(runGroups([], NOW), []);
  const justBeforeMidnight = new Date(2026, 10, 16, 23, 59).toISOString();
  const justAfterMidnight = new Date(2026, 10, 17, 0, 1).toISOString();
  const future = at(18, 9, 0);
  const groups = runGroups(
    [run("a", { started_at: justBeforeMidnight }), run("b", { started_at: justAfterMidnight }), run("c", { started_at: "garbage" }), run("d", { started_at: future })],
    NOW,
  );
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((r) => r.session_id)]), [["Today", ["d", "b"]], ["Earlier", ["a", "c"]]]);
});

test("grouping keeps the items and the order of equal starts", () => {
  const first = run("x", { started_at: at(17, 8, 0) });
  const second = run("y", { started_at: at(17, 8, 0) });
  const [group] = runGroups([first, second], NOW);
  assert.equal(group?.items[0], first);
  assert.equal(group?.items[1], second);
});

test("the count and the heading agree with the group", () => {
  assert.equal(needsYouCount([WAITING, RUNNING, run("p", { status: "succeeded", approvals: 1 })]), 2);
  const [group] = runGroups([WAITING], NOW);
  assert.equal(group && runGroupHeading(group), "Needs you (1)");
});

test("the name is the routine's, or golem ask", () => {
  assert.equal(runName(TODAY), "morning-brief");
  assert.equal(runName(ASK), "golem ask");
});

test("the trigger says schedule, manual, file or the CLI", () => {
  assert.equal(runTriggerWords(TODAY), "by schedule");
  assert.equal(runTriggerWords(RUNNING), "by you");
  assert.equal(runTriggerWords(TODAY_LATER), "by new file receipt-0412.pdf");
  assert.equal(runTriggerWords(run("w", { trigger: "watch" })), "by new file");
  assert.equal(runTriggerWords(run("h", { trigger: "hook" })), "by hook");
  assert.equal(runTriggerWords(ASK), "from the CLI");
  assert.equal(runTriggerWords({ session_id: "wf", kind: "workflow", status: "running" }), "");
});

test("the start is the time today and the day after that, from the same words a History row uses", () => {
  assert.equal(runStartedText(TODAY, NOW), "08:30");
  assert.equal(runStartedText(YESTERDAY, NOW), runWhenText(YESTERDAY.started_at, NOW));
  assert.equal(runStartedText(YESTERDAY, NOW), "Yesterday 17:00");
  assert.equal(runStartedText(OLD, NOW), runWhenText(OLD.started_at, NOW));
  assert.equal(runStartedText(run("n", {}), NOW), "");
  assert.equal(runStartedText(run("n", { started_at: "garbage" }), NOW), "");
});

test("the row line joins the trigger and the start, and a workflow shows its steps instead of a trigger", () => {
  assert.equal(runRowLine(TODAY, NOW), "by schedule · 08:30");
  assert.equal(runRowLine(YESTERDAY, NOW), "by schedule · Yesterday 17:00");
  assert.equal(runRowLine({ session_id: "wf", kind: "workflow", status: "running", steps: 4, started_at: at(17, 17, 30) }, NOW), "4 steps · 17:30");
  assert.equal(runRowLine({ session_id: "wf", kind: "workflow", status: "running", steps: 1 }, NOW), "1 step");
});

test("a finished run shows how long it took, an open one counts up to now, and a queued or skipped one says so", () => {
  assert.equal(runDuration(TODAY, NOW), "0m 48s");
  assert.equal(runDuration(YESTERDAY, NOW), "2m 00s");
  assert.equal(runDuration(RUNNING, NOW), "60m 00s");
  assert.equal(runDuration(WAITING, NOW), "480m 00s");
  assert.equal(runDuration(run("q", { status: "queued" }), NOW), "queued");
  assert.equal(runDuration(run("k", { status: "skipped", started_at: at(17, 8, 0), ended_at: at(17, 8, 0) }), NOW), "");
  assert.equal(runDuration(run("e", { started_at: at(17, 8, 0) }), NOW), "");
});

test("the result line is the question while waiting, the reply or reason after", () => {
  assert.equal(runResultLine(WAITING), "Allow mcp__linear__create_issue: TypeError in router");
  assert.equal(runResultLine(run("w", { status: "waiting" })), "waiting for you");
  assert.equal(runResultLine(TODAY), "12 PRs, 3 failing");
  assert.equal(runResultLine(YESTERDAY), "provider timeout");
  assert.equal(runResultLine(run("ok", {})), "finished");
  assert.equal(runResultLine(run("sk", { status: "skipped", reason: "paused" })), "skipped: paused");
  assert.equal(runResultLine(ASK), "stopped");
  assert.equal(runResultLine(RUNNING), "running");
});

test("approvals are counted in words", () => {
  assert.equal(approvalsWords(0), "");
  assert.equal(approvalsWords(1), "1 approval waiting");
  assert.equal(approvalsWords(2), "2 approvals waiting");
});

test("the banner says the routine, the start, how it began and what waits, for each trigger", () => {
  assert.equal(runBannerText({ ...TODAY, status: "waiting", approvals: 1 }, NOW), "Routine morning-brief · started 08:30 by schedule · 1 approval waiting");
  assert.equal(runBannerText(TODAY, NOW), "Routine morning-brief · started 08:30 by schedule");
  assert.equal(runBannerText({ ...TODAY, trigger: "manual" }, NOW), "Routine morning-brief · started 08:30 by you");
  assert.equal(runBannerText(TODAY_LATER, NOW), "Routine receipts · started 09:40 by new file receipt-0412.pdf");
  assert.equal(runBannerText(YESTERDAY, NOW), "Routine morning-brief · started Yesterday 17:00 by schedule");
  assert.equal(runBannerText(ASK, NOW), "golem ask · started 12:00 from the CLI");
});

test("the words do not depend on the time zone: fixed instants give the clock the same functions give", () => {
  const instant = run("z", { started_at: "2026-11-17T07:30:00Z", ended_at: "2026-11-17T07:31:00Z" });
  const now = Date.parse("2026-11-17T12:00:00Z");
  const local = new Date("2026-11-17T07:30:00Z");
  const clock = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
  assert.equal(runStartedText(instant, now), runWhenText(instant.started_at, now).replace("Today ", ""));
  assert.match(runStartedText(instant, now), /^(\d\d:\d\d|Yesterday \d\d:\d\d|\w{3} \d+ \w{3})$/);
  assert.ok(runStartedText(instant, now).includes(clock));
});

test("waiting elsewhere is empty when nothing waits", () => {
  assert.deepEqual(needsYouElsewhere([RUNNING, TODAY], null), []);
  assert.deepEqual(needsYouElsewhere([], "s_x"), []);
});

test("waiting elsewhere finds a waiting run, and leaves out the session you are in", () => {
  assert.deepEqual(needsYouElsewhere([RUNNING, WAITING], "s_other"), [WAITING]);
  assert.deepEqual(needsYouElsewhere([RUNNING, WAITING], WAITING.session_id ?? null), []);
});

test("a run is keyed by its workflow run id, else its session id, and one with no session still counts", () => {
  assert.equal(runKey({ session_id: "s_1", status: "running" }), "s_1");
  assert.equal(runKey({ workflow_run_id: "wr_1", status: "running" }), "wr_1");
  assert.equal(runKey({ session_id: null, workflow_run_id: "wr_1", status: "running" }), "wr_1");
  const bare = { kind: "workflow", workflow_run_id: "wr_2", status: "waiting" as const };
  assert.deepEqual(needsYouElsewhere([bare], "s_other"), [bare]);
});

test("waiting elsewhere puts the newest start first", () => {
  const older = run("s_old_wait", { status: "waiting", started_at: at(10, 8, 0) });
  const newer = run("s_new_wait", { status: "waiting", started_at: at(10, 9, 0) });
  assert.deepEqual(needsYouElsewhere([older, newer], null).map((r) => r.session_id), ["s_new_wait", "s_old_wait"]);
});
