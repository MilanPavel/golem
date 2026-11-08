import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { FAILED_TRACE, SHORT_TRACE } from "./sample.ts";
import { SELECT_A_SPAN } from "./trace-screen.tsx";
import type { TraceRunSpan } from "../../store/trace.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function open(path: string, runs: TraceRunSpan[] = SHORT_TRACE) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs } as never);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  return { fake, user: userEvent.setup() };
}

afterEach(() => {
  history.replaceState(null, "", "/");
});

test("the page shows the title, the summary line, the tree, and the empty detail", async () => {
  const { fake } = await open("/s/a/trace");
  expect(await screen.findByRole("heading", { name: "UTF-8 split" })).toBeTruthy();
  expect(await screen.findByText("1 run · 4.2s · 6.9K tokens")).toBeTruthy();
  expect(screen.getAllByRole("treeitem")).toHaveLength(5);
  expect(screen.getByText(SELECT_A_SPAN)).toBeTruthy();
  expect(fake.raw.getTrace).toHaveBeenCalledWith("a");
});

test("a session with no runs says there is nothing to trace, and links back to the chat", async () => {
  await open("/s/a/trace", []);
  expect(await screen.findByText("Nothing to trace yet. Send a message first.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to the chat" }).getAttribute("href")).toBe("/s/a");
});

test("an error says what went wrong and tries again", async () => {
  const { fake, user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  fake.raw.getTrace.mockRejectedValueOnce(new Error("session not found"));
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: null, runs: [] } as never);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("session not found"));
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Nothing to trace yet. Send a message first.")).toBeTruthy();
});

test("Refresh reads the trace again", async () => {
  const { fake, user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  expect(fake.raw.getTrace).toHaveBeenCalledTimes(1);
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs: FAILED_TRACE } as never);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fake.raw.getTrace).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Run · Run the tests")).toBeTruthy();
});

test("selecting a span puts it in the address without adding to the history, and a link opens it", async () => {
  const { user } = await open("/s/a/trace");
  const before = history.length;
  await user.click(await screen.findByRole("treeitem", { name: /grep/ }));
  expect(location.search).toBe("?span=c_1");
  expect(history.length).toBe(before);
  expect(screen.getByRole("treeitem", { name: /grep/, selected: true })).toBeTruthy();
});

test("a link with a span opens with that span selected", async () => {
  await open("/s/a/trace?span=m_2");
  expect(await screen.findByRole("treeitem", { name: /model 2/, selected: true })).toBeTruthy();
});

test("the Chat and Trace switch moves between the views, and the current one is pressed", async () => {
  const { user } = await open("/s/a/trace");
  const group = await screen.findByRole("group", { name: "View" });
  expect(within(group).getByRole("button", { name: "Trace" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(group).getByRole("button", { name: "Chat" }).getAttribute("aria-pressed")).toBe("false");
  await user.click(within(group).getByRole("button", { name: "Chat" }));
  await waitFor(() => expect(location.pathname).toBe("/s/a"));
  const chat = await screen.findByRole("group", { name: "View" });
  expect(within(chat).getByRole("button", { name: "Chat" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(within(chat).getByRole("button", { name: "Trace" }));
  await waitFor(() => expect(location.pathname).toBe("/s/a/trace"));
});

test("the page has no accessibility violations", async () => {
  await open("/s/a/trace");
  await screen.findByRole("tree");
  const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});
