import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { GROWING_EVENTS, GROWING_TRACE } from "./sample.ts";
import { inputMarks } from "./format.ts";
import { Sparkline } from "./sparkline.tsx";

test("one value gives no SVG, and several give a labelled one", () => {
  expect(render(<Sparkline values={[5]} />).container.querySelector("svg")).toBeNull();
  const { getByRole } = render(<Sparkline values={[21700, 24000, 28400, 32000]} />);
  expect(getByRole("img").getAttribute("aria-label")).toBe("Input tokens per model call: 21.7K, 24.0K, 28.4K, 32.0K");
});

test("the calls right after a clear or a grow get a tick with a title", () => {
  const marks = inputMarks(GROWING_TRACE, GROWING_EVENTS);
  expect(marks).toEqual([
    { index: 2, label: "cleared" },
    { index: 3, label: "128K" },
  ]);
  const { container, getByRole } = render(<Sparkline values={[21700, 24000, 28400, 32000]} marks={marks} />);
  expect([...container.querySelectorAll("g[data-mark] title")].map((t) => t.textContent)).toEqual(["cleared", "128K"]);
  expect(getByRole("img").getAttribute("aria-label")).toContain("cleared before call 3, 128K before call 4");
});

test("an event with no call after it makes no mark", () => {
  expect(inputMarks(GROWING_TRACE, [{ seq: 1, action: "summarised", call_id: null }])).toEqual([]);
});
