import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { INSPECTOR_DEFAULT, INSPECTOR_MAX, INSPECTOR_MIN, INSPECTOR_STEP, INSPECTOR_WIDTH_KEY, inspectorWidthStore } from "./inspector-width.ts";
import { SHORT_TRACE, TOOL_DETAIL } from "./sample.ts";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function open(path: string) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs: SHORT_TRACE } as never);
  fake.raw.getTraceSpan.mockResolvedValue(TOOL_DETAIL as never);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  return { fake, user: userEvent.setup(), ...view };
}

const inspectButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Inspect" });
const panel = () => screen.queryByRole("complementary", { name: "Trace inspector" });

beforeEach(() => {
  localStorage.clear();
  inspectorWidthStore.set(INSPECTOR_DEFAULT);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("Inspect opens the panel and puts it in the address; pressing it again closes it", async () => {
  const { user } = await open("/s/a");
  expect(panel()).toBeNull();
  expect(inspectButton().getAttribute("aria-pressed")).toBe("false");
  await user.click(inspectButton());
  expect(location.pathname + location.search).toBe("/s/a?inspect");
  const aside = panel() as HTMLElement;
  expect(aside).toBeTruthy();
  expect(inspectButton().getAttribute("aria-pressed")).toBe("true");
  expect(await within(aside).findByText("1 run · 0m 04.2s · 6.9K tokens · context 3.4K / 128K · 2%")).toBeTruthy();
  expect(within(aside).getByRole("heading", { name: "Trace" })).toBeTruthy();
  expect(within(aside).getAllByRole("treeitem")).toHaveLength(5);
  // The chat stays beside it.
  expect(screen.getByRole("textbox")).toBeTruthy();
  await user.click(inspectButton());
  expect(panel()).toBeNull();
  expect(location.pathname + location.search).toBe("/s/a");
});

test("a link with ?inspect opens it, and ?inspect=<span> opens it at that span with the detail stacked under the tree", async () => {
  await open("/s/a?inspect=c_2");
  const aside = panel() as HTMLElement;
  expect(await within(aside).findByRole("treeitem", { name: /read_file/, selected: true })).toBeTruthy();
  const detail = within(aside).getByRole("region", { name: "Span detail" });
  expect(await within(detail).findByRole("tab", { name: "Args" })).toBeTruthy();
  const tree = within(aside).getByRole("tree");
  expect(tree.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("selecting a span moves ?inspect to it without adding to the history", async () => {
  const { user } = await open("/s/a?inspect");
  const before = history.length;
  await user.click(await within(panel() as HTMLElement).findByRole("treeitem", { name: /grep/ }));
  expect(location.search).toBe("?inspect=c_1");
  expect(history.length).toBe(before);
});

test("Close, Escape and the shortcut close it; Open full goes to the trace page at the span", async () => {
  const { user } = await open("/s/a?inspect=c_1");
  const aside = panel() as HTMLElement;
  await within(aside).findByRole("tree");
  expect(within(aside).getByRole("link", { name: "Open full ↗" }).getAttribute("href")).toBe("/s/a/trace?span=c_1");
  await user.click(within(aside).getByRole("button", { name: "Close inspector" }));
  expect(panel()).toBeNull();
  expect(location.search).toBe("");
  expect(document.activeElement).toBe(inspectButton());

  await user.click(inspectButton());
  await within(panel() as HTMLElement).findByRole("tree");
  await user.click(within(panel() as HTMLElement).getAllByRole("treeitem")[0] as HTMLElement);
  await user.keyboard("{Escape}");
  expect(panel()).toBeNull();

  const ctrl = navigator.platform.match(/mac/i) ? { metaKey: true } : { ctrlKey: true };
  fireEvent.keyDown(document.body, { key: ".", ...ctrl });
  expect(location.search).toBe("?inspect");
  await waitFor(() => expect(panel()).toBeTruthy());
  fireEvent.keyDown(document.body, { key: ".", ...ctrl });
  expect(panel()).toBeNull();
});

test("Open full leaves for the trace page", async () => {
  const { user } = await open("/s/a?inspect");
  await user.click(within(panel() as HTMLElement).getByRole("link", { name: "Open full ↗" }));
  expect(location.pathname).toBe("/s/a/trace");
  expect(await screen.findByRole("link", { name: "Back to chat" })).toBeTruthy();
});

test("the separator resizes with the arrow keys, within its limits, and remembers the width", async () => {
  const { user } = await open("/s/a?inspect");
  const handle = within(panel() as HTMLElement).getByRole("separator");
  expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_DEFAULT));
  handle.focus();
  await user.keyboard("{ArrowLeft}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_DEFAULT + INSPECTOR_STEP));
  expect((panel() as HTMLElement).style.width).toBe(`${INSPECTOR_DEFAULT + INSPECTOR_STEP}rem`);
  expect(localStorage.getItem(INSPECTOR_WIDTH_KEY)).toBe(String(INSPECTOR_DEFAULT + INSPECTOR_STEP));
  await user.keyboard("{ArrowRight}{ArrowRight}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_DEFAULT - INSPECTOR_STEP));
  await user.keyboard("{Home}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_MIN));
  await user.keyboard("{ArrowRight}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_MIN));
  await user.keyboard("{End}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_MAX));
  await user.keyboard("{ArrowLeft}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_MAX));
});

test("dragging the handle sets the width from the pointer", async () => {
  await open("/s/a?inspect");
  const aside = panel() as HTMLElement;
  aside.getBoundingClientRect = () => ({ right: 1000 }) as DOMRect;
  const handle = within(aside).getByRole("separator");
  fireEvent.pointerDown(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 1000 - 30 * 16 });
  expect(handle.getAttribute("aria-valuenow")).toBe("30");
  fireEvent.pointerUp(handle, { pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 1000 - 40 * 16 });
  expect(handle.getAttribute("aria-valuenow")).toBe("30");
});

test("a width that storage holds is read, and a blocked storage does not break the panel", async () => {
  const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { user } = await open("/s/a?inspect");
  const handle = within(panel() as HTMLElement).getByRole("separator");
  handle.focus();
  await user.keyboard("{ArrowLeft}");
  expect(handle.getAttribute("aria-valuenow")).toBe(String(INSPECTOR_DEFAULT + INSPECTOR_STEP));
  getItem.mockRestore();
  setItem.mockRestore();
});

test("below the narrow breakpoint the panel covers the chat and has no handle", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  const { user } = await open("/s/a?inspect");
  const aside = panel() as HTMLElement;
  expect(aside.hasAttribute("data-narrow")).toBe(true);
  expect(aside.className).toContain("max-narrow:fixed");
  expect(aside.className).toContain("max-narrow:inset-0");
  expect(aside.style.width).toBe("");
  expect(within(aside).getByRole("separator").className).toContain("max-narrow:hidden");
  await user.click(within(aside).getByRole("button", { name: "Close inspector" }));
  expect(panel()).toBeNull();
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the open panel has no accessibility violations in ${theme}`, async () => {
    const { container } = await open("/s/a?inspect=c_2");
    await within(panel() as HTMLElement).findByRole("tab", { name: "Args" });
    document.documentElement.dataset.theme = theme;
    try {
      expect((await axe.run(container, noContrast)).violations).toEqual([]);
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });
}
