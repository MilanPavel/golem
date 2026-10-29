import assert from "node:assert/strict";
import { test } from "node:test";

import { layoutMessages, type LayoutLine } from "./layout-chat.ts";
import {
  dragTo,
  isClick,
  markSpans,
  ordered,
  pointAt,
  selectedColumns,
  selectedText,
  type ChatView,
} from "./selection.ts";

// Six transcript rows, rows 2 to 4 on screen, from screen row 5.
const VIEW: ChatView = { top: 5, rows: 3, first: 2, count: 6, width: 20 };

function plain(text: string, joins?: " " | ""): LayoutLine {
  return joins === undefined ? { role: "assistant", spans: [{ text }] } : { role: "assistant", spans: [{ text }], joins };
}

test("a cell in the chat maps to a transcript row, and the scrollbar and other bands do not", () => {
  assert.deepEqual(pointAt(VIEW, 5, 0), { line: 2, column: 0 });
  assert.deepEqual(pointAt(VIEW, 7, 19), { line: 4, column: 19 });
  assert.equal(pointAt(VIEW, 4, 0), null);
  assert.equal(pointAt(VIEW, 8, 0), null);
  assert.equal(pointAt(VIEW, 6, 20), null);
  assert.equal(pointAt({ ...VIEW, first: 0, count: 2 }, 7, 0), null);
});

test("a drag past the edge scrolls a row while there is more, and stays in the chat", () => {
  assert.deepEqual(dragTo(VIEW, 6, 3), { point: { line: 3, column: 3 }, scroll: 0 });
  assert.deepEqual(dragTo(VIEW, 2, 3), { point: { line: 1, column: 3 }, scroll: 1 });
  assert.deepEqual(dragTo(VIEW, 12, 40), { point: { line: 5, column: 19 }, scroll: -1 });
  const top = { ...VIEW, first: 0 };
  assert.deepEqual(dragTo(top, 0, 0), { point: { line: 0, column: 0 }, scroll: 0 });
  const bottom = { ...VIEW, first: 3 };
  assert.deepEqual(dragTo(bottom, 30, 1), { point: { line: 5, column: 1 }, scroll: 0 });
});

test("a selection reads the same dragged either way, and a press without a move is a click", () => {
  const down = { anchor: { line: 1, column: 4 }, head: { line: 3, column: 2 } };
  const up = { anchor: down.head, head: down.anchor };
  assert.deepEqual(ordered(down), ordered(up));
  assert.deepEqual(selectedColumns(down, 1), [4, Number.POSITIVE_INFINITY]);
  assert.deepEqual(selectedColumns(down, 2), [0, Number.POSITIVE_INFINITY]);
  assert.deepEqual(selectedColumns(up, 3), [0, 3]);
  assert.equal(selectedColumns(down, 4), null);
  assert.equal(isClick({ anchor: { line: 1, column: 1 }, head: { line: 1, column: 1 } }), true);
  assert.equal(isClick(down), false);
});

test("the text joins wrapped rows as one line and keeps real line breaks and blank lines", () => {
  const lines = [plain("golem"), plain("one two"), plain("three", " "), plain("abcd"), plain("ef", ""), plain(""), plain("end   ")];
  const all = { anchor: { line: 0, column: 0 }, head: { line: 6, column: 30 } };
  assert.equal(selectedText(lines, all), "golem\none two three\nabcdef\n\nend");
  assert.equal(selectedText(lines, { anchor: { line: 1, column: 4 }, head: { line: 2, column: 2 } }), "two thr");
  assert.equal(selectedText(lines, { anchor: { line: 0, column: 1 }, head: { line: 0, column: 3 } }), "ole");
});

test("a long answer, wrapped by the layout, copies back as the words it was", () => {
  const text = "the quick brown fox jumps over the lazy dog and keeps running";
  const lines = layoutMessages([{ id: "m", role: "assistant", text, streaming: false }], 16);
  assert.ok(lines.length > 3);
  const selection = { anchor: { line: 1, column: 0 }, head: { line: lines.length - 1, column: 40 } };
  assert.equal(selectedText(lines, selection), text);
  const cut = layoutMessages([{ id: "m", role: "assistant", text: "x".repeat(30), streaming: false }], 12);
  assert.equal(selectedText(cut, { anchor: { line: 1, column: 0 }, head: { line: cut.length - 1, column: 40 } }), "x".repeat(30));
});

test("your own message copies without its padding", () => {
  const lines = layoutMessages([{ id: "u", role: "user", text: "hello there", streaming: false }], 30);
  const row = lines.findIndex((line) => line.spans.some((span) => span.text === "hello there"));
  assert.equal(selectedText(lines, { anchor: { line: row, column: 0 }, head: { line: row, column: 29 } }), "hello there");
});

test("spans are cut at the selected columns", () => {
  const spans = [{ text: "abc", bold: true }, { text: "def" }];
  assert.deepEqual(markSpans(spans, [2, 4]), [
    { span: { text: "ab", bold: true }, selected: false },
    { span: { text: "c", bold: true }, selected: true },
    { span: { text: "d" }, selected: true },
    { span: { text: "ef" }, selected: false },
  ]);
  assert.deepEqual(markSpans(spans, null), [
    { span: spans[0], selected: false },
    { span: spans[1], selected: false },
  ]);
  assert.deepEqual(
    markSpans(spans, [0, Number.POSITIVE_INFINITY]).map((part) => part.selected),
    [true, true],
  );
});
