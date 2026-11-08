import assert from "node:assert/strict";
import { test } from "node:test";

import {
  contextBar,
  contextCells,
  contextLevel,
  contextSummary,
  contextWarning,
  formatTokens,
  formatWindow,
  type TraceContext,
  type TraceContextPart,
} from "./context.ts";

function part(key: TraceContextPart["key"], tokens: number, chars = tokens * 4): TraceContextPart {
  return { key, tokens, chars, items: [] };
}

function context(over: Partial<TraceContext>): TraceContext {
  return { used: 3400, window: 32768, window_estimated: false, num_ctx: null, estimated: true, parts: [part("tool_results", 3400)], ...over };
}

test("formatTokens: plain under a thousand, then thousands with a tenth and a capital K", () => {
  assert.deepEqual([612, 999, 1000, 9100, 52000].map(formatTokens), ["612", "999", "1.0K", "9.1K", "52.0K"]);
});

test("formatWindow: round window sizes", () => {
  const cases: [number, string][] = [
    [128000, "128K"],
    [131072, "128K"],
    [32768, "32K"],
    [8192, "8K"],
    [200000, "200K"],
    [1000000, "1M"],
    [1048576, "1M"],
    [12345, "12.3K"],
    [900, "900"],
  ];
  for (const [count, text] of cases) assert.equal(formatWindow(count), text);
});

test("contextLevel: high from 80%, full from 95%, ok with no window", () => {
  assert.equal(contextLevel(799, 1000), "ok");
  assert.equal(contextLevel(800, 1000), "high");
  assert.equal(contextLevel(949, 1000), "high");
  assert.equal(contextLevel(950, 1000), "full");
  assert.equal(contextLevel(5000, null), "ok");
  assert.equal(contextLevel(2000, 1000), "full");
});

test("contextSummary: used, window and percent", () => {
  assert.equal(contextSummary(32000, 128000, false), "32.0K / 128K · 25%");
  assert.equal(contextSummary(32000, 128000, true), "32.0K / ≈128K · 25%");
  assert.equal(contextSummary(32000, null, false), "32.0K");
  assert.equal(contextSummary(31500, 32768, false), "31.5K / 32K · 96%");
});

test("contextWarning: num_ctx first, then how full, else none", () => {
  const full = context({ used: 31500, window: 32768 });
  assert.equal(contextWarning(full), "Context is 96% full.");
  const over = context({ used: 8192, window: 8192, num_ctx: 8192, parts: [part("tools", 600), part("tool_results", 6992, 41250)] });
  assert.equal(contextWarning(over), "Input is larger than num_ctx 8K. Ollama dropped the oldest part.");
  const cut = context({ used: 5000, window: 8192, num_ctx: 8192, parts: [part("tool_results", 5000, 50000)] });
  assert.equal(contextWarning(cut), "Input is larger than num_ctx 8K. Ollama dropped the oldest part.");
  assert.equal(contextWarning(context({ num_ctx: 32768 })), null);
  assert.equal(contextWarning(context({ used: 850, window: 1000 })), "Context is 85% full.");
});

const parts = [part("system", 10), part("tools", 50), part("user", 0), part("assistant", 10), part("tool_results", 30)];

test("contextCells and contextBar: largest remainder, free at the end", () => {
  assert.deepEqual(contextCells(parts, 200, 20), [
    { key: "system", cells: 1 },
    { key: "tools", cells: 5 },
    { key: "user", cells: 0 },
    { key: "assistant", cells: 1 },
    { key: "tool_results", cells: 3 },
    { key: "free", cells: 10 },
  ]);
  assert.equal(contextBar(parts, 200, 20), "██████████░░░░░░░░░░");
  assert.equal(contextBar(parts, 50, 10), "██████████");
  assert.deepEqual(contextCells([], null, 6), [{ key: "free", cells: 6 }]);
});
