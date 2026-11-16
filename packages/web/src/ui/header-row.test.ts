import { describe, expect, it } from "vitest";
import { HEADER_ROW } from "./header-row.ts";

describe("HEADER_ROW", () => {
  it("fixes a minimum height, centres, and draws the bottom line", () => {
    expect(HEADER_ROW.split(" ")).toEqual(expect.arrayContaining(["min-h-13", "items-center", "border-b", "border-line"]));
  });
});
