import { expect, test, vi } from "vitest";
import { activeComposer, registerComposer, type ActiveComposer } from "./active-composer.ts";

function composer(): ActiveComposer {
  return { run: vi.fn(() => Promise.resolve("handled")), insert: vi.fn(), focus: vi.fn() };
}

test("none is registered at first", () => {
  expect(activeComposer()).toBeNull();
});

test("the last one registered wins, and unregistering a replaced one changes nothing", () => {
  const a = composer();
  const b = composer();
  const offA = registerComposer(a);
  const offB = registerComposer(b);
  expect(activeComposer()).toBe(b);
  offA();
  expect(activeComposer()).toBe(b);
  offB();
  expect(activeComposer()).toBeNull();
});
