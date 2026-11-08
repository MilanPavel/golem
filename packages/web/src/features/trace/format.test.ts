import { expect, test } from "vitest";
import { formatDuration, formatTokens, summaryLine, totalTokens } from "./format.ts";
import { LONG_TRACE, OLD_TRACE, SHORT_TRACE } from "./sample.ts";

test("durations: ms under a second, else seconds with a tenth", () => {
  expect([0, 48, 999, 1000, 1234, 18400].map(formatDuration)).toEqual(["0ms", "48ms", "999ms", "1.0s", "1.2s", "18.4s"]);
  expect(formatDuration(null)).toBe("—");
});

test("tokens: plain under a thousand, then thousands with a tenth", () => {
  expect([612, 999, 1000, 9100, 52000].map(formatTokens)).toEqual(["612", "999", "1.0K", "9.1K", "52.0K"]);
});

test("the summary line counts runs, time, and tokens, and shows a dash for none", () => {
  expect(summaryLine(SHORT_TRACE)).toBe("1 run · 4.2s · 6.9K tokens");
  expect(summaryLine(LONG_TRACE)).toMatch(/^2 runs · 24\.0s · /);
  expect(totalTokens(OLD_TRACE)).toBeNull();
  expect(summaryLine(OLD_TRACE)).toBe("1 run · 3.0s · — tokens");
});
