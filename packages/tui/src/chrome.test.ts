import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bannerText,
  frameBudget,
  frameColumns,
  layoutComposer,
  PLACEHOLDERS,
  placeholderFor,
  PROMPT,
  type FrameBudget,
} from "./chrome.ts";

/** Every row the frame hands out, so a test can check they fill the terminal. */
function total(budget: FrameBudget): number {
  return (
    budget.header +
    budget.body +
    budget.banner +
    budget.meter +
    budget.suggestions +
    budget.approval +
    budget.todos +
    budget.install +
    budget.rules +
    budget.composer +
    budget.status +
    budget.debug
  );
}

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
  assert.equal(idle.rules, 2);
  assert.equal(idle.body, 15);
  assert.equal(total(idle), 24);

  const busy = frameBudget({ rows: 24, columns: 80, draft: "", busy: true, banner: false });
  assert.equal(busy.meter, 1);
  assert.equal(busy.body, 14);
  assert.equal(total(busy), 24);
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
  assert.equal(total(budget), 8);

  const cramped = frameBudget({
    rows: 4,
    columns: 80,
    draft: "a".repeat(400),
    busy: false,
    banner: false,
  });
  assert.equal(cramped.body, 1);
  assert.equal(total(cramped), 4);
});

test("the composer wraps the draft and keeps the cursor on the tail", () => {
  const rows = layoutComposer("hello", 5, 20, 1, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.prefix, PROMPT);
  assert.equal(rows[0]?.text, "hello");
  assert.equal(rows[0]?.cursorAt, 5);

  const middle = layoutComposer("hello", 2, 20, 1, false);
  assert.equal(middle[0]?.cursorAt, 2);

  const lines = layoutComposer("ab\ncd", 4, 20, 5, false);
  assert.deepEqual(
    lines.map((line) => [line.text, line.cursorAt]),
    [
      ["ab", null],
      ["cd", 1],
    ],
  );

  const tail = layoutComposer("a".repeat(100), 100, 12, 1, false);
  assert.equal(tail.length, 1);
  assert.equal(tail[0]?.prefix, "  ");
  assert.equal(tail[0]?.text.endsWith("a"), true);

  const busy = layoutComposer("hello", 5, 20, 1, true);
  assert.deepEqual(busy, [{ prefix: "", text: "…", cursorAt: null }]);

  const grown = layoutComposer("hello\n", 6, 40, 2, false);
  assert.equal(grown[0]?.prefix, PROMPT);
  assert.equal(grown[0]?.text, "hello");
  assert.equal(grown[0]?.cursorAt, null);
  assert.equal(grown[1]?.prefix, "  ");
  assert.equal(grown[1]?.text, "");
  assert.equal(grown[1]?.cursorAt, 0);

  const cursorLine = layoutComposer("hello\n", 6, 40, 1, false);
  assert.equal(cursorLine.length, 1);
  assert.equal(cursorLine[0]?.text, "");
  assert.equal(cursorLine[0]?.cursorAt, 0);
});

test("a new line grows the composer and the chat gives up that row", () => {
  const one = frameBudget({ rows: 24, columns: 80, draft: "hello", busy: false, banner: false });
  const two = frameBudget({ rows: 24, columns: 80, draft: "hello\n", busy: false, banner: false });
  assert.equal(one.composer, 1);
  assert.equal(two.composer, 2);
  assert.equal(two.body, one.body - 1);
  assert.equal(total(two), 24);

  const capped = frameBudget({
    rows: 24,
    columns: 80,
    draft: "a\nb\nc\nd\ne\nf",
    busy: false,
    banner: false,
  });
  assert.equal(capped.composer, 5);
  assert.equal(capped.body, one.body - 4);
  assert.equal(total(capped), 24);
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
  assert.equal(total(open), 24);

  const cramped = frameBudget({ rows: 6, columns: 80, draft: "", busy: false, banner: false, debug: true });
  assert.ok(cramped.body >= 1);
  assert.equal(total(cramped), 6);
});

