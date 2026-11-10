import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChatEvent, TraceModelSpan, TraceRunSpan } from "@golem/client";
import {
  contextBar,
  contextCells,
  contextGrid,
  contextReportLines,
  contextLevel,
  contextSummary,
  contextReport,
  windowUnknownHint,
  contextWarning,
  emptyLiveContext,
  foldLiveContext,
  formatTokens,
  formatWindow,
  latestModelSpan,
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

function event(type: string, data: Record<string, unknown>): ChatEvent {
  return { seq: 1, session_id: "s", run_id: "r", ts: "2026-11-01T10:00:00+00:00", type, data } as ChatEvent;
}
const started = (id: string, window: number | null = 128000, extra: Record<string, unknown> = {}) =>
  event("model.call.started", { message_id: id, index: 1, profile: "p", context_window: window, ...extra });
const completed = (id: string, usage?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  event("model.call.completed", { message_id: id, latency_ms: 5, usage, ...extra });

test("foldLiveContext: started then completed gives the last context", () => {
  const state = foldLiveContext(foldLiveContext(emptyLiveContext, started("m1")), completed("m1", { input: 32000, output: 10 }));
  assert.deepEqual(state, { last: { spanId: "m1", used: 32000, window: 128000, windowEstimated: false, numCtx: null }, pending: null });
});

test("foldLiveContext: window_estimated on the start reaches last, and a missing field is false", () => {
  const done = (extra: Record<string, unknown>) =>
    foldLiveContext(foldLiveContext(emptyLiveContext, started("m1", 8192, extra)), completed("m1", { input: 100 }));
  assert.equal(done({ window_estimated: true }).last?.windowEstimated, true);
  assert.equal(done({}).last?.windowEstimated, false);
});

test("windowUnknownHint: an Ollama model learns its window after the first answer", () => {
  assert.equal(
    windowUnknownHint("ollama"),
    "golem does not know this model's window yet. It learns it after the first answer, or you can set ctx on the profile.",
  );
  assert.equal(windowUnknownHint("openai"), "golem does not know this model's window.");
  assert.equal(windowUnknownHint(null), "golem does not know this model's window.");
});

test("contextReport: an estimated window is marked and an unknown one gets the hint", () => {
  const estimated = contextReport({ kind: "ready", model: "m", context: context({ used: 1000, window: 8192, window_estimated: true, parts: [part("user", 1000)] }) }, 80);
  assert.ok(estimated.some((line) => line.includes("≈8K")));
  assert.ok(estimated.some((line) => line.includes("not sent")));
  const unknown = contextReport({ kind: "ready", model: "m", provider: "ollama", context: context({ used: 1000, window: null, parts: [part("user", 1000)] }) }, 80);
  assert.ok(unknown.some((line) => line.includes("learns it after the first answer")));
});

test("foldLiveContext: a call with no usage keeps the previous last", () => {
  const first = foldLiveContext(foldLiveContext(emptyLiveContext, started("m1")), completed("m1", { input: 100 }));
  const state = foldLiveContext(foldLiveContext(first, started("m2")), completed("m2"));
  assert.deepEqual(state.last, first.last);
  assert.equal(state.pending, null);
});

test("foldLiveContext: a completed event for another id changes nothing, and so does an unrelated event", () => {
  const pending = foldLiveContext(emptyLiveContext, started("m1"));
  assert.equal(foldLiveContext(pending, completed("m9", { input: 5 })), pending);
  assert.equal(foldLiveContext(pending, event("message.started", { message_id: "x", role: "assistant" })), pending);
});

function model(id: string): TraceModelSpan {
  return { id, kind: "model", name: "model", start: "2026-11-01T10:00:00+00:00", status: "ok" };
}

function run(id: string, calls: TraceModelSpan[]): TraceRunSpan {
  return { id, kind: "run", name: "run", start: "2026-11-01T10:00:00+00:00", status: "ok", children: calls };
}

test("latestModelSpan: null with no runs or no calls, else the last call of the last run that has one", () => {
  assert.equal(latestModelSpan([]), null);
  assert.equal(latestModelSpan([run("r1", [])]), null);
  assert.equal(latestModelSpan([run("r1", [model("m1")]), run("r2", [model("m2"), model("m3")])])?.id, "m3");
  assert.equal(latestModelSpan([run("r1", [model("m1"), model("m2")]), run("r2", [])])?.id, "m2");
});

test("contextReport: the cases with nothing to show", () => {
  assert.deepEqual(contextReport({ kind: "loading" }, 80), ["reading the context…"]);
  assert.deepEqual(contextReport({ kind: "none" }, 80), ["no model call yet — send a message first"]);
  assert.deepEqual(contextReport({ kind: "error", message: "not connected" }, 80), ["could not read the context: not connected"]);
  assert.deepEqual(contextReport({ kind: "ready", model: null, context: null }, 80), [
    "this call has no context record — it ran before golem kept traces",
  ]);
});

function item(name: string, tokens: number, group: string | null) {
  return { name, tokens, group };
}

function full(): TraceContext {
  const tools: TraceContextPart = {
    key: "tools",
    tokens: 22800,
    chars: 91200,
    items: [item("a", 6000, "filesystem"), item("b", 12100, "github"), item("c", 4700, null)],
  };
  return context({
    used: 32000,
    window: 128000,
    parts: [part("system", 1200), tools, part("user", 312), part("assistant", 2100), part("tool_results", 5588)],
  });
}

test("contextReport: the grid with the legend beside it, the tools grouped by server and a free row", () => {
  const lines = contextReport({ kind: "ready", model: "ollama/qwen3-coder:30b", context: full() }, 100);
  const free = "\u25A1 ".repeat(15);
  const row = (text: string): string => `${text.padEnd(18)}`;
  assert.equal(lines.length, 10 + 3 + 1);
  assert.ok(lines[0]?.endsWith("   ollama/qwen3-coder:30b"));
  assert.ok(lines[1]?.endsWith("   32.0K / 128K · 25%"));
  assert.ok(lines[2]?.length === 40);
  assert.equal(lines[3]?.slice(40), `   ${"\u25A0 "}${row("System prompt")}${"1.2K".padStart(7)}   <1%`);
  assert.equal(lines[4]?.slice(40), `   ${"\u25A0 "}${row("Tool definitions")}${"22.8K".padStart(7)}   18%`);
  assert.equal(lines[8]?.slice(40), `   ${"\u25A1 "}${row("Free")}${"96.0K".padStart(7)}   75%`);
  assert.ok(lines[9]?.startsWith(free));
  assert.deepEqual(lines.slice(10), [
    "  github · 1 tool            12.1K",
    "  filesystem · 1 tool         6.0K",
    "  built-in · 1 tool           4.7K",
    "Parts are estimates, scaled to the provider's count.",
  ]);
});

test("contextGrid: rows by cols cells, parts in order, then free; an overfull window fills it", () => {
  const parts = full().parts;
  const grid = contextGrid(parts, 128000);
  assert.equal(grid.length, 10);
  assert.ok(grid.every((row) => row.length === 20));
  const flat = grid.flat();
  for (const { key, cells } of contextCells(parts, 128000, 200)) {
    assert.equal(flat.filter((cell) => cell === key).length, cells);
  }
  assert.equal(flat.lastIndexOf("tool_results") < flat.indexOf("free"), true);
  assert.equal(flat.slice(flat.indexOf("free")).every((cell) => cell === "free"), true);
  assert.equal(contextGrid(parts, 1000).flat().every((cell) => cell !== "free"), true);
  assert.equal(contextGrid(parts, 128000, 2, 3).flat().length, 6);
});

test("contextReportLines: the legend sits beside the grid from 84 columns and under it below", () => {
  const input = { kind: "ready" as const, model: "m", context: full() };
  const wide = contextReportLines(input, 100);
  const narrow = contextReportLines(input, 60);
  assert.equal(wide[3]?.some((segment) => segment.part === "system"), true);
  assert.equal(wide[3]?.some((segment) => segment.text.includes("System prompt")), true);
  assert.equal(contextReportLines(input, 84)[3]?.some((segment) => segment.text.includes("System prompt")), true);
  assert.equal(contextReportLines(input, 83)[3]?.some((segment) => segment.text.includes("System prompt")), false);
  assert.equal(narrow.slice(0, 10).every((line) => line.every((segment) => !segment.text.includes("System"))), true);
  assert.equal(narrow[10]?.[0]?.text, "m");
  assert.equal(narrow[13]?.[0]?.part, "system");
  assert.equal(narrow[18]?.[0]?.part, "free");
});

test("contextReport: with no window there is no grid, only the rows and the hint", () => {
  const lines = contextReport({ kind: "ready", model: "m", provider: "ollama", context: context({ used: 1000, window: null, parts: [part("user", 1000)] }) }, 100);
  assert.equal(lines[0], "context · m · 1.0K · window unknown");
  assert.equal(lines.some((line) => line.includes("\u25A0")), false);
  assert.equal(lines.at(-1)?.includes("learns it after the first answer"), true);
});

test("contextReport: seven servers show five and the rest summed; a null group is built-in", () => {
  const items = Array.from({ length: 7 }, (_, at) => item(`t${at}`, 1000 * (at + 1), `s${at}`));
  const tools: TraceContextPart = { key: "tools", tokens: 28000, chars: 0, items };
  const lines = contextReport({ kind: "ready", model: null, context: context({ used: 28000, window: 128000, parts: [tools] }) }, 80);
  const servers = lines.filter((line) => line.startsWith("  "));
  assert.equal(servers.length, 6);
  assert.equal(servers[0], `${"  s6 · 1 tool".padEnd(28)}${"7.0K".padStart(6)}`);
  assert.equal(servers[5], `${"  +2 more servers".padEnd(28)}${"3.0K".padStart(6)}`);
  const built = contextReport({ kind: "ready", model: null, context: context({ used: 50, parts: [{ ...tools, items: [item("own", 50, null)] }] }) }, 80);
  assert.ok(built.includes(`${"  built-in · 1 tool".padEnd(28)}${"50".padStart(6)}`));
});

test("contextReport: two tools on one server count as tools", () => {
  const tools: TraceContextPart = { key: "tools", tokens: 30, chars: 0, items: [item("a", 10, "x"), item("b", 20, "x")] };
  const lines = contextReport({ kind: "ready", model: null, context: context({ parts: [tools] }) }, 80);
  assert.ok(lines.some((line) => line.startsWith("  x · 2 tools")));
});

test("contextReport: an unknown window gives percents of used, no bar and no free row", () => {
  const lines = contextReport({ kind: "ready", model: null, context: context({ used: 1000, window: null, parts: [part("user", 1000)] }) }, 80);
  assert.equal(lines[0], "context · 1.0K · window unknown");
  assert.ok(lines.includes(`${"Your messages".padEnd(18)}${"1.0K".padStart(7)} ${"100%".padStart(5)}`));
  assert.ok(!lines.some((line) => line.startsWith("Free") || line.startsWith("█")));
});

test("contextReport: unknown usage leaves out the percent, the bar and the free row", () => {
  const lines = contextReport({ kind: "ready", model: "m", context: context({ used: null, parts: [part("user", 1000)] }) }, 80);
  assert.equal(lines[0], "context · m · usage not reported");
  assert.ok(lines.includes(`${"Your messages".padEnd(18)}${"1.0K".padStart(7)}`));
  assert.ok(!lines.some((line) => line.startsWith("Free") || line.startsWith("█")));
});

test("contextReport: input above num_ctx adds the warning line, and no estimate line when exact", () => {
  const ctx = context({ used: 8192, window: 32768, num_ctx: 8192, estimated: false, parts: [part("user", 8192)] });
  const lines = contextReport({ kind: "ready", model: null, context: ctx }, 80);
  assert.equal(lines.at(-1), "! Input is larger than num_ctx 8K. Ollama dropped the oldest part.");
  assert.ok(!lines.some((line) => line.startsWith("Parts are")));
});

test("contextReport: the part rows add up to used when the parts are scaled", () => {
  const ctx = full();
  const sum = ctx.parts.reduce((total, p) => total + p.tokens, 0);
  assert.equal(sum, ctx.used);
});

test("foldLiveContext: a window read after the call replaces the estimate and is exact", () => {
  const state = foldLiveContext(
    foldLiveContext(emptyLiveContext, started("m1", 4096, { window_estimated: true })),
    completed("m1", { input: 23600 }, { context_window: 32768 }),
  );
  assert.equal(state.last?.window, 32768);
  assert.equal(state.last?.windowEstimated, false);
});

test("foldLiveContext: input above an estimated window drops the window, never over 100%", () => {
  const state = foldLiveContext(
    foldLiveContext(emptyLiveContext, started("m1", 4096, { window_estimated: true })),
    completed("m1", { input: 23600 }),
  );
  assert.equal(state.last?.window, null);
  assert.equal(state.last?.windowEstimated, false);
});

test("foldLiveContext: input above an exact window keeps it", () => {
  const state = foldLiveContext(foldLiveContext(emptyLiveContext, started("m1", 4096)), completed("m1", { input: 23600 }));
  assert.equal(state.last?.window, 4096);
});
