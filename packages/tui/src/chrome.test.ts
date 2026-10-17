import assert from "node:assert/strict";
import { test } from "node:test";

import { bannerText, frameBudget, frameColumns, layoutComposer } from "./chrome.ts";

test("the frame leaves the last column empty", () => {
  assert.equal(frameColumns(80), 79);
  assert.equal(frameColumns(1), 1);
  assert.equal(frameColumns(0), 0);
});

test("frame rows add up to the terminal", () => {
  const idle = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  assert.equal(idle.mode, "full");
  assert.equal(idle.header, 5);
  assert.equal(idle.mode, "full");
  assert.equal(idle.composer, 1);
  assert.equal(idle.meter, 0);
  assert.equal(idle.status, 1);
  assert.equal(idle.body, 17);
  assert.equal(idle.header + idle.body + idle.banner + idle.meter + idle.composer + idle.status, 24);

  const busy = frameBudget({ rows: 24, columns: 80, draft: "", busy: true, banner: false });
  assert.equal(busy.meter, 1);
  assert.equal(busy.body, 16);
  assert.equal(busy.header + busy.body + busy.banner + busy.meter + busy.composer + busy.status, 24);
});

test("a short terminal drops the logo and keeps one transcript row", () => {
  const budget = frameBudget({
    rows: 8,
    columns: 40,
    draft: "",
    busy: false,
    banner: false,
  });
  assert.equal(budget.mode, "compact");
  assert.equal(budget.header, 1);
  assert.equal(budget.header + budget.body + budget.composer + budget.status, 8);

  const cramped = frameBudget({
    rows: 4,
    columns: 80,
    draft: "a".repeat(400),
    busy: false,
    banner: false,
  });
  assert.equal(cramped.body, 1);
  assert.equal(
    cramped.header + cramped.body + cramped.banner + cramped.meter + cramped.composer + cramped.status,
    4,
  );
});

test("the composer wraps the draft and keeps the cursor on the tail", () => {
  const rows = layoutComposer("hello", 20, 1, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.prefix, "> ");
  assert.equal(rows[0]?.text, "hello");
  assert.equal(rows[0]?.cursor, true);

  const tail = layoutComposer("a".repeat(100), 12, 1, false);
  assert.equal(tail.length, 1);
  assert.equal(tail[0]?.prefix, "  ");
  assert.equal(tail[0]?.text.endsWith("a"), true);

  const busy = layoutComposer("hello", 20, 1, true);
  assert.deepEqual(busy, [{ prefix: "", text: "…", cursor: false }]);
});

test("a wrapped question takes rows from the transcript", () => {
  const idle = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  const wrapped = frameBudget({
    rows: 24,
    columns: 80,
    draft: "a".repeat(200),
    busy: false,
    banner: false,
  });
  assert.equal(wrapped.composer, 3);
  assert.equal(wrapped.body, idle.body - 2);
});

test("an open debug panel takes rows from the transcript", () => {
  const idle = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  const open = frameBudget({
    rows: 24,
    columns: 80,
    draft: "",
    busy: false,
    banner: false,
    debug: true,
  });
  assert.equal(open.debug, 7);
  assert.equal(open.body, idle.body - 7);
  assert.equal(
    open.header + open.body + open.banner + open.meter + open.composer + open.status + open.debug,
    24,
  );

  const cramped = frameBudget({ rows: 6, columns: 80, draft: "", busy: false, banner: false, debug: true });
  assert.ok(cramped.body >= 1);
  assert.equal(
    cramped.header + cramped.body + cramped.banner + cramped.meter + cramped.composer + cramped.status + cramped.debug,
    6,
  );
});

test("suggestions take rows from the transcript and go away before the meter", () => {
  const idle = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  const open = frameBudget({ rows: 24, columns: 80, draft: "/", busy: false, banner: false, suggestions: 6 });
  assert.equal(open.suggestions, 6);
  assert.equal(open.body, idle.body - 6);
  assert.equal(
    open.header + open.body + open.banner + open.meter + open.suggestions + open.composer + open.status + open.debug,
    24,
  );

  const tight = frameBudget({ rows: 5, columns: 80, draft: "", busy: true, banner: false, suggestions: 6 });
  assert.equal(tight.suggestions, 0);
  assert.equal(tight.meter, 1);
  assert.equal(tight.body, 1);
});

test("banner text stays on one line", () => {
  assert.equal(bannerText("session was not found", 80), "session was not found");
  assert.equal(bannerText("abcdef", 4), "abc…");
});
