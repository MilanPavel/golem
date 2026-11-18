import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunLike } from "@golem/view";

import { pruneDismissed, runsBannerText, runsSignal, runsWaitingLabel } from "./runs-signal.ts";
import { statusSegments } from "./status-label.ts";

const run = (id: string, extra: Partial<RunLike> = {}): RunLike => ({
  session_id: id,
  kind: "routine",
  routine: "sentry-triage",
  status: "waiting",
  started_at: "2026-11-17T10:00:00.000Z",
  ...extra,
});

const none = new Set<string>();

test("the banner says which routine needs you and where to go", () => {
  assert.equal(runsBannerText(run("a")), "● sentry-triage needs you · /runs");
  assert.equal(runsBannerText(run("a", { routine: null, kind: "ask" })), "● golem ask needs you · /runs");
});

test("nothing waiting shows no banner and no count", () => {
  assert.deepEqual(runsSignal([run("a", { status: "running" })], "x", none), { count: 0, banner: null });
  assert.deepEqual(runsSignal(null, "x", none), { count: 0, banner: null });
});

test("the session you are in is not counted and has no banner", () => {
  assert.deepEqual(runsSignal([run("a")], "a", none), { count: 0, banner: null });
});

test("the banner is the newest waiting run, and the count is all of them", () => {
  const runs = [run("old", { routine: "one", started_at: "2026-11-17T08:00:00.000Z" }), run("new", { routine: "two" })];
  const signal = runsSignal(runs, null, none);
  assert.equal(signal.count, 2);
  assert.equal(signal.banner?.sessionId, "new");
  assert.equal(signal.banner?.text, "● two needs you · /runs");
});

test("Esc dismisses one session: the next shows, and the count stays", () => {
  const runs = [run("old", { routine: "one", started_at: "2026-11-17T08:00:00.000Z" }), run("new", { routine: "two" })];
  const signal = runsSignal(runs, null, new Set(["new"]));
  assert.equal(signal.count, 2);
  assert.equal(signal.banner?.sessionId, "old");
  assert.equal(runsSignal(runs, null, new Set(["new", "old"])).banner, null);
});

test("a dismissed session comes back only after it stops waiting and waits again", () => {
  const waiting = [run("a")];
  let dismissed: ReadonlySet<string> = new Set(["a"]);
  dismissed = pruneDismissed(dismissed, waiting);
  assert.equal(runsSignal(waiting, null, dismissed).banner, null);
  dismissed = pruneDismissed(dismissed, [run("a", { status: "running" })]);
  assert.equal(dismissed.size, 0);
  assert.equal(runsSignal(waiting, null, dismissed).banner?.sessionId, "a");
  // Before the first list arrives nothing is forgotten.
  assert.equal(pruneDismissed(new Set(["a"]), null).size, 1);
});

test("the status segment says runs: N waiting, in red, and is hidden at 0", () => {
  assert.equal(runsWaitingLabel(0), "");
  assert.equal(runsWaitingLabel(2), "runs: 2 waiting");
  const base = { connection: "connected", title: "t", model: "m", folder: "~", messageCount: null, uptimeSeconds: null };
  const shown = statusSegments({ ...base, runs: runsWaitingLabel(2) }).find((s) => s.id === "runs");
  assert.equal(shown?.text, "runs: 2 waiting");
  assert.equal(shown?.tone, "alert");
  assert.equal(statusSegments({ ...base, runs: "" }).find((s) => s.id === "runs")?.text, "");
});
