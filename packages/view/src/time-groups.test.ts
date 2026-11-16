import assert from "node:assert/strict";
import { test } from "node:test";

import { groupByTime } from "./time-groups.ts";

// Local-time maths: pin the zone so the test does not depend on the machine.
process.env.TZ = "Europe/Prague";

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date => new Date(y, m - 1, d, h, min, s);
const row = (id: string, when: Date | string) => ({
  id,
  updated_at: typeof when === "string" ? when : when.toISOString(),
});
const shape = (groups: ReturnType<typeof groupByTime<{ id: string; updated_at: string }>>) =>
  groups.map((g) => [g.label, g.items.map((i) => i.id)]);

// Wednesday 2026-11-18, 10:30 local. Midnights: today 18th, yesterday 17th, week start 11th.
const NOW = at(2026, 11, 18, 10, 30);

test("empty input gives no groups", () => {
  assert.deepEqual(groupByTime([], NOW), []);
});

test("the Today boundary: a second before midnight is Yesterday, midnight is Today", () => {
  const groups = groupByTime([row("a", at(2026, 11, 17, 23, 59, 59)), row("b", at(2026, 11, 18))], NOW);
  assert.deepEqual(shape(groups), [["Today", ["b"]], ["Yesterday", ["a"]]]);
});

test("the Yesterday boundary: a second before is Previous 7 days", () => {
  const groups = groupByTime([row("a", at(2026, 11, 16, 23, 59, 59)), row("b", at(2026, 11, 17))], NOW);
  assert.deepEqual(shape(groups), [["Yesterday", ["b"]], ["Previous 7 days", ["a"]]]);
});

test("the Previous 7 days boundary: a second before is Earlier", () => {
  const groups = groupByTime([row("a", at(2026, 11, 10, 23, 59, 59)), row("b", at(2026, 11, 11))], NOW);
  assert.deepEqual(shape(groups), [["Previous 7 days", ["b"]], ["Earlier", ["a"]]]);
});

test("groups come in order and empty ones are left out", () => {
  const groups = groupByTime([row("old", at(2026, 1, 1)), row("now", at(2026, 11, 18, 9))], NOW);
  assert.deepEqual(shape(groups), [["Today", ["now"]], ["Earlier", ["old"]]]);
});

test("items in a group are newest first, and equal times keep their order", () => {
  const same = at(2026, 11, 18, 8);
  const groups = groupByTime(
    [row("a", at(2026, 11, 18, 7)), row("b", same), row("c", at(2026, 11, 18, 9)), row("d", same)],
    NOW,
  );
  assert.deepEqual(shape(groups), [["Today", ["c", "b", "d", "a"]]]);
});

test("a date that does not parse goes to Earlier, last", () => {
  const groups = groupByTime([row("x", "nope"), row("y", "also bad"), row("z", at(2026, 1, 1))], NOW);
  assert.deepEqual(shape(groups), [["Earlier", ["z", "x", "y"]]]);
});

test("a date in the future goes to Today, newest first", () => {
  const groups = groupByTime([row("a", at(2026, 11, 18, 9)), row("b", at(2027, 3, 1))], NOW);
  assert.deepEqual(shape(groups), [["Today", ["b", "a"]]]);
});

test("now can be a number", () => {
  const groups = groupByTime([row("a", at(2026, 11, 18, 1))], NOW.getTime());
  assert.deepEqual(shape(groups), [["Today", ["a"]]]);
});

test("the items are not copied", () => {
  const item = row("a", at(2026, 11, 18, 1));
  assert.equal(groupByTime([item], NOW)[0]!.items[0], item);
});

test("a 25-hour day (clocks go back on 2026-10-25) still counts as one day", () => {
  const now = at(2026, 10, 26, 0, 30);
  const groups = groupByTime(
    [row("today", at(2026, 10, 26)), row("late", at(2026, 10, 25, 23, 59, 59)), row("early", at(2026, 10, 25))],
    now,
  );
  assert.deepEqual(shape(groups), [["Today", ["today"]], ["Yesterday", ["late", "early"]]]);
  // Seven calendar days back is the 19th, though 7 * 24 h earlier would land on the 18th at 23:00.
  const week = groupByTime([row("a", at(2026, 10, 19)), row("b", at(2026, 10, 18, 23, 59, 59))], now);
  assert.deepEqual(shape(week), [["Previous 7 days", ["a"]], ["Earlier", ["b"]]]);
});

test("a 23-hour day (clocks go forward on 2026-03-29) still counts as one day", () => {
  const now = at(2026, 3, 30, 0, 30);
  const groups = groupByTime([row("a", at(2026, 3, 29)), row("b", at(2026, 3, 28, 23, 59, 59))], now);
  assert.deepEqual(shape(groups), [["Yesterday", ["a"]], ["Previous 7 days", ["b"]]]);
});
