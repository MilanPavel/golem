import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposer, closedDebug, COMMANDS, helpLines } from "./commands.ts";

test("/help lists nothing of its own, and every command has a description", () => {
  assert.equal(COMMANDS.length > 0, true);
  for (const command of COMMANDS) {
    assert.equal(command.description.trim().length > 0, true);
  }
  const lines = helpLines(COMMANDS, 120);
  assert.equal(lines.length, COMMANDS.length);
  for (const command of COMMANDS) {
    assert.equal(
      lines.some((line) => line.startsWith(command.name) && line.includes(command.description)),
      true,
    );
  }
  assert.deepEqual(helpLines([{ name: "/only", args: "", description: "Just this" }], 80), ["/only  Just this"]);
  assert.equal(helpLines([{ name: "/only", args: "[a|b]", description: "Picks" }], 80)[0]?.startsWith("/only [a|b]"), true);

  assert.deepEqual(applyComposer(closedDebug, "/help"), { kind: "help" });
  assert.equal(applyComposer(closedDebug, "/help more").kind, "unknown");
  const debug = COMMANDS.find((command) => command.name === "/debug");
  assert.deepEqual(debug?.choices, ["wire", "model", "hold", "go"]);
});
