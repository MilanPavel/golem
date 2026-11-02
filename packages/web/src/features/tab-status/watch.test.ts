import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPage } from "../../store/page.ts";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { faviconHref } from "./favicon.ts";
import { watchTabStatus } from "./index.ts";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function setup() {
  const fake = fakeClient();
  const pageDoc = new EventTarget() as unknown as Document;
  (pageDoc as { visibilityState: string }).visibilityState = "hidden";
  const page = createPage(fake.client, { frame: fakeFrame(), doc: pageDoc });
  page.start();
  const doc = document.implementation.createHTMLDocument("golem");
  Object.defineProperty(doc, "visibilityState", { value: "hidden" });
  const icon = () => doc.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const stop = watchTabStatus(page, doc);
  return { fake, page, doc, icon, stop };
}

test("a hidden tab shows a waiting approval and goes back to idle", () => {
  const { fake, doc, icon } = setup();
  fake.setState({ status: "connected" });
  expect(doc.title).toBe("golem");
  const idleHref = icon()?.getAttribute("href");
  expect(idleHref).toBe(faviconHref("idle"));

  fake.emitSummary({ ...summary("a", "2026-11-01T10:00:00+00:00"), status: "waiting" });
  expect(doc.title.startsWith("! ")).toBe(true);
  expect(icon()?.getAttribute("href")).toBe(faviconHref("waiting"));

  fake.emitSummary({ ...summary("a", "2026-11-01T10:01:00+00:00", null, 2), status: "idle" });
  expect(doc.title).toBe("golem");
  expect(icon()?.getAttribute("href")).toBe(idleHref);
});

test("a running session marks the tab as working", () => {
  const { fake, doc } = setup();
  fake.setState({ status: "connected" });
  fake.emitSummary({ ...summary("a", "2026-11-01T10:00:00+00:00"), status: "running" });
  expect(doc.title).toBe("● golem");
});

test("a closed session does not count", () => {
  const { fake, doc } = setup();
  fake.setState({ status: "connected" });
  fake.emitSummary({ ...summary("a", "2026-11-01T10:00:00+00:00"), status: "closed" });
  expect(doc.title).toBe("golem");
});

test("the route's session title is in the tab title", () => {
  const { fake, page, doc } = setup();
  fake.setState({ status: "connected" });
  fake.emitSummary({ ...summary("a", "2026-11-01T10:00:00+00:00"), title: "Fix the login bug" });
  fake.emitSummary({ ...summary("b", "2026-11-01T10:00:00+00:00"), title: "Other" });
  expect(doc.title).toBe("golem");
  page.router.navigate("/s/a");
  expect(doc.title).toBe("Fix the login bug · golem");
  page.router.navigate("/s/b");
  expect(doc.title).toBe("Other · golem");
  page.router.navigate("/");
  expect(doc.title).toBe("golem");
});

test("the tab is offline while the connection is not connected", () => {
  const { fake, doc, icon } = setup();
  expect(doc.title).toBe("○ golem");
  expect(icon()?.getAttribute("href")).toBe(faviconHref("offline"));
  fake.setState({ status: "connected" });
  expect(doc.title).toBe("golem");
  fake.setState({ status: "reconnecting", attempt: 1, delayMs: 100 });
  expect(doc.title).toBe("○ golem");
});

test("it reuses an icon link and writes only a change", () => {
  const fake = fakeClient();
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  const doc = document.implementation.createHTMLDocument("golem");
  const existing = doc.createElement("link");
  existing.rel = "icon";
  existing.setAttribute("href", "data:,");
  doc.head.append(existing);
  const stop = watchTabStatus(page, doc);
  expect(doc.head.querySelectorAll("link")).toHaveLength(1);
  expect(existing.getAttribute("href")).toBe(faviconHref("offline"));
  stop();
  fake.setState({ status: "connected" });
  page.connection.start();
  expect(doc.title).toBe("○ golem");
});
