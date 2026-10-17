import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";

import { applyComposer, closedDebug } from "./commands.ts";
import { draftAt, edit, editDraft, editorCommand, insertText } from "./edit.ts";

test("the cursor edits the middle of the draft", () => {
  let draft = insertText(draftAt(""), "hello");
  draft = edit(draft, "left");
  draft = edit(draft, "left");
  draft = insertText(draft, "X");
  assert.deepEqual(draft, { text: "helXlo", cursor: 4 });
  draft = edit(draft, "backspace");
  assert.equal(draft.text, "hello");
  draft = edit(draft, "delete");
  assert.equal(draft.text, "helo");
});

test("words and lines move and delete around the cursor", () => {
  const end = draftAt("hello world");
  assert.equal(edit(end, "word-left").cursor, 6);
  assert.equal(edit(edit(end, "word-left"), "word-left").cursor, 0);
  assert.equal(edit(draftAt("hello world", 0), "word-right").cursor, 6);
  assert.equal(edit(draftAt("hello world", 6), "word-right").cursor, 11);
  assert.equal(edit(end, "delete-word").text, "hello ");

  const lines = draftAt("ab\ncd", 4);
  assert.equal(edit(lines, "line-start").cursor, 3);
  assert.equal(edit(lines, "line-end").cursor, 5);
  assert.equal(edit(draftAt("ab\ncd", 0), "delete-to-end").text, "\ncd");
  assert.equal(edit(draftAt("ab\ncd", 4), "delete-to-start").text, "ab\nd");
  assert.equal(edit(draftAt("ab\n", 2), "delete-to-end").text, "ab");
});

test("a pasted stack trace stays one message and can be fixed in the middle", () => {
  const trace = Array.from({ length: 20 }, (_, index) => `line ${index} boom`).join("\n");
  let draft = insertText(draftAt(""), trace);
  assert.equal(draft.text.split("\n").length, 20);
  const at = draft.text.indexOf("line 10 boom") + "line 10 boom".length;
  draft = draftAt(draft.text, at);
  draft = edit(draft, "delete-word");
  draft = insertText(draft, "fixed");
  assert.equal(draft.text.split("\n")[10], "line 10 fixed");
  assert.equal(draft.text.split("\n").length, 20);

  const sent = applyComposer(closedDebug, draft.text);
  assert.equal(sent.kind, "send");
  if (sent.kind === "send") {
    assert.equal(sent.text, draft.text);
  }
});

test("alt-enter inserts a newline and the cursor stops at the ends", () => {
  assert.deepEqual(edit(draftAt("ab", 1), "newline"), { text: "a\nb", cursor: 2 });
  assert.equal(edit(draftAt("ab", 0), "left").cursor, 0);
  assert.equal(edit(draftAt("ab"), "right").cursor, 2);
});

test("the editor command falls back to vi, and a saved file replaces the draft", async () => {
  assert.deepEqual(editorCommand({}), ["vi"]);
  assert.deepEqual(editorCommand({ EDITOR: "  " }), ["vi"]);
  assert.deepEqual(editorCommand({ EDITOR: "code --wait" }), ["code", "--wait"]);

  const saved = await editDraft("hello", async (run) => {
    await run();
  }, async (_command, file) => {
    const original = await readFile(file, "utf8");
    assert.equal(original, "hello");
    await writeFile(file, "hello\nfixed\n", "utf8");
    return 0;
  });
  assert.equal(saved, "hello\nfixed");

  const failed = await editDraft("hello", async (run) => {
    await run();
  }, async () => 1);
  assert.equal(failed, null);
});

test("a temp draft is removed after the editor exits", async () => {
  let seen = "";
  await editDraft("x", async (run) => {
    await run();
  }, async (_command, file) => {
    seen = file;
    return 0;
  });
  await assert.rejects(readFile(seen, "utf8"));
});
