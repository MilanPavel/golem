import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposer, closedDebug, COMMANDS, contextLines, contextSegments, fitLine, helpLines } from "./commands.ts";
import { CTX_SYSTEM, CTX_TOOLS, CTX_USER, HINT } from "./theme.ts";

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

const CONTEXT_REPORT = {
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

test("contextLines cuts every line to the terminal", () => {
  for (const columns of [100, 84, 60, 40, 24]) {
    const lines = contextLines(CONTEXT_REPORT, columns);
    assert.ok(lines.every((line) => line.length <= columns), `${columns} columns`);
    assert.ok(lines.every((line) => !line.includes("\n")));
  }
  assert.ok(contextLines(CONTEXT_REPORT, 24)[0]?.endsWith("\u2026"));
  assert.deepEqual(contextLines({ kind: "none" }, 80), ["no model call yet \u2014 send a message first"]);
});

test("contextSegments colours the grid by part, and the glyphs are one cell wide", () => {
  const lines = contextSegments(CONTEXT_REPORT, 100);
  const colours = new Set(lines.flat().flatMap((segment) => (segment.color === undefined ? [] : [segment.color])));
  assert.ok(colours.has(CTX_SYSTEM) && colours.has(CTX_TOOLS) && colours.has(CTX_USER) && colours.has(HINT));
  for (const glyph of ["\u25A0", "\u25A1"]) {
    assert.equal(glyph.length, 1);
    assert.equal(fitLine(`${glyph}${glyph}${glyph}`, 3), `${glyph}${glyph}${glyph}`);
  }
});
