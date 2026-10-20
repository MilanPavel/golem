import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { ChatMessage } from "./chat-state.ts";
import { newestArtifact, pagerCommand, showInPager } from "./pager.ts";

test("the pager is $PAGER split on spaces, or less", () => {
  assert.deepEqual(pagerCommand({ PAGER: "less -R" }), ["less", "-R"]);
  assert.deepEqual(pagerCommand({}), ["less"]);
  assert.deepEqual(pagerCommand({ PAGER: "  " }), ["less"]);
});

test("/artifact without an id opens the newest tool output that was kept", () => {
  const messages: ChatMessage[] = [
    {
      id: "m1",
      role: "assistant",
      text: "",
      streaming: false,
      tools: [
        { callId: "c1", name: "shell", args: {}, status: "done", artifactId: "a_old" },
        { callId: "c2", name: "shell", args: {}, status: "done", artifactId: "a_new" },
        { callId: "c3", name: "read_file", args: {}, status: "done" },
      ],
    },
    { id: "m2", role: "assistant", text: "done", streaming: false },
  ];
  assert.equal(newestArtifact(messages), "a_new");
  assert.equal(newestArtifact([]), null);
});

test("the text goes to the pager in a file while the terminal is suspended", async () => {
  let suspended = false;
  let seen = "";
  const code = await showInPager(
    "line 1\nline 2\n",
    async (run) => {
      suspended = true;
      await run();
    },
    async (command, file) => {
      assert.deepEqual(command, ["cat"]);
      seen = await readFile(file, "utf8");
      return 0;
    },
    { PAGER: "cat" },
  );
  assert.equal(code, 0);
  assert.equal(suspended, true);
  assert.equal(seen, "line 1\nline 2\n");
});
