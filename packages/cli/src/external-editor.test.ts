import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { editFile, editInEditor, editorCommand } from "./external-editor.ts";

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

test("editFile runs the editor on the file itself", async () => {
  let seen: readonly string[] = [];
  const ok = await editFile(
    "/x/SKILL.md",
    async (command, file) => {
      seen = [...command, file];
      return 0;
    },
    { EDITOR: "ed -s" },
  );
  assert.equal(ok, true);
  assert.deepEqual(seen, ["ed", "-s", "/x/SKILL.md"]);
  assert.equal(await editFile("/x", async () => 1, {}), false);
  assert.equal(
    await editFile(
      "/x",
      async () => {
        throw new Error("none");
      },
      {},
    ),
    false,
  );
});
