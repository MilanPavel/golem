import assert from "node:assert/strict";
import { test } from "node:test";

import { insertText } from "./edit.ts";
import { collapsePaste, deleteToken, noPastes } from "./paste.ts";

const NINE = Array.from({ length: 9 }, (_, index) => `line ${index + 1}`).join("\n");

test("backspace right after a token removes all of it, and elsewhere does nothing special", () => {
  const { pastes, insert } = collapsePaste(noPastes, NINE);
  const draft = insertText(insertText({ text: "see ", cursor: 4 }, insert), "!");
  assert.equal(deleteToken(draft, pastes), null);
  const after = { text: draft.text, cursor: draft.text.length - 1 };
  assert.deepEqual(deleteToken(after, pastes), { text: "see !", cursor: 4 });
  assert.equal(deleteToken({ text: "see", cursor: 3 }, pastes), null);
});
