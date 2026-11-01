import { afterEach, expect, test, vi } from "vitest";
import { createRouter, parseRoute, sessionPath } from "./router.ts";

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("parseRoute", () => {
  expect(parseRoute("/")).toEqual({ name: "home" });
  expect(parseRoute("/s/abc")).toEqual({ name: "session", id: "abc" });
  expect(parseRoute("/s/a%20b")).toEqual({ name: "session", id: "a b" });
  for (const bad of ["/s/", "/s", "/s/a/b", "/s/a%2Fb", "/other", "/gallery", "/s/%E0%A4%A"]) {
    expect(parseRoute(bad)).toEqual({ name: "not-found" });
  }
});

test("sessionPath round-trips through parseRoute", () => {
  expect(parseRoute(sessionPath("s_1 x"))).toEqual({ name: "session", id: "s_1 x" });
});

test("the router starts from the location", () => {
  history.replaceState(null, "", "/s/abc");
  const router = createRouter();
  expect(router.getSnapshot()).toEqual({ name: "session", id: "abc" });
  router.stop();
});

test("navigate pushes or replaces, and notifies", () => {
  const router = createRouter();
  const listener = vi.fn();
  router.subscribe(listener);
  const length = history.length;
  router.navigate("/s/one");
  expect(location.pathname).toBe("/s/one");
  expect(history.length).toBe(length + 1);
  expect(router.getSnapshot()).toEqual({ name: "session", id: "one" });
  router.navigate("/s/two", { replace: true });
  expect(history.length).toBe(length + 1);
  expect(router.getSnapshot()).toEqual({ name: "session", id: "two" });
  router.navigate("/nope");
  expect(router.getSnapshot()).toEqual({ name: "not-found" });
  expect(listener).toHaveBeenCalledTimes(3);
  router.stop();
});

test("navigating to the current route keeps the snapshot", () => {
  const router = createRouter();
  const first = router.getSnapshot();
  router.navigate("/");
  expect(router.getSnapshot()).toBe(first);
  router.stop();
});

test("back and forward update the route, and stop ends it", async () => {
  const router = createRouter();
  router.navigate("/s/one");
  const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
  history.back();
  await popped;
  expect(router.getSnapshot()).toEqual({ name: "home" });
  router.stop();
  const again = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
  history.forward();
  await again;
  expect(router.getSnapshot()).toEqual({ name: "home" });
});
