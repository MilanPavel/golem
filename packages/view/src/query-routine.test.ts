import assert from "node:assert/strict";
import { test } from "node:test";
import { postWords, queryKindWords, routineRowLine, routineToml } from "./routines.ts";
import {
  askAboutPostText,
  inboxPostMeta,
  inboxPostMore,
  queryRoutineFields,
  routineChipText,
  routineNameOf,
  routineRunsQuery,
  watchOfLocation,
  whenOfQuery,
} from "./query-routine.ts";

function expect(actual: unknown) {
  return {
    toBe: (want: unknown) => assert.equal(actual, want),
    toEqual: (want: unknown) => assert.deepEqual(actual, want),
    toBeNull: () => assert.equal(actual, null),
    toContain: (part: string) => assert.ok(String(actual).includes(part), `${String(actual)} has no ${part}`),
  };
}

const QUERY = { name: "big-payments", schedule: "every 1h", query: { source: "bank", saved: "Big payments this week" }, post: "rows" as const };

test("a query routine says its kind and what it posts", () => {
  expect(queryKindWords(QUERY)).toBe("query · bank › Big payments this week");
  expect(postWords(QUERY)).toBe("posts only when it finds rows");
  expect(postWords({ query: QUERY.query })).toBe("posts every time");
  expect(queryKindWords({ query: null })).toBeNull();
  expect(routineRowLine({ config: QUERY }, 0)).toContain("query · bank › Big payments this week");
});

test("a query routine is written as the TOML of the example", () => {
  expect(routineToml(QUERY)).toBe(
    ['[[routine]]', 'name = "big-payments"', 'schedule = "every 1h"', 'query = { source = "bank", saved = "Big payments this week" }', 'post = "rows"'].join("\n"),
  );
});

test("the fields of each Then, for a schedule and for a new file", () => {
  const hour = whenOfQuery("hour", "08:30", 1, "");
  expect(queryRoutineFields({ source: "bank", saved: "Q", when: hour, then: "always" })).toEqual({ schedule: "every 1h", query: { source: "bank", saved: "Q" }, post: "always" });
  expect(queryRoutineFields({ source: "bank", saved: "Q", when: whenOfQuery("weekly", "07:05", 1, ""), then: "summary" })).toEqual({
    schedule: "5 7 * * 1",
    workflow: "data_report",
    inputs: { source: "bank", queries: "Q" },
  });
  const watch = whenOfQuery("watch", "", 1, "");
  expect(queryRoutineFields({ source: "bank", saved: "Q", when: watch, then: "rows", folder: "~/bank", glob: "*.csv" })).toEqual({ on: { watch: "~/bank", glob: "*.csv" }, query: { source: "bank", saved: "Q" }, post: "rows" });
  expect(queryRoutineFields({ source: "bank", saved: "Q", when: watch, then: "rows" })).toBeNull();
  expect(queryRoutineFields({ source: "bank", saved: "Q", when: whenOfQuery("cron", "", 1, "  "), then: "rows" })).toBeNull();
});

test("a routine name comes from the query's name", () => {
  expect(routineNameOf("Big payments this week")).toBe("big-payments-this-week");
  expect(routineNameOf("Útraty — říjen!")).toBe("utraty-rijen");
  expect(routineNameOf("???")).toBe("query");
  expect(routineNameOf("x".repeat(80)).length).toBe(40);
});

test("a query's routine is found by its query or by the report that lists it", () => {
  expect(routineRunsQuery(QUERY, "bank", "Big payments this week")).toBe(true);
  expect(routineRunsQuery(QUERY, "bank", "Other")).toBe(false);
  const report = { name: "r", workflow: "data_report", inputs: { source: "bank", queries: "A\nSubscriptions" } };
  expect(routineRunsQuery(report, "bank", "Subscriptions")).toBe(true);
  expect(routineRunsQuery(report, "cash", "Subscriptions")).toBe(false);
  expect(routineRunsQuery({ name: "p", prompt: "hi" }, "bank", "A")).toBe(false);
});

test("the chip says when and what", () => {
  expect(routineChipText(QUERY, "every hour")).toBe("⏱ every hour · only when it finds rows");
  expect(routineChipText({ name: "a", query: QUERY.query }, "Mondays at 08:00")).toBe("⏱ Mondays at 08:00");
  expect(routineChipText({ name: "r", workflow: "data_report" }, "Mondays")).toBe("⏱ Mondays · a model writes a summary");
});

test("a post's words", () => {
  const post = { routine: "big-payments", source: "bank", saved: "Q", row_count: 12, at: "2026-11-27T10:00:00" };
  expect(inboxPostMeta(post)).toBe("12 rows · bank");
  expect(inboxPostMeta({ ...post, row_count: 1 })).toBe("1 row · bank");
  expect(inboxPostMeta({ ...post, error: "boom" })).toBe("could not run · bank");
  expect(inboxPostMore(post, 10)).toBe("… 2 more in the query");
  expect(inboxPostMore(post, 12)).toBeNull();
  expect(askAboutPostText(post)).toContain("found 12 rows");
  expect(askAboutPostText({ ...post, error: "boom" })).toContain("boom");
});

test("the folder and glob of a files source", () => {
  expect(watchOfLocation("~/Documents/bank/*.csv")).toEqual({ folder: "~/Documents/bank", glob: "*.csv" });
  expect(watchOfLocation("~/Documents/bank/")).toEqual({ folder: "~/Documents/bank", glob: "*" });
  expect(watchOfLocation("/*.csv")).toEqual({ folder: "/", glob: "*.csv" });
  expect(watchOfLocation(null)).toBeNull();
});
