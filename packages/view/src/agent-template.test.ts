import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_TEMPLATE } from "./agent-template.ts";

test("the template has the keys of an agent file between two fences, then a prompt", () => {
  const lines = AGENT_TEMPLATE.split("\n");
  assert.equal(lines[0], "---");
  const end = lines.indexOf("---", 1);
  assert.ok(end > 0);
  const keys = lines.slice(1, end).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["name", "description", "model", "tools", "max-calls", "max-seconds", "max-answer-chars", "asks"]);
  assert.ok(lines.slice(end + 1).join("\n").trim().length > 0);
  assert.ok(AGENT_TEMPLATE.includes("name: my-agent"));
  assert.ok(AGENT_TEMPLATE.includes("tools: read_file, list_dir, glob, grep"));
});
