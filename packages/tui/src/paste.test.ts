import assert from "node:assert/strict";
import { test } from "node:test";

import { insertText } from "./edit.ts";
import { collapsePaste, deleteToken, expandPastes, noPastes, PASTE_CHARS, pasteToken } from "./paste.ts";

const NINE = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n");

test("a short paste goes in as text, and a long one as a token", () => {
  assert.deepEqual(collapsePaste(noPastes, "one\ntwo"), { pastes: noPastes, insert: "one\ntwo" });
  const long = collapsePaste(noPastes, NINE);
  assert.equal(long.insert, "[Pasted text #1 +8 lines]");
  assert.equal(long.pastes.next, 2);
  assert.equal(long.pastes.texts.get(long.insert), NINE);
  const again = collapsePaste(long.pastes, "a\r\nb\r\nc");
  assert.equal(again.insert, "[Pasted text #2 +2 lines]");
  assert.equal(again.pastes.texts.get(again.insert), "a\nb\nc");
});

test("one long line is counted in characters", () => {
  const text = "x".repeat(PASTE_CHARS + 434);
  assert.equal(collapsePaste(noPastes, text).insert, "[Pasted text #1 1,234 chars]");
  assert.equal(collapsePaste(noPastes, "x".repeat(PASTE_CHARS - 1)).insert, "x".repeat(PASTE_CHARS - 1));
  assert.equal(pasteToken(3, "a\nb"), "[Pasted text #3 +1 line]");
});

test("sending swaps each token back, and an edited token stays as typed", () => {
  const first = collapsePaste(noPastes, NINE);
  const second = collapsePaste(first.pastes, "a\nb\nc");
  const draft = `look at ${first.insert} and ${second.insert}`;
  assert.equal(expandPastes(draft, second.pastes), `look at ${NINE} and a\nb\nc`);
  assert.equal(expandPastes("[Pasted text #1 +8 line]", second.pastes), "[Pasted text #1 +8 line]");
  assert.equal(expandPastes("no tokens", noPastes), "no tokens");
});

test("backspace right after a token removes all of it, and elsewhere does nothing special", () => {
  const { pastes, insert } = collapsePaste(noPastes, NINE);
  const draft = insertText(insertText({ text: "see ", cursor: 4 }, insert), "!");
  assert.equal(deleteToken(draft, pastes), null);
  const after = { text: draft.text, cursor: draft.text.length - 1 };
  assert.deepEqual(deleteToken(after, pastes), { text: "see !", cursor: 4 });
  assert.equal(deleteToken({ text: "see", cursor: 3 }, pastes), null);
});
