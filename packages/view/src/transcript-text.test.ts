import assert from "node:assert/strict";
import { test } from "node:test";

import { copyAnswer, copyCode, exportFileName, sessionMarkdown } from "./transcript-text.ts";

test("copy takes the last answer, or the last fenced block", () => {
  const messages = [
    { role: "user", text: "show me\n\n```\nold\n```" },
    { role: "assistant", text: "first" },
    { role: "assistant", text: "use this\n\n```ts\nconst n = 1\n```\n\nthen\n\n```\nlast\n```" },
  ];
  assert.equal(copyAnswer(messages), messages[2]?.text);
  assert.equal(copyAnswer([{ role: "user", text: "hi" }, { role: "assistant", text: "" }]), null);
  assert.equal(copyCode(messages), "last");
  assert.equal(copyCode([{ role: "assistant", text: "no fence" }]), null);
});

test("export is markdown from the messages, named from the title", () => {
  assert.equal(
    sessionMarkdown("Trip\nplans", [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi\n\n```\ncode\n```" },
    ]),
    "# Trip plans\n\n**you**\n\nhello\n\n**golem**\n\nhi\n\n```\ncode\n```\n",
  );
  assert.equal(sessionMarkdown("  ", []), "# untitled\n");
  assert.equal(exportFileName("a/b:c"), "a-b-c.md");
  assert.equal(exportFileName("   "), "untitled.md");
});
