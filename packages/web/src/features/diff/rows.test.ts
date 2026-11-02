import { parseDiff } from "@golem/view";
import { expect, test } from "vitest";
import { diffFile, splitRows, unifiedRows } from "./rows.ts";
import { SAMPLE_EDIT_DIFF, SAMPLE_NEW_FILE_DIFF } from "./sample.ts";

const lines = (text: string) => parseDiff(text);

test("a header with diff --git and index lines is not shown, and names the file", () => {
  const parsed = lines(SAMPLE_EDIT_DIFF);
  expect(diffFile(parsed)).toEqual({ path: "src/socket.ts", added: false, deleted: false });
  const rows = unifiedRows(parsed);
  expect(rows[0]).toEqual({ kind: "hunk", text: "@@ -1,6 +1,7 @@" });
  expect(rows.some((row) => row.kind === "meta")).toBe(false);
});

test("numbers follow each hunk header, across two hunks", () => {
  const rows = unifiedRows(lines(SAMPLE_EDIT_DIFF));
  expect(rows[1]).toMatchObject({ tone: "context", old: 1, new: 1, sign: " ", text: 'import { WebSocket } from "ws";' });
  expect(rows[2]).toMatchObject({ tone: "add", new: 2, sign: "+" });
  expect(rows[2]).not.toHaveProperty("old");
  expect(rows[3]).toMatchObject({ tone: "context", old: 2, new: 3 });
  expect(rows[5]).toMatchObject({ tone: "del", old: 4, sign: "-", text: "  const delay = Math.min(Math.max(attempt, 0), 8);" });
  expect(rows[6]).toMatchObject({ tone: "add", new: 5 });
  const second = rows.findIndex((row, i) => i > 0 && row.kind === "hunk");
  expect(rows[second]).toEqual({ kind: "hunk", text: "@@ -20,5 +21,5 @@ export function retry() {" });
  expect(rows[second + 1]).toMatchObject({ old: 20, new: 21 });
  expect(rows[second + 2]).toMatchObject({ tone: "del", old: 21 });
  expect(rows[second + 3]).toMatchObject({ tone: "del", old: 22 });
  expect(rows[second + 4]).toMatchObject({ tone: "add", new: 22 });
  expect(rows[second + 5]).toMatchObject({ tone: "context", old: 23, new: 23 });
});

test("an added file", () => {
  const parsed = lines(SAMPLE_NEW_FILE_DIFF);
  expect(diffFile(parsed)).toEqual({ path: "src/clamp.ts", added: true, deleted: false });
  const rows = unifiedRows(parsed);
  expect(rows).toHaveLength(4);
  expect(rows[3]).toMatchObject({ tone: "add", new: 3, text: "}" });
});

test("a deleted file takes the old path", () => {
  const parsed = lines("--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n");
  expect(diffFile(parsed)).toEqual({ path: "old.txt", added: false, deleted: true });
  expect(unifiedRows(parsed).slice(1)).toMatchObject([
    { tone: "del", old: 1, text: "one" },
    { tone: "del", old: 2, text: "two" },
  ]);
});

test("a path without a/ or b/ stays as written", () => {
  expect(diffFile(lines("--- x.txt\n+++ y.txt\n@@ -1 +1 @@\n-a\n+b\n")).path).toBe("y.txt");
});

test("split pairs a run of removed lines with the added run, and the extra side is empty", () => {
  const rows = splitRows(lines("--- a/f\n+++ b/f\n@@ -1,4 +1,3 @@\n keep\n-a\n-b\n-c\n+x\n+y\n tail\n"));
  expect(rows).toMatchObject([
    { kind: "hunk" },
    { kind: "pair", left: { tone: "context", n: 1, text: "keep" }, right: { tone: "context", n: 1, text: "keep" } },
    { kind: "pair", left: { tone: "del", n: 2, text: "a" }, right: { tone: "add", n: 2, text: "x" } },
    { kind: "pair", left: { tone: "del", n: 3, text: "b" }, right: { tone: "add", n: 3, text: "y" } },
    { kind: "pair", left: { tone: "del", n: 4, text: "c" }, right: null },
    { kind: "pair", left: { tone: "context", n: 5 }, right: { tone: "context", n: 4 } },
  ]);
});

test("split leaves the old side empty for added lines alone", () => {
  const rows = splitRows(lines("@@ -1 +1,2 @@\n a\n+b\n"));
  expect(rows[2]).toMatchObject({ kind: "pair", left: null, right: { tone: "add", n: 2 } });
});

test("a no-newline note stays a meta row with no number", () => {
  const rows = unifiedRows(lines("--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n"));
  expect(rows[2]).toEqual({ kind: "meta", text: "\\ No newline at end of file" });
  expect(rows[3]).toMatchObject({ tone: "add", new: 1 });
  expect(splitRows(lines("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n"))[2]).toEqual({
    kind: "meta",
    text: "\\ No newline at end of file",
  });
});

test("text with no hunk header shows its lines without numbers", () => {
  const rows = unifiedRows(lines("-a\n+b\n"));
  expect(rows).toEqual([
    { kind: "line", tone: "del", sign: "-", text: "a" },
    { kind: "line", tone: "add", sign: "+", text: "b" },
  ]);
});

test("escapes are already visible in the text", () => {
  const rows = unifiedRows(lines("@@ -1 +1 @@\n+a\u001b[31mb\n"));
  expect((rows[1] as { text: string }).text).not.toContain("\u001b");
});
