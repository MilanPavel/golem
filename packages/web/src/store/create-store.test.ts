import { expect, test, vi } from "vitest";
import { createStore } from "./create-store.ts";

test("set notifies listeners with the new snapshot", () => {
  const store = createStore({ n: 1 });
  const listener = vi.fn();
  store.subscribe(listener);
  const next = { n: 2 };
  store.set(next);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot()).toBe(next);
});

test("set with the same reference notifies nobody", () => {
  const initial = { n: 1 };
  const store = createStore(initial);
  const listener = vi.fn();
  store.subscribe(listener);
  store.set(initial);
  expect(listener).not.toHaveBeenCalled();
});

test("an unsubscribed listener is not called", () => {
  const store = createStore(0);
  const listener = vi.fn();
  const off = store.subscribe(listener);
  off();
  store.set(1);
  expect(listener).not.toHaveBeenCalled();
});
