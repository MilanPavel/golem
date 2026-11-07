import { afterEach, expect, test, vi } from "vitest";
import { createRouter, parseRoute, sessionPath, settingsPath, tracePath } from "./router.ts";

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

test("parseRoute reads the settings page and its sections", () => {
  expect(parseRoute("/settings")).toEqual({ name: "settings", section: "setup" });
  expect(parseRoute("/settings/setup")).toEqual({ name: "settings", section: "setup" });
  expect(parseRoute("/settings/mcp")).toEqual({ name: "settings", section: "mcp" });
  expect(parseRoute("/settings/tool-rules")).toEqual({ name: "settings", section: "tool-rules" });
  for (const bad of ["/settings/", "/settings/a/b", "/settings/A", "/settings/a1", "/settingsx"]) {
    expect(parseRoute(bad)).toEqual({ name: "not-found" });
  }
});

test("settingsPath round-trips through parseRoute", () => {
  expect(settingsPath()).toBe("/settings");
  expect(settingsPath("setup")).toBe("/settings");
  expect(settingsPath("appearance")).toBe("/settings/appearance");
  expect(parseRoute(settingsPath("appearance"))).toEqual({ name: "settings", section: "appearance" });
});

test("moving between sections is a new route, and back reaches the section, then the session", async () => {
  const router = createRouter();
  router.navigate("/s/one");
  router.navigate("/settings");
  const first = router.getSnapshot();
  router.navigate("/settings/setup", { replace: true });
  expect(router.getSnapshot()).toBe(first);
  router.navigate("/settings/appearance");
  expect(router.getSnapshot()).toEqual({ name: "settings", section: "appearance" });
  for (const expected of [{ name: "settings", section: "setup" }, { name: "session", id: "one" }]) {
    const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    history.back();
    await popped;
    expect(router.getSnapshot()).toEqual(expected);
  }
  // Go back to the end of the history, so a later test's push does not cut it.
  const forward = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
  history.go(2);
  await forward;
  router.stop();
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

test("parseRoute reads a session's trace and the span in the query", () => {
  expect(parseRoute("/s/abc/trace")).toEqual({ name: "trace", id: "abc", span: null });
  expect(parseRoute("/s/abc/trace", "?span=x")).toEqual({ name: "trace", id: "abc", span: "x" });
  expect(parseRoute("/s/abc/trace", "?span=")).toEqual({ name: "trace", id: "abc", span: null });
  expect(parseRoute("/s/a%20b/trace", "?span=m%201")).toEqual({ name: "trace", id: "a b", span: "m 1" });
  for (const bad of ["/s/abc/trace/", "/s/abc/other", "/s//trace", "/s/a%2Fb/trace"]) {
    expect(parseRoute(bad)).toEqual({ name: "not-found" });
  }
});

test("tracePath round-trips through parseRoute", () => {
  expect(tracePath("s_1")).toBe("/s/s_1/trace");
  const path = tracePath("s_1 x", "m_2&3");
  const [pathname, search] = path.split("?");
  expect(parseRoute(pathname ?? "", `?${search ?? ""}`)).toEqual({ name: "trace", id: "s_1 x", span: "m_2&3" });
});

test("selecting a span is a new route, and the same span is the same route", () => {
  const router = createRouter();
  router.navigate("/s/one/trace");
  const first = router.getSnapshot();
  router.navigate("/s/one/trace", { replace: true });
  expect(router.getSnapshot()).toBe(first);
  router.navigate(tracePath("one", "m_1"), { replace: true });
  expect(router.getSnapshot()).toEqual({ name: "trace", id: "one", span: "m_1" });
  router.stop();
});
