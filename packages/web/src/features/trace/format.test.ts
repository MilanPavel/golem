import { expect, test } from "vitest";
import { endContext, formatDuration, inputSeries, latestContext, localTime, runTokens, summaryLine, throughput, tokenCell, totalTokens } from "./format.ts";
import { GROWING_TRACE, LONG_TRACE, OLD_TRACE, SHORT_TRACE, sampleModel, sampleRun, sampleTool } from "./sample.ts";
import type { TraceModelSpan } from "../../store/trace.ts";

test("durations: minutes and seconds, and a dash when unknown", () => {
  expect([0, 4, 999, 1000, 1234, 18400].map(formatDuration)).toEqual(["0m 00.000s", "0m 00.004s", "0m 00.999s", "0m 01.0s", "0m 01.2s", "0m 18.4s"]);
  expect(formatDuration(null)).toBe("—");
});

test("the summary line counts runs, time, and tokens, and shows a dash for none", () => {
  expect(summaryLine(SHORT_TRACE)).toBe("1 run · 0m 04.2s · 6.9K tokens · context 3.4K / 128K · 2%");
  expect(summaryLine(LONG_TRACE)).toMatch(/^2 runs · 0m 24\.0s · /);
  expect(totalTokens(OLD_TRACE)).toBeNull();
  expect(summaryLine(OLD_TRACE)).toBe("1 run · 0m 03.0s · — tokens");
});

test("the latest context is the last model call with an input, and the line ends with it", () => {
  expect(latestContext(GROWING_TRACE)).toEqual({ spanId: "m_4", used: 32000, window: 128000, estimated: false });
  expect(latestContext(OLD_TRACE)).toBeNull();
  expect(summaryLine(GROWING_TRACE)).toBe("2 runs · 2m 30.8s · 110.7K tokens · context 32.0K / 128K · 25%");
  expect(inputSeries(GROWING_TRACE)).toEqual([21700, 24000, 28400, 32000]);
  expect(inputSeries(OLD_TRACE)).toEqual([]);
});

const run = SHORT_TRACE[0] as (typeof SHORT_TRACE)[number];
const first = run.children?.[0] as TraceModelSpan;

test("a run's tokens are the input and output of its calls, null with none", () => {
  expect(runTokens(run)).toBe(3200 + 90 + 3400 + 210);
  expect(runTokens(OLD_TRACE[0] as typeof run)).toBeNull();
});

test("the end context is the last call with both input and a window", () => {
  expect(endContext(run)).toEqual({ used: 3400, window: 128_000, estimated: false });
  const late = sampleModel("m_3", 3, 0, 10, [], { tokens: [500, 5], window: null });
  const mixed = sampleRun("r", "x", 0, 10, [first, late]);
  expect(endContext(mixed)).toEqual({ used: 3200, window: 128_000, estimated: false });
  expect(endContext(OLD_TRACE[0] as typeof run)).toBeNull();
  const guess = sampleModel("m_4", 4, 0, 10, [], { tokens: [64_000, 5], window: 128_000 });
  expect(endContext(sampleRun("r", "x", 0, 10, [{ ...guess, context_window_estimated: true }]))?.estimated).toBe(true);
});

test("a model row shows its input and the share of its window", () => {
  const cell = tokenCell(first);
  expect(cell).toMatchObject({ text: "3.2K · 2%", level: "ok", title: "3.2K in · 90 out · 2% of 128K" });
  expect(cell?.share).toBeCloseTo(0.025);
  expect(tokenCell({ ...first, context_window_estimated: true })).toMatchObject({ text: "3.2K · ≈2%", title: "3.2K in · 90 out · 2% of ≈128K" });
  expect(tokenCell({ ...first, context_window: null })).toEqual({ text: "3.2K", share: null, level: null, title: "3.2K in · 90 out" });
  expect(tokenCell({ ...first, context_window: 3300 })).toMatchObject({ text: "3.2K · 96%", level: "full" });
  expect(tokenCell({ ...first, context_window: 4000 })).toMatchObject({ level: "high" });
  expect(tokenCell({ ...first, tokens: { input: 5, output: 1, cache_read: null, cache_write: null } })?.text).toBe("5 · <1%");
  expect(tokenCell({ ...first, context_window: 1000 })?.text).toBe("3.2K · 320%");
});

test("a model row with no input shows a dash and no bar", () => {
  const old = OLD_TRACE[0]?.children?.[0] as TraceModelSpan;
  expect(tokenCell(old)).toEqual({ text: "—", share: null, level: null, title: "" });
  expect(tokenCell({ ...first, tokens: null })?.text).toBe("—");
});

test("a run row shows its total and its end context, and a tool row shows nothing", () => {
  expect(tokenCell(run)).toMatchObject({
    text: "6.9K · 2%",
    level: "ok",
    title: "6.9K tokens in this run · context at the end 3.4K / 128K (2%)",
  });
  const bare = sampleRun("r", "x", 0, 10, [sampleModel("m", 1, 0, 5, [], { tokens: [100, 5], window: null })]);
  expect(tokenCell(bare)).toEqual({ text: "105", share: null, level: null, title: "105 tokens in this run" });
  expect(tokenCell(OLD_TRACE[0] as typeof run)).toBeNull();
  expect(tokenCell(sampleTool("c", "grep", 0, 5))).toBeNull();
});

test("throughput is output over the time after the first token", () => {
  const span = { ...first, duration_ms: 10_000, first_token_ms: 2_000, tokens: { input: 1, output: 576, cache_read: null, cache_write: null } };
  expect(throughput(span)).toBe(72);
  expect(throughput({ ...span, first_token_ms: null })).toBeNull();
  expect(throughput({ ...span, tokens: { ...span.tokens, output: 0 } })).toBeNull();
  expect(throughput({ ...span, duration_ms: 2_010 })).toBeNull();
});

test("local time has milliseconds, and a bad string stays as it is", () => {
  expect(localTime("2026-11-07T11:00:02.120Z", "UTC")).toBe("Nov 7, 2026, 11:00:02.120");
  expect(localTime("not a time")).toBe("not a time");
});
