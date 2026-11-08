import { expect, test } from "vitest";
import { sparkPoints } from "./sparkline.ts";

test("sparkPoints spreads the values across the width, the highest at the top", () => {
  expect(sparkPoints([0, 50, 100], 22, 12)).toBe("1,11 11,6 21,1");
});
