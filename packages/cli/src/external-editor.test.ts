import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { editInEditor, editorCommand } from "./external-editor.ts";

test("the editor is $EDITOR split on spaces, or vi", () => {
  assert.deepEqual(editorCommand({ EDITOR: "code -w" }), ["code", "-w"]);
  assert.deepEqual(editorCommand({}), ["vi"]);
  assert.deepEqual(editorCommand({ EDITOR: "  " }), ["vi"]);
});

test("the saved text comes back, and a failed editor returns null", async () => {
  const saved = await editInEditor(
    "a = 1\n",
    "config.toml",
    async (command, file) => {
      assert.deepEqual(command, ["ed"]);
      assert.equal(readFileSync(file, "utf8"), "a = 1\n");
      writeFileSync(file, "a = 2\r\n");
      return 0;
    },
    { EDITOR: "ed" },
  );
  assert.equal(saved, "a = 2\n");
  assert.equal(await editInEditor("x", "c.toml", async () => 1, {}), null);
  assert.equal(
    await editInEditor("x", "c.toml", async () => {
      throw new Error("no such editor");
    }, {}),
    null,
  );
});
