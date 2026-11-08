import { expect, test } from "vitest";
import { sampleModel, sampleRun, sampleTool } from "./sample.ts";
import { barFor, MIN_WIDTH, runExtent } from "./waterfall.ts";

// A run of one second, so a millisecond is a tenth of a percent.
function within(...tools: ReturnType<typeof sampleTool>[]) {
  const model = sampleModel("m", 1, 0, 1000, tools);
  return sampleRun("r", "go", 0, 1000, [model]);
}

test("a span at the start, in the middle, and at the end of its run", () => {
  const first = sampleTool("a", "t", 0, 100);
  const middle = sampleTool("b", "t", 400, 200);
  const last = sampleTool("c", "t", 900, 100);
  const run = within(first, middle, last);
  expect(barFor(run, first)).toEqual({ left: 0, width: 10, wait: null });
  expect(barFor(run, middle)).toEqual({ left: 40, width: 20, wait: null });
  expect(barFor(run, last)).toEqual({ left: 90, width: 10, wait: null });
});

test("a 0 ms span still gets a visible width, and stays inside the line", () => {
  const instant = sampleTool("a", "t", 500, 0);
  const atEnd = sampleTool("b", "t", 1000, 0);
  const run = within(instant, atEnd);
  expect(barFor(run, instant).width).toBe(MIN_WIDTH);
  const edge = barFor(run, atEnd);
  expect(edge.left + edge.width).toBeLessThanOrEqual(100);
});

test("a span longer than its run is clamped to the end of the line", () => {
  const long = sampleTool("a", "t", 800, 900);
  const run = within(long);
  expect(runExtent(run)).toBe(1000);
  expect(barFor(run, long)).toEqual({ left: 80, width: 20, wait: null });
});

test("a run still open is as long as its latest span reaches", () => {
  const tool = sampleTool("a", "t", 200, 300);
  const run = { ...within(tool), end: null, duration_ms: null, status: "running" as const };
  expect(runExtent(run)).toBe(1000); // the model call reaches 1000 ms
  expect(barFor(run, tool)).toEqual({ left: 20, width: 30, wait: null });
});

test("a tool that waited for approval has the wait first and its bar after it", () => {
  const tool = sampleTool("a", "edit_file", 100, 50, { approval_wait_ms: 300 });
  const run = within(tool);
  expect(barFor(run, tool)).toEqual({ left: 40, width: 5, wait: { left: 10, width: 30 } });
});

test("a run is the whole line, and an open span runs to its end", () => {
  const open = { ...sampleTool("a", "t", 500, 0), end: null, duration_ms: null };
  const run = within(open);
  expect(barFor(run, run)).toEqual({ left: 0, width: 100, wait: null });
  expect(barFor(run, open)).toEqual({ left: 50, width: 50, wait: null });
});

test("a span with no measured time is as long as its start to its end", () => {
  const unmeasured = { ...sampleTool("a", "t", 200, 300), duration_ms: null };
  const run = within(unmeasured);
  expect(barFor(run, unmeasured)).toEqual({ left: 20, width: 30, wait: null });
});
