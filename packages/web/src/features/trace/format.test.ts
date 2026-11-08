import { expect, test } from "vitest";
import { formatDuration, summaryLine, totalTokens } from "./format.ts";
import { LONG_TRACE, OLD_TRACE, SHORT_TRACE } from "./sample.ts";

test("durations: minutes and seconds, and a dash when unknown", () => {
  expect([0, 4, 999, 1000, 1234, 18400].map(formatDuration)).toEqual(["0m 00.000s", "0m 00.004s", "0m 00.999s", "0m 01.0s", "0m 01.2s", "0m 18.4s"]);
  expect(formatDuration(null)).toBe("—");
});

test("the summary line counts runs, time, and tokens, and shows a dash for none", () => {
  expect(summaryLine(SHORT_TRACE)).toBe("1 run · 0m 04.2s · 6.9K tokens");
  expect(summaryLine(LONG_TRACE)).toMatch(/^2 runs · 0m 24\.0s · /);
  expect(totalTokens(OLD_TRACE)).toBeNull();
  expect(summaryLine(OLD_TRACE)).toBe("1 run · 0m 03.0s · — tokens");
});