test("suggestions take rows from the transcript and go away before the meter", () => {
  const idle = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  const open = frameBudget({ rows: 24, columns: 80, draft: "/", busy: false, banner: false, suggestions: 6 });
  assert.equal(open.suggestions, 6);
  assert.equal(open.body, idle.body - 6);
  assert.equal(total(open), 24);

  const tight = frameBudget({ rows: 5, columns: 80, draft: "", busy: true, banner: false, suggestions: 6 });
  assert.equal(tight.suggestions, 0);
  assert.equal(tight.meter, 1);
  assert.equal(tight.body, 1);
});

test("the approval band replaces the suggestions and keeps its three rows longest", () => {
  const open = frameBudget({ rows: 30, columns: 80, draft: "", busy: true, banner: false, approval: 12, suggestions: 6 });
  assert.equal(open.approval, 12);
  assert.equal(open.suggestions, 0);
  assert.equal(total(open), 30);
  const tight = frameBudget({ rows: 8, columns: 80, draft: "", busy: true, banner: false, approval: 12 });
  assert.equal(tight.approval, 3);
  assert.equal(tight.body, 1);
});

test("banner text stays on one line", () => {
  assert.equal(bannerText("session was not found", 80), "session was not found");
  assert.equal(bannerText("abcdef", 4), "abc…");
});

test("the todo list collapses to one row before the composer shrinks", () => {
  const room = frameBudget({ rows: 30, columns: 80, draft: "", busy: false, banner: false, todos: 3 });
  assert.equal(room.todos, 3);
  const tight = frameBudget({ rows: 8, columns: 80, draft: "a\nb\nc", busy: false, banner: false, todos: 3 });
  assert.equal(tight.todos, 1);
  assert.equal(tight.composer, 3);
});

test("the install band gives up rows before the composer shrinks, and keeps the chat a row", () => {
  const room = frameBudget({ rows: 30, columns: 80, draft: "", busy: false, banner: false, install: 6 });
  assert.equal(room.install, 6);
  const tight = frameBudget({ rows: 8, columns: 80, draft: "a\nb\nc", busy: false, banner: false, install: 6 });
  assert.deepEqual([tight.install, tight.composer, tight.body], [2, 3, 1]);
});

test("an empty draft shows a placeholder with the cursor on its first letter", () => {
  assert.deepEqual(layoutComposer("", 0, 40, 1, false, 'Try "explain this repo"'), [
    { prefix: PROMPT, text: 'Try "explain this repo"', cursorAt: 0, placeholder: true },
  ]);
  assert.equal(layoutComposer("", 0, 12, 1, false, 'Try "explain this repo"')[0]?.text, "Try \"expl…");
  assert.equal(layoutComposer("a", 1, 40, 1, false, "hint")[0]?.placeholder, undefined);
  assert.deepEqual(layoutComposer("", 0, 40, 1, true, "hint"), [{ prefix: "", text: "…", cursorAt: null }]);
  assert.deepEqual(layoutComposer("", 0, 40, 1, false), [{ prefix: PROMPT, text: "", cursorAt: 0 }]);
});

test("a session keeps its placeholder", () => {
  assert.equal(placeholderFor("s_1"), placeholderFor("s_1"));
  assert.ok((PLACEHOLDERS as readonly string[]).includes(placeholderFor("")));
  const seen = new Set(["s_1", "s_2", "s_3", "s_4", "s_5", "s_6"].map(placeholderFor));
  assert.ok(seen.size > 1);
});

test("the rules frame the composer and give their rows back first", () => {
  const room = frameBudget({ rows: 24, columns: 80, draft: "", busy: false, banner: false });
  assert.equal(room.rules, 2);
  const one = frameBudget({ rows: 5, columns: 80, draft: "", busy: false, banner: false });
  assert.deepEqual([one.rules, one.composer, one.body], [1, 1, 1]);
  const none = frameBudget({ rows: 8, columns: 80, draft: "a\nb\nc", busy: false, banner: false, todos: 3 });
  assert.deepEqual([none.rules, none.todos, none.composer], [0, 1, 3]);
  assert.equal(total(none), 8);
});
