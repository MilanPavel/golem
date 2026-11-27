import assert from "node:assert/strict";
import { test } from "node:test";

import { isTakenName, lastRunOf, oneLineSql, queriesSavedText, queryNameProblem, ranNowText, replaceQuestion, suggestQueryName, savedRunWhen } from "./data-queries.ts";

test("a name is suggested from the question as a short title", () => {
  assert.equal(suggestQueryName("How much did I spend each month this year?"), "Spend each month this year");
  assert.equal(suggestQueryName("What are my biggest payments?"), "My biggest payments");
  assert.equal(suggestQueryName("@bank show me subscriptions"), "Subscriptions");
  assert.equal(suggestQueryName(null), "");
  assert.equal(suggestQueryName("   "), "");
  assert.ok(suggestQueryName(`${"word ".repeat(40)}?`).length <= 60);
});

test("a name is 1 to 80 characters once trimmed", () => {
  assert.equal(queryNameProblem("  "), "Give the query a name.");
  assert.equal(queryNameProblem("Totals"), null);
  assert.match(queryNameProblem("x".repeat(81)) ?? "", /at most 80/);
});

test("a taken name is told from the daemon's sentence, and asks to replace", () => {
  assert.ok(isTakenName('There is already a query called "Totals" in this source.'));
  assert.ok(!isTakenName("Only queries that read."));
  assert.equal(replaceQuestion("Totals"), 'Replace "Totals"?');
});

test("where queries are kept depends on the scope", () => {
  assert.match(queriesSavedText("bank", "user"), /~\/\.golem\/data\/bank\/queries\.toml/);
  assert.match(queriesSavedText("bank", "project"), /\.golem\/data\/bank\/queries\.toml in this project/);
});

test("the SQL is one line, cut with an ellipsis", () => {
  assert.equal(oneLineSql("select a,\n   b\nfrom t"), "select a, b from t");
  const cut = oneLineSql("select " + "x, ".repeat(100), 20);
  assert.ok(cut.length <= 20 && cut.endsWith("…"));
});

test("the last run reads as when, rows and time, or the engine's first line", () => {
  const now = new Date(2026, 10, 27, 12, 0);
  const at = new Date(2026, 10, 27, 9, 14).toISOString();
  assert.equal(savedRunWhen(at, now), "today 09:14");
  assert.equal(savedRunWhen(new Date(2026, 10, 24, 9, 14).toISOString(), now), "3 days ago");
  assert.equal(savedRunWhen(new Date(2026, 10, 26, 9, 14).toISOString(), now), "yesterday 09:14");
  assert.deepEqual(lastRunOf({ last_run_at: at, last_rows: 11, last_ms: 38 }, now), { failed: false, when: "today 09:14", detail: "11 rows · 38 ms" });
  assert.deepEqual(lastRunOf({ last_run_at: at, last_error: 'column "amout" not found\nCandidates: amount' }, now), { failed: true, when: "today 09:14", detail: 'column "amout" not found' });
  assert.equal(lastRunOf({}, now), null);
  assert.equal(ranNowText(1, 5), "Ran now · 1 row · 5 ms");
});
