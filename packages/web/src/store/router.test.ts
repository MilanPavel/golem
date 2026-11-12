import { afterEach, expect, test, vi } from "vitest";
import { createRouter, inspectPath, parseRoute, sessionPath, settingsPath, tracePath, welcomePath } from "./router.ts";

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("parseRoute", () => {
  expect(parseRoute("/")).toEqual({ name: "home" });
  expect(parseRoute("/s/abc")).toEqual({ name: "session", id: "abc", inspect: null });
  expect(parseRoute("/s/a%20b")).toEqual({ name: "session", id: "a b", inspect: null });
  for (const bad of ["/s/", "/s", "/s/a/b", "/s/a%2Fb", "/other", "/gallery", "/s/%E0%A4%A"]) {
    expect(parseRoute(bad)).toEqual({ name: "not-found" });
  }
});

test("parseRoute reads ?inspect as the open inspector, and its value as the span", () => {
  expect(parseRoute("/s/abc", "?inspect")).toEqual({ name: "session", id: "abc", inspect: { span: null } });
  expect(parseRoute("/s/abc", "?inspect=")).toEqual({ name: "session", id: "abc", inspect: { span: null } });
  expect(parseRoute("/s/abc", "?inspect=m_2")).toEqual({ name: "session", id: "abc", inspect: { span: "m_2" } });
  expect(parseRoute("/s/abc", "?other=1")).toEqual({ name: "session", id: "abc", inspect: null });
  // The trace page ignores it.
  expect(parseRoute("/s/abc/trace", "?inspect")).toEqual({ name: "trace", id: "abc", span: null });
});

test("inspectPath round-trips through parseRoute", () => {
  expect(inspectPath("s_1")).toBe("/s/s_1?inspect");
  expect(inspectPath("s_1", null)).toBe("/s/s_1?inspect");
  const path = inspectPath("s_1 x", "m_2&3");
  const [pathname, search] = path.split("?");
  expect(parseRoute(pathname ?? "", `?${search ?? ""}`)).toEqual({ name: "session", id: "s_1 x", inspect: { span: "m_2&3" } });
});

test("opening, moving and closing the inspector are route changes of the same session", () => {
  history.replaceState(null, "", "/s/one");
  const router = createRouter();
  const closed = router.getSnapshot();
  router.navigate(inspectPath("one"), { replace: true });
  const open = router.getSnapshot();
  expect(open).toEqual({ name: "session", id: "one", inspect: { span: null } });
  router.navigate(inspectPath("one"), { replace: true });
  expect(router.getSnapshot()).toBe(open);
  router.navigate(inspectPath("one", "m_1"), { replace: true });
  expect(router.getSnapshot()).toEqual({ name: "session", id: "one", inspect: { span: "m_1" } });
  router.navigate(sessionPath("one"), { replace: true });
  expect(router.getSnapshot()).toEqual(closed);
  router.stop();
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
  for (const expected of [{ name: "settings", section: "setup" }, { name: "session", id: "one", inspect: null }]) {
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
  expect(parseRoute(sessionPath("s_1 x"))).toEqual({ name: "session", id: "s_1 x", inspect: null });
});

test("the router starts from the location", () => {
  history.replaceState(null, "", "/s/abc");
  const router = createRouter();
  expect(router.getSnapshot()).toEqual({ name: "session", id: "abc", inspect: null });
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
  expect(router.getSnapshot()).toEqual({ name: "session", id: "one", inspect: null });
  router.navigate("/s/two", { replace: true });
  expect(history.length).toBe(length + 1);
  expect(router.getSnapshot()).toEqual({ name: "session", id: "two", inspect: null });
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

test("parseRoute reads /welcome with its step and origin", () => {
  expect(parseRoute("/welcome")).toEqual({ name: "welcome", step: "engine", from: null });
  expect(parseRoute("/welcome", "?step=model")).toEqual({ name: "welcome", step: "model", from: null });
  expect(parseRoute("/welcome", "?step=tools&from=send")).toEqual({ name: "welcome", step: "tools", from: "send" });
  expect(parseRoute("/welcome", "?step=ready")).toEqual({ name: "welcome", step: "ready", from: null });
  // What is not a step is the first one, and what is not an origin is none.
  expect(parseRoute("/welcome", "?step=service&from=elsewhere")).toEqual({ name: "welcome", step: "engine", from: null });
  expect(parseRoute("/welcome/")).toEqual({ name: "not-found" });
});

test("welcomePath round-trips through parseRoute", () => {
  expect(welcomePath()).toBe("/welcome");
  expect(welcomePath("engine")).toBe("/welcome");
  expect(welcomePath("model")).toBe("/welcome?step=model");
  expect(welcomePath("ready", "send")).toBe("/welcome?step=ready&from=send");
  expect(welcomePath("engine", "send")).toBe("/welcome?from=send");
  for (const [step, from] of [["engine", null], ["model", null], ["tools", "send"], ["ready", "send"]] as const) {
    const [pathname, search] = welcomePath(step, from).split("?");
    expect(parseRoute(pathname ?? "", `?${search ?? ""}`)).toEqual({ name: "welcome", step, from });
  }
});

test("a step change is a route change, the same step is not", () => {
  history.replaceState(null, "", "/welcome");
  const router = createRouter();
  const first = router.getSnapshot();
  router.navigate(welcomePath("engine"), { replace: true });
  expect(router.getSnapshot()).toBe(first);
  router.navigate(welcomePath("model"), { replace: true });
  expect(router.getSnapshot()).toEqual({ name: "welcome", step: "model", from: null });
  router.stop();
});
