import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposer, closedDebug, COMMANDS, contextLines, helpLines } from "./commands.ts";

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

test("contextLines cuts every line to the terminal, and the bar stays within 60", () => {
  const report = {
    kind: "ready" as const,
    model: "ollama/qwen3-coder:30b",
    context: {
      used: 32_000,
      window: 128_000,
      window_estimated: false,
      num_ctx: null,
      estimated: true,
      parts: [
        { key: "system" as const, tokens: 1200, chars: 4800, items: [] },
        {
          key: "tools" as const,
          tokens: 22_800,
          chars: 91_200,
          items: [{ name: "search", group: "a-long-server-name-here", tokens: 22_800 }],
        },
        { key: "user" as const, tokens: 8000, chars: 32_000, items: [] },
      ],
    },
  };
  for (const columns of [80, 40, 24]) {
    const lines = contextLines(report, columns);
    assert.ok(lines.every((line) => line.length <= columns), `${columns} columns`);
    assert.ok(lines.every((line) => !line.includes("\n")));
    const bar = lines.find((line) => line.startsWith("\u2588") || line.startsWith("\u2591"));
    assert.ok(bar !== undefined && bar.length <= Math.min(columns, 60));
  }
  assert.equal(contextLines(report, 80)[1]?.length, 60);
  assert.ok(contextLines(report, 24)[0]?.endsWith("\u2026"));
  assert.deepEqual(contextLines({ kind: "none" }, 80), ["no model call yet \u2014 send a message first"]);
});
