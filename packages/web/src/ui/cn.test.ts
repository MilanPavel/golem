import { expect, test } from "vitest";
import { cn } from "./cn.ts";

test("a colour token and a size are different groups", () => {
  expect(cn("text-ink text-sm")).toBe("text-ink text-sm");
  expect(cn("text-sm text-ink")).toBe("text-sm text-ink");
});

test("two colour tokens conflict, and the later wins", () => {
  expect(cn("text-ink text-muted")).toBe("text-muted");
  expect(cn("bg-surface bg-clay")).toBe("bg-clay");
  expect(cn("border-line border-deny")).toBe("border-deny");
  expect(cn("text-clay-ink", "text-on-clay")).toBe("text-on-clay");
});

test("a border colour and a border width are different groups", () => {
  expect(cn("border-line-strong border")).toBe("border-line-strong border");
});

test("font families conflict with each other, not with weights", () => {
  expect(cn("font-ui font-mono")).toBe("font-mono");
  expect(cn("font-prose font-medium")).toBe("font-prose font-medium");
});

test("radius tokens conflict", () => {
  expect(cn("rounded-md rounded-lg")).toBe("rounded-lg");
});

test("the soft shadow conflicts with another shadow, not with a ring", () => {
  expect(cn("shadow-soft shadow-none")).toBe("shadow-none");
  expect(cn("shadow-soft ring-2")).toBe("shadow-soft ring-2");
});

test("falsy values are dropped", () => {
  expect(cn("p-2", false, undefined, null, { "m-1": true, "m-2": false })).toBe("p-2 m-1");
});
